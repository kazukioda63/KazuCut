import { describe, expect, it } from "vitest";
import { checkSupported, resolveAvPair, type ClipInfo } from "../../plugin/src/premiere/avPairResolver";
import { msToTicks } from "../../plugin/src/ticks";

function clip(overrides: Partial<ClipInfo> = {}): ClipInfo {
  return {
    clipId: "v1",
    mediaType: "video",
    trackIndex: 0,
    projectItemId: "item-1",
    startTicks: msToTicks(1000),
    endTicks: msToTicks(11000),
    inTicks: msToTicks(0),
    outTicks: msToTicks(10000),
    speed: 100,
    reversed: false,
    timeRemapped: false,
    mediaOffline: false,
    clipKind: "standard",
    ...overrides
  };
}

function audioOf(v: ClipInfo, overrides: Partial<ClipInfo> = {}): ClipInfo {
  return clip({ ...v, clipId: "a1", mediaType: "audio", trackIndex: 0, ...overrides });
}

describe("A/Vペア解決（仕様15章）", () => {
  it("同一ProjectItem・同位置の音声を一意に解決する", () => {
    const v = clip();
    const a = audioOf(v);
    const r = resolveAvPair(v, [a], 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audio.clipId).toBe("a1");
  });

  it("別ProjectItem（別録りBGM等）は対応音声にしない", () => {
    const v = clip();
    const bgm = audioOf(v, { projectItemId: "bgm-item" });
    const r = resolveAvPair(v, [bgm], 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("AMBIGUOUS_AUDIO_PAIR");
  });

  it("候補が複数なら自動編集せず候補を返す", () => {
    const v = clip();
    const a1 = audioOf(v);
    const a2 = audioOf(v, { clipId: "a2" });
    const r = resolveAvPair(v, [a1, a2], 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("AMBIGUOUS_AUDIO_PAIR");
      expect(r.candidates).toHaveLength(2);
      expect(r.error.userMessage).toContain("一意に特定できません");
    }
  });

  it("指定トラック外の音声は対象にしない", () => {
    const v = clip();
    const a = audioOf(v, { trackIndex: 1 });
    const r = resolveAvPair(v, [a], 0);
    expect(r.ok).toBe(false);
  });

  it("100%以外の速度の音声はペアにしない", () => {
    const v = clip();
    const a = audioOf(v, { speed: 110 });
    const r = resolveAvPair(v, [a], 0);
    expect(r.ok).toBe(false);
  });

  it("許容差1ms以内の位置ずれは同一とみなす", () => {
    const v = clip();
    const a = audioOf(v, { startTicks: msToTicks(1001) }); // 1msずれ
    const r = resolveAvPair(v, [a], 0);
    expect(r.ok).toBe(true);
  });
});

describe("非対応素材の検査（仕様16章）", () => {
  it("オフラインメディア", () => {
    expect(checkSupported(clip({ mediaOffline: true }))?.code).toBe("MEDIA_OFFLINE");
  });
  it("110%速度", () => {
    const e = checkSupported(clip({ speed: 110 }));
    expect(e?.code).toBe("UNSUPPORTED_SPEED");
    expect(e?.userMessage).toContain("100%");
  });
  it("逆再生", () => {
    expect(checkSupported(clip({ reversed: true }))?.code).toBe("UNSUPPORTED_REVERSE");
  });
  it("タイムリマップ", () => {
    expect(checkSupported(clip({ timeRemapped: true }))?.code).toBe("UNSUPPORTED_TIME_REMAP");
  });
  it("ネスト・マルチカム・Merged", () => {
    expect(checkSupported(clip({ clipKind: "nested" }))?.code).toBe("UNSUPPORTED_NEST");
    expect(checkSupported(clip({ clipKind: "multicam" }))?.code).toBe("UNSUPPORTED_MULTICAM");
    expect(checkSupported(clip({ clipKind: "merged" }))?.code).toBe("UNSUPPORTED_MERGED_CLIP");
  });
  it("対応素材はnull", () => {
    expect(checkSupported(clip())).toBeNull();
  });
  it("映像側が非対応ならペア解決も失敗する", () => {
    const v = clip({ speed: 50 });
    const r = resolveAvPair(v, [audioOf(clip())], 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNSUPPORTED_SPEED");
  });
});
