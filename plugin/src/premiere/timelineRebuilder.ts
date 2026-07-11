/**
 * 戦略A: TrackItem Cloneによるタイムライン再構築（ADR-003 / 仕様19章）。
 *
 * 手順:
 * 1. 対象V/A TrackItemを記録
 * 2. 対象トラック末尾（シーケンス最終端+マージン）に一時領域を確保・空を確認
 * 3. Keep Segmentごとに複製（isInsert=false固定）
 * 4. 複製前後のlistClips差分で新規TrackItemを特定（推測特定禁止・特定不能なら中止）
 * 5. In/Out変更 → 目的位置へ移動
 * 6. 元Aロール削除
 * 7. 呼び出し側で検証（timelineValidator）
 *
 * V/Aは同一手順を個別トラックに適用する。Clone時にリンクAudioが
 * 同時複製されるかは実機Probeで確認し、実Adapterで吸収する
 * （二重Clone防止はAdapter実装の責務。Mockテストで挙動を固定）。
 */
import { createError } from "../errors";
import type { KazuCutError, KeepSegment } from "../types";
import { addTicks, compareTicks, msToTicks, multiplyTicksBySmallInt } from "../ticks";
import type { TickString } from "../ticks";
import type { PremiereAdapter, TrackRef } from "./premiereAdapter";

export interface RebuildTarget {
  track: TrackRef;
  /** 再構築対象の元クリップID */
  originalClipId: string;
  /** 元クリップのSource In（Keep SegmentのsourceIn/Outは絶対Source位置） */
  originalSourceInTicks: TickString;
}

export type RebuildOutcome =
  | { ok: true; newClipIds: string[] }
  | { ok: false; error: KazuCutError };

const TEMP_AREA_MARGIN_MS = 10000;

export async function rebuildTrackWithClones(
  adapter: PremiereAdapter,
  sequenceGuid: string,
  target: RebuildTarget,
  keepSegments: KeepSegment[]
): Promise<RebuildOutcome> {
  if (keepSegments.length === 0) {
    return { ok: false, error: createError("TIMELINE_REBUILD_FAILED", "Keep Segmentが0件") };
  }
  try {
    // --- 一時領域の確保と空チェック ---
    const seqEnd = await adapter.getSequenceEndTicks(sequenceGuid);
    const tempStart = addTicks(seqEnd, msToTicks(TEMP_AREA_MARGIN_MS));
    {
      const clips = await adapter.listClips(sequenceGuid, target.track);
      const inTemp = clips.filter((c) => compareTicks(c.endTicks, tempStart) > 0);
      if (inTemp.length > 0) {
        return {
          ok: false,
          error: createError("TIMELINE_REBUILD_FAILED", "一時領域が空ではありません", {
            clipIds: inTemp.map((c) => c.clipId)
          })
        };
      }
    }

    // --- Keep Segmentごとに複製（一時領域へ） ---
    const newClipIds: string[] = [];
    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      if (!seg) continue;
      const tempPos = addTicks(
        tempStart,
        multiplyTicksBySmallInt(msToTicks(TEMP_AREA_MARGIN_MS), i)
      );

      const before = await adapter.listClips(sequenceGuid, target.track);
      const beforeIds = new Set(before.map((c) => c.clipId));
      await adapter.cloneTrackItem(sequenceGuid, target.track, target.originalClipId, tempPos);
      // Mutation後は再取得（仕様20章）
      const after = await adapter.listClips(sequenceGuid, target.track);
      const added = after.filter((c) => !beforeIds.has(c.clipId));
      if (added.length !== 1 || !added[0]) {
        return {
          ok: false,
          error: createError(
            "TRACK_ITEM_MAPPING_FAILED",
            `複製後の新規TrackItemが${added.length}件（期待: 1件）。推測特定は行わず中止`
          )
        };
      }
      const cloneId = added[0].clipId;
      await adapter.setClipInOut(
        sequenceGuid,
        target.track,
        cloneId,
        seg.sourceInTicks,
        seg.sourceOutTicks
      );
      newClipIds.push(cloneId);
    }

    // --- 複製結果の検証（In/Outが設定されたか） ---
    {
      const clips = await adapter.listClips(sequenceGuid, target.track);
      for (let i = 0; i < newClipIds.length; i++) {
        const seg = keepSegments[i];
        const clip = clips.find((c) => c.clipId === newClipIds[i]);
        if (!seg || !clip || clip.inTicks !== seg.sourceInTicks || clip.outTicks !== seg.sourceOutTicks) {
          return {
            ok: false,
            error: createError("TRACK_ITEM_CLONE_FAILED", `Segment ${i} のIn/Out設定を検証できません`)
          };
        }
      }
    }

    // --- 元クリップ削除 → Keep Segmentを目的位置へ移動 ---
    await adapter.removeClip(sequenceGuid, target.track, target.originalClipId);
    for (let i = 0; i < newClipIds.length; i++) {
      const seg = keepSegments[i];
      const id = newClipIds[i];
      if (!seg || !id) continue;
      await adapter.moveClip(sequenceGuid, target.track, id, seg.destinationStartTicks);
    }

    return { ok: true, newClipIds };
  } catch (e) {
    return {
      ok: false,
      error: createError(
        "TIMELINE_REBUILD_FAILED",
        e instanceof Error ? e.message : String(e)
      )
    };
  }
}
