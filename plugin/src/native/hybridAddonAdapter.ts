import type { NativeBridge } from "../types";

export type AddonLoadResult =
  | { ok: true; bridge: NativeBridge }
  | { ok: false; error: string };

/**
 * Hybrid Addon（kazucut-native.uxpaddon）をロードしてNativeBridgeを返す。
 *
 * 実機知見: UXPのHybrid Addonロードは非同期であり、
 * `await require("<addon名>")` がモジュールを解決する（bolt-uxpの実装で確認）。
 * 同期requireの戻り値はPromiseのため、awaitしないと関数が見えず未接続扱いになる。
 */
export async function loadHybridAddon(): Promise<AddonLoadResult> {
  const req = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") {
    return { ok: false, error: "require関数がありません（UXP環境外）" };
  }
  let addon: unknown;
  try {
    addon = await Promise.resolve(req("kazucut-native.uxpaddon"));
  } catch (e) {
    return {
      ok: false,
      error: `require("kazucut-native.uxpaddon")失敗: ${e instanceof Error ? e.message : String(e)}`
    };
  }
  if (typeof addon !== "object" || addon === null) {
    return { ok: false, error: `addonがオブジェクトではありません: ${typeof addon}` };
  }
  const a = addon as Record<string, unknown>;
  const fns = [
    "getVersion",
    "healthCheck",
    "startJob",
    "getJobStatus",
    "getJobResult",
    "cancelJob",
    "disposeJob"
  ];
  const missing = fns.filter((f) => typeof a[f] !== "function");
  if (missing.length > 0) {
    return {
      ok: false,
      error: `addonに関数がありません: ${missing.join(", ")}（存在するキー: ${Object.keys(a).join(", ")}）`
    };
  }
  const call = (name: string, ...args: unknown[]): unknown =>
    (a[name] as (...x: unknown[]) => unknown)(...args);
  return {
    ok: true,
    bridge: {
      getVersion: () => {
        const raw = call("getVersion") as string;
        return JSON.parse(raw);
      },
      healthCheck: () => String(call("healthCheck")),
      startJob: (requestJson: string) => String(call("startJob", requestJson)),
      getJobStatus: (jobId: string) => String(call("getJobStatus", jobId)),
      getJobResult: (jobId: string) => String(call("getJobResult", jobId)),
      cancelJob: (jobId: string) => Boolean(call("cancelJob", jobId)),
      disposeJob: (jobId: string) => Boolean(call("disposeJob", jobId))
    }
  };
}
