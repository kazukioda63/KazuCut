/**
 * Premiere Mock（仕様33章のPremiere Mockテスト用）。
 * 実Premiereの挙動を単純化したインメモリ実装 + 失敗注入フラグ。
 * これはMockでありPremiere実機の挙動保証ではない（MANUAL_TEST_CHECKLIST参照）。
 */
import type {
  PremiereAdapter,
  SequenceRef,
  TrackRef
} from "../../plugin/src/premiere/premiereAdapter";
import type { ClipInfo } from "../../plugin/src/premiere/avPairResolver";
import type { TrackItemSnapshot } from "../../plugin/src/types";
import { addTicks, compareTicks, maxTicks, subtractTicks } from "../../plugin/src/ticks";

export interface MockFailures {
  sequenceCloneThrows?: boolean;
  sequenceCloneProducesTwo?: boolean;
  trackItemCloneThrows?: boolean;
  cloneProducesNothing?: boolean;
  /** removeClip時にBGMトラックを勝手に動かす（対象外Track変化の注入） */
  mutateNonTargetOnRemove?: boolean;
  /** 音声moveにドリフトを加える（A/V同期誤差の注入） */
  audioMoveDriftTicks?: string;
  /** Video Clone時にリンクAudioも複製する（Audio二重Clone挙動の注入） */
  linkedAudioCloneOnVideoClone?: boolean;
}

interface MockSequence {
  ref: SequenceRef;
  tracks: TrackRef[];
  clips: Map<string, ClipInfo[]>; // key = mediaType#index
}

const trackKey = (t: TrackRef): string => `${t.mediaType}#${t.index}`;

export class MockPremiereAdapter implements PremiereAdapter {
  sequences = new Map<string, MockSequence>();
  failures: MockFailures = {};
  private guidSeq = 0;
  private clipSeq = 0;
  activeSequenceGuid: string | null = null;
  playerPositionTicks = "0";

  // ---- テストデータ構築 ----
  addSequence(name: string, tracks: TrackRef[]): string {
    const guid = `seq-${++this.guidSeq}`;
    this.sequences.set(guid, {
      ref: { guid, name },
      tracks,
      clips: new Map(tracks.map((t) => [trackKey(t), []]))
    });
    if (!this.activeSequenceGuid) this.activeSequenceGuid = guid;
    return guid;
  }

  addClip(guid: string, track: TrackRef, clip: Partial<ClipInfo> & {
    startTicks: string; endTicks: string; inTicks: string; outTicks: string;
    projectItemId: string; }): string {
    const seq = this.mustGet(guid);
    const clipId = `clip-${++this.clipSeq}`;
    const full: ClipInfo = {
      clipId,
      mediaType: track.mediaType,
      trackIndex: track.index,
      speed: 100,
      reversed: false,
      timeRemapped: false,
      mediaOffline: false,
      clipKind: "standard",
      ...clip
    };
    seq.clips.get(trackKey(track))!.push(full);
    return clipId;
  }

  // ---- PremiereAdapter実装 ----
  async getActiveSequence(): Promise<SequenceRef | null> {
    if (!this.activeSequenceGuid) return null;
    return this.sequences.get(this.activeSequenceGuid)?.ref ?? null;
  }

  async listSequences(): Promise<SequenceRef[]> {
    return [...this.sequences.values()].map((s) => ({ ...s.ref }));
  }

