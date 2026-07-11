import { AV_PAIR_TOLERANCE_MS } from "../constants";
import { createError } from "../errors";
import type { KazuCutError } from "../types";
import { compareTicks, msToTicks, subtractTicks, type TickString } from "../ticks";

/** A/Vペア解決に必要なクリップ情報（premiereAdapterが実TrackItemから抽出する） */
export interface ClipInfo {
  clipId: string;
  mediaType: "video" | "audio";
  trackIndex: number;
  projectItemId: string;
  startTicks: TickString;
  endTicks: TickString;
  inTicks: TickString;
  outTicks: TickString;
  speed: number;
  reversed: boolean;
  timeRemapped: boolean;
  mediaOffline: boolean;
  clipKind: "standard" | "nested" | "multicam" | "merged";
}

export type PairResolution =
  | { ok: true; video: ClipInfo; audio: ClipInfo }
  | { ok: false; error: KazuCutError; candidates?: ClipInfo[] };

/**
 * 選択したAロール映像クリップに対応する内蔵音声クリップを解決する（仕様15章）。
 * 条件: UI指定の音声トラック / 同じProjectItem / Start・End許容差内 /
 * In・Out許容差内 / 100%速度 / 正方向 / 時間重なり。
 * 一意に特定できない場合は自動編集せず候補を返す。
 */
export function resolveAvPair(
  video: ClipInfo,
  audioTrackClips: ClipInfo[],
  targetAudioTrackIndex: number
): PairResolution {
  // まず映像側の対応可否を検証
  const videoError = checkSupported(video);
  if (videoError) return { ok: false, error: videoError };

  const tol = msToTicks(AV_PAIR_TOLERANCE_MS);
  const within = (a: TickString, b: TickString): boolean => {
    const d = subtractTicks(a, b);
    const abs = d.startsWith("-") ? d.slice(1) : d;
    return compareTicks(abs, tol) <= 0;
  };

  const overlapping = audioTrackClips.filter(
    (a) =>
      a.mediaType === "audio" &&
      a.trackIndex === targetAudioTrackIndex &&
      compareTicks(a.startTicks, video.endTicks) < 0 &&
      compareTicks(a.endTicks, video.startTicks) > 0
  );

  const strict = overlapping.filter(
    (a) =>
      a.projectItemId === video.projectItemId &&
      within(a.startTicks, video.startTicks) &&
      within(a.endTicks, video.endTicks) &&
      within(a.inTicks, video.inTicks) &&
      within(a.outTicks, video.outTicks) &&
      a.speed === 100 &&
      !a.reversed
  );

  if (strict.length === 1) {
    const audio = strict[0];
    if (!audio) {
      return {
        ok: false,
        error: createError("AMBIGUOUS_AUDIO_PAIR", "内部エラー: strict[0]がundefined")
      };
    }
    const audioError = checkSupported(audio);
    if (audioError) return { ok: false, error: audioError };
    return { ok: true, video, audio };
  }

  if (strict.length > 1) {
    return {
      ok: false,
      error: createError(
        "AMBIGUOUS_AUDIO_PAIR",
        `厳密一致する音声クリップが${strict.length}件あります`,
        { candidateIds: strict.map((c) => c.clipId) }
      ),
      candidates: strict
    };
  }

  return {
    ok: false,
    error: createError(
      "AMBIGUOUS_AUDIO_PAIR",
      `対応する音声クリップが見つかりません（重なり候補${overlapping.length}件）`,
      { candidateIds: overlapping.map((c) => c.clipId) }
    ),
    candidates: overlapping
  };
}

/** 非対応素材の検査（仕様16章）。対応ならnull、非対応ならエラー */
export function checkSupported(clip: ClipInfo): KazuCutError | null {
  if (clip.mediaOffline) {
    return createError("MEDIA_OFFLINE", `clip=${clip.clipId}`);
  }
  if (clip.clipKind === "nested") {
    return createError("UNSUPPORTED_NEST", `clip=${clip.clipId}`);
  }
  if (clip.clipKind === "multicam") {
    return createError("UNSUPPORTED_MULTICAM", `clip=${clip.clipId}`);
  }
  if (clip.clipKind === "merged") {
    return createError("UNSUPPORTED_MERGED_CLIP", `clip=${clip.clipId}`);
  }
  if (clip.reversed) {
    return createError("UNSUPPORTED_REVERSE", `clip=${clip.clipId}`);
  }
  if (clip.timeRemapped) {
    return createError("UNSUPPORTED_TIME_REMAP", `clip=${clip.clipId}`);
  }
  if (clip.speed !== 100) {
    return createError("UNSUPPORTED_SPEED", `clip=${clip.clipId}, speed=${clip.speed}%`);
  }
  return null;
}
