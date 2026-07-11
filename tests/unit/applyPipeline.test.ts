/**
 * 適用パイプラインのPremiere Mockテスト（仕様33章）。
 * 「Aロール中央500ms削除」（仕様14章）のロジックをMock上で検証する。
 * ※ Mock成功はPremiere実機動作の保証ではない（実機はMANUAL_TEST_CHECKLIST 8〜13）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyEdits, type ApplyRequest } from "../../plugin/src/premiere/applyController";
import { cloneAndIdentify } from "../../plugin/src/premiere/sequenceCloner";
import { planKeepSegments } from "../../plugin/src/analysis/keepSegmentPlanner";
import { msToTicks, subtractTicks, ticksToApproxMs } from "../../plugin/src/ticks";
import type { TrackRef } from "../../plugin/src/premiere/premiereAdapter";
import type { CutCandidate } from "../../plugin/src/types";
import { MockPremiereAdapter } from "../premiere-mocks/mockPremiereAdapter";

const V1: TrackRef = { mediaType: "video", index: 0, name: "V1" };
const V2: TrackRef = { mediaType: "video", index: 1, name: "V2" };
const A1: TrackRef = { mediaType: "audio", index: 0, name: "A1" };
const A2: TrackRef = { mediaType: "audio", index: 1, name: "A2" };

const FRAME_TICKS = msToTicks(33); // 約30fps相当

let mock: MockPremiereAdapter;
let seqGuid: string;
let videoClipId: string;
let audioClipId: string;

function middleCut(): CutCandidate {
  return {
    id: "cut1",
    reason: "silence",
    clipId: videoClipId,
    sourceStartTicks: msToTicks(4750),
    sourceEndTicks: msToTicks(5250),
    sequenceStartTicks: msToTicks(4750),
    sequenceEndTicks: msToTicks(5250),
    originalDurationMs: 500,
    retainedDurationMs: 0,
    removalDurationMs: 500,
    selected: true,
    warnings: [],
    metadata: {}
  };
}

function buildRequest(outputMode: "duplicate" | "direct" = "duplicate"): ApplyRequest {
  const segments = planKeepSegments(
    {
      clipId: videoClipId,
      sourceInTicks: msToTicks(0),
      sourceOutTicks: msToTicks(10000),
      sequenceStartTicks: msToTicks(0)
    },
    [middleCut()]
  );
  return {
    sourceSequenceGuid: seqGuid,
    outputMode,
    videoTrack: V1,
    audioTrack: A1,
    videoClipId,
    audioClipId,
    videoSourceInTicks: msToTicks(0),
    keepSegments: segments,
    frameTicks: FRAME_TICKS
  };
}

beforeEach(() => {
  mock = new MockPremiereAdapter();
  seqGuid = mock.addSequence("メイン", [V1, V2, A1, A2]);
  // V1: Aロール10秒 / A1: 内蔵音声 / V2: ガイド画像 / A2: BGM60秒
  videoClipId = mock.addClip(seqGuid, V1, {
    projectItemId: "aroll.mp4",
    startTicks: msToTicks(0), endTicks: msToTicks(10000),
    inTicks: msToTicks(0), outTicks: msToTicks(10000)
  });
  audioClipId = mock.addClip(seqGuid, A1, {
    projectItemId: "aroll.mp4",
    startTicks: msToTicks(0), endTicks: msToTicks(10000),
    inTicks: msToTicks(0), outTicks: msToTicks(10000)
  });
  mock.addClip(seqGuid, V2, {
    projectItemId: "guide.png",
    startTicks: msToTicks(0), endTicks: msToTicks(60000),
    inTicks: msToTicks(0), outTicks: msToTicks(60000)
  });
  mock.addClip(seqGuid, A2, {
    projectItemId: "bgm.mp3",
    startTicks: msToTicks(0), endTicks: msToTicks(60000),
    inTicks: msToTicks(0), outTicks: msToTicks(60000)
  });
});

describe("500ms削除パイプライン（Mock・仕様14章）", () => {
  it("複製シーケンスで成功し、元シーケンス・BGM・ガイドが不変", async () => {
    // 編集対象クリップIDは複製後のシーケンス内のIDになるため、
    // 実フローどおり複製後に再解決する必要がある。ここではapplyEditsの
    // 中で使うIDが複製先にも存在するようMockのclone実装を経由して検証する。
    const before = await mock.snapshotAllTracks(seqGuid);
    const clone = await cloneAndIdentify(mock, seqGuid);
    expect(clone.ok).toBe(true);
    if (!clone.ok) return;
    const clonedGuid = clone.cloned.guid;
    // 複製後のDOM再取得（仕様20章）: クリップIDを再解決
    const vClips = await mock.listClips(clonedGuid, V1);
    const aClips = await mock.listClips(clonedGuid, A1);
    const request: ApplyRequest = {
      ...buildRequest(),
      sourceSequenceGuid: clonedGuid,
      outputMode: "direct", // 既に複製済みなのでこのテストでは直接方式の内部経路は使わない
      videoClipId: vClips[0]!.clipId,
      audioClipId: aClips[0]!.clipId
    };
    // 直接編集はバックアップを作る仕様なので、ここでは複製先へ直接適用する
    const outcome = await applyEdits(mock, request);
    expect(outcome.ok).toBe(true);

    // 元シーケンスが不変
    const after = await mock.snapshotAllTracks(seqGuid);
    expect(after).toEqual(before);

    // 複製先: V1は2クリップ（前半4750ms+後半4750ms）合計9500ms
    const newV = await mock.listClips(clonedGuid, V1);
    expect(newV).toHaveLength(2);
    const totalMs = newV.reduce(
      (sum, c) => sum + Math.round(ticksToApproxMs(subtractTicks(c.endTicks, c.startTicks))),
      0
    );
    expect(totalMs).toBe(9500);
    // 後半が左詰め
    const sorted = newV.sort((a, b) => Number(a.startTicks) - Number(b.startTicks));
    expect(sorted[1]!.startTicks).toBe(msToTicks(4750));
    // A/V同期: 音声も同一位置
    const newA = await mock.listClips(clonedGuid, A1);
    expect(newA.map((c) => c.startTicks).sort()).toEqual(
      newV.map((c) => c.startTicks).sort()
    );
    // BGM・ガイドが不変
    const bgm = await mock.listClips(clonedGuid, A2);
    expect(bgm[0]!.startTicks).toBe(msToTicks(0));
    expect(bgm[0]!.endTicks).toBe(msToTicks(60000));
    const guide = await mock.listClips(clonedGuid, V2);
    expect(guide[0]!.endTicks).toBe(msToTicks(60000));
    // クリップ重なりなし
    expect(mock.clipsOverlap(clonedGuid, V1)).toBe(false);
  });

  it("duplicateモード: applyEditsが複製を作り元を保護する", async () => {
    // duplicateモードでは複製先のクリップIDが元と異なるため、
    // 実運用ではUI層が複製後に再解決する。このMockテストでは
    // TrackItem Cloneの前段（複製特定）の失敗系のみ検証する。
    mock.failures.sequenceCloneThrows = true;
    const outcome = await applyEdits(mock, buildRequest("duplicate"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("SEQUENCE_CLONE_FAILED");
      expect(outcome.originalIntact).toBe(true);
    }
  });

  it("複製が2件できた場合はCLONED_SEQUENCE_NOT_IDENTIFIEDで中止", async () => {
    mock.failures.sequenceCloneProducesTwo = true;
    const r = await cloneAndIdentify(mock, seqGuid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CLONED_SEQUENCE_NOT_IDENTIFIED");
  });

  it("TrackItem Clone失敗時は中止し元シーケンス無傷", async () => {
    mock.failures.trackItemCloneThrows = true;
    const outcome = await applyEdits(mock, { ...buildRequest("direct") });
    expect(outcome.ok).toBe(false);
    // Clone失敗はMutation前に発生するため元シーケンスは無傷
    if (!outcome.ok) expect(outcome.originalIntact).toBe(true);
  });

  it("Cloneが新規Itemを生まない場合はTRACK_ITEM_MAPPING_FAILED（推測特定しない）", async () => {
    mock.failures.cloneProducesNothing = true;
    const outcome = await applyEdits(mock, buildRequest("direct"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("TRACK_ITEM_MAPPING_FAILED");
  });

  it("対象外トラック（BGM）の変化を検出して失敗にする", async () => {
    mock.failures.mutateNonTargetOnRemove = true;
    const outcome = await applyEdits(mock, buildRequest("direct"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("NON_TARGET_TRACK_CHANGED");
  });

  it("A/V同期誤差（1フレーム以上）を検出して失敗にする", async () => {
    mock.failures.audioMoveDriftTicks = msToTicks(50); // 50msドリフト > 33ms
    const outcome = await applyEdits(mock, buildRequest("direct"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("SYNC_VALIDATION_FAILED");
  });

  it("1フレーム未満のA/Vずれは許容する", async () => {
    mock.failures.audioMoveDriftTicks = msToTicks(10); // 10ms < 33ms
    const outcome = await applyEdits(mock, buildRequest("direct"));
    expect(outcome.ok).toBe(true);
  });

  it("直接編集: バックアップ複製失敗なら編集を開始しない", async () => {
    mock.failures.sequenceCloneThrows = true;
    const before = await mock.snapshotAllTracks(seqGuid);
    const outcome = await applyEdits(mock, buildRequest("direct"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("BACKUP_SEQUENCE_FAILED");
      expect(outcome.originalIntact).toBe(true);
    }
    expect(await mock.snapshotAllTracks(seqGuid)).toEqual(before);
  });

  it("直接編集成功時はバックアップGUIDを返す", async () => {
    const outcome = await applyEdits(mock, buildRequest("direct"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.backupSequenceGuid).toBeDefined();
      expect(outcome.editedSequenceGuid).toBe(seqGuid);
    }
  });
});
