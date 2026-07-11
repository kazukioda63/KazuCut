import type { JobStage, NativeBridge, NativeVersionInfo } from "../types";

interface MockJob {
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: JobStage;
  requestJson: string;
  result?: string;
  startedAt: number;
  durationMs: number;
  timer?: ReturnType<typeof setInterval>;
}

/**
 * Hybrid Addonが使えない環境（開発・テスト・SDK未取得）用のMock Bridge。
 * 仕様11章のテストジョブ相当: durationMsかけて進捗0→1、最後に入力文字列を返す。
 * 本番でこのAdapterが選択された場合、UIは「ネイティブ未接続」を明示する。
 */
export class MockNativeAdapter implements NativeBridge {
  private jobs = new Map<string, MockJob>();
  private seq = 0;
  private readonly durationMs: number;

  constructor(durationMs = 3000) {
    this.durationMs = durationMs;
  }

  getVersion(): NativeVersionInfo {
    return {
      addonVersion: "mock",
      workerVersion: "mock",
      architecture: "mock",
      workerAvailable: false,
      executionMode: "external-worker"
    };
  }

  healthCheck(): string {
    return JSON.stringify({ ok: true, mode: "mock" });
  }

  startJob(requestJson: string): string {
    // 不正JSONはWorker同様に拒否する
    JSON.parse(requestJson);
    const jobId = `mock-${++this.seq}`;
    const job: MockJob = {
      state: "running",
      progress: 0,
      stage: "starting",
      requestJson,
      startedAt: Date.now(),
      durationMs: this.durationMs
    };
    job.timer = setInterval(() => {
      if (job.state !== "running") return;
      const elapsed = Date.now() - job.startedAt;
      job.progress = Math.min(elapsed / job.durationMs, 1);
      job.stage = job.progress < 0.5 ? "decode" : "silence";
      if (job.progress >= 1) {
        job.state = "completed";
        job.result = JSON.stringify({ echo: job.requestJson });
        this.clearTimer(job);
      }
    }, 20);
    this.jobs.set(jobId, job);
    return jobId;
  }

  getJobStatus(jobId: string): string {
    const job = this.jobs.get(jobId);
    if (!job) {
      return JSON.stringify({
        state: "failed",
        progress: 0,
        error: { code: "WORKER_PROTOCOL_ERROR", developerMessage: `未知のjobId: ${jobId}` }
      });
    }
    return JSON.stringify({ state: job.state, progress: job.progress, stage: job.stage });
  }

  getJobResult(jobId: string): string {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== "completed" || job.result === undefined) {
      return JSON.stringify({
        error: { code: "WORKER_PROTOCOL_ERROR", developerMessage: "結果がありません" }
      });
    }
    return job.result;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== "running") return false;
    job.state = "cancelled";
    this.clearTimer(job);
    return true;
  }

  disposeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    this.clearTimer(job);
    this.jobs.delete(jobId);
    return true;
  }

  private clearTimer(job: MockJob): void {
    if (job.timer !== undefined) {
      clearInterval(job.timer);
      delete job.timer;
    }
  }
}
