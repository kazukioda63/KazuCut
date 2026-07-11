import type { TickString } from "./ticks";

// ---- Native Bridge (仕様11章) ----

export interface NativeVersionInfo {
  addonVersion: string;
  workerVersion: string;
  architecture: string;
  workerAvailable: boolean;
  executionMode: "external-worker" | "in-process-worker";
}

export interface NativeBridge {
  getVersion(): NativeVersionInfo;
  healthCheck(): string;
  startJob(requestJson: string): string;
  getJobStatus(jobId: string): string;
  getJobResult(jobId: string): string;
  cancelJob(jobId: string): boolean;
  disposeJob(jobId: string): boolean;
}

export type JobStage =
  | "starting"
  | "decode"
  | "silence"
  | "transcript"
  | "filler"
  | "finalize";

export interface JobStatus {
  jobId: string;
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number; // 0..1
  stage?: JobStage;
  error?: KazuCutError;
}

// ---- エラー (仕様32章) ----

export interface KazuCutError {
  code: string;
  userMessage: string;
  developerMessage: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

// ---- Snapshot (仕様18章) ----

export interface TrackItemSnapshot {
  mediaType: "video" | "audio" | "caption";
  trackIndex: number;
  projectItemId?: string;
  mediaPathHash?: string;
  name: string;
  startTicks: TickString;
  endTicks: TickString;
  inTicks?: TickString;
  outTicks?: TickString;
  speed?: number;
  disabled?: boolean;
}

// ---- Keep Segment (仕様19章) ----

export interface KeepSegment {
  id: string;
  sourceInTicks: TickString;
  sourceOutTicks: TickString;
  originalSequenceStartTicks: TickString;
  destinationStartTicks: TickString;
  durationTicks: TickString;
}

// ---- Candidate (仕様26章) ----

export type CandidateReason = "silence" | "filler" | "manual";

export interface CutCandidate {
  id: string;
  reason: CandidateReason;
  clipId: string;
  sourceStartTicks: TickString;
  sourceEndTicks: TickString;
  sequenceStartTicks: TickString;
  sequenceEndTicks: TickString;
  originalDurationMs: number;
  retainedDurationMs: number;
  removalDurationMs: number;
  detectedText?: string;
  confidence?: number;
  selected: boolean;
  warnings: string[];
  metadata: Record<string, string | number | boolean | null>;
}

// ---- 解析設定 ----

export type ChannelMode = "auto" | "left" | "right" | "mix" | "max-energy";
export type SilenceMode = "remove" | "shorten";

export interface StagedShorteningRule {
  /** この長さ(ms)以上の無音に適用 */
  minDurationMs: number;
  /** 残す長さ(ms) */
  retainMs: number;
}

export interface SilenceSettings {
  enabled: boolean;
  autoThreshold: boolean;
  manualThresholdDb: number;
  noiseMarginDb: number;
  hysteresisDb: number;
  minSilenceMs: number;
  retainMs: number;
  mode: SilenceMode;
  prePaddingMs: number;
  postPaddingMs: number;
  mergeGapMs: number;
  minSpeechMs: number;
  vadEnabled: boolean;
  vadSensitivity: 0 | 1 | 2 | 3;
  quietVoiceProtection: boolean;
  channelMode: ChannelMode;
  processLeadingSilence: boolean;
  processTrailingSilence: boolean;
  stagedRules: StagedShorteningRule[] | null;
}

export interface FillerSettings {
  enabled: boolean;
  /** 削除後に残す間(ms) 初期値80 */
  gapAfterMs: number;
  /** 自動選択される安全語 */
  safeWords: string[];
  /** 初期状態で自動選択しない文脈依存語 */
  contextDependentWords: string[];
  transcriptSource: "auto" | "premiere" | "whisper";
}

export interface AnalysisSettings {
  silence: SilenceSettings;
  filler: FillerSettings;
  cpuThreads: number;
}

export interface Preset {
  name: string;
  builtIn: boolean;
  settings: AnalysisSettings;
}

// ---- ジョブリクエスト（Workerへ渡すJSON。fillerセクションはON時のみ存在） ----

export interface AnalysisJobRequest {
  jobId: string;
  mediaPath: string;
  sourceInTicks: TickString;
  sourceOutTicks: TickString;
  audioStreamIndex: number;
  silence: SilenceSettings;
  /** フィラーOFF時はプロパティ自体を含めない（ADR-006） */
  filler?: FillerSettings & { modelPath: string };
  cpuThreads: number;
}

// ---- Transcript (仕様25章) ----

export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TranscriptResult {
  providerId: string;
  words: TranscriptWord[] | null;
  /** 単語時刻が取得できたか。falseなら自動フィラー適用禁止 */
  hasWordTimings: boolean;
  segments?: { text: string; startMs: number; endMs: number }[];
}

export interface TranscriptContext {
  mediaPath: string;
  sequenceGuid?: string;
  clipId: string;
}

export interface TranscriptProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(context: TranscriptContext): Promise<boolean>;
  transcribe(context: TranscriptContext, signal?: AbortSignal): Promise<TranscriptResult>;
}

// ---- API Probe (仕様12章) ----

export interface ProbeResult {
  apiName: string;
  available: boolean;
  succeeded: boolean;
  observedReturnType?: string;
  notes: string[];
  error?: string;
}
