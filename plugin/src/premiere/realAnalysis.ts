/**
 * 実メディアの無音解析と適用（Phase 4-7統合）。
 *
 * 解析: 選択トラックのA/Vペア解決 → メディアパス取得 → Worker(analyze)で無音検出
 *       → 無音区間をCutCandidateへ変換 → 統合
 * 適用: 複製(または直接+バックアップ) → Phase 3で実証済みの再構築エンジンで
 *       Keep Segmentを一括適用 → 検証（A/V同期・対象外/元シーケンス不変）
 */
import type { NativeBridge, CutCandidate, AnalysisSettings, ProbeResult, JobStatus } from "../types";
import { createError } from "../errors";
import type { KazuCutError } from "../types";
import { pollJob } from "../native/jobPoller";
import { buildJobRequest } from "../analysis/analysisController";
import { mergeCandidates } from "../analysis/candidateMerger";
import { planKeepSegments } from "../analysis/keepSegmentPlanner";
import { resolveAvPair, type ClipInfo } from "./avPairResolver";
import type { PproModule, PproProject } from "./pproTypes";
import {
  cloneSequenceAndIdentify,
  rebuildTrackSegments,
  scanTrack,
  sequenceFingerprint,
  trackCount,
  freshSequence,
  type LiveClip
} from "./uxpTimeline";
import { clipTrackItemType } from "./pproTypes";
import {
  addTicks,
  compareTicks,
  msToTicks,
  subtractTicks,
  ticksToApproxMs,
  type TickString
} from "../ticks";