  async cloneSequence(guid: string): Promise<void> {
    if (this.failures.sequenceCloneThrows) throw new Error("Mock: cloneSequence失敗");
    const src = this.mustGet(guid);
    const copies = this.failures.sequenceCloneProducesTwo ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      const newGuid = `seq-${++this.guidSeq}`;
      const clips = new Map<string, ClipInfo[]>();
      for (const [k, arr] of src.clips) {
        clips.set(k, arr.map((c) => ({ ...c, clipId: `clip-${++this.clipSeq}` })));
      }
      this.sequences.set(newGuid, {
        ref: { guid: newGuid, name: `${src.ref.name} コピー` },
        tracks: [...src.tracks],
        clips
      });
    }
  }

  async setActiveSequence(guid: string): Promise<void> {
    this.mustGet(guid);
    this.activeSequenceGuid = guid;
  }

  async deleteSequence(guid: string): Promise<boolean> {
    return this.sequences.delete(guid);
  }

  async listTracks(guid: string): Promise<TrackRef[]> {
    return [...this.mustGet(guid).tracks];
  }

  async snapshotAllTracks(guid: string): Promise<TrackItemSnapshot[]> {
    const seq = this.mustGet(guid);
    const out: TrackItemSnapshot[] = [];
    for (const [, arr] of seq.clips) {
      for (const c of arr) {
        out.push({
          mediaType: c.mediaType,
          trackIndex: c.trackIndex,
          projectItemId: c.projectItemId,
          name: c.projectItemId,
          startTicks: c.startTicks,
          endTicks: c.endTicks,
          inTicks: c.inTicks,
          outTicks: c.outTicks,
          speed: c.speed,
          disabled: false
        });
      }
    }
    return out;
  }

  async listClips(guid: string, track: TrackRef): Promise<ClipInfo[]> {
    return (this.mustGet(guid).clips.get(trackKey(track)) ?? []).map((c) => ({ ...c }));
  }

  async getSequenceEndTicks(guid: string): Promise<string> {
    const seq = this.mustGet(guid);
    let end = "0";
    for (const [, arr] of seq.clips) {
      for (const c of arr) end = maxTicks(end, c.endTicks);
    }
    return end;
  }

  async cloneTrackItem(
    guid: string,
    track: TrackRef,
    clipId: string,
    destinationStartTicks: string
  ): Promise<void> {
    if (this.failures.trackItemCloneThrows) throw new Error("Mock: cloneTrackItem失敗");
    if (this.failures.cloneProducesNothing) return;
    const seq = this.mustGet(guid);
    const src = this.findClip(seq, track, clipId);
    const duration = subtractTicks(src.endTicks, src.startTicks);
    const doClone = (t: TrackRef, from: ClipInfo): void => {
      seq.clips.get(trackKey(t))!.push({
        ...from,
        clipId: `clip-${++this.clipSeq}`,
        startTicks: destinationStartTicks,
        endTicks: addTicks(destinationStartTicks, duration)
      });
    };
    doClone(track, src);
    // 実機で確認すべき「リンクAudio同時Clone」挙動の注入
    if (this.failures.linkedAudioCloneOnVideoClone && track.mediaType === "video") {
      const audioTrack = seq.tracks.find((t) => t.mediaType === "audio");
      if (audioTrack) {
        const linked = (seq.clips.get(trackKey(audioTrack)) ?? []).find(
          (c) => c.projectItemId === src.projectItemId && c.startTicks === src.startTicks
        );
        if (linked) doClone(audioTrack, linked);
      }
    }
  }

  async setClipInOut(
    guid: string,
    track: TrackRef,
    clipId: string,
    inTicks: string,
    outTicks: string
  ): Promise<void> {
    const seq = this.mustGet(guid);
    const clip = this.findClip(seq, track, clipId);
    clip.inTicks = inTicks;
    clip.outTicks = outTicks;
    clip.endTicks = addTicks(clip.startTicks, subtractTicks(outTicks, inTicks));
  }

  async moveClip(
    guid: string,
    track: TrackRef,
    clipId: string,
    newStartTicks: string
  ): Promise<void> {
    const seq = this.mustGet(guid);
    const clip = this.findClip(seq, track, clipId);
    const duration = subtractTicks(clip.endTicks, clip.startTicks);
    let start = newStartTicks;
    if (track.mediaType === "audio" && this.failures.audioMoveDriftTicks) {
      start = addTicks(start, this.failures.audioMoveDriftTicks);
    }
    clip.startTicks = start;
    clip.endTicks = addTicks(start, duration);
  }

  async removeClip(guid: string, track: TrackRef, clipId: string): Promise<void> {
    const seq = this.mustGet(guid);
    const arr = seq.clips.get(trackKey(track))!;
    const idx = arr.findIndex((c) => c.clipId === clipId);
    if (idx < 0) throw new Error(`Mock: clip未発見 ${clipId}`);
    arr.splice(idx, 1);
    if (this.failures.mutateNonTargetOnRemove) {
      // BGM（audio track 1）を勝手に動かす
      for (const [key, clips] of seq.clips) {
        if (key === "audio#1") {
          for (const c of clips) {
            c.startTicks = addTicks(c.startTicks, "254016000000");
            c.endTicks = addTicks(c.endTicks, "254016000000");
          }
        }
      }
    }
  }

  async setPlayerPosition(_guid: string, ticks: string): Promise<void> {
    this.playerPositionTicks = ticks;
  }

  // ---- helpers ----
  private mustGet(guid: string): MockSequence {
    const seq = this.sequences.get(guid);
    if (!seq) throw new Error(`Mock: sequence未発見 ${guid}`);
    return seq;
  }

  private findClip(seq: MockSequence, track: TrackRef, clipId: string): ClipInfo {
    const clip = (seq.clips.get(trackKey(track)) ?? []).find((c) => c.clipId === clipId);
    if (!clip) throw new Error(`Mock: clip未発見 ${clipId}`);
    return clip;
  }

  /** クリップが時間順で重ならないか（テスト補助） */
  clipsOverlap(guid: string, track: TrackRef): boolean {
    const clips = [...(this.mustGet(guid).clips.get(trackKey(track)) ?? [])].sort((a, b) =>
      compareTicks(a.startTicks, b.startTicks)
    );
    for (let i = 1; i < clips.length; i++) {
      if (compareTicks(clips[i]!.startTicks, clips[i - 1]!.endTicks) < 0) return true;
    }
    return false;
  }
}
