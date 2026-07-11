export const PLUGIN_ID = "com.kazu.premiere.kazucutlocal";
export const PLUGIN_VERSION = "0.1.0";

/**
 * Premiereのtick分解能（254,016,000,000 ticks/秒）。
 * 公式ドキュメントに明記が見つからないため、API Probe（TickTime.createWithSeconds(1).ticks）
 * で実機検証するまでは「表示・概算」にのみ使用し、編集位置の決定には使用しない。
 * 編集位置は常にTick文字列演算（ticks.ts）とTickTime APIで扱う。
 */
export const ASSUMED_TICKS_PER_SECOND = "254016000000";

export const SETTINGS_SCHEMA_VERSION = 1;
export const ANALYSIS_VERSION = 1;
export const DECODER_VERSION = 1;

export const UNDO_LABEL = "KazuCut Local：Aロールを編集";
export const GENERATED_BIN_NAME = "KazuCut Generated";

/** A/Vペア解決の許容差（ms）。フレーム/サンプル境界のずれを吸収する */
export const AV_PAIR_TOLERANCE_MS = 1;

/** 適用後検証: 映像同期誤差の許容（フレーム数未満） */
export const MAX_SYNC_ERROR_FRAMES = 1;
