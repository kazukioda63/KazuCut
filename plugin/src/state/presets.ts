import type { AnalysisSettings, Preset, SilenceSettings, FillerSettings } from "../types";

/** 安全語（自動選択される） 仕様25章 */
export const SAFE_FILLER_WORDS = ["えー", "ええと", "えっと", "あー", "あのー", "うーん", "んー"];

/** 文脈依存語（初期状態で自動選択しない） 仕様25章 */
export const CONTEXT_DEPENDENT_FILLER_WORDS = ["あの", "その", "まあ", "なんか", "こう", "やっぱ"];

function fillerDefaults(): FillerSettings {
  return {
    enabled: false, // ADR-006: 初期値OFF。全標準プリセットでOFF
    gapAfterMs: 80,
    safeWords: [...SAFE_FILLER_WORDS],
    contextDependentWords: [...CONTEXT_DEPENDENT_FILLER_WORDS],
    transcriptSource: "auto"
  };
}

function silenceBase(): Omit<
  SilenceSettings,
  | "noiseMarginDb"
  | "hysteresisDb"
  | "minSilenceMs"
  | "retainMs"
  | "prePaddingMs"
  | "postPaddingMs"
  | "mergeGapMs"
  | "minSpeechMs"
  | "vadSensitivity"
> {
  return {
    enabled: true,
    autoThreshold: true,
    manualThresholdDb: -40,
    mode: "shorten",
    vadEnabled: true,
    quietVoiceProtection: true,
    channelMode: "auto",
    processLeadingSilence: true,
    processTrailingSilence: true,
    stagedRules: null
  };
}

export function createNaturalPreset(): Preset {
  return {
    name: "自然",
    builtIn: true,
    settings: {
      silence: {
        ...silenceBase(),
        noiseMarginDb: 6,
        hysteresisDb: 3,
        minSilenceMs: 450,
        retainMs: 160,
        prePaddingMs: 55,
        postPaddingMs: 90,
        mergeGapMs: 70,
        minSpeechMs: 120,
        vadSensitivity: 2
      },
      filler: fillerDefaults(),
      cpuThreads: 0
    }
  };
}

export function createShortsFastPreset(): Preset {
  return {
    name: "ショート高速",
    builtIn: true,
    settings: {
      silence: {
        ...silenceBase(),
        noiseMarginDb: 7,
        hysteresisDb: 3,
        minSilenceMs: 280,
        retainMs: 90,
        prePaddingMs: 35,
        postPaddingMs: 60,
        mergeGapMs: 55,
        minSpeechMs: 100,
        vadSensitivity: 2
      },
      filler: fillerDefaults(),
      cpuThreads: 0
    }
  };
}

export function createConservativePreset(): Preset {
  return {
    name: "保守的",
    builtIn: true,
    settings: {
      silence: {
        ...silenceBase(),
        noiseMarginDb: 5,
        hysteresisDb: 4,
        minSilenceMs: 650,
        retainMs: 220,
        prePaddingMs: 80,
        postPaddingMs: 120,
        mergeGapMs: 100,
        minSpeechMs: 150,
        vadSensitivity: 1
      },
      filler: fillerDefaults(),
      cpuThreads: 0
    }
  };
}

export function builtInPresets(): Preset[] {
  return [createNaturalPreset(), createShortsFastPreset(), createConservativePreset()];
}

/** 設定値の妥当性検証。不正値はエラーメッセージ（日本語）を返す */
export function validateSettings(s: AnalysisSettings): string[] {
  const errors: string[] = [];
  const sil = s.silence;
  if (sil.noiseMarginDb < 0 || sil.noiseMarginDb > 40)
    errors.push("ノイズマージンは0〜40dBで指定してください。");
  if (sil.hysteresisDb < 0 || sil.hysteresisDb > 20)
    errors.push("ヒステリシスは0〜20dBで指定してください。");
  if (sil.manualThresholdDb > 0 || sil.manualThresholdDb < -90)
    errors.push("手動しきい値は-90〜0dBで指定してください。");
  if (sil.minSilenceMs < 50 || sil.minSilenceMs > 10000)
    errors.push("最小無音時間は50〜10,000msで指定してください。");
  if (sil.retainMs < 0 || sil.retainMs > 5000)
    errors.push("残す無音は0〜5,000msで指定してください。");
  if (sil.mode === "shorten" && sil.retainMs >= sil.minSilenceMs)
    errors.push("残す無音は最小無音時間より短くしてください。");
  if (sil.prePaddingMs < 0 || sil.prePaddingMs > 1000)
    errors.push("前側余白は0〜1,000msで指定してください。");
  if (sil.postPaddingMs < 0 || sil.postPaddingMs > 1000)
    errors.push("後側余白は0〜1,000msで指定してください。");
  if (sil.mergeGapMs < 0 || sil.mergeGapMs > 2000)
    errors.push("近接結合は0〜2,000msで指定してください。");
  if (sil.minSpeechMs < 0 || sil.minSpeechMs > 2000)
    errors.push("最小発話長は0〜2,000msで指定してください。");
  if (![0, 1, 2, 3].includes(sil.vadSensitivity))
    errors.push("VAD感度は0〜3で指定してください。");
  if (sil.stagedRules) {
    for (const r of sil.stagedRules) {
      if (r.retainMs >= r.minDurationMs)
        errors.push("段階処理: 残す長さは対象最小長より短くしてください。");
    }
  }
  if (s.filler.gapAfterMs < 0 || s.filler.gapAfterMs > 1000)
    errors.push("フィラー削除後の間は0〜1,000msで指定してください。");
  if (s.cpuThreads < 0 || s.cpuThreads > 64 || !Number.isInteger(s.cpuThreads))
    errors.push("CPUスレッド数は0（自動）〜64の整数で指定してください。");
  return errors;
}
