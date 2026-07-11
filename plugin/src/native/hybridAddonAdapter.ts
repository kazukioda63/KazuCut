import type { NativeBridge } from "../types";

/**
 * Hybrid Addon（kazucut-native.uxpaddon）をロードしてNativeBridgeを返す。
 * UXP環境ではmanifestの addon.name をrequireでロードする
 * （公式Hybrid SDKサンプルの方式。実機未検証: SDK_SETUP_REQUIRED.md）。
 * ロードできない環境（開発・SDKなし・非Windows）ではnullを返し、
 * 呼び出し側がMockNativeAdapterへフォールバックして「未接続」を明示する。
 */
export function tryLoadHybridAddon(): NativeBridge | null {
  const req = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  let addon: unknown;
  try {
    addon = req("kazucut-native.uxpaddon");
  } catch {
    return null;
  }
  if (typeof addon !== "object" || addon === null) return null;
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
  for (const f of fns) {
    if (typeof a[f] !== "function") return null;
  }
  const call = (name: string, ...args: unknown[]): unknown =>
    (a[name] as (...x: unknown[]) => unknown)(...args);
  return {
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
  };
}
