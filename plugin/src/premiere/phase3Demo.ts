/**
 * Phase 3: Aロール中央500ms削除の最小実証（仕様14章・実機）。
 *
 * 手順（元シーケンスは一切変更しない）:
 * 1. 元シーケンスの指紋を記録
 * 2. 複製を作成しGUID差分で特定
 * 3. 複製上で対象V/AトラックのA/Vペアを解決（曖昧なら中止）
 * 4. クリップ中央500msを削除対象としKeep Segmentを生成
 * 5. V/A各トラックを戦略Aで再構築（Clone→In/Out→元削除→左詰め配置）
 * 6. 検証: Keep Segment位置・A/V同期0差・対象外トラック不変・元シーケンス不変
 * 7. 複製シーケンスは検証用に残す（ユーザーが目視確認後に削除）
 */
import type { ProbeResult } from "../types";
import type { PproModule } from "./pproTypes";
import { resolveAvPair, type ClipInfo } from "./avPairResolver";
import { planKeepSegments } from "../analysis/keepSegmentPlanner";
import type { CutCandidate } from "../types";
import {
  addTicks,
  compareTicks,
  divTicksBySmallInt,
  msToTicks,
  subtractTicks,
  ticksToApproxMs
} from "../ticks";
import {
  cloneSequenceAndIdentify,
  rebuildTrackSegments,
  scanTrack,
  sequenceFingerprint,
  trackCount,
  type LiveClip
} from "./uxpTimeline";

function toClipInfo(c: LiveClip, id: string): ClipInfo {
  return {
    clipId: id,
    mediaType: c.kind,
    trackIndex: c.trackIndex,
    projectItemId: c.projectItemName,
    startTicks: c.startTicks,
    endTicks: c.endTicks,
    inTicks: c.inTicks,
    outTicks: c.outTicks,
    speed: c.speed,
    reversed: c.reversed,
    timeRemapped: false,
    mediaOffline: false,
    clipKind: "standard"
  };
}

