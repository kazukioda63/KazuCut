import type {
  AnalysisJobRequest,
  AnalysisSettings,
  TranscriptContext,
  TranscriptProvider,
  TranscriptResult
} from "../types";
import { createError } from "../errors";
import type { KazuCutError } from "../types";
import type { TickString } from "../ticks";

export interface AnalysisTarget {
  jobId: string;
  mediaPath: string;
  sourceInTicks: TickString;
  sourceOutTicks: TickString;
  audioStreamIndex: number;
}

/**
 * WorkerへのジョブリクエストJSONを構築する。
 * フィラーOFF時は `filler` プロパティ自体を含めない（ADR-006）。
 * Worker側はfillerセクション不在ならWhisper関連コードへ到達しない。
 */
export function buildJobRequest(
  target: AnalysisTarget,
  settings: AnalysisSettings,
  whisperModelPath: string | null
): AnalysisJobRequest {
  const request: AnalysisJobRequest = {
    jobId: target.jobId,
    mediaPath: target.mediaPath,
    sourceInTicks: target.sourceInTicks,
    sourceOutTicks: target.sourceOutTicks,
    audioStreamIndex: target.audioStreamIndex,
    silence: settings.silence,
    cpuThreads: settings.cpuThreads
  };
  if (settings.filler.enabled) {
    request.filler = {
      ...settings.filler,
      modelPath: whisperModelPath ?? ""
    };
  }
  return request;
}

export type TranscriptOutcome =
  | { kind: "disabled" }
  | { kind: "ok"; result: TranscriptResult; providerId: string }
  | { kind: "skipped"; userMessage: string }
  | { kind: "error"; error: KazuCutError };

/**
 * フィラー用Transcript取得（仕様4.3の優先順位）。
 *
 * **フィラーOFF時はProviderのisAvailableすら呼ばずに即returnする（ADR-006）。**
 * ON時: Premiere優先 → 単語時刻なしならWhisper → モデル未設定ならスキップ。
 */
export async function acquireTranscript(
  settings: AnalysisSettings,
  context: TranscriptContext,
  premiereProvider: TranscriptProvider,
  whisperProvider: TranscriptProvider,
  whisperModelConfigured: boolean,
  signal?: AbortSignal
): Promise<TranscriptOutcome> {
  if (!settings.filler.enabled) {
    return { kind: "disabled" };
  }

  const source = settings.filler.transcriptSource;
  const tryPremiere = source === "auto" || source === "premiere";
  const tryWhisper = source === "auto" || source === "whisper";

  if (tryPremiere) {
    try {
      if (await premiereProvider.isAvailable(context)) {
        const result = await premiereProvider.transcribe(context, signal);
        if (result.hasWordTimings && result.words && result.words.length > 0) {
          return { kind: "ok", result, providerId: premiereProvider.id };
        }
        // 単語時刻なし → Whisperへフォールバック（文字数比率推定は禁止）
      }
    } catch (e) {
      if (signal?.aborted) {
        return { kind: "error", error: createError("CANCELLED", "transcript取得中にキャンセル") };
      }
      // Premiere Transcriptの失敗は致命ではない。Whisperへ進む
      if (!tryWhisper) {
        return {
          kind: "error",
          error: createError(
            "TRANSCRIPT_NOT_FOUND",
            e instanceof Error ? e.message : String(e)
          )
        };
      }
    }
  }

  if (tryWhisper) {
    if (!whisperModelConfigured) {
      return {
        kind: "skipped",
        userMessage:
          "フィラー解析をスキップしました。\n\n" +
          "Premiereの文字起こしに必要な単語時刻がなく、\n" +
          "ローカルWhisperモデルも設定されていません。\n\n" +
          "無音解析は正常に完了しました。"
      };
    }
    try {
      const result = await whisperProvider.transcribe(context, signal);
      if (result.hasWordTimings && result.words && result.words.length > 0) {
        return { kind: "ok", result, providerId: whisperProvider.id };
      }
      return {
        kind: "error",
        error: createError("WHISPER_FAILED", "Whisperが単語時刻を返しませんでした")
      };
    } catch (e) {
      if (signal?.aborted) {
        return { kind: "error", error: createError("CANCELLED", "Whisper実行中にキャンセル") };
      }
      return {
        kind: "error",
        error: createError("WHISPER_FAILED", e instanceof Error ? e.message : String(e))
      };
    }
  }

  return {
    kind: "skipped",
    userMessage:
      "フィラー解析をスキップしました。文字起こし方式の設定を確認してください。\n無音解析は正常に完了しました。"
  };
}
