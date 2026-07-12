import type { StateStorage } from "./settingsStore";

/**
 * plugin-data:/ への設定保存（UXP storage API）。
 * UXP外（テスト・開発）ではnullを返し、呼び出し側は保存なしで動作継続する。
 */
export function createUxpStorage(fileName = "settings.json"): StateStorage | null {
  const req = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  let uxp: {
    storage?: {
      localFileSystem?: { getDataFolder(): Promise<unknown> };
      formats?: { utf8?: unknown };
    };
  };
  try {
    uxp = req("uxp") as typeof uxp;
  } catch {
    return null;
  }
  const lfs = uxp.storage?.localFileSystem;
  if (!lfs) return null;
  const utf8 = uxp.storage?.formats?.utf8;

  interface DataFolder {
    getEntry(name: string): Promise<{ read(opts?: { format?: unknown }): Promise<string> }>;
    createFile(name: string, opts: { overwrite: boolean }): Promise<{
      write(data: string, opts?: { format?: unknown }): Promise<void>;
    }>;
  }

  return {
    read: async (): Promise<string | null> => {
      try {
        const folder = (await lfs.getDataFolder()) as DataFolder;
        const entry = await folder.getEntry(fileName);
        const text = await entry.read(utf8 ? { format: utf8 } : undefined);
        return typeof text === "string" ? text : null;
      } catch {
        return null; // 初回起動などファイルなし
      }
    },
    write: async (data: string): Promise<void> => {
      const folder = (await lfs.getDataFolder()) as DataFolder;
      const file = await folder.createFile(fileName, { overwrite: true });
      await file.write(data, utf8 ? { format: utf8 } : undefined);
    }
  };
}
