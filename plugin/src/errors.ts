import type { KazuCutError } from "./types";

interface ErrorDef {
  userMessage: string;
  recoverable: boolean;
}

const ERROR_DEFS: Record<string, ErrorDef> = {
  NO_ACTIVE_PROJECT: {
    userMessage: "開いているプロジェクトがありません。プロジェクトを開いてから実行してください。",
    recoverable: true
  },
  NO_ACTIVE_SEQUENCE: {
    userMessage: "アクティブなシーケンスがありません。タイムラインでシーケンスを開いてください。",
    recoverable: true
  },
  NO_TARGET_VIDEO_TRACK: {
    userMessage: "映像トラックが選択されていません。パネルで映像トラックを選択してください。",
    recoverable: true
  },
  NO_TARGET_AUDIO_TRACK: {
    userMessage: "会話音声トラックが選択されていません。パネルで音声トラックを選択してください。",
    recoverable: true
  },
  NO_SELECTED_CLIP: {
    userMessage: "クリップが選択されていません。タイムラインでAロールのクリップを選択するか、対象を「Aロールトラック全体」へ変更してください。",
    recoverable: true
  },
  AMBIGUOUS_AUDIO_PAIR: {
    userMessage: "映像クリップに対応する音声クリップを一意に特定できませんでした。候補から選択するか、タイムラインを確認してください。",
    recoverable: true
  },
  MEDIA_OFFLINE: {
    userMessage: "メディアがオフラインです。メディアを再リンクしてから実行してください。",
    recoverable: true
  },
  MEDIA_NOT_FOUND: {
    userMessage: "メディアファイルが見つかりません。ファイルの場所を確認してください。",
    recoverable: true
  },
  UNSUPPORTED_SPEED: {
    userMessage: "100%以外の速度のクリップは処理できません。速度変更はKazuCut実行後（編集終盤）に行ってください。",
    recoverable: true
  },
  UNSUPPORTED_REVERSE: {
    userMessage: "逆再生クリップは処理できません。",
    recoverable: true
  },
  UNSUPPORTED_TIME_REMAP: {
    userMessage: "タイムリマップされたクリップは処理できません。",
    recoverable: true
  },
  UNSUPPORTED_NEST: {
    userMessage: "ネストされたシーケンスは処理できません。",
    recoverable: true
  },
  UNSUPPORTED_MULTICAM: {
    userMessage: "マルチカメラクリップは処理できません。",
    recoverable: true
  },
  UNSUPPORTED_MERGED_CLIP: {
    userMessage: "結合クリップ（Merged Clip）は処理できません。",
    recoverable: true
  },
  UNSUPPORTED_EFFECTED_CLIP: {
    userMessage: "複雑なエフェクトやトランジションが適用されたクリップは処理できません。",
    recoverable: true
  },
  NATIVE_ADDON_NOT_LOADED: {
    userMessage: "ネイティブモジュールを読み込めませんでした。プラグインを再インストールしてください。",
    recoverable: false
  },
  WORKER_NOT_FOUND: {
    userMessage: "解析プログラム（KazuCutWorker.exe）が見つかりません。プラグインを再インストールしてください。",
    recoverable: false
  },
  WORKER_START_FAILED: {
    userMessage: "解析プログラムを起動できませんでした。セキュリティソフトの設定を確認してください。",
    recoverable: true
  },
  WORKER_CRASHED: {
    userMessage: "解析プログラムが異常終了しました。もう一度お試しください。",
    recoverable: true
  },
  WORKER_PROTOCOL_ERROR: {
    userMessage: "解析プログラムとの通信でエラーが発生しました。もう一度お試しください。",
    recoverable: true
  },
  WORKER_TIMEOUT: {
    userMessage: "解析がタイムアウトしました。素材が長い場合は時間をおいて再実行してください。",
    recoverable: true
  },
  AUDIO_STREAM_NOT_FOUND: {
    userMessage: "動画ファイル内に音声が見つかりませんでした。",
    recoverable: true
  },
  AUDIO_DECODE_FAILED: {
    userMessage: "音声のデコードに失敗しました。対応形式（MP4/MOV内のAAC等）か確認してください。",
    recoverable: true
  },
  AUDIO_SEEK_FAILED: {
    userMessage: "音声のシークに失敗しました。ファイルが破損していないか確認してください。",
    recoverable: true
  },
  TRANSCRIPT_NOT_FOUND: {
    userMessage: "Premiereの文字起こしが見つかりませんでした。",
    recoverable: true
  },
  TRANSCRIPT_SCHEMA_UNSUPPORTED: {
    userMessage: "Premiereの文字起こし形式を解釈できませんでした。",
    recoverable: true
  },
  TRANSCRIPT_HAS_NO_WORD_TIMINGS: {
    userMessage: "Premiereの文字起こしに単語ごとの時刻情報がありません。",
    recoverable: true
  },
  WHISPER_MODEL_NOT_FOUND: {
    userMessage: "ローカルWhisperモデルが設定されていないか、見つかりません。",
    recoverable: true
  },
  WHISPER_FAILED: {
    userMessage: "ローカル音声認識に失敗しました。",
    recoverable: true
  },
  SEQUENCE_CLONE_FAILED: {
    userMessage: "シーケンスの複製に失敗しました。元のシーケンスは変更されていません。",
    recoverable: true
  },
  CLONED_SEQUENCE_NOT_IDENTIFIED: {
    userMessage: "複製したシーケンスを特定できませんでした。安全のため処理を中止しました。元のシーケンスは変更されていません。",
    recoverable: true
  },
  TRACK_ITEM_CLONE_FAILED: {
    userMessage: "クリップの複製に失敗しました。処理を中止しました。",
    recoverable: true
  },
  TRACK_ITEM_MAPPING_FAILED: {
    userMessage: "複製したクリップを一意に特定できませんでした。安全のため処理を中止しました。",
    recoverable: true
  },
  TIMELINE_REBUILD_FAILED: {
    userMessage: "タイムラインの再構築に失敗しました。元のシーケンスは保護されています。",
    recoverable: true
  },
  NON_TARGET_TRACK_CHANGED: {
    userMessage: "対象外トラックに意図しない変更を検出しました。処理を失敗として扱います。編集結果を確認し、必要ならUndoしてください。",
    recoverable: false
  },
  SYNC_VALIDATION_FAILED: {
    userMessage: "編集後のA/V同期検証で許容誤差を超えるずれを検出しました。処理を失敗として扱います。",
    recoverable: false
  },
  BACKUP_SEQUENCE_FAILED: {
    userMessage: "バックアップ用シーケンスの複製に失敗したため、直接編集を開始しませんでした。",
    recoverable: true
  },
  CANCELLED: {
    userMessage: "処理をキャンセルしました。",
    recoverable: true
  }
};

export type KazuCutErrorCode = keyof typeof ERROR_DEFS;

export function createError(
  code: string,
  developerMessage: string,
  details?: Record<string, unknown>
): KazuCutError {
  const def = ERROR_DEFS[code];
  const base: KazuCutError = {
    code,
    userMessage: def ? def.userMessage : `エラーが発生しました（${code}）。`,
    developerMessage,
    recoverable: def ? def.recoverable : false
  };
  if (details !== undefined) base.details = details;
  return base;
}

export function isKnownErrorCode(code: string): boolean {
  return code in ERROR_DEFS;
}

export const ALL_ERROR_CODES: string[] = Object.keys(ERROR_DEFS);
