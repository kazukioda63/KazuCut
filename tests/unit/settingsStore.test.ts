import { describe, expect, it } from "vitest";
import {
  allPresets,
  defaultState,
  loadState,
  saveState,
  type StateStorage
} from "../../plugin/src/state/settingsStore";
import { createNaturalPreset } from "../../plugin/src/state/presets";

function memStorage(initial: string | null = null): StateStorage & { data: string | null } {
  const store = {
    data: initial,
    read: async (): Promise<string | null> => store.data,
    write: async (d: string): Promise<void> => {
      store.data = d;
    }
  };
  return store;
}

describe("設定保存（仕様29章）", () => {
  it("保存→読込の往復", async () => {
    const storage = memStorage();
    const state = defaultState();
    state.lastVideoTrackIndex = 2;
    state.whisperModelToken = "token-abc";
    await saveState(storage, state);
    const loaded = await loadState(storage);
    expect(loaded.lastVideoTrackIndex).toBe(2);
    expect(loaded.whisperModelToken).toBe("token-abc");
  });

  it("壊れたJSONでクラッシュせずデフォルトへ", async () => {
    const loaded = await loadState(memStorage("{ broken json !!"));
    expect(loaded.schemaVersion).toBe(defaultState().schemaVersion);
    expect(loaded.currentSettings.filler.enabled).toBe(false);
  });

  it("未知のSchema Versionはデフォルトへ", async () => {
    const loaded = await loadState(memStorage(JSON.stringify({ schemaVersion: 999 })));
    expect(loaded.outputMode).toBe("duplicate");
  });

  it("読込失敗（例外）でもデフォルトへ", async () => {
    const storage: StateStorage = {
      read: async () => {
        throw new Error("IO error");
      },
      write: async () => undefined
    };
    const loaded = await loadState(storage);
    expect(loaded.outputMode).toBe("duplicate");
  });

  it("初期出力モードは複製シーケンス（仕様17章）", () => {
    expect(defaultState().outputMode).toBe("duplicate");
  });

  it("初期設定のフィラーはOFF（ADR-006）", () => {
    expect(defaultState().currentSettings.filler.enabled).toBe(false);
  });

  it("フィラーONのカスタムプリセットだけがONを復元する（仕様4.4）", async () => {
    const storage = memStorage();
    const state = defaultState();
    const custom = createNaturalPreset();
    custom.name = "マイ設定";
    custom.builtIn = false;
    custom.settings.filler.enabled = true;
    state.customPresets = [custom];
    await saveState(storage, state);
    const loaded = await loadState(storage);
    const presets = allPresets(loaded);
    const builtIns = presets.filter((p) => p.builtIn);
    const customs = presets.filter((p) => !p.builtIn);
    expect(builtIns.every((p) => !p.settings.filler.enabled)).toBe(true);
    expect(customs).toHaveLength(1);
    expect(customs[0]!.settings.filler.enabled).toBe(true);
  });

  it("不正なカスタムプリセットは除外する", async () => {
    const state = defaultState();
    const bad = createNaturalPreset();
    bad.name = "壊れた";
    bad.builtIn = false;
    bad.settings.silence.minSilenceMs = -5;
    state.customPresets = [bad];
    const storage = memStorage();
    await saveState(storage, state);
    const loaded = await loadState(storage);
    expect(loaded.customPresets).toHaveLength(0);
  });
});
