import { describe, expect, it } from "vitest";
import { parseTranscriptJson } from "../../plugin/src/transcript/transcriptParser";

describe("Transcript防御的パーサ（ADR-004）", () => {
  it("words配列（秒単位）を単語時刻として解釈する", () => {
    const json = JSON.stringify({
      words: [
        { text: "えっと", start: 0.1, end: 0.48 },
        { text: "今日は", start: 0.6, end: 1.1 }
      ]
    });
    const r = parseTranscriptJson(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.hasWordTimings).toBe(true);
      expect(r.result.words).toHaveLength(2);
      expect(r.result.words![0]!.startMs).toBe(100);
      expect(r.result.words![0]!.endMs).toBe(480);
    }
  });

  it("tokens配列（ms単位フィールド名）を解釈する", () => {
    const json = JSON.stringify({
      results: {
        tokens: [{ word: "えー", startMs: 100, endMs: 400, confidence: 0.8 }]
      }
    });
    const r = parseTranscriptJson(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.hasWordTimings).toBe(true);
      expect(r.result.words![0]!.startMs).toBe(100);
      expect(r.result.words![0]!.confidence).toBe(0.8);
    }
  });

  it("Segment時刻のみ（長文テキスト）は hasWordTimings=false", () => {
    const json = JSON.stringify({
      segments: [
        {
          text: "えっと今日はプログラミングの話をしたいと思いますよろしくお願いします",
          start: 0,
          end: 8.5
        },
        {
          text: "まず最初にこのテーマを選んだ理由について説明させてください",
          start: 9.0,
          end: 15.2
        }
      ]
    });
    const r = parseTranscriptJson(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.hasWordTimings).toBe(false);
      expect(r.result.words).toBeNull();
      expect(r.result.segments).toHaveLength(2);
    }
  });

  it("不正JSONはTRANSCRIPT_SCHEMA_UNSUPPORTED", () => {
    const r = parseTranscriptJson("{ broken");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TRANSCRIPT_SCHEMA_UNSUPPORTED");
  });

  it("未知形状はTRANSCRIPT_SCHEMA_UNSUPPORTED（推測で処理しない）", () => {
    const r = parseTranscriptJson(JSON.stringify({ foo: "bar" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TRANSCRIPT_SCHEMA_UNSUPPORTED");
  });

  it("end < start の不正データを拒否する", () => {
    const json = JSON.stringify({ words: [{ text: "a", start: 5, end: 1 }] });
    const r = parseTranscriptJson(json);
    expect(r.ok).toBe(false);
  });
});
