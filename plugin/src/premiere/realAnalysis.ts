/**
 * 実メディアの無音解析と適用（複数クリップ対応・D-020直接編集）。
 *
 * 解析: 対象クリップ（選択クリップ or トラック全体）ごとにA/Vペア解決→
 *       メディアパス取得→Worker(analyze)で無音検出→CutCandidate化→クリップ内で統合
 * 適用: buildEditPlan（テスト済み）でクリップごとのKeep Segment+累積左詰めを計画し、
 *       実機実証済みの再構築エンジンで直接編集。候補のないクリップは移動のみ（高速パス）。
 *       クリップ間の意図的なギャップは維持。カット位置へマーカー。復元はCtrl+Z。
 */
import type { NativeBridge, CutCandidate, AnalysisSettings, ProbeResult, JobStatus } from "../types";
import { createError } from "../errors";
import type { KazuCutError } from "../types";
import { pollJob } from "../native/jobPoller";
import { buildJobRequest } from "../analysis/analysisController";
import { mergeCandidates } from "../analysis/candidateMerger";
import { buildEditPlan } from "../analysis/editPlanBuilder";
import type { ClipRange } from "../analysis/keepSegmentPlanner";
import { resolveAvPair, type ClipInfo } from "./avPairResolver";
import type { PproModule, PproProject } from "./pproTypes";
import { clipTrackItemType } from "./pproTypes";
import {
  rebuildTrackSegments,
  moveClipTo,
  runTransaction,
  scanTrack,
  trackCount,
  freshSequence,
  type LiveClip
} from "./uxpTimeline";
import {
  addTicks,
  compareTicks,
  msToTicks,
  subtractTicks,
  ticksToApproxMs,
  type TickString
} from "../ticks";

export interface ClipTarget {
  clipId: string; // "clip0", "clip1", ...（トラック上の時間順）
  videoStartTicks: TickString;
  videoInTicks: TickString;
  videoOutTicks: TickString;
  audioStartTicks: TickString;
  /** 無音解析の対象か（選択クリップモードでは選択されたものだけtrue） */
  analyzed: boolean;
  mediaPath: string;
}

export interface AnalysisContext {
  sequenceGuid: string;
  videoTrackIndex: number;
  audioTrackIndex: number;
  clips: ClipTarget[];
  noiseFloorDb: number;
  thresholdDb: number;
}

export type AnalyzeResult =
  | { ok: true; candidates: CutCandidate[]; context: AnalysisContext }
  | { ok: false; error: KazuCutError };

function toClipInfo(c: LiveClip, id: string, offline: boolean): ClipInfo {
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
    mediaOffline: offline,
    clipKind: "standard"
  };
}

/** 無音の残し時間を設定から決定（段階処理対応・仕様23章） */
function retainedMsFor(durationMs: number, settings: AnalysisSettings): number {
  const sil = settings.silence;
  if (sil.mode === "remove") return 0;
  if (sil.stagedRules && sil.stagedRules.length > 0) {
    const sorted = [...sil.stagedRules].sort((a, b) => b.minDurationMs - a.minDurationMs);
    for (const rule of sorted) {
      if (durationMs >= rule.minDurationMs) return Math.min(rule.retainMs, durationMs);
    }
    return durationMs; // どの段階にも達しない → 処理しない（全部残す）
  }
  return Math.min(sil.retainMs, durationMs);
}

/** 指定トラック上のクリップに対応するメディアパス・オフライン状態を取得 */
async function mediaInfoForClip(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  videoTrackIndex: number,
  startTicks: TickString
): Promise<{ mediaPath: string; offline: boolean }> {
  const seqFresh = await freshSequence(project, guid);
  const track = await seqFresh.getVideoTrack(videoTrackIndex);
  const items = track.getTrackItems(clipTrackItemType(ppro), false).filter((x) => x != null);
  for (const item of items) {
    const start = (await item.getStartTime()).ticks;
    if (start !== startTicks) continue;
    const projectItem = await item.getProjectItem();
    const clipItem = ppro.ClipProjectItem.cast(projectItem);
    const mediaPath = await clipItem.getMediaFilePath();
    const offline = await clipItem.isOffline().catch(() => false);
    return { mediaPath, offline };
  }
  throw new Error(`クリップ(start=${startTicks})を再取得できません`);
}

