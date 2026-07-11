import { describe, expect, it } from "vitest";
import { pollJob } from "../../plugin/src/native/jobPoller";
import { MockNativeAdapter } from "../../plugin/src/native/mockNativeAdapter";
import type { NativeBridge } from "../../plugin/src/types";

describe("ジョブポーリング（仕様11章 Phase 1相当・Mock Bridge）", () => {
  it("進捗0→1で完了し、結果が入力のechoになる（テストジョブ仕様）", async () => {
    const bridge = new MockNativeAdapter(300);
    const request = JSON.stringify({ hello: "世界" });
    const jobId = bridge.startJob(request);
    const progresses: number[] = [];
    const status = await pollJob(bridge, jobId, {
      intervalMs: 20,
      onProgress: (s) => progresses.push(s.progress)
    });
    expect(status.state).toBe("completed");
    expect(progresses.length).toBeGreaterThan(1);
    expect(Math.max(...progresses)).toBeLessThanOrEqual(1);
    const result = JSON.parse(bridge.getJobResult(jobId)) as { echo: string };
    expect(result.echo).toBe(request);
    bridge.disposeJob(jobId);
  });

  it("AbortSignalで協調キャンセルされる", async () => {
    const bridge = new MockNativeAdapter(5000);
    const jobId = bridge.startJob("{}");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const status = await pollJob(bridge, jobId, {
      intervalMs: 20,
      signal: controller.signal
    });
    expect(status.state).toBe("cancelled");
    bridge.disposeJob(jobId);
  });

  it("タイムアウトでWORKER_TIMEOUT + キャンセル試行", async () => {
    const bridge = new MockNativeAdapter(60_000);
    const jobId = bridge.startJob("{}");
    const status = await pollJob(bridge, jobId, { intervalMs: 20, timeoutMs: 100 });
    expect(status.state).toBe("failed");
    expect(status.error?.code).toBe("WORKER_TIMEOUT");
    // キャンセルが要求されている
    expect(JSON.parse(bridge.getJobStatus(jobId)).state).toBe("cancelled");
    bridge.disposeJob(jobId);
  });

  it("不正JSON応答はWORKER_PROTOCOL_ERROR", async () => {
    const broken: NativeBridge = {
      getVersion: () => ({
        addonVersion: "x",
        workerVersion: "x",
        architecture: "x",
        workerAvailable: false,
        executionMode: "external-worker"
      }),
      healthCheck: () => "ok",
      startJob: () => "j1",
      getJobStatus: () => "not-json{{{",
      getJobResult: () => "",
      cancelJob: () => false,
      disposeJob: () => false
    };
    const status = await pollJob(broken, "j1", { intervalMs: 10 });
    expect(status.state).toBe("failed");
    expect(status.error?.code).toBe("WORKER_PROTOCOL_ERROR");
  });

  it("未知jobIdはfailed（エラー付き）", async () => {
    const bridge = new MockNativeAdapter();
    const status = await pollJob(bridge, "no-such-job", { intervalMs: 10 });
    expect(status.state).toBe("failed");
  });

  it("startJobは不正JSONリクエストを拒否する", () => {
    const bridge = new MockNativeAdapter();
    expect(() => bridge.startJob("not json")).toThrow();
  });
});
