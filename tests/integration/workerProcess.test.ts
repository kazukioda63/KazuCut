/**
 * Worker実行ファイルのプロセスレベル統合テスト（Phase 1のLinux実行可能部分）。
 *
 * ここで検証するのはWorkerプロセス自体の挙動（起動/JSON Lines/進捗/キャンセル/
 * 不正JSON/日本語・スペースパス/stdinクローズ時の自己終了）。
 * Addon側（CreateProcessW/Job Object）はWindows実機でのみ検証可能
 * （MANUAL_TEST_CHECKLIST.md 1〜4, 22）。
 *
 * 事前条件: cmake --build build/worker 済み。バイナリが無い場合はskip。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKER = join(process.cwd(), "build", "worker", "KazuCutWorker");
const hasWorker = existsSync(WORKER);

interface Message {
  type: string;
  jobId?: string;
  progress?: number;
  stage?: string;
  result?: Record<string, unknown>;
  error?: { code: string; developerMessage: string };
}

function runWorker(
  args: string[],
  stdinLines: string[],
  opts: { killAfterMs?: number; closeStdin?: boolean } = {}
): Promise<{ messages: Message[]; exitCode: number | null; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(WORKER, args);
    const messages: Message[] = [];
    let buffer = "";
    proc.stdout.on("data", (d: Buffer) => {
      buffer += d.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim() === "") continue;
        try {
          messages.push(JSON.parse(line) as Message);
        } catch {
          messages.push({ type: "___unparseable", error: { code: "PARSE", developerMessage: line } });
        }
      }
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => resolve({ messages, exitCode: code, signal }));
    for (const line of stdinLines) proc.stdin.write(line + "\n");
    if (opts.closeStdin) proc.stdin.end();
    if (opts.killAfterMs) setTimeout(() => proc.kill("SIGKILL"), opts.killAfterMs);
  });
}

describe.skipIf(!hasWorker)("Workerプロセス統合（JSON Lines IPC）", () => {
  it("テストジョブ: started→progress(0→1)→result(echo)", async () => {
    const request = JSON.stringify({
      type: "test",
      jobId: "j1",
      durationMs: 500,
      payload: "こんにちは 世界"
    });
    const { messages, exitCode } = await runWorker(["--job-stdin"], [request]);
    expect(exitCode).toBe(0);
    expect(messages[0]!.type).toBe("started");
    const progresses = messages.filter((m) => m.type === "progress");
    expect(progresses.length).toBeGreaterThan(2);
    expect(progresses.at(-1)!.progress).toBe(1);
    const result = messages.find((m) => m.type === "result");
    expect(result?.result?.echo).toBe("こんにちは 世界");
  }, 10000);

  it("協調キャンセル: cancelメッセージでcancelled + 終了コード2", async () => {
    const request = JSON.stringify({ type: "test", jobId: "j2", durationMs: 30000 });
    const cancel = JSON.stringify({ type: "cancel" });
    const { messages, exitCode } = await runWorker(["--job-stdin"], [request, cancel]);
    expect(exitCode).toBe(2);
    expect(messages.some((m) => m.type === "cancelled")).toBe(true);
    expect(messages.some((m) => m.type === "result")).toBe(false);
  }, 10000);

  it("stdinクローズ（親の死亡相当）でWorkerが自己終了し孤児にならない", async () => {
    const request = JSON.stringify({ type: "test", jobId: "j3", durationMs: 30000 });
    const start = Date.now();
    const { exitCode } = await runWorker(["--job-stdin"], [request], { closeStdin: true });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(exitCode).toBe(2); // cancelled扱い
  }, 10000);

  it("不正JSONリクエストはWORKER_PROTOCOL_ERROR + 終了コード1", async () => {
    const { messages, exitCode } = await runWorker(["--job-stdin"], ["this is not json"]);
    expect(exitCode).toBe(1);
    const err = messages.find((m) => m.type === "error");
    expect(err?.error?.code).toBe("WORKER_PROTOCOL_ERROR");
  }, 10000);

  it("キャンセル行の不正JSONは無視して処理を継続する", async () => {
    const request = JSON.stringify({ type: "test", jobId: "j4", durationMs: 300 });
    const { messages, exitCode } = await runWorker(["--job-stdin"], [request, "garbage{{{", ""]);
    expect(exitCode).toBe(0);
    expect(messages.some((m) => m.type === "result")).toBe(true);
  }, 10000);

  it("--job <日本語・スペースを含むパス> のリクエストファイルを読める", async () => {
    const dir = join(tmpdir(), "kazucut テスト", "日本語 フォルダ");
    mkdirSync(dir, { recursive: true });
    const reqFile = join(dir, "リクエスト ファイル.json");
    writeFileSync(reqFile, JSON.stringify({ type: "test", jobId: "j5", durationMs: 200 }));
    const { messages, exitCode } = await runWorker(["--job", reqFile], []);
    expect(exitCode).toBe(0);
    expect(messages.some((m) => m.type === "result")).toBe(true);
  }, 10000);

  it("analyzeジョブ: 合成WAVの無音区間を返す", async () => {
    // 1秒トーン + 500ms無音 + 1秒トーン のWAVを生成
    const sr = 16000;
    const samples: number[] = [];
    for (let i = 0; i < sr; i++) samples.push(0.3 * Math.sin((2 * Math.PI * 220 * i) / sr));
    for (let i = 0; i < sr / 2; i++) samples.push(0);
    for (let i = 0; i < sr; i++) samples.push(0.3 * Math.sin((2 * Math.PI * 220 * i) / sr));
    const dir = join(tmpdir(), "kazucut-integration");
    mkdirSync(dir, { recursive: true });
    const wavPath = join(dir, "speech.wav");
    writeFileSync(wavPath, buildWav(samples, sr));

    const request = JSON.stringify({
      type: "analyze",
      jobId: "j6",
      mediaPath: wavPath,
      silence: { minSilenceMs: 280, vadSensitivity: 2 }
    });
    const { messages, exitCode } = await runWorker(["--job-stdin"], [request]);
    expect(exitCode).toBe(0);
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    const silence = result!.result!.silence as {
      intervals: { startMs: number; endMs: number }[];
      noiseFloorDb: number;
    };
    expect(silence.intervals).toHaveLength(1);
    expect(silence.intervals[0]!.startMs).toBeGreaterThan(950);
    expect(silence.intervals[0]!.endMs).toBeLessThan(1550);
  }, 15000);

  it("--version がバージョンJSONを返す", async () => {
    const { messages, exitCode } = await runWorker(["--version"], []);
    expect(exitCode).toBe(0);
    expect((messages[0] as unknown as { workerVersion: string }).workerVersion).toBe("0.1.0");
  }, 10000);
});

function buildWav(samples: number[], sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  }
  return buf;
}