/** 選択中クリップのstart一覧（選択クリップモード用） */
async function selectedStarts(project: PproProject, guid: string): Promise<Set<string>> {
  const seq = await freshSequence(project, guid);
  const selection = await seq.getSelection();
  const items = await selection.getTrackItems();
  const starts = new Set<string>();
  for (const item of items) {
    if (!item) continue;
    try {
      starts.add((await item.getStartTime()).ticks);
    } catch {
      // 失効アイテムはスキップ
    }
  }
  return starts;
}

export async function runRealAnalysis(
  ppro: PproModule,
  bridge: NativeBridge,
  settings: AnalysisSettings,
  videoTrackIndex: number,
  audioTrackIndex: number,
  scope: "selection" | "track",
  onProgress: (status: JobStatus) => void,
  signal: AbortSignal
): Promise<AnalyzeResult> {
  const project = await ppro.Project.getActiveProject();
  if (!project) return { ok: false, error: createError("NO_ACTIVE_PROJECT", "") };
  const seq = await project.getActiveSequence();
  if (!seq) return { ok: false, error: createError("NO_ACTIVE_SEQUENCE", "") };
  const guid = String(seq.guid);

  // --- トラック上の全クリップ（時間順） ---
  const vClips = (await scanTrack(ppro, project, guid, "video", videoTrackIndex)).sort(
    (a, b) => compareTicks(a.startTicks, b.startTicks)
  );
  if (vClips.length === 0) {
    return {
      ok: false,
      error: createError("NO_SELECTED_CLIP", `V${videoTrackIndex + 1}にクリップがありません`)
    };
  }
  const aClips = await scanTrack(ppro, project, guid, "audio", audioTrackIndex);
  const audioInfos = aClips.map((c, i) => toClipInfo(c, `a${i}`, false));

  // --- 解析対象の決定 ---
  let analyzedStarts: Set<string>;
  if (scope === "selection") {
    analyzedStarts = await selectedStarts(project, guid);
    const hit = vClips.some((c) => analyzedStarts.has(c.startTicks));
    if (!hit) {
      return {
        ok: false,
        error: createError(
          "NO_SELECTED_CLIP",
          "タイムラインでクリップが選択されていません（対象を「Aロールトラック全体」にすると全クリップを処理します）"
        )
      };
    }
  } else {
    analyzedStarts = new Set(vClips.map((c) => c.startTicks));
  }

  // --- クリップごとにA/Vペア解決 + 解析対象はメディア情報取得 ---
  const clips: ClipTarget[] = [];
  for (let k = 0; k < vClips.length; k++) {
    const vLive = vClips[k];
    if (!vLive) continue;
    const clipId = `clip${k}`;
    const video = toClipInfo(vLive, clipId, false);
    const pair = resolveAvPair(video, audioInfos, audioTrackIndex);
    if (!pair.ok) {
      return {
        ok: false,
        error: {
          ...pair.error,
          userMessage: `${k + 1}番目のクリップ: ${pair.error.userMessage}`
        }
      };
    }
    const analyzed = analyzedStarts.has(vLive.startTicks);
    let mediaPath = "";
    if (analyzed) {
      try {
        const info = await mediaInfoForClip(ppro, project, guid, videoTrackIndex, vLive.startTicks);
        if (info.offline) {
          return { ok: false, error: createError("MEDIA_OFFLINE", info.mediaPath) };
        }
        mediaPath = info.mediaPath;
        if (!mediaPath) {
          return { ok: false, error: createError("MEDIA_NOT_FOUND", `clip${k}: パスが空です`) };
        }
      } catch (e) {
        return { ok: false, error: createError("MEDIA_NOT_FOUND", String(e)) };
      }
    }
    clips.push({
      clipId,
      videoStartTicks: vLive.startTicks,
      videoInTicks: vLive.inTicks,
      videoOutTicks: vLive.outTicks,
      audioStartTicks: pair.audio.startTicks,
      analyzed,
      mediaPath
    });
  }

  // --- 解析対象クリップごとにWorkerで無音解析（順次・進捗を按分） ---
  const analyzedClips = clips.filter((c) => c.analyzed);
  const allCandidates: CutCandidate[] = [];
  let noiseFloorDb = -60;
  let thresholdDb = -50;
  for (let idx = 0; idx < analyzedClips.length; idx++) {
    const clip = analyzedClips[idx];
    if (!clip) continue;
    const request = buildJobRequest(
      {
        jobId: `analyze-${Date.now()}-${idx}`,
        mediaPath: clip.mediaPath,
        sourceInTicks: clip.videoInTicks,
        sourceOutTicks: clip.videoOutTicks,
        audioStreamIndex: 0
      },
      settings,
      null
    );
    const jobId = bridge.startJob(JSON.stringify({ type: "analyze", ...request }));
    if (jobId.startsWith("{")) {
      try {
        const err = JSON.parse(jobId) as { error?: { code?: string; developerMessage?: string } };
        return {
          ok: false,
          error: createError(err.error?.code ?? "WORKER_START_FAILED", err.error?.developerMessage ?? jobId)
        };
      } catch {
        return { ok: false, error: createError("WORKER_START_FAILED", jobId) };
      }
    }
    const status = await pollJob(bridge, jobId, {
      intervalMs: 150,
      signal,
      onProgress: (st) =>
        onProgress({
          ...st,
          progress: (idx + st.progress) / analyzedClips.length
        })
    });
    if (status.state === "cancelled") {
      bridge.disposeJob(jobId);
      return { ok: false, error: createError("CANCELLED", "") };
    }
    if (status.state !== "completed") {
      bridge.disposeJob(jobId);
      return {
        ok: false,
        error: status.error ?? createError("WORKER_CRASHED", `state=${status.state}`)
      };
    }
    let silence: {
      intervals: { startMs: number; endMs: number }[];
      noiseFloorDb: number;
      thresholdDb: number;
    };
    try {
      const result = JSON.parse(bridge.getJobResult(jobId)) as { silence?: typeof silence };
      if (!result.silence) throw new Error("silenceセクションがありません");
      silence = result.silence;
    } catch (e) {
      bridge.disposeJob(jobId);
      return { ok: false, error: createError("WORKER_PROTOCOL_ERROR", String(e)) };
    }
    bridge.disposeJob(jobId);
    noiseFloorDb = silence.noiseFloorDb;
    thresholdDb = silence.thresholdDb;

    // 区間（クリップIn基準ms）→ CutCandidate → クリップ内で統合
    const raw: CutCandidate[] = silence.intervals.map((iv, i) => {
      const durationMs = iv.endMs - iv.startMs;
      const retained = retainedMsFor(durationMs, settings);
      return {
        id: `${clip.clipId}-sil-${i}`,
        reason: "silence" as const,
        clipId: clip.clipId,
        sourceStartTicks: addTicks(clip.videoInTicks, msToTicks(iv.startMs)),
        sourceEndTicks: addTicks(clip.videoInTicks, msToTicks(iv.endMs)),
        sequenceStartTicks: addTicks(clip.videoStartTicks, msToTicks(iv.startMs)),
        sequenceEndTicks: addTicks(clip.videoStartTicks, msToTicks(iv.endMs)),
        originalDurationMs: durationMs,
        retainedDurationMs: retained,
        removalDurationMs: Math.max(durationMs - retained, 0),
        selected: durationMs - retained > 0,
        warnings: [],
        metadata: { noiseFloorDb: silence.noiseFloorDb }
      };
    });
    const merged = mergeCandidates(raw, {
      mergeGapMs: settings.silence.mergeGapMs,
      minSpeechMs: settings.silence.minSpeechMs
    }).filter((c) => c.removalDurationMs > 0);
    allCandidates.push(...merged);
  }

  allCandidates.sort((a, b) => compareTicks(a.sequenceStartTicks, b.sequenceStartTicks));

  return {
    ok: true,
    candidates: allCandidates,
    context: {
      sequenceGuid: guid,
      videoTrackIndex,
      audioTrackIndex,
      clips,
      noiseFloorDb,
      thresholdDb
    }
  };
}

