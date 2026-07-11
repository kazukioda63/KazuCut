/**
 * 実行後検証（仕様28章）。
 * - Aロール: Keep Segment数・位置・In/Out・A/V同期差
 * - 対象外: Snapshot完全比較（ADR-005）
 * 許容超過は成功扱いにしない。
 */
import { createError } from "../errors";
import type { KazuCutError, KeepSegment, TrackItemSnapshot } from "../types";
import { compareSnapshots, excludeTargets } from "./trackSnapshot";
import { subtractTicks, compareTicks, msToTicks } from "../ticks";
import type { PremiereAdapter, TrackRef } from "./premiereAdapter";

export interface ValidationInput {
  sequenceGuid: string;
  videoTrack: TrackRef;
  audioTrack: TrackRef;
  keepSegments: KeepSegment[];
  newVideoClipIds: string[];
  newAudioClipIds: string[];
  /** 処理前の全トラックSnapshot */
  beforeSnapshot: TrackItemSnapshot[];
  /** 1フレームのTick長（実機ではシーケンスFrameRateから取得） */
  frameTicks: string;
}

export type ValidationOutcome = { ok: true } | { ok: false; error: KazuCutError };

export async function validateAfterApply(
  adapter: PremiereAdapter,
  input: ValidationInput
): Promise<ValidationOutcome> {
  // --- Aロール検証 ---
  const videoClips = await adapter.listClips(input.sequenceGuid, input.videoTrack);
  const audioClips = await adapter.listClips(input.sequenceGuid, input.audioTrack);

  if (
    input.newVideoClipIds.length !== input.keepSegments.length ||
    input.newAudioClipIds.length !== input.keepSegments.length
  ) {
    return fail("SYNC_VALIDATION_FAILED", "Keep Segment数と新規クリップ数が一致しません");
  }

  for (let i = 0; i < input.keepSegments.length; i++) {
    const seg = input.keepSegments[i];
    const v = videoClips.find((c) => c.clipId === input.newVideoClipIds[i]);
    const a = audioClips.find((c) => c.clipId === input.newAudioClipIds[i]);
    if (!seg || !v || !a) {
      return fail("SYNC_VALIDATION_FAILED", `Segment ${i} のクリップが見つかりません`);
    }
    // 位置・In/Out検証
    if (v.startTicks !== seg.destinationStartTicks) {
      return fail("SYNC_VALIDATION_FAILED", `Segment ${i}: 映像Startが計画位置と不一致`);
    }
    if (v.inTicks !== seg.sourceInTicks || v.outTicks !== seg.sourceOutTicks) {
      return fail("SYNC_VALIDATION_FAILED", `Segment ${i}: 映像In/Outが不一致`);
    }
    // A/V同期差: 映像1フレーム未満（仕様28章）
    const drift = absTicks(subtractTicks(a.startTicks, v.startTicks));
    if (compareTicks(drift, input.frameTicks) >= 0) {
      return fail(
        "SYNC_VALIDATION_FAILED",
        `Segment ${i}: A/V同期差${drift} ticksが1フレーム(${input.frameTicks})以上`
      );
    }
    // Speed維持
    if (v.speed !== 100 || a.speed !== 100) {
      return fail("SYNC_VALIDATION_FAILED", `Segment ${i}: 速度が100%ではありません`);
    }
  }

  // --- 対象外トラック検証（ADR-005） ---
  const afterSnapshot = await adapter.snapshotAllTracks(input.sequenceGuid);
  const beforeNonTarget = excludeTargets(
    input.beforeSnapshot,
    input.videoTrack.index,
    input.audioTrack.index
  );
  const afterNonTarget = excludeTargets(
    afterSnapshot,
    input.videoTrack.index,
    input.audioTrack.index
  );
  const diffs = compareSnapshots(beforeNonTarget, afterNonTarget);
  if (diffs.length > 0) {
    return {
      ok: false,
      error: createError(
        "NON_TARGET_TRACK_CHANGED",
        diffs.map((d) => d.detail).join(" / "),
        { diffs: diffs.map((d) => ({ kind: d.kind, detail: d.detail })) }
      )
    };
  }

  return { ok: true };
}

/** BGM等が長く残る場合の情報メッセージ（仕様34章・編集はしない） */
export function bgmOverhangMessage(
  arollEndTicks: string,
  bgmEndTicks: string
): string | null {
  if (compareTicks(bgmEndTicks, arollEndTicks) <= 0) return null;
  const overhang = subtractTicks(bgmEndTicks, arollEndTicks);
  // 表示専用の概算ms
  const ms = Number(subtractSafeMs(overhang));
  const sec = (ms / 1000).toFixed(1);
  return (
    `BGMがAロールより${sec}秒長く残っています。\n` +
    `必要に応じてPremiere上で短くしてください。`
  );
}

function subtractSafeMs(ticks: string): number {
  // 1ms = 254016000 ticks（仮定分解能）
  const perMs = Number(msToTicks(1));
  return Math.round(Number(ticks) / perMs);
}

function absTicks(t: string): string {
  return t.startsWith("-") ? t.slice(1) : t;
}

function fail(code: string, message: string): ValidationOutcome {
  return { ok: false, error: createError(code, message) };
}
