import { SETTINGS_SCHEMA_VERSION } from "../constants";
import type { AnalysisSettings, Preset } from "../types";
import { builtInPresets, createShortsFastPreset, validateSettings } from "./presets";

export interface StoredState {
  schemaVersion: number;
  currentSettings: AnalysisSettings;
  customPresets: Preset[];
  lastVideoTrackIndex: number;
  lastAudioTrackIndex: number;
  outputMode: "duplicate" | "direct";
  whisperModelToken: string | null;
  uiState: Record<string, string | number | boolean>;
}

export function defaultState(): StoredState {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    currentSettings: createShortsFastPreset().settings,
    customPresets: [],
    lastVideoTrackIndex: 0,
    lastAudioTrackIndex: 0,
    outputMode: "duplicate", // 仕様17章: 初期値は複製シーケンスで編集
    whisperModelToken: null,
    uiState: {}
  };
}

/** ストレージ抽象（実機ではplugin-data:/、テストではメモリ） */
export interface StateStorage {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

/**
 * 保存済みJSONを読み込む。壊れたJSON・未知Schema・検証エラーは
 * クラッシュせずデフォルトへフォールバックする（仕様29章）。
 */
export async function loadState(storage: StateStorage): Promise<StoredState> {
  let text: string | null;
  try {
    text = await storage.read();
  } catch {
    return defaultState();
  }
  if (text === null || text.trim() === "") return defaultState();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaultState();
  }
  if (typeof raw !== "object" || raw === null) return defaultState();
  const obj = raw as Partial<StoredState>;
  if (obj.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    // 将来: マイグレーション。現状は安全側でデフォルトへ
    return defaultState();
  }
  const def = defaultState();
  const state: StoredState = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    currentSettings: obj.currentSettings ?? def.currentSettings,
    customPresets: Array.isArray(obj.customPresets) ? obj.customPresets : [],
    lastVideoTrackIndex:
      typeof obj.lastVideoTrackIndex === "number" ? obj.lastVideoTrackIndex : 0,
    lastAudioTrackIndex:
      typeof obj.lastAudioTrackIndex === "number" ? obj.lastAudioTrackIndex : 0,
    outputMode: obj.outputMode === "direct" ? "direct" : "duplicate",
    whisperModelToken:
      typeof obj.whisperModelToken === "string" ? obj.whisperModelToken : null,
    uiState: typeof obj.uiState === "object" && obj.uiState !== null ? obj.uiState : {}
  };
  // 設定の妥当性検証。不正ならデフォルト設定へ
  if (validateSettings(state.currentSettings).length > 0) {
    state.currentSettings = def.currentSettings;
  }
  // カスタムプリセットの不正エントリを除外
  state.customPresets = state.customPresets.filter(
    (p) =>
      typeof p.name === "string" &&
      p.name.length > 0 &&
      !p.builtIn &&
      p.settings !== undefined &&
      validateSettings(p.settings).length === 0
  );
  return state;
}

export async function saveState(storage: StateStorage, state: StoredState): Promise<void> {
  await storage.write(JSON.stringify(state, null, 2));
}

/** 標準+カスタムのプリセット一覧。標準はすべてフィラーOFF（ADR-006） */
export function allPresets(state: StoredState): Preset[] {
  return [...builtInPresets(), ...state.customPresets];
}