export interface ApplySummary {
  ok: boolean;
  results: ProbeResult[];
  cutCount?: number;
  removedMs?: number;
  bgmOverhangMessage?: string;
}

/**
 * 選択候補を「開いているシーケンスへ直接」適用する（D-020・複数クリップ対応）。
 * 候補のあるクリップは再構築、無いクリップは累積短縮分の左詰め移動のみ。
 */
export async function applyRealEdits(
  ppro: PproModule,
  context: AnalysisContext,
  candidates: CutCandidate[],
  onLog: (message: string) => void
): Promise<ApplySummary> {
  const results: ProbeResult[] = [];
  const push = (apiName: string, succeeded: boolean, notes: string[], error?: string): void => {
    const r: ProbeResult = { apiName, available: succeeded, succeeded, notes };
    if (error !== undefined) r.error = error;
    results.push(r);
    onLog(`${succeeded ? "✓" : "✗"} ${apiName}`);
  };

  const project = (await ppro.Project.getActiveProject()) as PproProject | null;
  if (!project) {
    push("前提", false, [], "プロジェクトがありません");
    return { ok: false, results };
  }
  const active = await project.getActiveSequence();
  if (!active || String(active.guid) !== context.sequenceGuid) {
    push("対象シーケンス確認", false, [
      "解析した時と違うシーケンスが開いています。対象のシーケンスを開いて「解析する」からやり直してください"
    ]);
    return { ok: false, results };
  }
  const targetGuid = context.sequenceGuid;

  try {
    // --- 対象クリップの再解決（解析後に変更されていないこと） ---
    const vNow = await scanTrack(ppro, project, targetGuid, "video", context.videoTrackIndex);
    for (const clip of context.clips) {
      const hit = vNow.find(
        (c) =>
          c.startTicks === clip.videoStartTicks &&
          c.inTicks === clip.videoInTicks &&
          c.outTicks === clip.videoOutTicks
      );
      if (!hit) {
        push("対象クリップ再解決", false, [
          "解析後にタイムラインが変更されたようです。「解析する」からやり直してください"
        ]);
        return { ok: false, results };
      }
    }

    // --- 編集計画（クリップごとのKeep Segment+累積左詰め・テスト済みロジック） ---
    const selected = candidates.filter((c) => c.selected);
    const clipRanges: ClipRange[] = context.clips.map((c) => ({
      clipId: c.clipId,
      sourceInTicks: c.videoInTicks,
      sourceOutTicks: c.videoOutTicks,
      sequenceStartTicks: c.videoStartTicks
    }));
    const plan = buildEditPlan(clipRanges, selected);
    const removedMs = selected.reduce((s, c) => s + c.removalDurationMs, 0);
    push("編集計画", true, [
      `クリップ${context.clips.length}件 / 候補${selected.length}件 / 推定短縮 ${(removedMs / 1000).toFixed(1)}秒`
    ]);
    if (selected.length === 0) {
      push("編集計画", false, ["選択された候補がありません"]);
      return { ok: false, results };
    }

    const nonTargetBefore = await nonTargetFingerprint(ppro, project, targetGuid, context);

    // --- クリップごとに適用（時間順） ---
    const allSegments: { destinationStartTicks: TickString; sourceInTicks: TickString; sourceOutTicks: TickString }[] = [];
    const cutMarkerPositions: { posTicks: TickString; removedSec: string }[] = [];
    for (let k = 0; k < plan.clips.length; k++) {
      const clipPlan = plan.clips[k];
      const clip = context.clips[k];
      if (!clipPlan || !clip) continue;
      const segments = clipPlan.keepSegments;
      if (segments.length === 0) continue;
      const single = segments.length === 1 ? segments[0] : null;
      const isWholeClip =
        single &&
        single.sourceInTicks === clip.videoInTicks &&
        single.sourceOutTicks === clip.videoOutTicks;

      if (isWholeClip && single) {
        // 高速パス: カットなし → 累積短縮分の移動のみ（移動不要ならno-op）
        if (compareTicks(single.destinationStartTicks, clip.videoStartTicks) !== 0) {
          await moveClipTo(
            ppro, project, targetGuid, "video", context.videoTrackIndex,
            clip.videoStartTicks, single.destinationStartTicks
          );
          await moveClipTo(
            ppro, project, targetGuid, "audio", context.audioTrackIndex,
            clip.audioStartTicks, single.destinationStartTicks
          );
          onLog(`clip${k}: 左詰め移動OK`);
        }
        allSegments.push(single);
        continue;
      }

      const rebuildSegments = segments.map((s) => ({
        sourceInTicks: s.sourceInTicks,
        sourceOutTicks: s.sourceOutTicks,
        destinationStartTicks: s.destinationStartTicks
      }));
      await rebuildTrackSegments(
        ppro, project, targetGuid, "video", context.videoTrackIndex,
        clip.videoStartTicks, rebuildSegments, onLog
      );
      await rebuildTrackSegments(
        ppro, project, targetGuid, "audio", context.audioTrackIndex,
        clip.audioStartTicks, rebuildSegments, onLog
      );
      allSegments.push(...rebuildSegments);
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const prev = segments[i - 1];
        if (!seg || !prev) continue;
        const removedTicks = subtractTicks(seg.sourceInTicks, prev.sourceOutTicks);
        cutMarkerPositions.push({
          posTicks: seg.destinationStartTicks,
          removedSec: (ticksToApproxMs(removedTicks) / 1000).toFixed(2)
        });
      }
      onLog(`clip${k}: 再構築OK（${segments.length} Segment）`);
    }
    push("V/A再構築（全クリップ）", true, []);

    // --- 検証 ---
    const vAfter = await scanTrack(ppro, project, targetGuid, "video", context.videoTrackIndex);
    const aAfter = await scanTrack(ppro, project, targetGuid, "audio", context.audioTrackIndex);
    let ok = true;
    const notes: string[] = [];
    for (const seg of allSegments) {
      const sv = vAfter.find((c) => c.startTicks === seg.destinationStartTicks);
      const sa = aAfter.find((c) => c.startTicks === seg.destinationStartTicks);
      if (!sv || !sa || sv.inTicks !== seg.sourceInTicks || sv.outTicks !== seg.sourceOutTicks) {
        ok = false;
        notes.push(`dest=${seg.destinationStartTicks}: 配置/In/Out不一致`);
        break;
      }
      if (subtractTicks(sa.startTicks, sv.startTicks) !== "0") {
        ok = false;
        notes.push(`dest=${seg.destinationStartTicks}: A/V同期ずれ`);
        break;
      }
    }
    notes.unshift(`Segment ${allSegments.length}件を検証`);
    push("配置+A/V同期検証", ok, notes);

    const nonTargetAfter = await nonTargetFingerprint(ppro, project, targetGuid, context);
    push("対象外トラック不変検証", nonTargetBefore === nonTargetAfter, []);
    if (nonTargetBefore !== nonTargetAfter) ok = false;

    // --- カット位置へマーカー（失敗しても適用自体は成功扱い） ---
    let cutCount = 0;
    try {
      if (cutMarkerPositions.length > 0) {
        const seqNow = await freshSequence(project, targetGuid);
        const markers = await ppro.Markers.getMarkers(seqNow);
        const actions: unknown[] = cutMarkerPositions.map((m) =>
          markers.createAddMarkerAction(
            "KazuCut",
            "Comment",
            ppro.TickTime.createWithTicks(m.posTicks),
            ppro.TickTime.createWithTicks("0"),
            `ここで${m.removedSec}秒カット`
          )
        );
        runTransaction(project, "KazuCut Local：カット位置マーカー", () => actions);
      }
      cutCount = cutMarkerPositions.length;
      push("カット位置マーカー", true, [`${cutCount}箇所へマーカー「KazuCut」を追加`]);
    } catch (e) {
      cutCount = cutMarkerPositions.length;
      push("カット位置マーカー", false, [
        "マーカーは打てませんでしたが、カット自体は完了しています"
      ], String(e));
    }

    // --- BGM残り情報（仕様34章・編集はしない） ---
    let bgmMessage: string | undefined;
    {
      const arollEnd = vAfter.reduce<TickString>(
        (max, c) => (compareTicks(c.endTicks, max) > 0 ? c.endTicks : max),
        "0"
      );
      let otherAudioEnd: TickString = "0";
      const aCount = await trackCount(project, targetGuid, "audio");
      for (let i = 0; i < aCount; i++) {
        if (i === context.audioTrackIndex) continue;
        for (const c of await scanTrack(ppro, project, targetGuid, "audio", i)) {
          if (compareTicks(c.endTicks, otherAudioEnd) > 0) otherAudioEnd = c.endTicks;
        }
      }
      if (compareTicks(otherAudioEnd, arollEnd) > 0) {
        const overhangSec = ticksToApproxMs(subtractTicks(otherAudioEnd, arollEnd)) / 1000;
        bgmMessage =
          `BGMがAロールより${overhangSec.toFixed(1)}秒長く残っています。\n` +
          `必要に応じてPremiere上で短くしてください。`;
      }
    }

    const summary: ApplySummary = { ok, results, cutCount, removedMs };
    if (bgmMessage !== undefined) summary.bgmOverhangMessage = bgmMessage;
    return summary;
  } catch (e) {
    push("適用処理", false, [
      "途中で失敗しました。Ctrl+Z（複数回）で適用前に戻せます"
    ], String(e));
    return { ok: false, results };
  }
}

async function nonTargetFingerprint(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  context: AnalysisContext
): Promise<string> {
  const parts: string[] = [];
  for (const kind of ["video", "audio"] as const) {
    const count = await trackCount(project, guid, kind);
    for (let i = 0; i < count; i++) {
      if (kind === "video" && i === context.videoTrackIndex) continue;
      if (kind === "audio" && i === context.audioTrackIndex) continue;
      for (const c of await scanTrack(ppro, project, guid, kind, i)) {
        parts.push(`${kind}${i}:${c.projectItemName}:${c.startTicks}-${c.endTicks}:${c.inTicks}/${c.outTicks}`);
      }
    }
  }
  return parts.sort().join("|");
}
