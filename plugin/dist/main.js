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
  async function loadHybridAddon() {
    const req = globalThis.require;
    if (typeof req !== "function") {
      return { ok: false, error: "require\u95A2\u6570\u304C\u3042\u308A\u307E\u305B\u3093\uFF08UXP\u74B0\u5883\u5916\uFF09" };
    }
    let addon;
    try {
      addon = await Promise.resolve(req("kazucut-native.uxpaddon"));
    } catch (e) {
      return {
        ok: false,
        error: `require("kazucut-native.uxpaddon")\u5931\u6557: ${e instanceof Error ? e.message : String(e)}`
      };
    }
    if (typeof addon !== "object" || addon === null) {
      return { ok: false, error: `addon\u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306F\u3042\u308A\u307E\u305B\u3093: ${typeof addon}` };
    }
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
    const missing = fns.filter((f) => typeof a[f] !== "function");
    if (missing.length > 0) {
      return {
        ok: false,
        error: `addon\u306B\u95A2\u6570\u304C\u3042\u308A\u307E\u305B\u3093: ${missing.join(", ")}\uFF08\u5B58\u5728\u3059\u308B\u30AD\u30FC: ${Object.keys(a).join(", ")}\uFF09`
      };
    }
    const call = (name, ...args) => a[name](...args);
    return {
      ok: true,
      bridge: {
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
      }
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
  var AV_PAIR_TOLERANCE_MS = 1;

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
              const constants = ppro2.Constants;
              const mediaTypeObj = constants?.MediaType;
              push("Constants.MediaType \u306E\u5185\u5BB9", !!mediaTypeObj, [
                `Constants\u30AD\u30FC: ${constants ? Object.keys(constants).join(", ") : "\u306A\u3057"}`,
                `MediaType: ${mediaTypeObj ? JSON.stringify(Object.keys(mediaTypeObj).map((k) => `${k}=${String(mediaTypeObj[k])}`)) : "\u306A\u3057"}`
              ]);
              const variants = [
                { label: "(selection, false)", mediaType: null, argCount: 2 },
                { label: "(selection, false, MediaType.VIDEO, false)", mediaType: mediaTypeObj?.["VIDEO"], argCount: 4 },
                { label: "(selection, false, MediaType.ANY, false)", mediaType: mediaTypeObj?.["ANY"], argCount: 4 },
                { label: "(selection, false, MediaType.Video, false)", mediaType: mediaTypeObj?.["Video"], argCount: 4 }
              ];
              let succeededVariant = null;
              const attempts = [];
              for (const variant of variants) {
                if (variant.argCount === 4 && variant.mediaType === void 0) {
                  attempts.push(`${variant.label}: \u30B9\u30AD\u30C3\u30D7\uFF08MediaType\u5B9A\u6570\u306A\u3057\uFF09`);
                  continue;
                }
                try {
                  const seqNow = await freshSequence(project, guid);
                  const scanNow = await scanAll(ppro2, project, guid);
                  const vTrack = scanNow.find(
                    (s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex
                  );
                  let removeTarget;
                  for (const item of vTrack?.items ?? []) {
                    const s = (await item.getStartTime()).ticks;
                    if (vBefore && s !== vBefore.start) removeTarget = item;
                  }
                  if (!removeTarget) {
                    attempts.push(`${variant.label}: \u5BFE\u8C61\u306A\u3057\uFF08\u65E2\u306B\u524A\u9664\u6E08\u307F?\uFF09`);
                    break;
                  }
                  const target = removeTarget;
                  const selection = await seqNow.getSelection();
                  const existing = await selection.getTrackItems();
                  for (const it of existing) selection.removeItem(it);
                  selection.addItem(target, true);
                  const editor = ppro2.SequenceEditor.getEditor(seqNow);
                  runTransaction(project, "KazuCut Probe: Remove", () => [
                    variant.argCount === 2 ? editor.createRemoveItemsAction(selection, false) : editor.createRemoveItemsAction(selection, false, variant.mediaType, false)
                  ]);
                  const afterScan = await scanAll(ppro2, project, guid);
                  const vCountNow = countKind(afterScan, "video");
                  if (vCountNow === videoCountBefore) {
                    succeededVariant = variant.label;
                    attempts.push(`${variant.label}: \u2705 \u6210\u529F\uFF08Video\u4EF6\u6570=${vCountNow}\uFF09`);
                    break;
                  }
                  attempts.push(`${variant.label}: \u5B9F\u884C\u306F\u3067\u304D\u305F\u304C\u4EF6\u6570\u304C${vCountNow}\uFF08\u671F\u5F85${videoCountBefore}\uFF09`);
                } catch (e) {
                  attempts.push(`${variant.label}: ${String(e)}`);
                }
              }
              push(
                "SequenceEditor.createRemoveItemsAction(ripple=false)",
                succeededVariant !== null,
                [...attempts, succeededVariant ? `\u63A1\u7528\u5F62: ${succeededVariant}` : "\u5168\u30D0\u30EA\u30A8\u30FC\u30B7\u30E7\u30F3\u5931\u6557"]
              );
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

  // plugin/src/premiere/avPairResolver.ts
  function resolveAvPair(video, audioTrackClips, targetAudioTrackIndex) {
    const videoError = checkSupported(video);
    if (videoError) return { ok: false, error: videoError };
    const tol = msToTicks(AV_PAIR_TOLERANCE_MS);
    const within = (a, b) => {
      const d = subtractTicks(a, b);
      const abs = d.startsWith("-") ? d.slice(1) : d;
      return compareTicks(abs, tol) <= 0;
    };
    const overlapping = audioTrackClips.filter(
      (a) => a.mediaType === "audio" && a.trackIndex === targetAudioTrackIndex && compareTicks(a.startTicks, video.endTicks) < 0 && compareTicks(a.endTicks, video.startTicks) > 0
    );
    const strict = overlapping.filter(
      (a) => a.projectItemId === video.projectItemId && within(a.startTicks, video.startTicks) && within(a.endTicks, video.endTicks) && within(a.inTicks, video.inTicks) && within(a.outTicks, video.outTicks) && a.speed === 100 && !a.reversed
    );
    if (strict.length === 1) {
      const audio = strict[0];
      if (!audio) {
        return {
          ok: false,
          error: createError("AMBIGUOUS_AUDIO_PAIR", "\u5185\u90E8\u30A8\u30E9\u30FC: strict[0]\u304Cundefined")
        };
      }
      const audioError = checkSupported(audio);
      if (audioError) return { ok: false, error: audioError };
      return { ok: true, video, audio };
    }
    if (strict.length > 1) {
      return {
        ok: false,
        error: createError(
          "AMBIGUOUS_AUDIO_PAIR",
          `\u53B3\u5BC6\u4E00\u81F4\u3059\u308B\u97F3\u58F0\u30AF\u30EA\u30C3\u30D7\u304C${strict.length}\u4EF6\u3042\u308A\u307E\u3059`,
          { candidateIds: strict.map((c) => c.clipId) }
        ),
        candidates: strict
      };
    }
    return {
      ok: false,
      error: createError(
        "AMBIGUOUS_AUDIO_PAIR",
        `\u5BFE\u5FDC\u3059\u308B\u97F3\u58F0\u30AF\u30EA\u30C3\u30D7\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\uFF08\u91CD\u306A\u308A\u5019\u88DC${overlapping.length}\u4EF6\uFF09`,
        { candidateIds: overlapping.map((c) => c.clipId) }
      ),
      candidates: overlapping
    };
  }
  function checkSupported(clip) {
    if (clip.mediaOffline) {
      return createError("MEDIA_OFFLINE", `clip=${clip.clipId}`);
    }
    if (clip.clipKind === "nested") {
      return createError("UNSUPPORTED_NEST", `clip=${clip.clipId}`);
    }
    if (clip.clipKind === "multicam") {
      return createError("UNSUPPORTED_MULTICAM", `clip=${clip.clipId}`);
    }
    if (clip.clipKind === "merged") {
      return createError("UNSUPPORTED_MERGED_CLIP", `clip=${clip.clipId}`);
    }
    if (clip.reversed) {
      return createError("UNSUPPORTED_REVERSE", `clip=${clip.clipId}`);
    }
    if (clip.timeRemapped) {
      return createError("UNSUPPORTED_TIME_REMAP", `clip=${clip.clipId}`);
    }
    if (clip.speed !== 100) {
      return createError("UNSUPPORTED_SPEED", `clip=${clip.clipId}, speed=${clip.speed}%`);
    }
    return null;
  }

  // plugin/src/analysis/keepSegmentPlanner.ts
  function planKeepSegments(clip, selectedCandidates) {
    const cuts = selectedCandidates.filter((c) => c.selected && c.clipId === clip.clipId).map((c) => shrinkForRetention(c)).filter((c) => compareTicks(c.startTicks, c.endTicks) < 0).filter(
      (c) => compareTicks(c.endTicks, clip.sourceInTicks) > 0 && compareTicks(c.startTicks, clip.sourceOutTicks) < 0
    ).map((c) => ({
      startTicks: maxT(c.startTicks, clip.sourceInTicks),
      endTicks: minT(c.endTicks, clip.sourceOutTicks)
    })).sort((a, b) => compareTicks(a.startTicks, b.startTicks));
    for (let i = 1; i < cuts.length; i++) {
      const prev = cuts[i - 1];
      const cur = cuts[i];
      if (prev && cur && compareTicks(cur.startTicks, prev.endTicks) < 0) {
        throw new Error(
          "\u524A\u9664\u5019\u88DC\u304C\u91CD\u306A\u3063\u3066\u3044\u307E\u3059\u3002\u5019\u88DC\u7D71\u5408(mergeCandidates)\u3092\u5148\u306B\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
        );
      }
    }
    const segments = [];
    let cursor = clip.sourceInTicks;
    let destCursor = clip.sequenceStartTicks;
    let index = 0;
    const pushSegment = (srcIn, srcOut) => {
      if (compareTicks(srcIn, srcOut) >= 0) return;
      const duration = subtractTicks(srcOut, srcIn);
      const originalSeqStart = addTicks(
        clip.sequenceStartTicks,
        subtractTicks(srcIn, clip.sourceInTicks)
      );
      segments.push({
        id: `${clip.clipId}-keep-${index++}`,
        sourceInTicks: srcIn,
        sourceOutTicks: srcOut,
        originalSequenceStartTicks: originalSeqStart,
        destinationStartTicks: destCursor,
        durationTicks: duration
      });
      destCursor = addTicks(destCursor, duration);
    };
    for (const cut of cuts) {
      pushSegment(cursor, cut.startTicks);
      cursor = cut.endTicks;
    }
    pushSegment(cursor, clip.sourceOutTicks);
    return segments;
  }
  function shrinkForRetention(c) {
    if (c.retainedDurationMs <= 0) {
      return { startTicks: c.sourceStartTicks, endTicks: c.sourceEndTicks };
    }
    const retainTicks = msToTicks(c.retainedDurationMs);
    const total = subtractTicks(c.sourceEndTicks, c.sourceStartTicks);
    if (compareTicks(retainTicks, total) >= 0) {
      return { startTicks: c.sourceStartTicks, endTicks: c.sourceStartTicks };
    }
    const front = divTicksBySmallInt(multiplyTicksBySmallInt(retainTicks, 40), 100).quotient;
    const back = subtractTicks(retainTicks, front);
    return {
      startTicks: addTicks(c.sourceStartTicks, front),
      endTicks: subtractTicks(c.sourceEndTicks, back)
    };
  }
  function maxT(a, b) {
    return compareTicks(a, b) >= 0 ? a : b;
  }
  function minT(a, b) {
    return compareTicks(a, b) <= 0 ? a : b;
  }

  // plugin/src/premiere/uxpTimeline.ts
  async function freshSequence2(project, guid) {
    const all = await project.getSequences();
    const seq = all.find((s) => String(s.guid) === guid);
    if (!seq) throw new Error(`\u30B7\u30FC\u30B1\u30F3\u30B9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093: ${guid}`);
    return seq;
  }
  function runTransaction2(project, label, buildActions) {
    let innerError = null;
    project.lockedAccess(() => {
      try {
        project.executeTransaction((compound) => {
          for (const action of buildActions()) compound.addAction(action);
        }, label);
      } catch (e) {
        innerError = e;
      }
    });
    if (innerError) throw innerError;
  }
  async function liveItems(ppro2, project, guid, kind, index) {
    const seq = await freshSequence2(project, guid);
    const track = kind === "video" ? await seq.getVideoTrack(index) : await seq.getAudioTrack(index);
    return track.getTrackItems(clipTrackItemType(ppro2), false);
  }
  async function scanTrack(ppro2, project, guid, kind, index) {
    const seq = await freshSequence2(project, guid);
    const track = kind === "video" ? await seq.getVideoTrack(index) : await seq.getAudioTrack(index);
    const items = track.getTrackItems(clipTrackItemType(ppro2), false);
    const out = [];
    for (const item of items) {
      const projectItem = await item.getProjectItem().catch(() => null);
      out.push({
        kind,
        trackIndex: index,
        trackName: track.name,
        name: await item.getName(),
        projectItemName: projectItem?.name ?? "",
        startTicks: (await item.getStartTime()).ticks,
        endTicks: (await item.getEndTime()).ticks,
        inTicks: (await item.getInPoint()).ticks,
        outTicks: (await item.getOutPoint()).ticks,
        speed: await item.getSpeed().catch(() => 100),
        reversed: Boolean(await item.isSpeedReversed().catch(() => 0))
      });
    }
    return out;
  }
  async function trackCount(project, guid, kind) {
    const seq = await freshSequence2(project, guid);
    return kind === "video" ? seq.getVideoTrackCount() : seq.getAudioTrackCount();
  }
  async function resolveItem(ppro2, project, guid, kind, index, predicate, what) {
    const items = await liveItems(ppro2, project, guid, kind, index);
    const hits = [];
    for (const item of items) {
      const start = (await item.getStartTime()).ticks;
      const in_ = (await item.getInPoint()).ticks;
      const out = (await item.getOutPoint()).ticks;
      if (predicate({ start, in_, out })) hits.push(item);
    }
    if (hits.length !== 1 || !hits[0]) {
      throw new Error(`${what}: \u5BFE\u8C61\u304C${hits.length}\u4EF6\uFF08\u671F\u5F851\u4EF6\uFF09\u3002\u5B89\u5168\u306E\u305F\u3081\u4E2D\u6B62\u3057\u307E\u3059`);
    }
    return hits[0];
  }
  function mediaTypeConstant(ppro2, kind) {
    const mt = ppro2.Constants?.MediaType;
    const v = kind === "video" ? mt?.["VIDEO"] : mt?.["AUDIO"];
    if (v === void 0) throw new Error("Constants.MediaType\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093");
    return v;
  }
  async function cloneClipToTemp(ppro2, project, guid, kind, trackIndex, sourceStartTicks, tempPosTicks) {
    const before = await scanTrack(ppro2, project, guid, kind, trackIndex);
    const beforeStarts = new Set(before.map((c) => c.startTicks));
    const item = await resolveItem(
      ppro2,
      project,
      guid,
      kind,
      trackIndex,
      (c) => c.start === sourceStartTicks,
      "Clone\u5BFE\u8C61"
    );
    const currentStart = (await item.getStartTime()).ticks;
    const offset = subtractTicks(tempPosTicks, currentStart);
    const seq = await freshSequence2(project, guid);
    const editor = ppro2.SequenceEditor.getEditor(seq);
    runTransaction2(project, "KazuCut: \u30AF\u30EA\u30C3\u30D7\u8907\u88FD", () => [
      editor.createCloneTrackItemAction(item, ppro2.TickTime.createWithTicks(offset), 0, 0, true, false)
    ]);
    const after = await scanTrack(ppro2, project, guid, kind, trackIndex);
    const added = after.filter((c) => !beforeStarts.has(c.startTicks));
    if (added.length !== 1 || !added[0]) {
      throw new Error(`\u8907\u88FD\u5F8C\u306E\u65B0\u898FTrackItem\u304C${added.length}\u4EF6\uFF08\u671F\u5F851\u4EF6\uFF09\u3002\u4E2D\u6B62\u3057\u307E\u3059`);
    }
    return { observedStartTicks: added[0].startTicks };
  }
  async function setClipInOut(ppro2, project, guid, kind, trackIndex, currentStartTicks, inTicks, outTicks) {
    const item = await resolveItem(
      ppro2,
      project,
      guid,
      kind,
      trackIndex,
      (c) => c.start === currentStartTicks,
      "In/Out\u8A2D\u5B9A\u5BFE\u8C61"
    );
    runTransaction2(project, "KazuCut: In/Out\u8A2D\u5B9A", () => [
      item.createSetInPointAction(ppro2.TickTime.createWithTicks(inTicks)),
      item.createSetOutPointAction(ppro2.TickTime.createWithTicks(outTicks))
    ]);
    const after = await scanTrack(ppro2, project, guid, kind, trackIndex);
    const hits = after.filter((c) => c.inTicks === inTicks && c.outTicks === outTicks);
    if (hits.length !== 1 || !hits[0]) {
      throw new Error(`In/Out\u8A2D\u5B9A\u5F8C\u306E\u7279\u5B9A\u304C${hits.length}\u4EF6\uFF08\u671F\u5F851\u4EF6\uFF09\u3002\u4E2D\u6B62\u3057\u307E\u3059`);
    }
    return { observedStartTicks: hits[0].startTicks };
  }
  async function moveClipTo(ppro2, project, guid, kind, trackIndex, currentStartTicks, destStartTicks) {
    if (compareTicks(currentStartTicks, destStartTicks) === 0) return;
    const item = await resolveItem(
      ppro2,
      project,
      guid,
      kind,
      trackIndex,
      (c) => c.start === currentStartTicks,
      "Move\u5BFE\u8C61"
    );
    const delta = subtractTicks(destStartTicks, currentStartTicks);
    runTransaction2(project, "KazuCut: \u30AF\u30EA\u30C3\u30D7\u79FB\u52D5", () => [
      item.createMoveAction(ppro2.TickTime.createWithTicks(delta))
    ]);
    const after = await scanTrack(ppro2, project, guid, kind, trackIndex);
    if (!after.some((c) => c.startTicks === destStartTicks)) {
      throw new Error(
        `Move\u7740\u5730\u691C\u8A3C\u5931\u6557: ${destStartTicks} \u306B\u30AF\u30EA\u30C3\u30D7\u304C\u3042\u308A\u307E\u305B\u3093\uFF08\u5B9F\u4F4D\u7F6E: ${after.map((c) => c.startTicks).join(",")}\uFF09`
      );
    }
  }
  async function removeClipAt(ppro2, project, guid, kind, trackIndex, startTicks) {
    const item = await resolveItem(
      ppro2,
      project,
      guid,
      kind,
      trackIndex,
      (c) => c.start === startTicks,
      "\u524A\u9664\u5BFE\u8C61"
    );
    const seq = await freshSequence2(project, guid);
    const selection = await seq.getSelection();
    const existing = await selection.getTrackItems();
    for (const it of existing) selection.removeItem(it);
    selection.addItem(item, true);
    const editor = ppro2.SequenceEditor.getEditor(seq);
    const mediaType = mediaTypeConstant(ppro2, kind);
    runTransaction2(project, "KazuCut: \u30AF\u30EA\u30C3\u30D7\u524A\u9664", () => [
      editor.createRemoveItemsAction(selection, false, mediaType, false)
    ]);
  }
  async function sequenceEndTicks(project, guid) {
    const seq = await freshSequence2(project, guid);
    return (await seq.getEndTime()).ticks;
  }
  async function cloneSequenceAndIdentify(project, sourceGuid) {
    const before = await project.getSequences();
    const beforeGuids = new Set(before.map((s) => String(s.guid)));
    const fresh = await freshSequence2(project, sourceGuid);
    runTransaction2(project, "KazuCut: \u30B7\u30FC\u30B1\u30F3\u30B9\u8907\u88FD", () => [fresh.createCloneAction()]);
    const after = await project.getSequences();
    const added = after.filter((s) => !beforeGuids.has(String(s.guid)));
    if (added.length !== 1 || !added[0]) {
      throw new Error(`\u8907\u88FD\u5F8C\u306E\u65B0\u898F\u30B7\u30FC\u30B1\u30F3\u30B9\u304C${added.length}\u4EF6\uFF08\u671F\u5F851\u4EF6\uFF09`);
    }
    return { guid: String(added[0].guid), name: added[0].name };
  }
  async function sequenceFingerprint2(ppro2, project, guid) {
    const parts = [];
    for (const kind of ["video", "audio"]) {
      const count = await trackCount(project, guid, kind);
      for (let i = 0; i < count; i++) {
        const clips = await scanTrack(ppro2, project, guid, kind, i);
        for (const c of clips) {
          parts.push(
            `${kind}${i}:${c.projectItemName}:${c.startTicks}-${c.endTicks}:${c.inTicks}/${c.outTicks}:${c.speed}`
          );
        }
      }
    }
    return parts.sort().join("|");
  }
  async function rebuildTrackSegments(ppro2, project, guid, kind, trackIndex, originalStartTicks, segments, log) {
    if (segments.length === 0) throw new Error("Keep Segment\u304C0\u4EF6");
    const seqEnd = await sequenceEndTicks(project, guid);
    const tempBase = addTicks(seqEnd, "2540160000000");
    const tempGap = "2540160000000";
    {
      const clips = await scanTrack(ppro2, project, guid, kind, trackIndex);
      const inTemp = clips.filter((c) => compareTicks(c.endTicks, tempBase) > 0);
      if (inTemp.length > 0) {
        throw new Error(`\u4E00\u6642\u9818\u57DF\u304C\u7A7A\u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF08${inTemp.length}\u4EF6\uFF09`);
      }
    }
    const placed = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      let tempPos = tempBase;
      for (let k = 0; k < i; k++) tempPos = addTicks(tempPos, tempGap);
      const cloned = await cloneClipToTemp(
        ppro2,
        project,
        guid,
        kind,
        trackIndex,
        originalStartTicks,
        tempPos
      );
      log(`${kind} seg${i}: \u8907\u88FDOK\uFF08\u5B9F\u4F4D\u7F6E ${cloned.observedStartTicks}\uFF09`);
      const trimmed = await setClipInOut(
        ppro2,
        project,
        guid,
        kind,
        trackIndex,
        cloned.observedStartTicks,
        seg.sourceInTicks,
        seg.sourceOutTicks
      );
      log(`${kind} seg${i}: In/Out\u8A2D\u5B9AOK\uFF08\u5B9F\u4F4D\u7F6E ${trimmed.observedStartTicks}\uFF09`);
      placed.push({ startTicks: trimmed.observedStartTicks, dest: seg.destinationStartTicks });
    }
    await removeClipAt(ppro2, project, guid, kind, trackIndex, originalStartTicks);
    log(`${kind}: \u5143\u30AF\u30EA\u30C3\u30D7\u524A\u9664OK`);
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (!p) continue;
      await moveClipTo(ppro2, project, guid, kind, trackIndex, p.startTicks, p.dest);
      log(`${kind} seg${i}: \u76EE\u7684\u4F4D\u7F6E ${p.dest} \u3078\u914D\u7F6EOK`);
    }
  }

  // plugin/src/premiere/phase3Demo.ts
  function toClipInfo(c, id) {
    return {
      clipId: id,
      mediaType: c.kind,
      trackIndex: c.trackIndex,
      projectItemId: c.projectItemName,
      startTicks: c.startTicks,
      endTicks: c.endTicks,
      inTicks: c.inTicks,
      outTicks: c.outTicks,
      speed: c.speed,
      reversed: c.reversed,
      timeRemapped: false,
      mediaOffline: false,
      clipKind: "standard"
    };
  }
  async function runPhase3Demo(ppro2, videoTrackIndex, audioTrackIndex, onLog) {
    const results = [];
    const push = (apiName, succeeded, notes, error) => {
      const r = { apiName, available: succeeded, succeeded, notes };
      if (error !== void 0) r.error = error;
      results.push(r);
      onLog(`${succeeded ? "\u2713" : "\u2717"} ${apiName}`);
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
    const originalFingerprint = await sequenceFingerprint2(ppro2, project, originalGuid);
    let cloneGuid;
    let cloneName;
    try {
      const clone = await cloneSequenceAndIdentify(project, originalGuid);
      cloneGuid = clone.guid;
      cloneName = clone.name;
      push("1. \u30B7\u30FC\u30B1\u30F3\u30B9\u8907\u88FD+\u7279\u5B9A", true, [`\u8907\u88FD\u540D: ${clone.name}`]);
    } catch (e) {
      push("1. \u30B7\u30FC\u30B1\u30F3\u30B9\u8907\u88FD+\u7279\u5B9A", false, [], String(e));
      return results;
    }
    try {
      const vClips = await scanTrack(ppro2, project, cloneGuid, "video", videoTrackIndex);
      const aClips = await scanTrack(ppro2, project, cloneGuid, "audio", audioTrackIndex);
      if (vClips.length === 0) {
        push("2. A/V\u30DA\u30A2\u89E3\u6C7A", false, [
          `\u6620\u50CF\u30C8\u30E9\u30C3\u30AFV${videoTrackIndex + 1}\u306B\u30AF\u30EA\u30C3\u30D7\u304C\u3042\u308A\u307E\u305B\u3093`
        ]);
        return results;
      }
      const video = toClipInfo(vClips[0], "v0");
      const audioInfos = aClips.map((c, i) => toClipInfo(c, `a${i}`));
      const pair = resolveAvPair(video, audioInfos, audioTrackIndex);
      if (!pair.ok) {
        push("2. A/V\u30DA\u30A2\u89E3\u6C7A", false, [pair.error.userMessage], pair.error.developerMessage);
        return results;
      }
      push("2. A/V\u30DA\u30A2\u89E3\u6C7A", true, [
        `\u6620\u50CF: ${video.projectItemId} start=${video.startTicks}`,
        `\u97F3\u58F0: ${pair.audio.projectItemId} start=${pair.audio.startTicks}`
      ]);
      const clipDuration = subtractTicks(video.outTicks, video.inTicks);
      if (compareTicks(clipDuration, msToTicks(2e3)) < 0) {
        push("3. Keep Segment\u751F\u6210", false, ["\u30AF\u30EA\u30C3\u30D7\u304C2\u79D2\u672A\u6E80\u306E\u305F\u3081\u5B9F\u8A3C\u306B\u4E0D\u9069\u3067\u3059"]);
        return results;
      }
      const mid = addTicks(video.inTicks, divTicksBySmallInt(clipDuration, 2).quotient);
      const half = msToTicks(250);
      const cut = {
        id: "phase3-cut",
        reason: "manual",
        clipId: "v0",
        sourceStartTicks: subtractTicks(mid, half),
        sourceEndTicks: addTicks(mid, half),
        sequenceStartTicks: "0",
        sequenceEndTicks: "0",
        originalDurationMs: 500,
        retainedDurationMs: 0,
        removalDurationMs: 500,
        selected: true,
        warnings: [],
        metadata: {}
      };
      const segments = planKeepSegments(
        {
          clipId: "v0",
          sourceInTicks: video.inTicks,
          sourceOutTicks: video.outTicks,
          sequenceStartTicks: video.startTicks
        },
        [cut]
      );
      push("3. Keep Segment\u751F\u6210", segments.length === 2, [
        `Segment\u6570=${segments.length}\uFF08\u671F\u5F852\uFF09`,
        ...segments.map(
          (s, i) => `seg${i}: source[${s.sourceInTicks}..${s.sourceOutTicks}] \u2192 dest=${s.destinationStartTicks}`
        )
      ]);
      if (segments.length !== 2) return results;
      const nonTargetBefore = await nonTargetFingerprint(
        ppro2,
        project,
        cloneGuid,
        videoTrackIndex,
        audioTrackIndex
      );
      const rebuildSegments = segments.map((s) => ({
        sourceInTicks: s.sourceInTicks,
        sourceOutTicks: s.sourceOutTicks,
        destinationStartTicks: s.destinationStartTicks
      }));
      try {
        await rebuildTrackSegments(
          ppro2,
          project,
          cloneGuid,
          "video",
          videoTrackIndex,
          video.startTicks,
          rebuildSegments,
          onLog
        );
        push("4. \u6620\u50CF\u30C8\u30E9\u30C3\u30AF\u518D\u69CB\u7BC9", true, []);
      } catch (e) {
        push("4. \u6620\u50CF\u30C8\u30E9\u30C3\u30AF\u518D\u69CB\u7BC9", false, [], String(e));
        return results;
      }
      try {
        await rebuildTrackSegments(
          ppro2,
          project,
          cloneGuid,
          "audio",
          audioTrackIndex,
          pair.audio.startTicks,
          rebuildSegments,
          onLog
        );
        push("5. \u97F3\u58F0\u30C8\u30E9\u30C3\u30AF\u518D\u69CB\u7BC9", true, []);
      } catch (e) {
        push("5. \u97F3\u58F0\u30C8\u30E9\u30C3\u30AF\u518D\u69CB\u7BC9", false, [], String(e));
        return results;
      }
      const vAfter = await scanTrack(ppro2, project, cloneGuid, "video", videoTrackIndex);
      const aAfter = await scanTrack(ppro2, project, cloneGuid, "audio", audioTrackIndex);
      const notes = [];
      let ok = vAfter.length === segments.length && aAfter.length === segments.length;
      notes.push(`\u6620\u50CF\u30AF\u30EA\u30C3\u30D7\u6570=${vAfter.length} / \u97F3\u58F0=${aAfter.length}\uFF08\u671F\u5F85${segments.length}\uFF09`);
      for (let i = 0; i < segments.length && ok; i++) {
        const seg = segments[i];
        const v = vAfter.find((c) => c.startTicks === seg.destinationStartTicks);
        const a = aAfter.find((c) => c.startTicks === seg.destinationStartTicks);
        if (!v || !a) {
          ok = false;
          notes.push(`seg${i}: dest=${seg.destinationStartTicks} \u306BV/A\u304C\u63C3\u3063\u3066\u3044\u307E\u305B\u3093`);
          break;
        }
        if (v.inTicks !== seg.sourceInTicks || v.outTicks !== seg.sourceOutTicks) {
          ok = false;
          notes.push(`seg${i}: \u6620\u50CFIn/Out\u4E0D\u4E00\u81F4`);
          break;
        }
        const drift = subtractTicks(a.startTicks, v.startTicks);
        notes.push(`seg${i}: A/V\u540C\u671F\u5DEE=${drift} ticks`);
        if (drift !== "0") ok = false;
      }
      const totalKeptMs = vAfter.reduce(
        (sum, c) => sum + ticksToApproxMs(subtractTicks(c.endTicks, c.startTicks)),
        0
      );
      notes.push(`\u518D\u69CB\u7BC9\u5F8C\u306E\u5408\u8A08\u6642\u9593: ${Math.round(totalKeptMs)}ms\uFF08\u5143${Math.round(ticksToApproxMs(clipDuration))}ms\u304B\u3089500ms\u77ED\u7E2E\u306E\u306F\u305A\uFF09`);
      push("6. Keep Segment\u914D\u7F6E+A/V\u540C\u671F\u691C\u8A3C", ok, notes);
      const nonTargetAfter = await nonTargetFingerprint(
        ppro2,
        project,
        cloneGuid,
        videoTrackIndex,
        audioTrackIndex
      );
      push("7. \u5BFE\u8C61\u5916\u30C8\u30E9\u30C3\u30AF\u4E0D\u5909\u691C\u8A3C\uFF08BGM/\u30AC\u30A4\u30C9\uFF09", nonTargetBefore === nonTargetAfter, [
        nonTargetBefore === nonTargetAfter ? "\u5BFE\u8C61\u5916\u30C8\u30E9\u30C3\u30AF\u306ETrackItem\u306F\u3059\u3079\u3066\u4E0D\u5909" : "\u26A0\uFE0F \u5BFE\u8C61\u5916\u30C8\u30E9\u30C3\u30AF\u306B\u5DEE\u5206\u304C\u3042\u308A\u307E\u3059"
      ]);
    } catch (e) {
      push("Phase 3\u5B9F\u884C", false, [], String(e));
    }
    try {
      const after = await sequenceFingerprint2(ppro2, project, originalGuid);
      push("8. \u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0D\u5909\u691C\u8A3C", after === originalFingerprint, [
        after === originalFingerprint ? "\u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u306F\u4E00\u5207\u5909\u66F4\u3055\u308C\u3066\u3044\u307E\u305B\u3093" : "\u26A0\uFE0F \u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u306B\u5DEE\u5206\u304C\u3042\u308A\u307E\u3059"
      ]);
    } catch (e) {
      push("8. \u5143\u30B7\u30FC\u30B1\u30F3\u30B9\u4E0D\u5909\u691C\u8A3C", false, [], String(e));
    }
    push("9. \u8907\u88FD\u30B7\u30FC\u30B1\u30F3\u30B9\u306E\u6271\u3044", true, [
      `\u8907\u88FD\u300C${cloneName}\u300D\u306F\u691C\u8A3C\u7528\u306B\u6B8B\u3057\u3066\u3044\u307E\u3059\u3002`,
      "Premiere\u3067\u958B\u3044\u3066\u518D\u751F\u3057\u3001\u6620\u50CF\u3068\u97F3\u58F0\u306E\u540C\u671F\u30FBBGM\u306E\u4F4D\u7F6E\u3092\u76EE\u8996\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "\u554F\u984C\u306A\u3051\u308C\u3070\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u30D1\u30CD\u30EB\u304B\u3089\u8907\u88FD\u3092\u524A\u9664\u3057\u3066OK\u3067\u3059\u3002"
    ]);
    return results;
  }
  async function nonTargetFingerprint(ppro2, project, guid, videoTrackIndex, audioTrackIndex) {
    const parts = [];
    for (const kind of ["video", "audio"]) {
      const count = await trackCount(project, guid, kind);
      for (let i = 0; i < count; i++) {
        if (kind === "video" && i === videoTrackIndex) continue;
        if (kind === "audio" && i === audioTrackIndex) continue;
        const clips = await scanTrack(ppro2, project, guid, kind, i);
        for (const c of clips) {
          parts.push(
            `${kind}${i}:${c.projectItemName}:${c.startTicks}-${c.endTicks}:${c.inTicks}/${c.outTicks}`
          );
        }
      }
    }
    return parts.sort().join("|");
  }

  // plugin/src/main.ts
  var BUILD_ID = true ? "20260712T1155" : "dev";
  var bridge = new MockNativeAdapter(3e3);
  var bridgeIsMock = true;
  var addonLoadError = "";
  async function initBridge() {
    const result = await loadHybridAddon();
    if (result.ok) {
      bridge = result.bridge;
      bridgeIsMock = false;
      try {
        const v = bridge.getVersion();
        showBanner(
          `\u30CD\u30A4\u30C6\u30A3\u30D6\u63A5\u7D9AOK: addon ${v.addonVersion} / ${v.architecture} / Worker${v.workerAvailable ? "\u691C\u51FA\u6E08\u307F" : "\u672A\u691C\u51FA(WORKER_NOT_FOUND)"}`
        );
      } catch (e) {
        showBanner(`Addon\u306F\u30ED\u30FC\u30C9\u3055\u308C\u307E\u3057\u305F\u304C getVersion \u3067\u5931\u6557: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      addonLoadError = result.error;
      showBanner(
        `\u30CD\u30A4\u30C6\u30A3\u30D6\u30E2\u30B8\u30E5\u30FC\u30EB\u672A\u63A5\u7D9A\uFF08Mock\u30E2\u30FC\u30C9\uFF09\u3002
\u30ED\u30FC\u30C9\u5931\u6557\u306E\u7406\u7531: ${addonLoadError}`
      );
    }
  }
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
      "mutatingProbeButton",
      "phase3Button"
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
  async function populateTracksFromPremiere() {
    if (!ppro) return;
    try {
      const mod = ppro;
      const project = await mod.Project.getActiveProject();
      const seq = project ? await project.getActiveSequence() : null;
      if (!project || !seq) return;
      const vSel = el("videoTrackSelect");
      const aSel = el("audioTrackSelect");
      vSel.innerHTML = "";
      aSel.innerHTML = "";
      const vCount = await seq.getVideoTrackCount();
      for (let i = 0; i < vCount; i++) {
        const track = await seq.getVideoTrack(i);
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `V${i + 1} (${track.name})`;
        vSel.appendChild(opt);
      }
      const aCount = await seq.getAudioTrackCount();
      for (let i = 0; i < aCount; i++) {
        const track = await seq.getAudioTrack(i);
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `A${i + 1} (${track.name})`;
        aSel.appendChild(opt);
      }
      vSel.value = "0";
      aSel.value = "0";
    } catch {
    }
  }
  async function runPhase3Ui() {
    if (!ppro) {
      showBanner("Premiere\u672A\u63A5\u7D9A\u306E\u305F\u3081\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093\u3002");
      return;
    }
    if (running) return;
    running = true;
    setControlsEnabled(false);
    const videoIdx = Number(el("videoTrackSelect").value || "0");
    const audioIdx = Number(el("audioTrackSelect").value || "0");
    const logs = [];
    const renderLogs = () => {
      showBanner(
        `500ms\u524A\u9664\u5B9F\u8A3C\u3092\u5B9F\u884C\u4E2D\uFF08V${videoIdx + 1}/A${audioIdx + 1}\uFF09...
` + logs.slice(-8).join("\n")
      );
    };
    renderLogs();
    try {
      const results = await runPhase3Demo(ppro, videoIdx, audioIdx, (m) => {
        logs.push(m);
        renderLogs();
      });
      results.unshift({
        apiName: "phase3Version",
        available: true,
        succeeded: true,
        notes: [`build ${BUILD_ID}`, `V${videoIdx + 1}/A${audioIdx + 1}`]
      });
      const okCount = results.filter((r) => r.succeeded).length;
      const allOk = okCount === results.length;
      const json = JSON.stringify(results, null, 2);
      try {
        await saveDiagnostics("phase3-result.json", json);
        showBanner(
          (allOk ? "\u2705 500ms\u524A\u9664\u5B9F\u8A3C: \u5168\u30B9\u30C6\u30C3\u30D7\u6210\u529F\uFF01\n" : `\u26A0\uFE0F 500ms\u524A\u9664\u5B9F\u8A3C: ${okCount}/${results.length}\u30B9\u30C6\u30C3\u30D7\u6210\u529F
`) + "\u8907\u88FD\u30B7\u30FC\u30B1\u30F3\u30B9\u3092\u958B\u3044\u3066\u3001\u518D\u751F\u30FBA/V\u540C\u671F\u30FBBGM\u4F4D\u7F6E\u3092\u76EE\u8996\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002\nplugin-data\u306Ephase3-result.json\u3092\u5171\u6709\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
        );
      } catch {
        showBanner("\u5B9F\u8A3C\u5B8C\u4E86\uFF08\u4FDD\u5B58\u5931\u6557\u306E\u305F\u3081\u5148\u982D\u3092\u8868\u793A\uFF09:\n" + json.slice(0, 800));
      }
    } catch (e) {
      showBanner(`500ms\u524A\u9664\u5B9F\u8A3C\u3067\u30A8\u30E9\u30FC: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
      setControlsEnabled(true);
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
      results.unshift({
        apiName: "probeVersion",
        available: true,
        succeeded: true,
        notes: [`build ${BUILD_ID}`]
      });
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
  var initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    const h1 = document.querySelector("h1");
    if (h1) {
      const span = document.createElement("span");
      span.style.cssText = "font-size:10px;color:#888;margin-left:8px;font-weight:normal;";
      span.textContent = `build ${BUILD_ID}`;
      h1.appendChild(span);
    }
    populatePresets();
    settingsToUi();
    el("scopeSelect").value = "selection";
    void populateTracksFromPremiere();
    void initBridge();
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
    on("phase3Button", () => {
      void runPhase3Ui();
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
