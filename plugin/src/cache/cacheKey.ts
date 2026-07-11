import { ANALYSIS_VERSION, DECODER_VERSION } from "../constants";
import type { AnalysisSettings } from "../types";

export interface CacheKeyInput {
  mediaPath: string;
  fileSize: number;
  lastModified: number;
  sourceInTicks: string;
  sourceOutTicks: string;
  audioStreamIndex: number;
  settings: AnalysisSettings;
  /** フィラーON時のみ。OFF時はキー自体に含めない（ADR-006） */
  transcriptProviderId?: string;
  modelHash?: string;
}

/** FNV-1a 32bit（キャッシュキー用途。暗号用途ではない） */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 設定のうち解析結果へ影響する部分だけのハッシュ */
export function settingsHash(settings: AnalysisSettings): string {
  const sil = settings.silence;
  const relevant: Record<string, unknown> = {
    silence: {
      enabled: sil.enabled,
      autoThreshold: sil.autoThreshold,
      manualThresholdDb: sil.manualThresholdDb,
      noiseMarginDb: sil.noiseMarginDb,
      hysteresisDb: sil.hysteresisDb,
      minSilenceMs: sil.minSilenceMs,
      retainMs: sil.retainMs,
      mode: sil.mode,
      prePaddingMs: sil.prePaddingMs,
      postPaddingMs: sil.postPaddingMs,
      mergeGapMs: sil.mergeGapMs,
      minSpeechMs: sil.minSpeechMs,
      vadEnabled: sil.vadEnabled,
      vadSensitivity: sil.vadSensitivity,
      quietVoiceProtection: sil.quietVoiceProtection,
      channelMode: sil.channelMode,
      processLeadingSilence: sil.processLeadingSilence,
      processTrailingSilence: sil.processTrailingSilence,
      stagedRules: sil.stagedRules
    }
  };
  // フィラー設定はON時のみキャッシュキーへ寄与（OFF時のフィラー関連キャッシュ禁止）
  if (settings.filler.enabled) {
    relevant.filler = {
      gapAfterMs: settings.filler.gapAfterMs,
      safeWords: settings.filler.safeWords,
      contextDependentWords: settings.filler.contextDependentWords,
      transcriptSource: settings.filler.transcriptSource
    };
  }
  return fnv1a(JSON.stringify(relevant));
}

export function buildCacheKey(input: CacheKeyInput): string {
  const parts = [
    `path=${input.mediaPath}`,
    `size=${input.fileSize}`,
    `mtime=${input.lastModified}`,
    `in=${input.sourceInTicks}`,
    `out=${input.sourceOutTicks}`,
    `stream=${input.audioStreamIndex}`,
    `ch=${input.settings.silence.channelMode}`,
    `decoder=${DECODER_VERSION}`,
    `analysis=${ANALYSIS_VERSION}`,
    `settings=${settingsHash(input.settings)}`
  ];
  if (input.settings.filler.enabled) {
    parts.push(`provider=${input.transcriptProviderId ?? "none"}`);
    parts.push(`model=${input.modelHash ?? "none"}`);
  }
  return fnv1a(parts.join("|")) + "-" + fnv1a(parts.reverse().join("|"));
}
