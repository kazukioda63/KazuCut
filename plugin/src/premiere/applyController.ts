/**
 * 適用パイプライン（仕様17・20章）:
 * Snapshot → 出力先準備（複製 or 直接+バックアップ）→ V/A再構築 → 検証 →
 * 失敗時は複製シーケンス削除+元シーケンス無傷確認。
 */
import { createError } from "../errors";
import type { KazuCutError, KeepSegment, TrackItemSnapshot } from "../types";
import type { PremiereAdapter, TrackRef } from "./premiereAdapter";
import { cloneAndIdentify } from "./sequenceCloner";
import { rebuildTrackWithClones } from "./timelineRebuilder";
import { validateAfterApply } from "./timelineValidator";
import { compareSnapshots } from "./trackSnapshot";

export interface ApplyRequest {
  sourceSequenceGuid: string;
  outputMode: "duplicate" | "direct";
  videoTrack: TrackRef;
  audioTrack: TrackRef;
  videoClipId: string;
  audioClipId: string;
  videoSourceInTicks: string;
  keepSegments: KeepSegment[];
  frameTicks: string;
}

export type ApplyOutcome =
  | { ok: true; editedSequenceGuid: string; backupSequenceGuid?: string }
  | { ok: false; error: KazuCutError; originalIntact: boolean };

export async function applyEdits(
  adapter: PremiereAdapter,
  request: ApplyRequest
): Promise<ApplyOutcome> {
  // 元シーケンスの事前Snapshot（無傷検証用）
  const originalBefore = await adapter.snapshotAllTracks(request.sourceSequenceGuid);

  // --- 出力先の準備 ---
  let editedGuid: string;
  let backupGuid: string | undefined;
  if (request.outputMode === "duplicate") {
    const clone = await cloneAndIdentify(adapter, request.sourceSequenceGuid);
    if (!clone.ok) return { ok: false, error: clone.error, originalIntact: true };
    editedGuid = clone.cloned.guid;
  } else {
    // 直接編集: 先にバックアップ複製。失敗したら開始しない（仕様17章）
    const backup = await cloneAndIdentify(adapter, request.sourceSequenceGuid);
    if (!backup.ok) {
      return {
        ok: false,
        error: createError(
          "BACKUP_SEQUENCE_FAILED",
          `バックアップ複製に失敗: ${backup.error.developerMessage}`
        ),
        originalIntact: true
      };
    }
    backupGuid = backup.cloned.guid;
    editedGuid = request.sourceSequenceGuid;
  }

  // 編集対象シーケンスの処理前Snapshot（対象外トラック検証用）
  const beforeSnapshot: TrackItemSnapshot[] = await adapter.snapshotAllTracks(editedGuid);

  const failAndCleanup = async (error: KazuCutError): Promise<ApplyOutcome> => {
    // 失敗した複製シーケンスは削除可能なら削除（仕様20章）
    if (request.outputMode === "duplicate") {
      try {
        await adapter.deleteSequence(editedGuid);
      } catch {
        error = { ...error, details: { ...error.details, cleanupFailed: true } };
      }
    }
    // 元シーケンス無傷を検証
    let originalIntact = false;
    try {
      const originalAfter = await adapter.snapshotAllTracks(request.sourceSequenceGuid);
      originalIntact = compareSnapshots(originalBefore, originalAfter).length === 0;
    } catch {
      originalIntact = false;
    }
    return { ok: false, error, originalIntact };
  };

  // --- V/A再構築（Aロール映像と内蔵音声のみ・仕様3.3） ---
  const videoResult = await rebuildTrackWithClones(adapter, editedGuid, {
    track: request.videoTrack,
    originalClipId: request.videoClipId,
    originalSourceInTicks: request.videoSourceInTicks
  }, request.keepSegments);
  if (!videoResult.ok) return failAndCleanup(videoResult.error);

  const audioResult = await rebuildTrackWithClones(adapter, editedGuid, {
    track: request.audioTrack,
    originalClipId: request.audioClipId,
    originalSourceInTicks: request.videoSourceInTicks
  }, request.keepSegments);
  if (!audioResult.ok) return failAndCleanup(audioResult.error);

  // --- 検証（仕様28章） ---
  const validation = await validateAfterApply(adapter, {
    sequenceGuid: editedGuid,
    videoTrack: request.videoTrack,
    audioTrack: request.audioTrack,
    keepSegments: request.keepSegments,
    newVideoClipIds: videoResult.newClipIds,
    newAudioClipIds: audioResult.newClipIds,
    beforeSnapshot,
    frameTicks: request.frameTicks
  });
  if (!validation.ok) return failAndCleanup(validation.error);

  // 複製モードでは元シーケンス無傷も最終確認
  if (request.outputMode === "duplicate") {
    const originalAfter = await adapter.snapshotAllTracks(request.sourceSequenceGuid);
    if (compareSnapshots(originalBefore, originalAfter).length > 0) {
      return {
        ok: false,
        error: createError("NON_TARGET_TRACK_CHANGED", "元シーケンスが変更されています"),
        originalIntact: false
      };
    }
  }

  const outcome: ApplyOutcome = { ok: true, editedSequenceGuid: editedGuid };
  if (backupGuid !== undefined) outcome.backupSequenceGuid = backupGuid;
  return outcome;
}
