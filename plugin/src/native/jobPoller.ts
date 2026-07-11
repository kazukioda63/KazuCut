import type { JobStatus, NativeBridge } from "../types";
import { createError } from "../errors";

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (status: JobStatus) => void;
  signal?: AbortSignal;
}

/**
 * NativeBridgeのジョブをポーリングし、完了/失敗/キャンセルまで待つ。
 * - UIスレッドをブロックしない（setTimeoutベース）
 * - AbortSignalで協調キャンセル（cancelJob→cancelled状態を待つ）
 * - タイムアウト時はcancelJobを試みてWORKER_TIMEOUT
 * - 不正JSON応答はWORKER_PROTOCOL_ERROR
 */
export async function pollJob(
  bridge: NativeBridge,
  jobId: string,
  options: PollOptions = {}
): Promise<JobStatus> {
  const interval = options.intervalMs ?? 150;
  const timeout = options.timeoutMs ?? 30 * 60 * 1000;
  const started = Date.now();
  let cancelRequested = false;

  const requestCancel = (): void => {
    if (!cancelRequested) {
      cancelRequested = true;
      try {
        bridge.cancelJob(jobId);
      } catch {
        // cancelJob自体の失敗は最終状態の判定に任せる（下でfailed/timeout扱いになる）
        cancelRequested = true;
      }
    }
  };
  if (options.signal) {
    if (options.signal.aborted) requestCancel();
    else options.signal.addEventListener("abort", requestCancel, { once: true });
  }

  for (;;) {
    let status: JobStatus;
    try {
      status = parseStatus(bridge.getJobStatus(jobId), jobId);
    } catch (e) {
      return {
        jobId,
        state: "failed",
        progress: 0,
        error: createError(
          "WORKER_PROTOCOL_ERROR",
          `getJobStatusの応答を解釈できません: ${e instanceof Error ? e.message : String(e)}`
        )
      };
    }

    if (status.state === "completed" || status.state === "failed" || status.state === "cancelled") {
      return status;
    }

    options.onProgress?.(status);

    if (Date.now() - started > timeout) {
      requestCancel();
      return {
        jobId,
        state: "failed",
        progress: status.progress,
        error: createError("WORKER_TIMEOUT", `${timeout}msを超過`)
      };
    }

    await sleep(interval);
  }
}

function parseStatus(json: string, jobId: string): JobStatus {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("statusがオブジェクトではありません");
  }
  const obj = raw as Record<string, unknown>;
  const state = obj.state;
  if (
    state !== "pending" &&
    state !== "running" &&
    state !== "completed" &&
    state !== "failed" &&
    state !== "cancelled"
  ) {
    throw new Error(`未知のstate: ${String(state)}`);
  }
  const progress = typeof obj.progress === "number" ? obj.progress : 0;
  const status: JobStatus = { jobId, state, progress };
  if (typeof obj.stage === "string") {
    status.stage = obj.stage as Exclude<JobStatus["stage"], undefined>;
  }
  if (typeof obj.error === "object" && obj.error !== null) {
    const e = obj.error as Record<string, unknown>;
    status.error = createError(
      typeof e.code === "string" ? e.code : "WORKER_PROTOCOL_ERROR",
      typeof e.developerMessage === "string" ? e.developerMessage : JSON.stringify(e)
    );
  }
  return status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
