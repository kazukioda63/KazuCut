import { describe, expect, it, vi } from "vitest";
import { acquireTranscript, buildJobRequest } from "../../plugin/src/analysis/analysisController";
import { createShortsFastPreset } from "../../plugin/src/state/presets";
import type { TranscriptProvider, TranscriptResult } from "../../plugin/src/types";

const target = {
  jobId: "job-1",
  mediaPath: "C:\\Videos\\sample.mp4",
  sourceInTicks: "0",
  sourceOutTicks: "2540160000000",
  audioStreamIndex: 0
};

function spyProvider(result: TranscriptResult, available = true): TranscriptProvider & {
  isAvailableSpy: ReturnType<typeof vi.fn>;
  transcribeSpy: ReturnType<typeof vi.fn>;
} {
  const isAvailableSpy = vi.fn(async () => available);
  const transcribeSpy = vi.fn(async () => result);
  return {
    id: "spy",
    displayName: "Spy",
    isAvailable: isAvailableSpy,
    transcribe: transcribeSpy,
    isAvailableSpy,
    transcribeSpy
  };
}

const wordResult: TranscriptResult = {
  providerId: "spy",
  hasWordTimings: true,
  words: [{ text: "えっと", startMs: 0, endMs: 400 }]
};

const context = { mediaPath: target.mediaPath, clipId: "clip1" };

describe("フィラーOFFの保証（ADR-006）", () => {
  it("OFF時: ジョブリクエストにfillerセクション自体が存在しない", () => {
    const settings = createShortsFastPreset().settings;
    expect(settings.filler.enabled).toBe(false);
    const req = buildJobRequest(target, settings, "C:\\models\\ggml-small.bin");
    expect("filler" in req).toBe(false);
    expect(JSON.parse(JSON.stringify(req)).filler).toBeUndefined();
  });

  it("OFF時: TranscriptProviderのisAvailable/transcribeを一切呼ばない", async () => {
    const settings = createShortsFastPreset().settings;
    const premiere = spyProvider(wordResult);
    const whisper = spyProvider(wordResult);
    const outcome = await acquireTranscript(settings, context, premiere, whisper, true);
    expect(outcome.kind).toBe("disabled");
    expect(premiere.isAvailableSpy).not.toHaveBeenCalled();
    expect(premiere.transcribeSpy).not.toHaveBeenCalled();
    expect(whisper.isAvailableSpy).not.toHaveBeenCalled();
    expect(whisper.transcribeSpy).not.toHaveBeenCalled();
  });

  it("ON時: ジョブリクエストにfillerセクションが含まれる", () => {
    const settings = createShortsFastPreset().settings;
    settings.filler.enabled = true;
    const req = buildJobRequest(target, settings, "C:\\models\\ggml-small.bin");
    expect(req.filler).toBeDefined();
    expect(req.filler!.modelPath).toBe("C:\\models\\ggml-small.bin");
  });
});

describe("ON時の優先順位（仕様4.3）", () => {
  it("Premiereに単語時刻があればPremiereを使う（Whisper未実行）", async () => {
    const settings = createShortsFastPreset().settings;
    settings.filler.enabled = true;
    const premiere = spyProvider(wordResult);
    const whisper = spyProvider(wordResult);
    const outcome = await acquireTranscript(settings, context, premiere, whisper, true);
    expect(outcome.kind).toBe("ok");
    expect(premiere.transcribeSpy).toHaveBeenCalledTimes(1);
    expect(whisper.transcribeSpy).not.toHaveBeenCalled();
  });

  it("Premiereが単語時刻なしならWhisperへフォールバック", async () => {
    const settings = createShortsFastPreset().settings;
    settings.filler.enabled = true;
    const segmentOnly: TranscriptResult = {
      providerId: "premiere",
      hasWordTimings: false,
      words: null,
      segments: [{ text: "長い段落テキスト", startMs: 0, endMs: 8000 }]
    };
    const premiere = spyProvider(segmentOnly);
    const whisper = spyProvider(wordResult);
    const outcome = await acquireTranscript(settings, context, premiere, whisper, true);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.result.hasWordTimings).toBe(true);
    expect(whisper.transcribeSpy).toHaveBeenCalledTimes(1);
  });

  it("Whisperモデル未設定ならスキップ（仕様の文言で通知、無音処理は継続）", async () => {
    const settings = createShortsFastPreset().settings;
    settings.filler.enabled = true;
    const premiere = spyProvider(wordResult, false); // Transcriptなし
    const whisper = spyProvider(wordResult);
    const outcome = await acquireTranscript(settings, context, premiere, whisper, false);
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.userMessage).toContain("フィラー解析をスキップしました");
      expect(outcome.userMessage).toContain("無音解析は正常に完了しました");
    }
    expect(whisper.transcribeSpy).not.toHaveBeenCalled();
  });
});
