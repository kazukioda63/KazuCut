/**
 * Premiere DOM操作の抽象化。
 *
 * 実Premiere実装（uxpPremiereAdapter）はAPI Probe（Phase 2実機）の結果を
 * 確認してから確定する（ADR-003: Clone挙動を推測で決めない）。
 * テストは tests/premiere-mocks のMock実装で行う。
 * Mutation後は必ず再スキャンし、古い参照を再利用しない（仕様20章）。
 */
import type { TrackItemSnapshot } from "../types";
import type { ClipInfo } from "./avPairResolver";
import type { TickString } from "../ticks";

export interface SequenceRef {
  guid: string;
  name: string;
}

export interface TrackRef {
  mediaType: "video" | "audio";
  index: number;
  name: string;
}

export interface PremiereAdapter {
  getActiveSequence(): Promise<SequenceRef | null>;
  listSequences(): Promise<SequenceRef[]>;
  /** シーケンス複製。成功時は何も返さない（特定はGUID差分で行う） */
  cloneSequence(guid: string): Promise<void>;
  setActiveSequence(guid: string): Promise<void>;
  deleteSequence(guid: string): Promise<boolean>;

  listTracks(sequenceGuid: string): Promise<TrackRef[]>;
  /** 全トラックの全TrackItemスナップショット（保護検証用） */
  snapshotAllTracks(sequenceGuid: string): Promise<TrackItemSnapshot[]>;
  /** 指定トラックのクリップ情報（A/Vペア解決・編集対象特定用） */
  listClips(sequenceGuid: string, track: TrackRef): Promise<ClipInfo[]>;

  /** シーケンス最終端（全トラック中で最大のend） */
  getSequenceEndTicks(sequenceGuid: string): Promise<TickString>;

  /**
   * TrackItemを同一トラックの指定位置へ複製（isInsert=false固定・仕様19章）。
   * 戻り値なし。新規Itemの特定は呼び出し側がlistClipsの差分で行う。
   */
  cloneTrackItem(
    sequenceGuid: string,
    track: TrackRef,
    clipId: string,
    destinationStartTicks: TickString
  ): Promise<void>;

  /** クリップのSource In/Outを変更（リンク非連動を前提にV/A個別に呼ぶ） */
  setClipInOut(
    sequenceGuid: string,
    track: TrackRef,
    clipId: string,
    inTicks: TickString,
    outTicks: TickString
  ): Promise<void>;

  /** クリップを移動（リップルなし） */
  moveClip(
    sequenceGuid: string,
    track: TrackRef,
    clipId: string,
    newStartTicks: TickString
  ): Promise<void>;

  /** クリップ削除（リップルなし・対象トラックのみ） */
  removeClip(sequenceGuid: string, track: TrackRef, clipId: string): Promise<void>;

  setPlayerPosition(sequenceGuid: string, ticks: TickString): Promise<void>;
}
