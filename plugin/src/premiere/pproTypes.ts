/**
 * require("premierepro") モジュールの構造的型定義。
 * 公式ドキュメント（docs/REFERENCES.md）とAPI Probe実測（docs/api-probe.md）に基づく。
 * 実挙動が異なる場合はProbe結果を優先し、ここを更新する。
 */

export interface PproTickTime {
  ticks: string;
  ticksNumber: number;
  seconds: number;
}

export interface PproAction {
  readonly __brand?: "Action";
}

export interface PproCompoundAction {
  addAction(action: PproAction): boolean;
}

export interface PproGuid {
  toString(): string;
}

export interface PproProjectItem {
  name?: string;
}

export interface PproTrackItem {
  getStartTime(): Promise<PproTickTime>;
  getEndTime(): Promise<PproTickTime>;
  getInPoint(): Promise<PproTickTime>;
  getOutPoint(): Promise<PproTickTime>;
  getDuration(): Promise<PproTickTime>;
  getSpeed(): Promise<number>;
  isSpeedReversed(): Promise<number>;
  isDisabled(): Promise<boolean>;
  getName(): Promise<string>;
  getProjectItem(): Promise<PproProjectItem>;
  getTrackIndex(): Promise<number>;
  createSetStartAction(t: PproTickTime): PproAction;
  createSetEndAction(t: PproTickTime): PproAction;
  createSetInPointAction(t: PproTickTime): PproAction;
  createSetOutPointAction(t: PproTickTime): PproAction;
  createMoveAction(t: PproTickTime): PproAction;
}

export interface PproTrack {
  name: string;
  getIndex(): Promise<number>;
  getTrackItems(trackItemType: number, includeEmpty: boolean): PproTrackItem[];
}

export interface PproTrackItemSelection {
  addItem(item: PproTrackItem, skipDuplicateCheck?: boolean): boolean;
  removeItem(item: PproTrackItem): boolean;
  getTrackItems(): Promise<PproTrackItem[]>;
}

export interface PproSequence {
  guid: PproGuid;
  name: string;
  getVideoTrackCount(): Promise<number>;
  getAudioTrackCount(): Promise<number>;
  getVideoTrack(index: number): Promise<PproTrack>;
  getAudioTrack(index: number): Promise<PproTrack>;
  getEndTime(): Promise<PproTickTime>;
  getSelection(): Promise<PproTrackItemSelection>;
  getPlayerPosition(): Promise<PproTickTime>;
  setPlayerPosition(t: PproTickTime): Promise<boolean>;
  createCloneAction(): PproAction;
}

export interface PproSequenceEditor {
  createCloneTrackItemAction(
    trackItem: PproTrackItem,
    timeOffset: PproTickTime,
    videoTrackVerticalOffset: number,
    audioTrackVerticalOffset: number,
    alignToVideo: boolean,
    isInsert: boolean
  ): PproAction;
  createRemoveItemsAction(
    selection: PproTrackItemSelection,
    ripple: boolean,
    mediaType?: unknown,
    shiftOverLapping?: boolean
  ): PproAction;
}

export interface PproProject {
  getActiveSequence(): Promise<PproSequence | null>;
  setActiveSequence(seq: PproSequence): Promise<boolean>;
  getSequences(): Promise<PproSequence[]>;
  deleteSequence(seq: PproSequence): Promise<boolean>;
  executeTransaction(
    callback: (compound: PproCompoundAction) => void,
    undoString?: string
  ): boolean;
  lockedAccess(callback: () => void): void;
}

export interface PproModule {
  Project: {
    getActiveProject(): Promise<PproProject | null>;
  };
  TickTime: {
    createWithTicks(ticks: string): PproTickTime;
    createWithSeconds(seconds: number): PproTickTime;
  };
  SequenceEditor: {
    getEditor(seq: PproSequence): PproSequenceEditor;
  };
  ClipProjectItem: {
    cast(item: PproProjectItem): {
      getMediaFilePath(): Promise<string>;
      isOffline(): Promise<boolean>;
    };
  };
  TrackItemSelection?: {
    createEmptySelection?(selection: unknown): void;
  };
  Constants?: {
    TrackItemType?: Record<string, number>;
    MediaType?: Record<string, unknown>;
  };
}

/** Constants.TrackItemTypeのClip値（26.3の公称値。取得できなければ1を仮定しProbeで検証） */
export function clipTrackItemType(ppro: PproModule): number {
  const t = ppro.Constants?.TrackItemType;
  if (t) {
    for (const key of ["CLIP", "Clip", "clip"]) {
      const v = t[key];
      if (typeof v === "number") return v;
    }
  }
  return 1;
}
