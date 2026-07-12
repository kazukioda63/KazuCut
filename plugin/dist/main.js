"use strict";
(() => {
  // plugin/src/native/mockNativeAdapter.ts
  var MockNativeAdapter = class {
    jobs = /* @__PURE__ */ new Map();
    seq = 0;
    durationMs;
    constructor(durationMs = 3e3) {
      this.durationMs = durationMs;
    }
    getVersion() {
      return {
        addonVersion: "mock",
        workerVersion: "mock",
        architecture: "mock",
        workerAvailable: false,
        executionMode: "external-worker"
      };
    }
    healthCheck() {
      return JSON.stringify({ ok: true, mode: "mock" });
    }
    startJob(requestJson) {
      JSON.parse(requestJson);
      const jobId = `mock-${++this.seq}`;
      const job = {
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
    getJobStatus(jobId) {
      const job = this.jobs.get(jobId);
      if (!job) {
        return JSON.stringify({
          state: "failed",
          progress: 0,
          error: { code: "WORKER_PROTOCOL_ERROR", developerMessage: `\u672A\u77E5\u306EjobId: ${jobId}` }
        });
      }
      return JSON.stringify({ state: job.state, progress: job.progress, stage: job.stage });
    }
    getJobResult(jobId) {
      const job = this.jobs.get(jobId);
      if (!job || job.state !== "completed" || job.result === void 0) {
        return JSON.stringify({
          error: { code: "WORKER_PROTOCOL_ERROR", developerMessage: "\u7D50\u679C\u304C\u3042\u308A\u307E\u305B\u3093" }
        });
      }
      return job.result;
    }
    cancelJob(jobId) {
      const job = this.jobs.get(jobId);
      if (!job || job.state !== "running") return false;
      job.state = "cancelled";
      this.clearTimer(job);
      return true;
    }
    disposeJob(jobId) {
      const job = this.jobs.get(jobId);
      if (!job) return false;
      this.clearTimer(job);
      this.jobs.delete(jobId);
      return true;
    }
    clearTimer(job) {
      if (job.timer !== void 0) {
        clearInterval(job.timer);
        delete job.timer;
      }
    }
  };

  // plugin/src/native/hybridAddonAdapter.ts
  function tryLoadHybridAddon() {
    const req = globalThis.require;
    if (typeof req !== "function") return null;
    let addon;
    try {
      addon = req("kazucut-native.uxpaddon");
    } catch {
      return null;
    }
    if (typeof addon !== "object" || addon === null) return null;
    const a = addon;
    const fns = [
      "getVersion",
      "healthCheck",
      "startJob",
      "getJobStatus",
      "getJobResult",
      "cancelJob",
      "disposeJob"
    ];
    for (const f of fns) {
      if (typeof a[f] !== "function") return null;
    }
    const call = (name, ...args) => a[name](...args);
    return {
      getVersion: () => {
        const raw = call("getVersion");
        return JSON.parse(raw);
      },
      healthCheck: () => String(call("healthCheck")),
      startJob: (requestJson) => String(call("startJob", requestJson)),
      getJobStatus: (jobId) => String(call("getJobStatus", jobId)),
      getJobResult: (jobId) => String(call("getJobResult", jobId)),
      cancelJob: (jobId) => Boolean(call("cancelJob", jobId)),
      disposeJob: (jobId) => Boolean(call("disposeJob", jobId))
    };
  }

  // plugin/src/errors.ts
  var ERROR_DEFS = {
    NO_ACTIVE_PROJECT: {
      userMessage: "\u958B\u3044\u3066\u3044\u308B\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u958B\u3044\u3066\u304B\u3089\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    NO_ACTIVE_SEQUENCE: {
      userMessage: "\u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30B7\u30FC\u30B1\u30F3\u30B9\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u3067\u30B7\u30FC\u30B1\u30F3\u30B9\u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    NO_TARGET_VIDEO_TRACK: {
      userMessage: "\u6620\u50CF\u30C8\u30E9\u30C3\u30AF\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u30D1\u30CD\u30EB\u3067\u6620\u50CF\u30C8\u30E9\u30C3\u30AF\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    NO_TARGET_AUDIO_TRACK: {
      userMessage: "\u4F1A\u8A71\u97F3\u58F0\u30C8\u30E9\u30C3\u30AF\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u30D1\u30CD\u30EB\u3067\u97F3\u58F0\u30C8\u30E9\u30C3\u30AF\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    NO_SELECTED_CLIP: {
      userMessage: "\u30AF\u30EA\u30C3\u30D7\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u3067A\u30ED\u30FC\u30EB\u306E\u30AF\u30EA\u30C3\u30D7\u3092\u9078\u629E\u3059\u308B\u304B\u3001\u5BFE\u8C61\u3092\u300CA\u30ED\u30FC\u30EB\u30C8\u30E9\u30C3\u30AF\u5168\u4F53\u300D\u3078\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    AMBIGUOUS_AUDIO_PAIR: {
      userMessage: "\u6620\u50CF\u30AF\u30EA\u30C3\u30D7\u306B\u5BFE\u5FDC\u3059\u308B\u97F3\u58F0\u30AF\u30EA\u30C3\u30D7\u3092\u4E00\u610F\u306B\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5019\u88DC\u304B\u3089\u9078\u629E\u3059\u308B\u304B\u3001\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    MEDIA_OFFLINE: {
      userMessage: "\u30E1\u30C7\u30A3\u30A2\u304C\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u3059\u3002\u30E1\u30C7\u30A3\u30A2\u3092\u518D\u30EA\u30F3\u30AF\u3057\u3066\u304B\u3089\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    MEDIA_NOT_FOUND: {
      userMessage: "\u30E1\u30C7\u30A3\u30A2\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u30D5\u30A1\u30A4\u30EB\u306E\u5834\u6240\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    UNSUPPORTED_SPEED: {
      userMessage: "100%\u4EE5\u5916\u306E\u901F\u5EA6\u306E\u30AF\u30EA\u30C3\u30D7\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002\u901F\u5EA6\u5909\u66F4\u306FKazuCut\u5B9F\u884C\u5F8C\uFF08\u7DE8\u96C6\u7D42\u76E4\uFF09\u306B\u884C\u3063\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    UNSUPPORTED_REVERSE: {
      userMessage: "\u9006\u518D\u751F\u30AF\u30EA\u30C3\u30D7\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    UNSUPPORTED_TIME_REMAP: {
      userMessage: "\u30BF\u30A4\u30E0\u30EA\u30DE\u30C3\u30D7\u3055\u308C\u305F\u30AF\u30EA\u30C3\u30D7\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    UNSUPPORTED_NEST: {
      userMessage: "\u30CD\u30B9\u30C8\u3055\u308C\u305F\u30B7\u30FC\u30B1\u30F3\u30B9\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    UNSUPPORTED_MULTICAM: {
      userMessage: "\u30DE\u30EB\u30C1\u30AB\u30E1\u30E9\u30AF\u30EA\u30C3\u30D7\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    UNSUPPORTED_MERGED_CLIP: {
      userMessage: "\u7D50\u5408\u30AF\u30EA\u30C3\u30D7\uFF08Merged Clip\uFF09\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    UNSUPPORTED_EFFECTED_CLIP: {
      userMessage: "\u8907\u96D1\u306A\u30A8\u30D5\u30A7\u30AF\u30C8\u3084\u30C8\u30E9\u30F3\u30B8\u30B7\u30E7\u30F3\u304C\u9069\u7528\u3055\u308C\u305F\u30AF\u30EA\u30C3\u30D7\u306F\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    NATIVE_ADDON_NOT_LOADED: {
      userMessage: "\u30CD\u30A4\u30C6\u30A3\u30D6\u30E2\u30B8\u30E5\u30FC\u30EB\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D7\u30E9\u30B0\u30A4\u30F3\u3092\u518D\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: false
    },
    WORKER_NOT_FOUND: {
      userMessage: "\u89E3\u6790\u30D7\u30ED\u30B0\u30E9\u30E0\uFF08KazuCutWorker.exe\uFF09\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u30D7\u30E9\u30B0\u30A4\u30F3\u3092\u518D\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: false
    },
    WORKER_START_FAILED: {
      userMessage: "\u89E3\u6790\u30D7\u30ED\u30B0\u30E9\u30E0\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u30BD\u30D5\u30C8\u306E\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    WORKER_CRASHED: {
      userMessage: "\u89E3\u6790\u30D7\u30ED\u30B0\u30E9\u30E0\u304C\u7570\u5E38\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    WORKER_PROTOCOL_ERROR: {
      userMessage: "\u89E3\u6790\u30D7\u30ED\u30B0\u30E9\u30E0\u3068\u306E\u901A\u4FE1\u3067\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    WORKER_TIMEOUT: {
      userMessage: "\u89E3\u6790\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002\u7D20\u6750\u304C\u9577\u3044\u5834\u5408\u306F\u6642\u9593\u3092\u304A\u3044\u3066\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    AUDIO_STREAM_NOT_FOUND: {
      userMessage: "\u52D5\u753B\u30D5\u30A1\u30A4\u30EB\u5185\u306B\u97F3\u58F0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      recoverable: true
    },
    AUDIO_DECODE_FAILED: {
      userMessage: "\u97F3\u58F0\u306E\u30C7\u30B3\u30FC\u30C9\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u5BFE\u5FDC\u5F62\u5F0F\uFF08MP4/MOV\u5185\u306EAAC\u7B49\uFF09\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    AUDIO_SEEK_FAILED: {
      userMessage: "\u97F3\u58F0\u306E\u30B7\u30FC\u30AF\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30D5\u30A1\u30A4\u30EB\u304C\u7834\u640D\u3057\u3066\u3044\u306A\u3044\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: true
    },
    TRANSCRIPT_NOT_FOUND: {
      userMessage: "Premiere\u306E\u6587\u5B57\u8D77\u3053\u3057\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      recoverable: true
    },
    TRANSCRIPT_SCHEMA_UNSUPPORTED: {
      userMessage: "Premiere\u306E\u6587\u5B57\u8D77\u3053\u3057\u5F62\u5F0F\u3092\u89E3\u91C8\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      recoverable: true
    },
    TRANSCRIPT_HAS_NO_WORD_TIMINGS: {
      userMessage: "Premiere\u306E\u6587\u5B57\u8D77\u3053\u3057\u306B\u5358\u8A9E\u3054\u3068\u306E\u6642\u523B\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    WHISPER_MODEL_NOT_FOUND: {
      userMessage: "\u30ED\u30FC\u30AB\u30EBWhisper\u30E2\u30C7\u30EB\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u306A\u3044\u304B\u3001\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    WHISPER_FAILED: {
      userMessage: "\u30ED\u30FC\u30AB\u30EB\u97F3\u58F0\u8A8D\u8B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002",
      recoverable: true
    },
    SEQUENCE_CLONE_FAILED: {
      userMessage: "\u30B7\u30FC\u30B1\u30F3\u30B9\u306E\u8907\u88FD\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u5143\u306E\u30B7\u30FC\u30B1\u30F3\u30B9\u306F\u5909\u66F4\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    CLONED_SEQUENCE_NOT_IDENTIFIED: {
      userMessage: "\u8907\u88FD\u3057\u305F\u30B7\u30FC\u30B1\u30F3\u30B9\u3092\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5B89\u5168\u306E\u305F\u3081\u51E6\u7406\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002\u5143\u306E\u30B7\u30FC\u30B1\u30F3\u30B9\u306F\u5909\u66F4\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002",
      recoverable: true
    },
    TRACK_ITEM_CLONE_FAILED: {
      userMessage: "\u30AF\u30EA\u30C3\u30D7\u306E\u8907\u88FD\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u51E6\u7406\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002",
      recoverable: true
    },
    TRACK_ITEM_MAPPING_FAILED: {
      userMessage: "\u8907\u88FD\u3057\u305F\u30AF\u30EA\u30C3\u30D7\u3092\u4E00\u610F\u306B\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u5B89\u5168\u306E\u305F\u3081\u51E6\u7406\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002",
      recoverable: true
    },
    TIMELINE_REBUILD_FAILED: {
      userMessage: "\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u306E\u518D\u69CB\u7BC9\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u5143\u306E\u30B7\u30FC\u30B1\u30F3\u30B9\u306F\u4FDD\u8B77\u3055\u308C\u3066\u3044\u307E\u3059\u3002",
      recoverable: true
    },
    NON_TARGET_TRACK_CHANGED: {
      userMessage: "\u5BFE\u8C61\u5916\u30C8\u30E9\u30C3\u30AF\u306B\u610F\u56F3\u3057\u306A\u3044\u5909\u66F4\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002\u51E6\u7406\u3092\u5931\u6557\u3068\u3057\u3066\u6271\u3044\u307E\u3059\u3002\u7DE8\u96C6\u7D50\u679C\u3092\u78BA\u8A8D\u3057\u3001\u5FC5\u8981\u306A\u3089Undo\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      recoverable: false
    },
    SYNC_VALIDATION_FAILED: {
      userMessage: "\u7DE8\u96C6\u5F8C\u306EA/V\u540C\u671F\u691C\u8A3C\u3067\u8A31\u5BB9\u8AA4\u5DEE\u3092\u8D85\u3048\u308B\u305A\u308C\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002\u51E6\u7406\u3092\u5931\u6557\u3068\u3057\u3066\u6271\u3044\u307E\u3059\u3002",
      recoverable: false
    },
    BACKUP_SEQUENCE_FAILED: {
      userMessage: "\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7\u7528\u30B7\u30FC\u30B1\u30F3\u30B9\u306E\u8907\u88FD\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u3001\u76F4\u63A5\u7DE8\u96C6\u3092\u958B\u59CB\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      recoverable: true
    },
    CANCELLED: {
      userMessage: "\u51E6\u7406\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\u3057\u307E\u3057\u305F\u3002",
      recoverable: true
    }
  };
  function createError(code, developerMessage, details) {
    const def = ERROR_DEFS[code];
    const base = {
      code,
      userMessage: def ? def.userMessage : `\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\uFF08${code}\uFF09\u3002`,
      developerMessage,
      recoverable: def ? def.recoverable : false
    };
    if (details !== void 0) base.details = details;
    return base;
  }
  var ALL_ERROR_CODES = Object.keys(ERROR_DEFS);

  // plugin/src/native/jobPoller.ts
  async function pollJob(bridge2, jobId, options = {}) {
    const interval = options.intervalMs ?? 150;
    const timeout = options.timeoutMs ?? 30 * 60 * 1e3;
    const started = Date.now();
    let cancelRequested = false;
    const requestCancel = () => {
      if (!cancelRequested) {
        cancelRequested = true;
        try {
          bridge2.cancelJob(jobId);
        } catch {
          cancelRequested = true;
        }
      }
    };
    if (options.signal) {
      if (options.signal.aborted) requestCancel();
      else options.signal.addEventListener("abort", requestCancel, { once: true });
    }
    for (; ; ) {
      let status;
      try {
        status = parseStatus(bridge2.getJobStatus(jobId), jobId);
      } catch (e) {
        return {
          jobId,
          state: "failed",
          progress: 0,
          error: createError(
            "WORKER_PROTOCOL_ERROR",
            `getJobStatus\u306E\u5FDC\u7B54\u3092\u89E3\u91C8\u3067\u304D\u307E\u305B\u3093: ${e instanceof Error ? e.message : String(e)}`
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
          error: createError("WORKER_TIMEOUT", `${timeout}ms\u3092\u8D85\u904E`)
        };
      }
      await sleep(interval);
    }
  }
  function parseStatus(json, jobId) {
    const raw = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) {
      throw new Error("status\u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306F\u3042\u308A\u307E\u305B\u3093");
    }
    const obj = raw;
    const state2 = obj.state;
    if (state2 !== "pending" && state2 !== "running" && state2 !== "completed" && state2 !== "failed" && state2 !== "cancelled") {
      throw new Error(`\u672A\u77E5\u306Estate: ${String(state2)}`);
    }
    const progress = typeof obj.progress === "number" ? obj.progress : 0;
    const status = { jobId, state: state2, progress };
    if (typeof obj.stage === "string") {
      status.stage = obj.stage;
    }
    if (typeof obj.error === "object" && obj.error !== null) {
      const e = obj.error;
      status.error = createError(
        typeof e.code === "string" ? e.code : "WORKER_PROTOCOL_ERROR",
        typeof e.developerMessage === "string" ? e.developerMessage : JSON.stringify(e)
      );
    }
    return status;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // plugin/src/analysis/analysisController.ts
  function buildJobRequest(target, settings, whisperModelPath) {
    const request = {
      jobId: target.jobId,
      mediaPath: target.mediaPath,
      sourceInTicks: target.sourceInTicks,
      sourceOutTicks: target.sourceOutTicks,
      audioStreamIndex: target.audioStreamIndex,
      silence: settings.silence,
      cpuThreads: settings.cpuThreads
    };
    if (settings.filler.enabled) {
      request.filler = {
        ...settings.filler,
        modelPath: whisperModelPath ?? ""
      };
    }
    return request;
  }

  // plugin/src/constants.ts
  var ASSUMED_TICKS_PER_SECOND = "254016000000";
  var SETTINGS_SCHEMA_VERSION = 1;

  // plugin/src/ticks.ts
  var TICK_RE = /^-?\d+$/;
  function isValidTicks(value) {
    return TICK_RE.test(value);
  }
  function assertTicks(value) {
    if (!isValidTicks(value)) {
      throw new Error(`\u4E0D\u6B63\u306ATick\u6587\u5B57\u5217: "${value}"`);
    }
  }
  function normalize(value) {
    assertTicks(value);
    const neg = value.startsWith("-");
    let digits = neg ? value.slice(1) : value;
    digits = digits.replace(/^0+(?=\d)/, "");
    if (digits === "0") return "0";
    return neg ? `-${digits}` : digits;
  }
  function addUnsigned(a, b) {
    let carry = 0;
    let out = "";
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const da = i < a.length ? a.charCodeAt(a.length - 1 - i) - 48 : 0;
      const db = i < b.length ? b.charCodeAt(b.length - 1 - i) - 48 : 0;
      const sum = da + db + carry;
      out = String(sum % 10) + out;
      carry = sum >= 10 ? 1 : 0;
    }
    if (carry) out = "1" + out;
    return out;
  }
  function cmpUnsigned(a, b) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  function subUnsigned(a, b) {
    let borrow = 0;
    let out = "";
    for (let i = 0; i < a.length; i++) {
      const da = a.charCodeAt(a.length - 1 - i) - 48;
      const db = i < b.length ? b.charCodeAt(b.length - 1 - i) - 48 : 0;
      let d = da - db - borrow;
      if (d < 0) {
        d += 10;
        borrow = 1;
      } else {
        borrow = 0;
      }
      out = String(d) + out;
    }
    return out.replace(/^0+(?=\d)/, "");
  }
  function split(value) {
    const n = normalize(value);
    return n.startsWith("-") ? { neg: true, mag: n.slice(1) } : { neg: false, mag: n };
  }
  function join(neg, mag) {
    if (mag === "0") return "0";
    return neg ? `-${mag}` : mag;
  }
  function addTicks(a, b) {
    const x = split(a);
    const y = split(b);
    if (x.neg === y.neg) return join(x.neg, addUnsigned(x.mag, y.mag));
    const c = cmpUnsigned(x.mag, y.mag);
    if (c === 0) return "0";
    return c > 0 ? join(x.neg, subUnsigned(x.mag, y.mag)) : join(y.neg, subUnsigned(y.mag, x.mag));
  }
  function subtractTicks(a, b) {
    const y = split(b);
    return addTicks(a, join(!y.neg, y.mag));
  }
  function compareTicks(a, b) {
    const d = split(subtractTicks(a, b));
    if (d.mag === "0") return 0;
    return d.neg ? -1 : 1;
  }
  function minTicks(a, b) {
    return compareTicks(a, b) <= 0 ? normalize(a) : normalize(b);
  }
  function maxTicks(a, b) {
    return compareTicks(a, b) >= 0 ? normalize(a) : normalize(b);
  }
  function multiplyTicksBySmallInt(a, factor) {
    if (!Number.isInteger(factor) || factor < 0) {
      throw new Error(`\u4E57\u6570\u306F\u975E\u8CA0\u6574\u6570\u306E\u307F: ${factor}`);
    }
    let acc = "0";
    let base = normalize(a);
    let f = factor;
    while (f > 0) {
      if (f & 1) acc = addTicks(acc, base);
      base = addTicks(base, base);
      f >>= 1;
    }
    return acc;
  }
  function msToTicks(ms) {
    if (!Number.isFinite(ms)) throw new Error(`\u4E0D\u6B63\u306Ams: ${ms}`);
    const neg = ms < 0;
    const absMs = Math.round(Math.abs(ms));
    const perMs = divTicksBySmallInt(ASSUMED_TICKS_PER_SECOND, 1e3).quotient;
    const mag = multiplyTicksBySmallInt(perMs, absMs);
    return join(neg && mag !== "0", split(mag).mag);
  }
  function divTicksBySmallInt(a, divisor) {
    if (!Number.isInteger(divisor) || divisor <= 0) {
      throw new Error(`\u9664\u6570\u306F\u6B63\u6574\u6570\u306E\u307F: ${divisor}`);
    }
    const { neg, mag } = split(a);
    let q = "";
    let rem = 0;
    for (let i = 0; i < mag.length; i++) {
      const cur = rem * 10 + (mag.charCodeAt(i) - 48);
      q += String(Math.floor(cur / divisor));
      rem = cur % divisor;
    }
    q = q.replace(/^0+(?=\d)/, "");
    return { quotient: join(neg && q !== "0", q), remainder: neg ? -rem : rem };
  }
  function ticksToApproxMs(ticks) {
    const { neg, mag } = split(ticks);
    const perMs = divTicksBySmallInt(ASSUMED_TICKS_PER_SECOND, 1e3).quotient;
    let result = 0;
    const div = Number(perMs);
    const val = Number(mag);
    if (Number.isSafeInteger(val)) {
      result = val / div;
    } else {
      const headLen = 15;
      const head = Number(mag.slice(0, headLen));
      const scale = Math.pow(10, mag.length - headLen);
      result = head * scale / div;
    }
    return neg ? -result : result;
  }

  // plugin/src/analysis/candidateMerger.ts
  function mergeCandidates(candidates2, options) {
    if (candidates2.length === 0) return [];
    const sorted = [...candidates2].sort(
      (a, b) => compareTicks(a.sourceStartTicks, b.sourceStartTicks)
    );
    const gapTicks = msToTicks(Math.max(options.mergeGapMs, 0));
    const speechTicks = msToTicks(Math.max(options.minSpeechMs, 0));
    const out = [];
    let cur = null;
    for (const cand of sorted) {
      if (cur === null) {
        cur = cloneCandidate(cand);
        continue;
      }
      const gap = subtractTicks(cand.sourceStartTicks, cur.sourceEndTicks);
      const threshold = maxTicks(gapTicks, speechTicks);
      if (compareTicks(gap, threshold) <= 0) {
        cur = mergeTwo(cur, cand);
      } else {
        out.push(cur);
        cur = cloneCandidate(cand);
      }
    }
    if (cur) out.push(cur);
    return out;
  }
  function cloneCandidate(c) {
    return {
      ...c,
      warnings: [...c.warnings],
      metadata: { ...c.metadata, mergedFrom: String(c.id) }
    };
  }
  function mergeTwo(a, b) {
    const sourceStart = minTicks(a.sourceStartTicks, b.sourceStartTicks);
    const sourceEnd = maxTicks(a.sourceEndTicks, b.sourceEndTicks);
    const seqStart = minTicks(a.sequenceStartTicks, b.sequenceStartTicks);
    const seqEnd = maxTicks(a.sequenceEndTicks, b.sequenceEndTicks);
    const originalDurationMs = Math.round(
      ticksToApproxMs(subtractTicks(sourceEnd, sourceStart))
    );
    const retainedDurationMs = Math.max(a.retainedDurationMs, b.retainedDurationMs);
    const removalDurationMs = Math.max(originalDurationMs - retainedDurationMs, 0);
    const reason = a.reason === "filler" || b.reason === "filler" ? "filler" : a.reason;
    const detectedText = [a.detectedText, b.detectedText].filter((t) => !!t).join(" ") || void 0;
    const confidences = [a.confidence, b.confidence].filter(
      (c) => typeof c === "number"
    );
    const confidence = confidences.length > 0 ? Math.min(...confidences) : void 0;
    const merged = {
      id: a.id,
      reason,
      clipId: a.clipId,
      sourceStartTicks: sourceStart,
      sourceEndTicks: sourceEnd,
      sequenceStartTicks: seqStart,
      sequenceEndTicks: seqEnd,
      originalDurationMs,
      retainedDurationMs,
      removalDurationMs,
      // 統合後の選択状態: 両方選択時のみ選択（安全側）
      selected: a.selected && b.selected,
      warnings: [.../* @__PURE__ */ new Set([...a.warnings, ...b.warnings])],
      metadata: {
        ...a.metadata,
        ...b.metadata,
        mergedFrom: `${String(a.metadata.mergedFrom ?? a.id)},${String(b.metadata.mergedFrom ?? b.id)}`
      }
    };
    if (detectedText !== void 0) merged.detectedText = detectedText;
    if (confidence !== void 0) merged.confidence = confidence;
    return merged;
  }

  // plugin/src/state/presets.ts
  var SAFE_FILLER_WORDS = ["\u3048\u30FC", "\u3048\u3048\u3068", "\u3048\u3063\u3068", "\u3042\u30FC", "\u3042\u306E\u30FC", "\u3046\u30FC\u3093", "\u3093\u30FC"];
  var CONTEXT_DEPENDENT_FILLER_WORDS = ["\u3042\u306E", "\u305D\u306E", "\u307E\u3042", "\u306A\u3093\u304B", "\u3053\u3046", "\u3084\u3063\u3071"];
  function fillerDefaults() {
    return {
      enabled: false,
      // ADR-006: 初期値OFF。全標準プリセットでOFF
      gapAfterMs: 80,
      safeWords: [...SAFE_FILLER_WORDS],
      contextDependentWords: [...CONTEXT_DEPENDENT_FILLER_WORDS],
      transcriptSource: "auto"
    };
  }
  function silenceBase() {
    return {
      enabled: true,
      autoThreshold: true,
      manualThresholdDb: -40,
      mode: "shorten",
      vadEnabled: true,
      quietVoiceProtection: true,
      channelMode: "auto",
      processLeadingSilence: true,
      processTrailingSilence: true,
      stagedRules: null
    };
  }
  function createNaturalPreset() {
    return {
      name: "\u81EA\u7136",
      builtIn: true,
      settings: {
        silence: {
          ...silenceBase(),
          noiseMarginDb: 6,
          hysteresisDb: 3,
          minSilenceMs: 450,
          retainMs: 160,
          prePaddingMs: 55,
          postPaddingMs: 90,
          mergeGapMs: 70,
          minSpeechMs: 120,
          vadSensitivity: 2
        },
        filler: fillerDefaults(),
        cpuThreads: 0
      }
    };
  }
  function createShortsFastPreset() {
    return {
      name: "\u30B7\u30E7\u30FC\u30C8\u9AD8\u901F",
      builtIn: true,
      settings: {
        silence: {
          ...silenceBase(),
          noiseMarginDb: 7,
          hysteresisDb: 3,
          minSilenceMs: 280,
          retainMs: 90,
          prePaddingMs: 35,
          postPaddingMs: 60,
          mergeGapMs: 55,
          minSpeechMs: 100,
          vadSensitivity: 2
        },
        filler: fillerDefaults(),
        cpuThreads: 0
      }
    };
  }
  function createConservativePreset() {
    return {
      name: "\u4FDD\u5B88\u7684",
      builtIn: true,
      settings: {
        silence: {
          ...silenceBase(),
          noiseMarginDb: 5,
          hysteresisDb: 4,
          minSilenceMs: 650,
          retainMs: 220,
          prePaddingMs: 80,
          postPaddingMs: 120,
          mergeGapMs: 100,
          minSpeechMs: 150,
          vadSensitivity: 1
        },
        filler: fillerDefaults(),
        cpuThreads: 0
      }
    };
  }
  function builtInPresets() {
    return [createNaturalPreset(), createShortsFastPreset(), createConservativePreset()];
  }
  function validateSettings(s) {
    const errors = [];
    const sil = s.silence;
    if (sil.noiseMarginDb < 0 || sil.noiseMarginDb > 40)
      errors.push("\u30CE\u30A4\u30BA\u30DE\u30FC\u30B8\u30F3\u306F0\u301C40dB\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.hysteresisDb < 0 || sil.hysteresisDb > 20)
      errors.push("\u30D2\u30B9\u30C6\u30EA\u30B7\u30B9\u306F0\u301C20dB\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.manualThresholdDb > 0 || sil.manualThresholdDb < -90)
      errors.push("\u624B\u52D5\u3057\u304D\u3044\u5024\u306F-90\u301C0dB\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.minSilenceMs < 50 || sil.minSilenceMs > 1e4)
      errors.push("\u6700\u5C0F\u7121\u97F3\u6642\u9593\u306F50\u301C10,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.retainMs < 0 || sil.retainMs > 5e3)
      errors.push("\u6B8B\u3059\u7121\u97F3\u306F0\u301C5,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.mode === "shorten" && sil.retainMs >= sil.minSilenceMs)
      errors.push("\u6B8B\u3059\u7121\u97F3\u306F\u6700\u5C0F\u7121\u97F3\u6642\u9593\u3088\u308A\u77ED\u304F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.prePaddingMs < 0 || sil.prePaddingMs > 1e3)
      errors.push("\u524D\u5074\u4F59\u767D\u306F0\u301C1,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.postPaddingMs < 0 || sil.postPaddingMs > 1e3)
      errors.push("\u5F8C\u5074\u4F59\u767D\u306F0\u301C1,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.mergeGapMs < 0 || sil.mergeGapMs > 2e3)
      errors.push("\u8FD1\u63A5\u7D50\u5408\u306F0\u301C2,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.minSpeechMs < 0 || sil.minSpeechMs > 2e3)
      errors.push("\u6700\u5C0F\u767A\u8A71\u9577\u306F0\u301C2,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (![0, 1, 2, 3].includes(sil.vadSensitivity))
      errors.push("VAD\u611F\u5EA6\u306F0\u301C3\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (sil.stagedRules) {
      for (const r of sil.stagedRules) {
        if (r.retainMs >= r.minDurationMs)
          errors.push("\u6BB5\u968E\u51E6\u7406: \u6B8B\u3059\u9577\u3055\u306F\u5BFE\u8C61\u6700\u5C0F\u9577\u3088\u308A\u77ED\u304F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      }
    }
    if (s.filler.gapAfterMs < 0 || s.filler.gapAfterMs > 1e3)
      errors.push("\u30D5\u30A3\u30E9\u30FC\u524A\u9664\u5F8C\u306E\u9593\u306F0\u301C1,000ms\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    if (s.cpuThreads < 0 || s.cpuThreads > 64 || !Number.isInteger(s.cpuThreads))
      errors.push("CPU\u30B9\u30EC\u30C3\u30C9\u6570\u306F0\uFF08\u81EA\u52D5\uFF09\u301C64\u306E\u6574\u6570\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    return errors;
  }

  // plugin/src/state/settingsStore.ts
  function defaultState() {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      currentSettings: createShortsFastPreset().settings,
      customPresets: [],
      lastVideoTrackIndex: 0,
      lastAudioTrackIndex: 0,
      outputMode: "duplicate",
      // 仕様17章: 初期値は複製シーケンスで編集
      whisperModelToken: null,
      uiState: {}
    };
  }

  // plugin/src/premiere/apiProbe.ts
  function typeName(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return `array(${v.length})`;
    const t = typeof v;
    if (t === "object") {
      const ctor = v.constructor?.name;
      return ctor ?? "object";
    }
    return t;
  }
  async function getProject(ppro2) {
    const Project = ppro2.Project;
    if (!Project?.getActiveProject) throw new Error("Project.getActiveProject\u304C\u3042\u308A\u307E\u305B\u3093");
    return Project.getActiveProject();
  }
  async function getActiveSequence(ppro2) {
    const project = await getProject(ppro2);
    if (!project?.getActiveSequence) throw new Error("project.getActiveSequence\u304C\u3042\u308A\u307E\u305B\u3093");
    return project.getActiveSequence();
  }
  function probeDefinitions() {
    const defs = [
      {
        apiName: "Project.getActiveProject",
        mutating: false,
        run: async (ppro2) => ({ observed: await getProject(ppro2), notes: [] })
      },
      {
        apiName: "project.getActiveSequence",
        mutating: false,
        run: async (ppro2) => ({ observed: await getActiveSequence(ppro2), notes: [] })
      },
      {
        apiName: "project.getSequences",
        mutating: false,
        run: async (ppro2) => {
          const project = await getProject(ppro2);
          return { observed: await project.getSequences?.(), notes: [] };
        }
      },
      {
        apiName: "sequence.guid",
        mutating: false,
        run: async (ppro2) => {
          const seq = await getActiveSequence(ppro2);
          return { observed: seq?.guid, notes: ["\u8AAD\u307F\u53D6\u308A\u5C02\u7528\u30D7\u30ED\u30D1\u30C6\u30A3\uFF0825.6+\uFF09"] };
        }
      },
      {
        apiName: "sequence.getVideoTrackCount/getVideoTrack",
        mutating: false,
        run: async (ppro2) => {
          const seq = await getActiveSequence(ppro2);
          const count = await seq.getVideoTrackCount?.();
          const first = count && count > 0 ? await seq.getVideoTrack?.(0) : void 0;
          return { observed: first, notes: [`videoTrackCount=${String(count)}`] };
        }
      },
      {
        apiName: "sequence.getAudioTrackCount/getAudioTrack",
        mutating: false,
        run: async (ppro2) => {
          const seq = await getActiveSequence(ppro2);
          const count = await seq.getAudioTrackCount?.();
          const first = count && count > 0 ? await seq.getAudioTrack?.(0) : void 0;
          return { observed: first, notes: [`audioTrackCount=${String(count)}`] };
        }
      },
      {
        apiName: "sequence.getSelection",
        mutating: false,
        run: async (ppro2) => {
          const seq = await getActiveSequence(ppro2);
          return { observed: await seq.getSelection?.(), notes: [] };
        }
      },
      {
        apiName: "sequence.getPlayerPosition",
        mutating: false,
        run: async (ppro2) => {
          const seq = await getActiveSequence(ppro2);
          const pos = await seq.getPlayerPosition?.();
          const ticks = pos?.ticks;
          return {
            observed: pos,
            notes: [`ticks=${String(ticks)} (type=${typeof ticks})`]
          };
        }
      },
      {
        apiName: "TickTime.createWithSeconds(1).ticks",
        mutating: false,
        run: async (ppro2) => {
          const TickTime = ppro2.TickTime;
          const t = TickTime?.createWithSeconds?.(1);
          return {
            observed: t?.ticks,
            notes: [
              "1\u79D2=254016000000 ticks\u306E\u4EEE\u5B9A\u3092\u691C\u8A3C\u3059\u308B\uFF08constants.ts\u53C2\u7167\uFF09",
              `\u5B9F\u6E2C\u5024: ${String(t?.ticks)}`
            ]
          };
        }
      },
      {
        apiName: "BigInt\u5229\u7528\u53EF\u5426",
        mutating: false,
        run: async () => {
          const big = BigInt("9007199254740993") + BigInt(1);
          return {
            observed: big.toString(),
            notes: ["UXP\u74B0\u5883\u3067BigInt\u6F14\u7B97\u304C\u6B63\u3057\u3044\u304B\uFF089007199254740994\u306B\u306A\u308B\u3053\u3068\uFF09"]
          };
        }
      },
      {
        apiName: "project.lockedAccess",
        mutating: false,
        run: async (ppro2) => {
          const project = await getProject(ppro2);
          return { observed: project?.lockedAccess, notes: ["\u95A2\u6570\u306E\u5B58\u5728\u78BA\u8A8D\u306E\u307F\uFF08\u5B9F\u884C\u3057\u306A\u3044\uFF09"] };
        }
      },
      {
        apiName: "project.executeTransaction",
        mutating: false,
        run: async (ppro2) => {
          const project = await getProject(ppro2);
          return { observed: project?.executeTransaction, notes: ["\u95A2\u6570\u306E\u5B58\u5728\u78BA\u8A8D\u306E\u307F\uFF08\u5B9F\u884C\u3057\u306A\u3044\uFF09"] };
        }
      }
    ];
    const mutating = [
      ["sequence.createCloneAction (\u30B7\u30FC\u30B1\u30F3\u30B9\u8907\u88FD)", "\u8907\u88FD\u2192GUID\u5DEE\u5206\u21921\u4EF6\u306E\u307F\u304B"],
      ["sequence.createSubsequence", "\u8907\u88FD\u4EE3\u66FF\u624B\u6BB5\u3068\u3057\u3066\u306E\u6319\u52D5"],
      ["TrackItem Clone (createCloneTrackItemAction)", "\u30EA\u30F3\u30AFAudio\u540C\u6642\u8907\u88FD\u6709\u7121/isInsert=false"],
      ["TrackItem In/Out\u5909\u66F4Action", "\u30EA\u30F3\u30AF\u9023\u52D5\u6709\u7121"],
      ["TrackItem Move Action", "\u30EA\u30C3\u30D7\u30EB\u767A\u751F\u6709\u7121"],
      ["TrackItem\u524A\u9664Action", "\u30EA\u30C3\u30D7\u30EB\u767A\u751F\u6709\u7121"],
      ["Subclip\u4F5C\u6210", "\u6226\u7565B\u7528"],
      ["Sequence\u524A\u9664", "\u5931\u6557\u8907\u88FD\u306E\u5F8C\u59CB\u672B\u7528"],
      ["Transcript.hasTranscript / exportToJSON", "JSON Schema\u63A1\u53D6"],
      ["Marker\u8FFD\u52A0", "\u5019\u88DC\u30D7\u30EC\u30D3\u30E5\u30FC\u7528"]
    ];
    for (const [apiName, note] of mutating) {
      defs.push({
        apiName,
        mutating: true,
        run: async () => ({
          observed: void 0,
          notes: [note, "\u5C02\u7528\u30C6\u30B9\u30C8\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0A\u3067\u624B\u52D5\u5B9F\u884C\u3059\u308B\u3053\u3068\uFF08\u672C\u756A\u30B7\u30FC\u30B1\u30F3\u30B9\u7981\u6B62\uFF09"]
        })
      });
    }
    return defs;
  }
  async function runApiProbe(ppro2, includeMutating = false) {
    const results = [];
    for (const def of probeDefinitions()) {
      if (def.mutating && !includeMutating) {
        results.push({
          apiName: def.apiName,
          available: false,
          succeeded: false,
          notes: ["\u672A\u5B9F\u884C\uFF08\u5909\u66F4\u7CFB\u306E\u305F\u3081\u5C02\u7528\u30C6\u30B9\u30C8\u30B7\u30FC\u30B1\u30F3\u30B9\u3067\u660E\u793A\u5B9F\u884C\u304C\u5FC5\u8981\uFF09", ...await def.run(ppro2).then((r) => r.notes).catch(() => [])]
        });
        continue;
      }
      try {
        const { observed, notes } = await def.run(ppro2);
        results.push({
          apiName: def.apiName,
          available: observed !== void 0 && observed !== null,
          succeeded: true,
          observedReturnType: typeName(observed),
          notes
        });
      } catch (e) {
        results.push({
          apiName: def.apiName,
          available: false,
          succeeded: false,
          notes: [],
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    return results;
  }

  // plugin/src/premiere/pproTypes.ts
  function clipTrackItemType(ppro2) {
    const t = ppro2.Constants?.TrackItemType;
    if (t) {
      for (const key of ["CLIP", "Clip", "clip"]) {
        const v = t[key];
        if (typeof v === "number") return v;
      }
    }
    return 1;
  }

  // plugin/src/premiere/mutatingProbe.ts
  async function snapshotItem(item) {
    return {
      name: await item.getName(),
      start: (await item.getStartTime()).ticks,
      end: (await item.getEndTime()).ticks,
      inPoint: (await item.getInPoint()).ticks,
      outPoint: (await item.getOutPoint()).ticks
    };
  }
  async function freshSequence(project, guid) {
    const all = await project.getSequences();
    const seq = all.find((s) => String(s.guid) === guid);
    if (!seq) throw new Error(`\u30B7\u30FC\u30B1\u30F3\u30B9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093: ${guid}`);
    return seq;
  }
  function runTransaction(project, label, buildActions) {
    let innerError = null;
    project.lockedAccess(() => {
      try {
        project.executeTransaction((compound) => {
          for (const action of buildActions()) {
            compound.addAction(action);
          }
        }, label);
      } catch (e) {
        innerError = e;
      }
    });
    if (innerError) throw innerError;
  }
  async function scanAll(ppro2, project, guid) {
    const seq = await freshSequence(project, guid);
    const clipType = clipTrackItemType(ppro2);
    const out = [];
    const vCount = await seq.getVideoTrackCount();
    for (let i = 0; i < vCount; i++) {
      const track = await seq.getVideoTrack(i);
      out.push({ kind: "video", trackName: track.name, trackIndex: i, items: track.getTrackItems(clipType, false) });
    }
    const aCount = await seq.getAudioTrackCount();
    for (let i = 0; i < aCount; i++) {
      const track = await seq.getAudioTrack(i);
      out.push({ kind: "audio", trackName: track.name, trackIndex: i, items: track.getTrackItems(clipType, false) });
    }
    return out;
  }
  async function sequenceFingerprint(ppro2, project, guid) {
    const scans = await scanAll(ppro2, project, guid);
    const parts = [];
    for (const scan of scans) {
      for (const item of scan.items) {
        const s = await snapshotItem(item);
        parts.push(`${scan.kind}${scan.trackIndex}:${s.name}:${s.start}-${s.end}:${s.inPoint}/${s.outPoint}`);
      }
    }
    return parts.sort().join("|");
  }
  function countKind(scans, kind) {
    return scans.filter((s) => s.kind === kind).reduce((n, s) => n + s.items.length, 0);
  }
  async function runMutatingProbe(ppro2) {
    const results = [];
    const push = (apiName, succeeded, notes, error) => {
      const r = { apiName, available: succeeded, succeeded, notes };
      if (error !== void 0) r.error = error;
      results.push(r);
    };
    const project = await ppro2.Project.getActiveProject();
    if (!project) {
      push("\u524D\u63D0: \u30A2\u30AF\u30C6\u30A3\u30D6\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8", false, [], "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u304C\u3042\u308A\u307E\u305B\u3093");
      return results;
    }
    const active = await project.getActiveSequence();
    if (!active) {
      push("\u524D\u63D0: \u30A2\u30AF\u30C6\u30A3\u30D6\u30B7\u30FC\u30B1\u30F3\u30B9", false, [], "\u30B7\u30FC\u30B1\u30F3\u30B9\u304C\u3042\u308A\u307E\u305B\u3093");
      return results;
    }
    const originalGuid = String(active.guid);
    const originalFingerprint = await sequenceFingerprint(ppro2, project, originalGuid);
    let cloneGuid = null;
    try {
      const before = await project.getSequences();
      const beforeGuids = new Set(before.map((s) => String(s.guid)));
      const fresh = await freshSequence(project, originalGuid);
      runTransaction(project, "KazuCut Probe: \u30B7\u30FC\u30B1\u30F3\u30B9\u8907\u88FD", () => [fresh.createCloneAction()]);
      const after = await project.getSequences();
      const added = after.filter((s) => !beforeGuids.has(String(s.guid)));
      if (added.length === 1 && added[0]) {
        cloneGuid = String(added[0].guid);
        push("sequence.createCloneAction + GUID\u5DEE\u5206\u7279\u5B9A", true, [
          `\u65B0\u898F\u30B7\u30FC\u30B1\u30F3\u30B91\u4EF6\u3092\u7279\u5B9A: name=${added[0].name}`,
          "lockedAccess\u5185\u3067Action\u751F\u6210\u2192executeTransaction\u306E\u30D1\u30BF\u30FC\u30F3\u3067\u6210\u529F"
        ]);
      } else {
        push("sequence.createCloneAction + GUID\u5DEE\u5206\u7279\u5B9A", false, [
          `\u65B0\u898F\u30B7\u30FC\u30B1\u30F3\u30B9\u304C${added.length}\u4EF6\uFF08\u671F\u5F851\u4EF6\uFF09`
        ]);
      }
    } catch (e) {
      push("sequence.createCloneAction + GUID\u5DEE\u5206\u7279\u5B9A", false, [], String(e));
    }
    if (cloneGuid) {
      const guid = cloneGuid;
      try {
        const scans = await scanAll(ppro2, project, guid);
        push(
          "\u8907\u88FD\u30B7\u30FC\u30B1\u30F3\u30B9\u306ETrackItem\u5217\u6319",
          true,
          scans.filter((s) => s.items.length > 0).map((s) => `${s.kind}[${s.trackName}]: ${s.items.length}\u4EF6`)
        );
        const videoScan = scans.find((s) => s.kind === "video" && s.items.length > 0);
        if (!videoScan) {
          push("\u8907\u88FD\u4E0A\u306EVideo\u30AF\u30EA\u30C3\u30D7", false, [
            "Video\u30AF\u30EA\u30C3\u30D7\u304C1\u3064\u3082\u3042\u308A\u307E\u305B\u3093\u3002\u30AF\u30EA\u30C3\u30D7\u306E\u3042\u308B\u30B7\u30FC\u30B1\u30F3\u30B9\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044"
          ]);
        } else {
          const videoCountBefore = countKind(scans, "video");
          const audioCountBefore = countKind(scans, "audio");
          const firstVideo = videoScan.items[0];
          const vBefore = firstVideo ? await snapshotItem(firstVideo) : null;
          let clonedFound = false;
          let clonedStartTicks = "";
          if (vBefore) {
            try {
              const seqNow = await freshSequence(project, guid);
              const seqEnd = (await seqNow.getEndTime()).ticks;
              const offsetTicks = addTicks(subtractTicks(seqEnd, vBefore.start), "2540160000000");
              const scanNow = await scanAll(ppro2, project, guid);
              const vTrackNow = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              const target = vTrackNow?.items[0];
              if (!target) throw new Error("Clone\u5BFE\u8C61\u3092\u518D\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
              const seqForEditor = await freshSequence(project, guid);
              const editor = ppro2.SequenceEditor.getEditor(seqForEditor);
              const offsetT = ppro2.TickTime.createWithTicks(offsetTicks);
              runTransaction(project, "KazuCut Probe: TrackItem Clone", () => [
                editor.createCloneTrackItemAction(target, offsetT, 0, 0, true, false)
              ]);
              const afterScan = await scanAll(ppro2, project, guid);
              const videoAdded = countKind(afterScan, "video") - videoCountBefore;
              const audioAdded = countKind(afterScan, "audio") - audioCountBefore;
              push("SequenceEditor.createCloneTrackItemAction(isInsert=false)", videoAdded === 1, [
                `\u65B0\u898FVideo TrackItem: ${videoAdded}\u4EF6\uFF08\u671F\u5F851\u4EF6\uFF09`,
                `\u65B0\u898FAudio TrackItem: ${audioAdded}\u4EF6 \u2192 \u30EA\u30F3\u30AFAudio${audioAdded > 0 ? "\u3082\u540C\u6642\u8907\u88FD\u3055\u308C\u308B" : "\u306F\u8907\u88FD\u3055\u308C\u306A\u3044"}`,
                `timeOffset=${offsetTicks}\uFF08\u76F8\u5BFE\u30AA\u30D5\u30BB\u30C3\u30C8\u3068\u3057\u3066\u6307\u5B9A\uFF09`
              ]);
              const vTrackAfter = afterScan.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              if (vTrackAfter) {
                for (const item of vTrackAfter.items) {
                  const s = await snapshotItem(item);
                  if (s.start !== vBefore.start) {
                    clonedFound = true;
                    clonedStartTicks = s.start;
                    push("Clone\u5F8C\u306E\u65B0\u898FTrackItem\u7279\u5B9A\uFF08start\u5DEE\u5206\uFF09", true, [
                      `\u8907\u88FD\u4F4D\u7F6E start=${s.start}\uFF08\u671F\u5F85: \u5143start+offset=${addTicks(vBefore.start, offsetTicks)}\uFF09`
                    ]);
                    break;
                  }
                }
              }
              if (!clonedFound) {
                push("Clone\u5F8C\u306E\u65B0\u898FTrackItem\u7279\u5B9A\uFF08start\u5DEE\u5206\uFF09", false, ["\u5DEE\u5206\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093"]);
              }
            } catch (e) {
              push("SequenceEditor.createCloneTrackItemAction", false, [], String(e));
            }
          }
          if (clonedFound) {
            try {
              const target = "2540160000000";
              const scanNow = await scanAll(ppro2, project, guid);
              const vTrack = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              let moveTarget;
              for (const item of vTrack?.items ?? []) {
                if ((await item.getStartTime()).ticks === clonedStartTicks) moveTarget = item;
              }
              if (!moveTarget) throw new Error("Move\u5BFE\u8C61\u3092\u518D\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
              const before = await snapshotItem(moveTarget);
              runTransaction(project, "KazuCut Probe: Move", () => [
                moveTarget.createMoveAction(ppro2.TickTime.createWithTicks(target))
              ]);
              const scanAfter = await scanAll(ppro2, project, guid);
              const vTrackAfter = scanAfter.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              const starts = [];
              for (const item of vTrackAfter?.items ?? []) {
                starts.push((await item.getStartTime()).ticks);
              }
              let semantics = "\u5224\u5B9A\u4E0D\u80FD";
              let movedStart = "";
              if (starts.includes(target)) {
                semantics = "\u7D76\u5BFE\u4F4D\u7F6E\uFF08\u6307\u5B9Atick\u3078\u79FB\u52D5\uFF09";
                movedStart = target;
              } else {
                const relative = addTicks(before.start, target);
                if (starts.includes(relative)) {
                  semantics = "\u76F8\u5BFE\u30AA\u30D5\u30BB\u30C3\u30C8\uFF08\u73FE\u5728\u4F4D\u7F6E+\u6307\u5B9Atick\uFF09";
                  movedStart = relative;
                }
              }
              clonedStartTicks = movedStart || clonedStartTicks;
              push("trackItem.createMoveAction", semantics !== "\u5224\u5B9A\u4E0D\u80FD", [
                `\u79FB\u52D5\u524Dstart=${before.start} / \u6307\u5B9A\u5024=${target}`,
                `\u79FB\u52D5\u5F8C\u306E\u5168start=[${starts.join(", ")}]`,
                `\u30BB\u30DE\u30F3\u30C6\u30A3\u30AF\u30B9\u5224\u5B9A: ${semantics}`
              ]);
            } catch (e) {
              push("trackItem.createMoveAction", false, [], String(e));
            }
            try {
              const scanNow = await scanAll(ppro2, project, guid);
              const vTrack = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              let target;
              for (const item of vTrack?.items ?? []) {
                if ((await item.getStartTime()).ticks === clonedStartTicks) target = item;
              }
              if (!target) throw new Error("SetInPoint\u5BFE\u8C61\u3092\u518D\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
              const before = await snapshotItem(target);
              const newIn = addTicks(before.inPoint, "127008000000");
              runTransaction(project, "KazuCut Probe: SetInPoint", () => [
                target.createSetInPointAction(ppro2.TickTime.createWithTicks(newIn))
              ]);
              const scanAfter = await scanAll(ppro2, project, guid);
              const vTrackAfter = scanAfter.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              const details = [];
              for (const item of vTrackAfter?.items ?? []) {
                const s = await snapshotItem(item);
                details.push(`start=${s.start} in=${s.inPoint} out=${s.outPoint} end=${s.end}`);
              }
              push("trackItem.createSetInPointAction", true, [
                `\u5909\u66F4\u524D: start=${before.start} in=${before.inPoint} end=${before.end}`,
                `\u6307\u5B9AIn=${newIn}`,
                ...details.map((d) => `\u5909\u66F4\u5F8C: ${d}`)
              ]);
            } catch (e) {
              push("trackItem.createSetInPointAction", false, [], String(e));
            }
            try {
              const seqNow = await freshSequence(project, guid);
              const scanNow = await scanAll(ppro2, project, guid);
              const vTrack = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
              let removeTarget;
              for (const item of vTrack?.items ?? []) {
                const s = (await item.getStartTime()).ticks;
                if (vBefore && s !== vBefore.start) removeTarget = item;
              }
              if (!removeTarget) throw new Error("Remove\u5BFE\u8C61\u3092\u518D\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
              const selection = await seqNow.getSelection();
              const existing = await selection.getTrackItems();
              for (const it of existing) selection.removeItem(it);
              selection.addItem(removeTarget, true);
              const editor = ppro2.SequenceEditor.getEditor(seqNow);
              runTransaction(project, "KazuCut Probe: Remove", () => [
                editor.createRemoveItemsAction(selection, false, void 0, false)
              ]);
              const afterScan = await scanAll(ppro2, project, guid);
              const vCountFinal = countKind(afterScan, "video");
              push("SequenceEditor.createRemoveItemsAction(ripple=false)", vCountFinal === videoCountBefore, [
                `\u524A\u9664\u5F8CVideo\u4EF6\u6570=${vCountFinal}\uFF08\u671F\u5F85${videoCountBefore}\uFF09`
              ]);
            } catch (e) {
              push("SequenceEditor.createRemoveItemsAction", false, [], String(e));
            }
          }
        }
      } catch (e) {
        push("\u8907\u88FD\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0A\u306E\u5B9F\u9A13", false, [], String(e));
      }
      try {
        const cloneFresh = await freshSequence(project, guid);
        const deleted = await project.deleteSequence(cloneFresh);
        push("project.deleteSequence(\u8907\u88FD\u306E\u5F8C\u59CB\u672B)", deleted === true, [`\u623B\u308A\u5024=${String(deleted)}`]);
      } catch (e) {
        push("project.deleteSequence", false, ["\u8907\u88FD\u30B7\u30FC\u30B1\u30F3\u30B9\u304C\u6B8B\u3063\u3066\u3044\u307E\u3059\u3002\u624B\u52D5\u3067\u524A\u9664\u3057\u3066\u304F\u3060\u3055\u3044"], String(e));
      }
    }
    try {
      const fingerprintAfter = await sequenceFingerprint(ppro2, project, originalGuid);
      const intact = fingerprintAfter === originalFingerprint;
      push("\u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0D\u5909\u691C\u8A3C", intact, [
        intact ? "\u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u306E\u5168TrackItem\u304C\u5909\u66F4\u3055\u308C\u3066\u3044\u306A\u3044\u3053\u3068\u3092\u78BA\u8A8D" : "\u26A0\uFE0F \u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u306B\u5DEE\u5206\u304C\u3042\u308A\u307E\u3059\u3002Undo(Ctrl+Z)\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044"
      ]);
    } catch (e) {
      push("\u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0D\u5909\u691C\u8A3C", false, [], String(e));
    }
    return results;
  }

  // plugin/src/main.ts
  var bridge = tryLoadHybridAddon() ?? new MockNativeAdapter(3e3);
  var bridgeIsMock = bridge instanceof MockNativeAdapter;
  function tryLoadPremiere() {
    const req = globalThis.require;
    if (typeof req !== "function") return null;
    try {
      return req("premierepro");
    } catch {
      return null;
    }
  }
  var ppro = tryLoadPremiere();
  var state = defaultState();
  var candidates = [];
  var running = false;
  var abortController = null;
  var currentJobId = null;
  function el(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`\u8981\u7D20\u304C\u3042\u308A\u307E\u305B\u3093: ${id}`);
    return node;
  }
  function on(id, handler) {
    const node = document.getElementById(id);
    if (node) node.addEventListener("click", handler);
  }
  var $ = {
    banner: () => el("banner"),
    presetSelect: () => el("presetSelect"),
    fillerEnabled: () => el("fillerEnabled"),
    fillerSettings: () => el("fillerSettings"),
    analyzeButton: () => el("analyzeButton"),
    cancelButton: () => el("cancelButton"),
    applyButton: () => el("applyButton"),
    progressArea: () => el("progressArea"),
    results: () => el("results"),
    summaryLine: () => el("summaryLine"),
    applyArea: () => el("applyArea")
  };
  function showBanner(text) {
    const banner = $.banner();
    banner.textContent = text;
    banner.style.display = "block";
  }
  var numericFields = [
    ["manualThresholdDb", (s) => s.silence.manualThresholdDb, (s, v) => {
      s.silence.manualThresholdDb = v;
    }],
    ["noiseMarginDb", (s) => s.silence.noiseMarginDb, (s, v) => {
      s.silence.noiseMarginDb = v;
    }],
    ["hysteresisDb", (s) => s.silence.hysteresisDb, (s, v) => {
      s.silence.hysteresisDb = v;
    }],
    ["minSilenceMs", (s) => s.silence.minSilenceMs, (s, v) => {
      s.silence.minSilenceMs = v;
    }],
    ["retainMs", (s) => s.silence.retainMs, (s, v) => {
      s.silence.retainMs = v;
    }],
    ["prePaddingMs", (s) => s.silence.prePaddingMs, (s, v) => {
      s.silence.prePaddingMs = v;
    }],
    ["postPaddingMs", (s) => s.silence.postPaddingMs, (s, v) => {
      s.silence.postPaddingMs = v;
    }],
    ["mergeGapMs", (s) => s.silence.mergeGapMs, (s, v) => {
      s.silence.mergeGapMs = v;
    }],
    ["minSpeechMs", (s) => s.silence.minSpeechMs, (s, v) => {
      s.silence.minSpeechMs = v;
    }],
    ["fillerGapMs", (s) => s.filler.gapAfterMs, (s, v) => {
      s.filler.gapAfterMs = v;
    }]
  ];
  var boolFields = [
    ["silenceEnabled", (s) => s.silence.enabled, (s, v) => {
      s.silence.enabled = v;
    }],
    ["autoThreshold", (s) => s.silence.autoThreshold, (s, v) => {
      s.silence.autoThreshold = v;
    }],
    ["vadEnabled", (s) => s.silence.vadEnabled, (s, v) => {
      s.silence.vadEnabled = v;
    }],
    ["quietVoiceProtection", (s) => s.silence.quietVoiceProtection, (s, v) => {
      s.silence.quietVoiceProtection = v;
    }],
    ["processLeadingSilence", (s) => s.silence.processLeadingSilence, (s, v) => {
      s.silence.processLeadingSilence = v;
    }],
    ["processTrailingSilence", (s) => s.silence.processTrailingSilence, (s, v) => {
      s.silence.processTrailingSilence = v;
    }],
    ["fillerEnabled", (s) => s.filler.enabled, (s, v) => {
      s.filler.enabled = v;
    }]
  ];
  function settingsToUi() {
    const s = state.currentSettings;
    for (const [id, get] of numericFields) el(id).value = String(get(s));
    for (const [id, get] of boolFields) el(id).checked = get(s);
    el("silenceMode").value = s.silence.mode;
    el("vadSensitivity").value = String(s.silence.vadSensitivity);
    el("channelMode").value = s.silence.channelMode;
    el("transcriptSource").value = s.filler.transcriptSource;
    el("outputMode").value = state.outputMode;
    $.fillerSettings().style.display = s.filler.enabled ? "block" : "none";
  }
  function uiToSettings() {
    const s = state.currentSettings;
    for (const [id, , set] of numericFields) set(s, Number(el(id).value));
    for (const [id, , set] of boolFields) set(s, el(id).checked);
    s.silence.mode = el("silenceMode").value;
    s.silence.vadSensitivity = Number(el("vadSensitivity").value);
    s.silence.channelMode = el("channelMode").value;
    s.filler.transcriptSource = el("transcriptSource").value;
    state.outputMode = el("outputMode").value;
  }
  function populatePresets() {
    const sel = $.presetSelect();
    sel.innerHTML = "";
    const presets = [...builtInPresets(), ...state.customPresets];
    for (const p of presets) {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    sel.value = "\u30B7\u30E7\u30FC\u30C8\u9AD8\u901F";
  }
  async function analyze() {
    if (running) return;
    uiToSettings();
    const errors = validateSettings(state.currentSettings);
    if (errors.length > 0) {
      showBanner("\u8A2D\u5B9A\u30A8\u30E9\u30FC:\n" + errors.join("\n"));
      return;
    }
    running = true;
    setControlsEnabled(false);
    $.progressArea().style.display = "block";
    abortController = new AbortController();
    try {
      const request = ppro ? buildJobRequest(
        {
          jobId: `analyze-${Date.now()}`,
          // TODO(Phase 2実機): 選択クリップのProjectItemからメディアパスを解決する。
          // API Probe完了までこの経路は到達しない（下のバナーで案内）
          mediaPath: "",
          sourceInTicks: "0",
          sourceOutTicks: "0",
          audioStreamIndex: 0
        },
        state.currentSettings,
        null
      ) : { type: "test", jobId: `test-${Date.now()}`, durationMs: 3e3, payload: "kazucut" };
      if (ppro) {
        showBanner(
          "Premiere API Probe\u304C\u672A\u5B9F\u65BD\u306E\u305F\u3081\u3001\u5B9F\u30AF\u30EA\u30C3\u30D7\u306E\u89E3\u6790\u306F\u307E\u3060\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093\u3002\n\u300CAPI Probe\u5B9F\u884C\u300D\u3092\u5148\u306B\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u7D50\u679C\u306Fdiagnostics\u3078\u4FDD\u5B58\u3055\u308C\u307E\u3059\uFF09\u3002"
        );
        return;
      }
      const jobId = bridge.startJob(JSON.stringify({ type: "test", ...request }));
      currentJobId = jobId;
      const status = await pollJob(bridge, jobId, {
        intervalMs: 120,
        signal: abortController.signal,
        onProgress: (st) => {
          el("progressPercent").textContent = `${Math.round(st.progress * 100)}%`;
          el("progressFill").style.width = `${st.progress * 100}%`;
          el("progressStage").textContent = st.stage === "silence" ? "\u73FE\u5728\uFF1A\u7121\u97F3\u533A\u9593\u3092\u691C\u51FA\u3057\u3066\u3044\u307E\u3059" : "\u73FE\u5728\uFF1A\u97F3\u58F0\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u3044\u307E\u3059";
        }
      });
      if (status.state === "completed") {
        renderCandidates(demoCandidates());
        showBanner(
          bridgeIsMock ? "\u30CD\u30A4\u30C6\u30A3\u30D6\u672A\u63A5\u7D9A\uFF08Mock\u30E2\u30FC\u30C9\uFF09\u3067\u3059\u3002\u8868\u793A\u4E2D\u306E\u5019\u88DC\u306F\u30C7\u30E2\u7528\u3067\u3059\u3002\nWindows + Premiere\u74B0\u5883\u3067\u306E\u30BB\u30C3\u30C8\u30A2\u30C3\u30D7\u306FSDK_SETUP_REQUIRED.md\u3092\u53C2\u7167\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : "\u89E3\u6790\u30B8\u30E7\u30D6\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002"
        );
      } else if (status.state === "cancelled") {
        showBanner("\u51E6\u7406\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\u3057\u307E\u3057\u305F\u3002");
      } else {
        showBanner(`\u30A8\u30E9\u30FC: ${status.error?.userMessage ?? "\u4E0D\u660E\u306A\u30A8\u30E9\u30FC"}`);
      }
      if (currentJobId) bridge.disposeJob(currentJobId);
    } finally {
      running = false;
      currentJobId = null;
      setControlsEnabled(true);
      $.progressArea().style.display = "none";
    }
  }
  function demoCandidates() {
    const make = (id, startMs, endMs, retained) => ({
      id,
      reason: "silence",
      clipId: "demo",
      sourceStartTicks: msToTicks(startMs),
      sourceEndTicks: msToTicks(endMs),
      sequenceStartTicks: msToTicks(startMs),
      sequenceEndTicks: msToTicks(endMs),
      originalDurationMs: endMs - startMs,
      retainedDurationMs: retained,
      removalDurationMs: endMs - startMs - retained,
      selected: true,
      warnings: [],
      metadata: { demo: true }
    });
    return mergeCandidates(
      [make("d1", 2140, 2750, 90), make("d2", 6320, 6800, 90), make("d3", 11730, 12040, 90)],
      { mergeGapMs: state.currentSettings.silence.mergeGapMs, minSpeechMs: state.currentSettings.silence.minSpeechMs }
    );
  }
  function formatTime(ms) {
    const m = Math.floor(ms / 6e4);
    const s = (ms % 6e4 / 1e3).toFixed(3).padStart(6, "0");
    return `${String(m).padStart(2, "0")}:${s}`;
  }
  function renderCandidates(list) {
    candidates = list;
    const container = $.results();
    container.innerHTML = "";
    for (const c of candidates) {
      const div = document.createElement("div");
      div.className = "candidate";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = c.selected;
      check.addEventListener("change", () => {
        c.selected = check.checked;
        updateSummary();
      });
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `<div class="time">${formatTime(approxStartMs(c))}</div><div>${c.reason === "filler" ? `\u30D5\u30A3\u30E9\u30FC\u300C${c.detectedText ?? ""}\u300D` : "\u7121\u97F3"}</div><div>${(c.originalDurationMs / 1e3).toFixed(2)}\u79D2 \u2192 ${(c.retainedDurationMs / 1e3).toFixed(2)}\u79D2</div>` + (c.warnings.length ? `<div class="warn">${c.warnings.join(" / ")}</div>` : "");
      div.appendChild(check);
      div.appendChild(meta);
      container.appendChild(div);
    }
    updateSummary();
    $.applyArea().style.display = candidates.length > 0 ? "block" : "none";
    $.applyButton().disabled = ppro === null || bridgeIsMock;
    if (ppro === null) {
      el("applySummary").textContent = "Premiere\u672A\u63A5\u7D9A\u306E\u305F\u3081\u9069\u7528\u3067\u304D\u307E\u305B\u3093\uFF08\u5019\u88DC\u78BA\u8A8D\u306E\u30C7\u30E2\u8868\u793A\uFF09\u3002";
    }
  }
  function approxStartMs(c) {
    const perMs = Number(msToTicks(1));
    return Math.round(Number(c.sequenceStartTicks) / perMs);
  }
  function updateSummary() {
    const selected = candidates.filter((c) => c.selected);
    const totalMs = selected.reduce((sum, c) => sum + c.removalDurationMs, 0);
    $.summaryLine().textContent = candidates.length === 0 ? "" : `${candidates.length}\u4EF6\u3092\u691C\u51FA / \u9078\u629E${selected.length}\u4EF6 / \u63A8\u5B9A\u77ED\u7E2E\uFF1A${(totalMs / 1e3).toFixed(1)}\u79D2`;
  }
  function setControlsEnabled(enabled) {
    const ids = [
      "scopeSelect",
      "videoTrackSelect",
      "audioTrackSelect",
      "presetSelect",
      "silenceEnabled",
      "silenceMode",
      "retainMs",
      "fillerEnabled",
      "outputMode",
      "analyzeButton",
      "applyButton",
      "probeButton",
      "mutatingProbeButton"
    ];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) node.disabled = !enabled;
    }
  }
  async function saveDiagnostics(fileName, json) {
    const uxpModule = globalThis.require?.("uxp");
    const dataFolder = await uxpModule?.storage?.localFileSystem?.getDataFolder?.();
    const file = await dataFolder?.createFile?.(fileName, { overwrite: true });
    await file?.write(json);
  }
  async function runProbe() {
    if (!ppro) {
      showBanner("Premiere\u672A\u63A5\u7D9A\u306E\u305F\u3081API Probe\u3092\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093\u3002");
      return;
    }
    const results = await runApiProbe(ppro, false);
    const json = JSON.stringify(results, null, 2);
    try {
      await saveDiagnostics("api-probe.json", json);
      showBanner(`API Probe\u5B8C\u4E86\uFF08${results.length}\u9805\u76EE\uFF09\u3002plugin-data\u3078\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002`);
    } catch (e) {
      showBanner(`API Probe\u5B8C\u4E86\uFF08${results.length}\u9805\u76EE\uFF09\u3002\u4FDD\u5B58\u5931\u6557: ${e instanceof Error ? e.message : String(e)}
` + json.slice(0, 500));
    }
  }
  async function runMutatingProbeUi() {
    if (!ppro) {
      showBanner("Premiere\u672A\u63A5\u7D9A\u306E\u305F\u3081\u5909\u66F4\u7CFBProbe\u3092\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093\u3002");
      return;
    }
    if (running) return;
    running = true;
    setControlsEnabled(false);
    showBanner(
      "\u5909\u66F4\u7CFBProbe\u3092\u5B9F\u884C\u4E2D...\n\u30A2\u30AF\u30C6\u30A3\u30D6\u30B7\u30FC\u30B1\u30F3\u30B9\u3092\u8907\u88FD\u3057\u3001\u8907\u88FD\u4E0A\u3067Clone/Move/In-Out/\u524A\u9664\u3092\u5B9F\u9A13\u3057\u307E\u3059\u3002\n\u5143\u306E\u30B7\u30FC\u30B1\u30F3\u30B9\u306F\u5909\u66F4\u3057\u307E\u305B\u3093\uFF08\u7D42\u4E86\u6642\u306B\u4E0D\u5909\u3092\u81EA\u52D5\u691C\u8A3C\u3057\u307E\u3059\uFF09\u3002"
    );
    try {
      const results = await runMutatingProbe(ppro);
      const json = JSON.stringify(results, null, 2);
      const okCount = results.filter((r) => r.succeeded).length;
      const intact = results.find((r) => r.apiName === "\u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0D\u5909\u691C\u8A3C");
      try {
        await saveDiagnostics("api-probe-mutating.json", json);
        showBanner(
          `\u5909\u66F4\u7CFBProbe\u5B8C\u4E86: ${okCount}/${results.length}\u9805\u76EE\u6210\u529F\u3002
\u5143\u30B7\u30FC\u30B1\u30F3\u30B9: ${intact?.succeeded ? "\u4E0D\u5909\u3092\u78BA\u8A8D \u2713" : "\u26A0\uFE0F \u8981\u78BA\u8A8D"}
plugin-data\u306Eapi-probe-mutating.json\u3092\u5171\u6709\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
        );
      } catch {
        showBanner(`\u5909\u66F4\u7CFBProbe\u5B8C\u4E86\uFF08\u4FDD\u5B58\u5931\u6557\u306E\u305F\u3081\u5148\u982D\u3092\u8868\u793A\uFF09:
` + json.slice(0, 800));
      }
    } catch (e) {
      showBanner(`\u5909\u66F4\u7CFBProbe\u3067\u30A8\u30E9\u30FC: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
      setControlsEnabled(true);
    }
  }
  function init() {
    populatePresets();
    settingsToUi();
    if (bridgeIsMock) {
      showBanner(
        "\u30CD\u30A4\u30C6\u30A3\u30D6\u30E2\u30B8\u30E5\u30FC\u30EB\u672A\u63A5\u7D9A\uFF08\u958B\u767AMock\u30E2\u30FC\u30C9\uFF09\u3002\nWindows + Hybrid SDK\u74B0\u5883\u3067\u306E\u30D3\u30EB\u30C9\u624B\u9806\u306FSDK_SETUP_REQUIRED.md\u3092\u53C2\u7167\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      );
    }
    $.presetSelect().addEventListener("change", () => {
      const name = $.presetSelect().value;
      const preset = [...builtInPresets(), ...state.customPresets].find((p) => p.name === name);
      if (preset) {
        state.currentSettings = JSON.parse(JSON.stringify(preset.settings));
        settingsToUi();
      }
    });
    $.fillerEnabled().addEventListener("change", () => {
      state.currentSettings.filler.enabled = $.fillerEnabled().checked;
      $.fillerSettings().style.display = $.fillerEnabled().checked ? "block" : "none";
    });
    on("analyzeButton", () => {
      void analyze();
    });
    on("cancelButton", () => {
      abortController?.abort();
    });
    on("probeButton", () => {
      void runProbe();
    });
    on("mutatingProbeButton", () => {
      void runMutatingProbeUi();
    });
    on("applyButton", () => {
      showBanner("\u30BF\u30A4\u30E0\u30E9\u30A4\u30F3\u9069\u7528\u306FAPI Probe\uFF08Phase 2\u5B9F\u6A5F\u691C\u8A3C\uFF09\u5B8C\u4E86\u5F8C\u306B\u6709\u52B9\u5316\u3055\u308C\u307E\u3059\u3002");
    });
    on("savePresetButton", () => {
      uiToSettings();
      const name = `\u30AB\u30B9\u30BF\u30E0 ${(/* @__PURE__ */ new Date()).toLocaleString("ja-JP")}`;
      state.customPresets.push({
        name,
        builtIn: false,
        settings: JSON.parse(JSON.stringify(state.currentSettings))
      });
      populatePresets();
      $.presetSelect().value = name;
    });
  }
  function safeInit() {
    try {
      init();
    } catch (e) {
      const message = e instanceof Error ? `${e.message}
${e.stack ?? ""}` : String(e);
      const div = document.createElement("div");
      div.style.cssText = "background:#7a1f1f;color:#fff;padding:10px;border-radius:4px;white-space:pre-wrap;margin:10px;";
      div.textContent = "\u30D1\u30CD\u30EB\u521D\u671F\u5316\u30A8\u30E9\u30FC\uFF08\u3053\u306E\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u958B\u767A\u8005\u3078\u5831\u544A\u3057\u3066\u304F\u3060\u3055\u3044\uFF09:\n" + message;
      document.body.insertBefore(div, document.body.firstChild);
    }
  }
  window.addEventListener("error", (ev) => {
    const div = document.createElement("div");
    div.style.cssText = "background:#7a1f1f;color:#fff;padding:8px;border-radius:4px;white-space:pre-wrap;margin:10px;";
    div.textContent = `\u5B9F\u884C\u6642\u30A8\u30E9\u30FC: ${ev.message} (${ev.filename ?? ""}:${ev.lineno ?? ""})`;
    document.body.insertBefore(div, document.body.firstChild);
  });
  document.addEventListener("DOMContentLoaded", safeInit);
  if (document.readyState !== "loading") safeInit();
})();