export async function runPhase3Demo(
  ppro: PproModule,
  videoTrackIndex: number,
  audioTrackIndex: number,
  onLog: (message: string) => void
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const push = (apiName: string, succeeded: boolean, notes: string[], error?: string): void => {
    const r: ProbeResult = { apiName, available: succeeded, succeeded, notes };
    if (error !== undefined) r.error = error;
    results.push(r);
    onLog(`${succeeded ? "✓" : "✗"} ${apiName}`);
  };

  const project = await ppro.Project.getActiveProject();
  if (!project) {
    push("前提: アクティブプロジェクト", false, [], "プロジェクトがありません");
    return results;
  }
  const active = await project.getActiveSequence();
  if (!active) {
    push("前提: アクティブシーケンス", false, [], "シーケンスがありません");
    return results;
  }
  const originalGuid = String(active.guid);
  const originalFingerprint = await sequenceFingerprint(ppro, project, originalGuid);

  // --- 複製 ---
  let cloneGuid: string;
  let cloneName: string;
  try {
    const clone = await cloneSequenceAndIdentify(project, originalGuid);
    cloneGuid = clone.guid;
    cloneName = clone.name;
    push("1. シーケンス複製+特定", true, [`複製名: ${clone.name}`]);
  } catch (e) {
    push("1. シーケンス複製+特定", false, [], String(e));
    return results;
  }

  try {
    // --- A/Vペア解決（仕様15章） ---
    const vClips = await scanTrack(ppro, project, cloneGuid, "video", videoTrackIndex);
    const aClips = await scanTrack(ppro, project, cloneGuid, "audio", audioTrackIndex);
    if (vClips.length === 0) {
      push("2. A/Vペア解決", false, [
        `映像トラックV${videoTrackIndex + 1}にクリップがありません`
      ]);
      return results;
    }
    const video = toClipInfo(vClips[0]!, "v0");
    const audioInfos = aClips.map((c, i) => toClipInfo(c, `a${i}`));
    const pair = resolveAvPair(video, audioInfos, audioTrackIndex);
    if (!pair.ok) {
      push("2. A/Vペア解決", false, [pair.error.userMessage], pair.error.developerMessage);
      return results;
    }
    push("2. A/Vペア解決", true, [
      `映像: ${video.projectItemId} start=${video.startTicks}`,
      `音声: ${pair.audio.projectItemId} start=${pair.audio.startTicks}`
    ]);

    // --- 中央500msのKeep Segment生成 ---
    const clipDuration = subtractTicks(video.outTicks, video.inTicks);
    if (compareTicks(clipDuration, msToTicks(2000)) < 0) {
      push("3. Keep Segment生成", false, ["クリップが2秒未満のため実証に不適です"]);
      return results;
    }
    const mid = addTicks(video.inTicks, divTicksBySmallInt(clipDuration, 2).quotient);
    const half = msToTicks(250);
    const cut: CutCandidate = {
      id: "phase3-cut",
      reason: "manual",
      clipId: "v0",
      sourceStartTicks: subtractTicks(mid, half),
      sourceEndTicks: addTicks(mid, half),
      sequenceStartTicks: "0",
      sequenceEndTicks: "0",
      originalDurationMs: 500,
      retainedDurationMs: 0,
      removalDurationMs: 500,
      selected: true,
      warnings: [],
      metadata: {}
    };
    const segments = planKeepSegments(
      {
        clipId: "v0",
        sourceInTicks: video.inTicks,
        sourceOutTicks: video.outTicks,
        sequenceStartTicks: video.startTicks
      },
      [cut]
    );
    push("3. Keep Segment生成", segments.length === 2, [
      `Segment数=${segments.length}（期待2）`,
      ...segments.map(
        (s, i) =>
          `seg${i}: source[${s.sourceInTicks}..${s.sourceOutTicks}] → dest=${s.destinationStartTicks}`
      )
    ]);
    if (segments.length !== 2) return results;

    // --- 対象外トラックの事前指紋（複製上・対象V/A除く） ---
    const nonTargetBefore = await nonTargetFingerprint(
      ppro, project, cloneGuid, videoTrackIndex, audioTrackIndex
    );

    // --- V/A再構築 ---
    const rebuildSegments = segments.map((s) => ({
      sourceInTicks: s.sourceInTicks,
      sourceOutTicks: s.sourceOutTicks,
      destinationStartTicks: s.destinationStartTicks
    }));
    try {
      await rebuildTrackSegments(
        ppro, project, cloneGuid, "video", videoTrackIndex,
        video.startTicks, rebuildSegments, onLog
      );
      push("4. 映像トラック再構築", true, []);
    } catch (e) {
      push("4. 映像トラック再構築", false, [], String(e));
      return results;
    }
    try {
      await rebuildTrackSegments(
        ppro, project, cloneGuid, "audio", audioTrackIndex,
        pair.audio.startTicks, rebuildSegments, onLog
      );
      push("5. 音声トラック再構築", true, []);
    } catch (e) {
      push("5. 音声トラック再構築", false, [], String(e));
      return results;
    }

    // --- 検証（仕様28章） ---
    const vAfter = await scanTrack(ppro, project, cloneGuid, "video", videoTrackIndex);
    const aAfter = await scanTrack(ppro, project, cloneGuid, "audio", audioTrackIndex);
    const notes: string[] = [];
    let ok = vAfter.length === segments.length && aAfter.length === segments.length;
    notes.push(`映像クリップ数=${vAfter.length} / 音声=${aAfter.length}（期待${segments.length}）`);
    for (let i = 0; i < segments.length && ok; i++) {
      const seg = segments[i]!;
      const v = vAfter.find((c) => c.startTicks === seg.destinationStartTicks);
      const a = aAfter.find((c) => c.startTicks === seg.destinationStartTicks);
      if (!v || !a) {
        ok = false;
        notes.push(`seg${i}: dest=${seg.destinationStartTicks} にV/Aが揃っていません`);
        break;
      }
      if (v.inTicks !== seg.sourceInTicks || v.outTicks !== seg.sourceOutTicks) {
        ok = false;
        notes.push(`seg${i}: 映像In/Out不一致`);
        break;
      }
      const drift = subtractTicks(a.startTicks, v.startTicks);
      notes.push(`seg${i}: A/V同期差=${drift} ticks`);
      if (drift !== "0") ok = false;
    }
    // 合計時間 = 元-500ms
    const totalKeptMs = vAfter.reduce(
      (sum, c) => sum + ticksToApproxMs(subtractTicks(c.endTicks, c.startTicks)),
      0
    );
    notes.push(`再構築後の合計時間: ${Math.round(totalKeptMs)}ms（元${Math.round(ticksToApproxMs(clipDuration))}msから500ms短縮のはず）`);
    push("6. Keep Segment配置+A/V同期検証", ok, notes);

    // --- 対象外トラック不変（複製上） ---
    const nonTargetAfter = await nonTargetFingerprint(
      ppro, project, cloneGuid, videoTrackIndex, audioTrackIndex
    );
    push("7. 対象外トラック不変検証（BGM/ガイド）", nonTargetBefore === nonTargetAfter, [
      nonTargetBefore === nonTargetAfter
        ? "対象外トラックのTrackItemはすべて不変"
        : "⚠️ 対象外トラックに差分があります"
    ]);
  } catch (e) {
    push("Phase 3実行", false, [], String(e));
  }

  // --- 元シーケンス不変 ---
  try {
    const after = await sequenceFingerprint(ppro, project, originalGuid);
    push("8. 元シーケンス不変検証", after === originalFingerprint, [
      after === originalFingerprint
        ? "元シーケンスは一切変更されていません"
        : "⚠️ 元シーケンスに差分があります"
    ]);
  } catch (e) {
    push("8. 元シーケンス不変検証", false, [], String(e));
  }

  push("9. 複製シーケンスの扱い", true, [
    `複製「${cloneName}」は検証用に残しています。`,
    "Premiereで開いて再生し、映像と音声の同期・BGMの位置を目視確認してください。",
    "問題なければプロジェクトパネルから複製を削除してOKです。"
  ]);
  return results;
}

async function nonTargetFingerprint(
  ppro: PproModule,
  project: Parameters<typeof scanTrack>[1],
  guid: string,
  videoTrackIndex: number,
  audioTrackIndex: number
): Promise<string> {
  const parts: string[] = [];
  for (const kind of ["video", "audio"] as const) {
    const count = await trackCount(project, guid, kind);
    for (let i = 0; i < count; i++) {
      if (kind === "video" && i === videoTrackIndex) continue;
      if (kind === "audio" && i === audioTrackIndex) continue;
      const clips = await scanTrack(ppro, project, guid, kind, i);
      for (const c of clips) {
        parts.push(
          `${kind}${i}:${c.projectItemName}:${c.startTicks}-${c.endTicks}:${c.inTicks}/${c.outTicks}`
        );
      }
    }
  }
  return parts.sort().join("|");
}