export interface AnalysisContext {
  sequenceGuid: string;
  videoTrackIndex: number;
  audioTrackIndex: number;
  videoStartTicks: TickString;
  videoInTicks: TickString;
  videoOutTicks: TickString;
  audioStartTicks: TickString;
  mediaPath: string;
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

export async function runRealAnalysis(
  ppro: PproModule,
  bridge: NativeBridge,
  settings: AnalysisSettings,
  videoTrackIndex: number,
  audioTrackIndex: number,
  onProgress: (status: JobStatus) => void,
  signal: AbortSignal
): Promise<AnalyzeResult> {
  const project = await ppro.Project.getActiveProject();
  if (!project) return { ok: false, error: createError("NO_ACTIVE_PROJECT", "") };
  const seq = await project.getActiveSequence();
  if (!seq) return { ok: false, error: createError("NO_ACTIVE_SEQUENCE", "") };
  const guid = String(seq.guid);

  // --- A/Vペア解決 ---
  const vClips = await scanTrack(ppro, project, guid, "video", videoTrackIndex);
  if (vClips.length === 0) {
    return {
      ok: false,
      error: createError("NO_SELECTED_CLIP", `V${videoTrackIndex + 1}にクリップがありません`)
    };
  }
  const vLive = vClips[0];
  if (!vLive) return { ok: false, error: createError("NO_SELECTED_CLIP", "") };

  // メディアパス・オフライン確認（ClipProjectItem経由）
  let mediaPath = "";
  let offline = false;
  try {
    const seqFresh = await freshSequence(project, guid);
    const track = await seqFresh.getVideoTrack(videoTrackIndex);
    const items = track.getTrackItems(clipTrackItemType(ppro), false).filter((x) => x != null);
    const item = items[0];
    if (!item) throw new Error("TrackItem再取得失敗");
    const projectItem = await item.getProjectItem();
    const clipItem = ppro.ClipProjectItem.cast(projectItem);
    mediaPath = await clipItem.getMediaFilePath();
    offline = await clipItem.isOffline().catch(() => false);
  } catch (e) {
    return {
      ok: false,
      error: createError("MEDIA_NOT_FOUND", `メディアパス取得失敗: ${String(e)}`)
    };
  }
  if (offline) return { ok: false, error: createError("MEDIA_OFFLINE", mediaPath) };
  if (!mediaPath) return { ok: false, error: createError("MEDIA_NOT_FOUND", "パスが空です") };

  const video = toClipInfo(vLive, "v0", offline);
  const aClips = await scanTrack(ppro, project, guid, "audio", audioTrackIndex);
  const pair = resolveAvPair(
    video,
    aClips.map((c, i) => toClipInfo(c, `a${i}`, false)),
    audioTrackIndex
  );
  if (!pair.ok) return { ok: false, error: pair.error };

  // --- Workerで無音解析 ---
  const request = buildJobRequest(
    {
      jobId: `analyze-${Date.now()}`,
      mediaPath,
      sourceInTicks: video.inTicks,
      sourceOutTicks: video.outTicks,
      audioStreamIndex: 0
    },
    settings,
    null
  );
  const jobId = bridge.startJob(JSON.stringify({ type: "analyze", ...request }));
  if (jobId.startsWith("{")) {
    // startJobがエラーJSONを返した
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
  const status = await pollJob(bridge, jobId, { intervalMs: 150, signal, onProgress });
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
  let silence: { intervals: { startMs: number; endMs: number }[]; noiseFloorDb: number; thresholdDb: number };
  try {
    const result = JSON.parse(bridge.getJobResult(jobId)) as {
      silence?: typeof silence;
    };
    if (!result.silence) throw new Error("silenceセクションがありません");
    silence = result.silence;
  } catch (e) {
    bridge.disposeJob(jobId);
    return { ok: false, error: createError("WORKER_PROTOCOL_ERROR", String(e)) };
  }
  bridge.disposeJob(jobId);

  // --- 無音区間 → CutCandidate（区間はデコード範囲=クリップIn基準のms） ---
  const rawCandidates: CutCandidate[] = silence.intervals.map((iv, i) => {
    const durationMs = iv.endMs - iv.startMs;
    const retained = retainedMsFor(durationMs, settings);
    const srcStart = addTicks(video.inTicks, msToTicks(iv.startMs));
    const srcEnd = addTicks(video.inTicks, msToTicks(iv.endMs));
    return {
      id: `sil-${i}`,
      reason: "silence" as const,
      clipId: "v0",
      sourceStartTicks: srcStart,
      sourceEndTicks: srcEnd,
      sequenceStartTicks: addTicks(video.startTicks, msToTicks(iv.startMs)),
      sequenceEndTicks: addTicks(video.startTicks, msToTicks(iv.endMs)),
      originalDurationMs: durationMs,
      retainedDurationMs: retained,
      removalDurationMs: Math.max(durationMs - retained, 0),
      selected: durationMs - retained > 0,
      warnings: [],
      metadata: { noiseFloorDb: silence.noiseFloorDb }
    };
  });
  const candidates = mergeCandidates(rawCandidates, {
    mergeGapMs: settings.silence.mergeGapMs,
    minSpeechMs: settings.silence.minSpeechMs
  }).filter((c) => c.removalDurationMs > 0);

  return {
    ok: true,
    candidates,
    context: {
      sequenceGuid: guid,
      videoTrackIndex,
      audioTrackIndex,
      videoStartTicks: video.startTicks,
      videoInTicks: video.inTicks,
      videoOutTicks: video.outTicks,
      audioStartTicks: pair.audio.startTicks,
      mediaPath,
      noiseFloorDb: silence.noiseFloorDb,
      thresholdDb: silence.thresholdDb
    }
  };
}

export interface ApplySummary {
  ok: boolean;
  results: ProbeResult[];
  editedSequenceGuid?: string;
  editedSequenceName?: string;
  activated?: boolean;
  backupSequenceGuid?: string;
  bgmOverhangMessage?: string;
}

export async function applyRealEdits(
  ppro: PproModule,
  context: AnalysisContext,
  candidates: CutCandidate[],
  outputMode: "duplicate" | "direct",
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
  const originalGuid = context.sequenceGuid;
  const originalFingerprint = await sequenceFingerprint(ppro, project, originalGuid);

  // --- 出力先の準備（仕様17章） ---
  let targetGuid: string;
  let targetName = "";
  let backupGuid: string | undefined;
  if (outputMode === "duplicate") {
    try {
      const clone = await cloneSequenceAndIdentify(project, originalGuid);
      targetGuid = clone.guid;
      targetName = clone.name;
      push("複製シーケンス作成", true, [clone.name]);
    } catch (e) {
      push("複製シーケンス作成", false, [], String(e));
      return { ok: false, results };
    }
  } else {
    try {
      const backup = await cloneSequenceAndIdentify(project, originalGuid);
      backupGuid = backup.guid;
      push("バックアップ複製作成", true, [backup.name]);
    } catch (e) {
      push("バックアップ複製作成", false, ["バックアップに失敗したため直接編集を開始しません（仕様17章）"], String(e));
      return { ok: false, results };
    }
    targetGuid = originalGuid;
  }

  try {
    // --- 対象クリップを編集先シーケンスで再解決 ---
    const vClips = await scanTrack(ppro, project, targetGuid, "video", context.videoTrackIndex);
    const aClips = await scanTrack(ppro, project, targetGuid, "audio", context.audioTrackIndex);
    const v = vClips.find(
      (c) => c.inTicks === context.videoInTicks && c.outTicks === context.videoOutTicks
    );
    const a = aClips.find((c) => c.startTicks === v?.startTicks);
    if (!v || !a) {
      push("対象クリップ再解決", false, [
        "編集先シーケンスで対象クリップを特定できませんでした"
      ]);
      return { ok: false, results };
    }

    // --- Keep Segment生成 ---
    const selected = candidates.filter((c) => c.selected);
    const segments = planKeepSegments(
      {
        clipId: "v0",
        sourceInTicks: v.inTicks,
        sourceOutTicks: v.outTicks,
        sequenceStartTicks: v.startTicks
      },
      selected
    );
    const removedMs = selected.reduce((s, c) => s + c.removalDurationMs, 0);
    push("Keep Segment生成", segments.length > 0, [
      `候補${selected.length}件 → Segment${segments.length}件 / 推定短縮 ${(removedMs / 1000).toFixed(1)}秒`
    ]);
    if (segments.length === 0) return { ok: false, results };

    const nonTargetBefore = await nonTargetFingerprint(ppro, project, targetGuid, context);

    // --- 再構築（Phase 3実証済みエンジン） ---
    const rebuildSegments = segments.map((s) => ({
      sourceInTicks: s.sourceInTicks,
      sourceOutTicks: s.sourceOutTicks,
      destinationStartTicks: s.destinationStartTicks
    }));
    try {
      await rebuildTrackSegments(
        ppro, project, targetGuid, "video", context.videoTrackIndex,
        v.startTicks, rebuildSegments, onLog
      );
      await rebuildTrackSegments(
        ppro, project, targetGuid, "audio", context.audioTrackIndex,
        a.startTicks, rebuildSegments, onLog
      );
      push("V/A再構築", true, []);
    } catch (e) {
      push("V/A再構築", false, [], String(e));
      return { ok: false, results };
    }

    // --- 検証 ---
    const vAfter = await scanTrack(ppro, project, targetGuid, "video", context.videoTrackIndex);
    const aAfter = await scanTrack(ppro, project, targetGuid, "audio", context.audioTrackIndex);
    let ok = vAfter.length === segments.length && aAfter.length === segments.length;
    const notes: string[] = [`クリップ数 V=${vAfter.length} A=${aAfter.length}（期待${segments.length}）`];
    for (const seg of segments) {
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
    push("配置+A/V同期検証", ok, notes);

    const nonTargetAfter = await nonTargetFingerprint(ppro, project, targetGuid, context);
    push("対象外トラック不変検証", nonTargetBefore === nonTargetAfter, []);
    if (nonTargetBefore !== nonTargetAfter) ok = false;

    if (outputMode === "duplicate") {
      const after = await sequenceFingerprint(ppro, project, originalGuid);
      push("元シーケンス不変検証", after === originalFingerprint, []);
      if (after !== originalFingerprint) ok = false;
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
        const overhangSec =
          ticksToApproxMs(subtractTicks(otherAudioEnd, arollEnd)) / 1000;
        bgmMessage =
          `BGMがAロールより${overhangSec.toFixed(1)}秒長く残っています。\n` +
          `必要に応じてPremiere上で短くしてください。`;
      }
    }

    // 編集結果のシーケンスをアクティブ化（ユーザーが結果をすぐ見られるように）
    let activated = false;
    if (ok) {
      try {
        const edited = await freshSequence(project, targetGuid);
        const returned = await project.setActiveSequence(edited);
        // 戻り値だけを信用せず、実際にアクティブになったかを確認する
        const nowActive = await project.getActiveSequence();
        activated = returned === true && nowActive !== null && String(nowActive.guid) === targetGuid;
        push("編集結果シーケンスをアクティブ化", activated, [
          `setActiveSequence戻り値=${String(returned)}`,
          activated ? "アクティブ化成功" : "アクティブ化が反映されませんでした（手動で開いてください）"
        ]);
      } catch (e) {
        push("編集結果シーケンスをアクティブ化", false, [
          "手動でプロジェクトパネルから複製シーケンスを開いてください"
        ], String(e));
      }
    }

    const summary: ApplySummary = {
      ok, results, editedSequenceGuid: targetGuid, activated
    };
    if (targetName) summary.editedSequenceName = targetName;
    if (backupGuid !== undefined) summary.backupSequenceGuid = backupGuid;
    if (bgmMessage !== undefined) summary.bgmOverhangMessage = bgmMessage;
    return summary;
  } catch (e) {
    push("適用処理", false, [], String(e));
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
