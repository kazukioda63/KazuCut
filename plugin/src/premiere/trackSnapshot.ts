import type { TrackItemSnapshot } from "../types";

export interface SnapshotDiff {
  kind: "count" | "changed" | "missing" | "added";
  trackIndex: number;
  mediaType: string;
  detail: string;
}

/**
 * 対象外トラック保護のSnapshot比較（ADR-005 / 仕様18章）。
 * Tickは文字列の完全一致で比較する（数値化による丸めを避ける）。
 * 1件でも差異があれば NON_TARGET_TRACK_CHANGED として成功扱いにしない。
 */
export function compareSnapshots(
  before: TrackItemSnapshot[],
  after: TrackItemSnapshot[]
): SnapshotDiff[] {
  const diffs: SnapshotDiff[] = [];
  if (before.length !== after.length) {
    diffs.push({
      kind: "count",
      trackIndex: -1,
      mediaType: "*",
      detail: `TrackItem数が変化: ${before.length} → ${after.length}`
    });
  }

  const key = (s: TrackItemSnapshot): string =>
    `${s.mediaType}#${s.trackIndex}#${s.projectItemId ?? s.mediaPathHash ?? s.name}#${s.startTicks}`;

  const afterMap = new Map<string, TrackItemSnapshot[]>();
  for (const s of after) {
    const k = key(s);
    const arr = afterMap.get(k) ?? [];
    arr.push(s);
    afterMap.set(k, arr);
  }

  const matchedAfter = new Set<TrackItemSnapshot>();
  for (const b of before) {
    const candidates = (afterMap.get(key(b)) ?? []).filter((a) => !matchedAfter.has(a));
    const exact = candidates.find((a) => itemsEqual(b, a));
    if (exact) {
      matchedAfter.add(exact);
      continue;
    }
    // 同一位置キーで一致しない → 変更 or 消失
    const near = candidates[0];
    if (near) {
      matchedAfter.add(near);
      diffs.push({
        kind: "changed",
        trackIndex: b.trackIndex,
        mediaType: b.mediaType,
        detail: describeChange(b, near)
      });
    } else {
      diffs.push({
        kind: "missing",
        trackIndex: b.trackIndex,
        mediaType: b.mediaType,
        detail: `TrackItem「${b.name}」(start=${b.startTicks})が見つかりません`
      });
    }
  }
  for (const a of after) {
    if (!matchedAfter.has(a)) {
      diffs.push({
        kind: "added",
        trackIndex: a.trackIndex,
        mediaType: a.mediaType,
        detail: `TrackItem「${a.name}」(start=${a.startTicks})が追加されています`
      });
    }
  }
  return diffs;
}

function itemsEqual(a: TrackItemSnapshot, b: TrackItemSnapshot): boolean {
  return (
    a.mediaType === b.mediaType &&
    a.trackIndex === b.trackIndex &&
    a.projectItemId === b.projectItemId &&
    a.mediaPathHash === b.mediaPathHash &&
    a.name === b.name &&
    a.startTicks === b.startTicks &&
    a.endTicks === b.endTicks &&
    a.inTicks === b.inTicks &&
    a.outTicks === b.outTicks &&
    a.speed === b.speed &&
    a.disabled === b.disabled
  );
}

function describeChange(b: TrackItemSnapshot, a: TrackItemSnapshot): string {
  const fields: [string, unknown, unknown][] = [
    ["end", b.endTicks, a.endTicks],
    ["in", b.inTicks, a.inTicks],
    ["out", b.outTicks, a.outTicks],
    ["speed", b.speed, a.speed],
    ["disabled", b.disabled, a.disabled],
    ["name", b.name, a.name]
  ];
  const changed = fields
    .filter(([, x, y]) => x !== y)
    .map(([f, x, y]) => `${f}: ${String(x)}→${String(y)}`);
  return `TrackItem「${b.name}」が変更: ${changed.join(", ") || "(位置キー衝突)"}`;
}

/**
 * 対象クリップ（編集対象のA/Vペア）を除いたSnapshotを返す。
 * 「対象外トラック不変」検証の入力を作る。
 */
export function excludeTargets(
  snapshots: TrackItemSnapshot[],
  targetVideoTrackIndex: number,
  targetAudioTrackIndex: number
): TrackItemSnapshot[] {
  return snapshots.filter(
    (s) =>
      !(s.mediaType === "video" && s.trackIndex === targetVideoTrackIndex) &&
      !(s.mediaType === "audio" && s.trackIndex === targetAudioTrackIndex)
  );
}
