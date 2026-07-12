/**
 * KazuCut Local パネルコントローラ。
 *
 * 現状の接続状態（FINAL_REPORT.md参照）:
 * - NativeBridge: Hybrid Addonが読めればexternal-worker、なければMock（バナー表示）
 * - Premiere DOM: API Probe（Phase 2実機）完了までタイムライン自動編集は無効。
 *   解析（無音候補の生成・確認）とテストジョブは動作する。
 */
import { MockNativeAdapter } from "./native/mockNativeAdapter";
import { loadHybridAddon } from "./native/hybridAddonAdapter";
import { pollJob } from "./native/jobPoller";
import { buildJobRequest } from "./analysis/analysisController";
import { mergeCandidates } from "./analysis/candidateMerger";
import { builtInPresets, validateSettings } from "./state/presets";
import { defaultState, loadState, saveState, type StoredState } from "./state/settingsStore";
import { createUxpStorage } from "./state/uxpStorage";
import { runApiProbe } from "./premiere/apiProbe";
import { runMutatingProbe } from "./premiere/mutatingProbe";
import { runPhase3Demo } from "./premiere/phase3Demo";
import { applyRealEdits, runRealAnalysis, type AnalysisContext } from "./premiere/realAnalysis";
import type { PproModule } from "./premiere/pproTypes";
import { msToTicks } from "./ticks";
import type { AnalysisSettings, CutCandidate, NativeBridge, Preset } from "./types";

// ビルド時にesbuildが注入（scripts/build-uxp.mjs）
declare const __KAZUCUT_BUILD__: string;
const BUILD_ID = typeof __KAZUCUT_BUILD__ === "string" ? __KAZUCUT_BUILD__ : "dev";

// ---- 環境検出 ----
// Hybrid Addonのロードは非同期（実機知見）。確定までMockで初期化し、initで差し替える
let bridge: NativeBridge = new MockNativeAdapter(3000);
let bridgeIsMock = true;
let addonLoadError = "";

async function initBridge(): Promise<void> {
  const result = await loadHybridAddon();
  if (result.ok) {
    bridge = result.bridge;
    bridgeIsMock = false;
    try {
      const v = bridge.getVersion();
      showBanner(
        `ネイティブ接続OK: addon ${v.addonVersion} / ${v.architecture} / ` +
        `Worker${v.workerAvailable ? "検出済み" : "未検出(WORKER_NOT_FOUND)"}`
      );
    } catch (e) {
      showBanner(`Addonはロードされましたが getVersion で失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    addonLoadError = result.error;
    showBanner(
      "ネイティブモジュール未接続（Mockモード）。\n" +
      `ロード失敗の理由: ${addonLoadError}`
    );
  }
}

function tryLoadPremiere(): Record<string, unknown> | null {
  const req = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  try {
    return req("premierepro") as Record<string, unknown>;
  } catch {
    return null;
  }
}
const ppro = tryLoadPremiere();

// ---- 状態 ----
let state: StoredState = defaultState();
const storage = createUxpStorage();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 設定を plugin-data:/ へ保存（500msデバウンス） */
function scheduleSave(): void {
  if (!storage) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      uiToSettings();
      state.lastVideoTrackIndex = Number(el<HTMLSelectElement>("videoTrackSelect").value || "0");
      state.lastAudioTrackIndex = Number(el<HTMLSelectElement>("audioTrackSelect").value || "0");
      void saveState(storage, state);
    } catch {
      // 保存失敗で操作を妨げない
    }
  }, 500);
}

/** 保存済み設定の復元（起動時） */
async function restoreState(): Promise<void> {
  if (!storage) return;
  try {
    state = await loadState(storage);
    populatePresets();
    settingsToUi();
  } catch {
    // 復元失敗時はデフォルトのまま
  }
}
let analysisContext: AnalysisContext | null = null;
let candidates: CutCandidate[] = [];
let running = false;
let abortController: AbortController | null = null;
let currentJobId: string | null = null;

// ---- DOMヘルパー ----
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`要素がありません: ${id}`);
  return node as T;
}

/** 要素が無くても初期化全体を止めないリスナー登録（HTML/JSのバージョン不一致対策） */
function on(id: string, handler: () => void): void {
  const node = document.getElementById(id);
  if (node) node.addEventListener("click", handler);
}
const $ = {
  banner: () => el<HTMLDivElement>("banner"),
  presetSelect: () => el<HTMLSelectElement>("presetSelect"),
  fillerEnabled: () => el<HTMLInputElement>("fillerEnabled"),
  fillerSettings: () => el<HTMLDivElement>("fillerSettings"),
  analyzeButton: () => el<HTMLButtonElement>("analyzeButton"),
  cancelButton: () => el<HTMLButtonElement>("cancelButton"),
  applyButton: () => el<HTMLButtonElement>("applyButton"),
  progressArea: () => el<HTMLDivElement>("progressArea"),
  results: () => el<HTMLDivElement>("results"),
  summaryLine: () => el<HTMLDivElement>("summaryLine"),
  applyArea: () => el<HTMLDivElement>("applyArea")
};

function showBanner(text: string): void {
  const banner = $.banner();
  banner.textContent = text;
  banner.style.display = "block";
}

// ---- 設定⇔UI同期 ----
const numericFields: [string, (s: AnalysisSettings) => number, (s: AnalysisSettings, v: number) => void][] = [
  ["manualThresholdDb", (s) => s.silence.manualThresholdDb, (s, v) => { s.silence.manualThresholdDb = v; }],
  ["noiseMarginDb", (s) => s.silence.noiseMarginDb, (s, v) => { s.silence.noiseMarginDb = v; }],
  ["hysteresisDb", (s) => s.silence.hysteresisDb, (s, v) => { s.silence.hysteresisDb = v; }],
  ["minSilenceMs", (s) => s.silence.minSilenceMs, (s, v) => { s.silence.minSilenceMs = v; }],
  ["retainMs", (s) => s.silence.retainMs, (s, v) => { s.silence.retainMs = v; }],
  ["prePaddingMs", (s) => s.silence.prePaddingMs, (s, v) => { s.silence.prePaddingMs = v; }],
  ["postPaddingMs", (s) => s.silence.postPaddingMs, (s, v) => { s.silence.postPaddingMs = v; }],
  ["mergeGapMs", (s) => s.silence.mergeGapMs, (s, v) => { s.silence.mergeGapMs = v; }],
  ["minSpeechMs", (s) => s.silence.minSpeechMs, (s, v) => { s.silence.minSpeechMs = v; }],
  ["fillerGapMs", (s) => s.filler.gapAfterMs, (s, v) => { s.filler.gapAfterMs = v; }]
];
const boolFields: [string, (s: AnalysisSettings) => boolean, (s: AnalysisSettings, v: boolean) => void][] = [
  ["silenceEnabled", (s) => s.silence.enabled, (s, v) => { s.silence.enabled = v; }],
  ["autoThreshold", (s) => s.silence.autoThreshold, (s, v) => { s.silence.autoThreshold = v; }],
  ["vadEnabled", (s) => s.silence.vadEnabled, (s, v) => { s.silence.vadEnabled = v; }],
  ["quietVoiceProtection", (s) => s.silence.quietVoiceProtection, (s, v) => { s.silence.quietVoiceProtection = v; }],
  ["processLeadingSilence", (s) => s.silence.processLeadingSilence, (s, v) => { s.silence.processLeadingSilence = v; }],
  ["processTrailingSilence", (s) => s.silence.processTrailingSilence, (s, v) => { s.silence.processTrailingSilence = v; }],
  ["fillerEnabled", (s) => s.filler.enabled, (s, v) => { s.filler.enabled = v; }]
];

function settingsToUi(): void {
  const s = state.currentSettings;
  for (const [id, get] of numericFields) el<HTMLInputElement>(id).value = String(get(s));
  for (const [id, get] of boolFields) el<HTMLInputElement>(id).checked = get(s);
  el<HTMLSelectElement>("silenceMode").value = s.silence.mode;
  el<HTMLSelectElement>("vadSensitivity").value = String(s.silence.vadSensitivity);
  el<HTMLSelectElement>("channelMode").value = s.silence.channelMode;
  el<HTMLSelectElement>("transcriptSource").value = s.filler.transcriptSource;
  // フィラーOFF時はWhisper設定を隠す・警告を出さない（仕様30章）
  $.fillerSettings().style.display = s.filler.enabled ? "block" : "none";
}

function uiToSettings(): void {
  const s = state.currentSettings;
  for (const [id, , set] of numericFields) set(s, Number(el<HTMLInputElement>(id).value));
  for (const [id, , set] of boolFields) set(s, el<HTMLInputElement>(id).checked);
  s.silence.mode = el<HTMLSelectElement>("silenceMode").value as "remove" | "shorten";
  s.silence.vadSensitivity = Number(el<HTMLSelectElement>("vadSensitivity").value) as 0 | 1 | 2 | 3;
  s.silence.channelMode = el<HTMLSelectElement>("channelMode").value as typeof s.silence.channelMode;
  s.filler.transcriptSource = el<HTMLSelectElement>("transcriptSource").value as typeof s.filler.transcriptSource;
}

function populatePresets(): void {
  const sel = $.presetSelect();
  sel.innerHTML = "";
  const presets: Preset[] = [...builtInPresets(), ...state.customPresets];
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = "ショート高速";
}

// ---- 解析 ----
async function analyze(): Promise<void> {
  if (running) return; // 連打防止（仕様32章）
  uiToSettings();
  const errors = validateSettings(state.currentSettings);
  if (errors.length > 0) {
    showBanner("設定エラー:\n" + errors.join("\n"));
    return;
  }
  running = true;
  setControlsEnabled(false);
  $.progressArea().style.display = "block";
  abortController = new AbortController();

  const updateProgress = (progress: number, stage?: string): void => {
    el<HTMLSpanElement>("progressPercent").textContent = `${Math.round(progress * 100)}%`;
    el<HTMLDivElement>("progressFill").style.width = `${progress * 100}%`;
    el<HTMLDivElement>("progressStage").textContent =
      stage === "silence" ? "現在：無音区間を検出しています" : "現在：音声を読み込んでいます";
  };

  // ---- 本番経路: Premiere接続 + ネイティブWorkerで実メディアの無音解析 ----
  if (ppro && !bridgeIsMock) {
    try {
      const vIdx = Number(el<HTMLSelectElement>("videoTrackSelect").value || "0");
      const aIdx = Number(el<HTMLSelectElement>("audioTrackSelect").value || "0");
      const result = await runRealAnalysis(
        ppro as unknown as PproModule,
        bridge,
        state.currentSettings,
        vIdx,
        aIdx,
        (st) => updateProgress(st.progress, st.stage),
        abortController.signal
      );
      if (result.ok) {
        analysisContext = result.context;
        renderCandidates(result.candidates);
        const totalMs = result.candidates
          .filter((c) => c.selected)
          .reduce((s, c) => s + c.removalDurationMs, 0);
        showBanner(
          `解析完了: 無音候補 ${result.candidates.length}件 / 推定短縮 ${(totalMs / 1000).toFixed(1)}秒\n` +
          `ノイズフロア ${result.context.noiseFloorDb.toFixed(1)}dB / しきい値 ${result.context.thresholdDb.toFixed(1)}dB\n` +
          "候補を確認して「選択した候補を適用」を押してください。"
        );
      } else {
        analysisContext = null;
        showBanner(
          result.error.code === "CANCELLED"
            ? "処理をキャンセルしました。"
            : `${result.error.userMessage}\n（詳細: ${result.error.developerMessage}）`
        );
      }
    } finally {
      running = false;
      currentJobId = null;
      setControlsEnabled(true);
      $.progressArea().style.display = "none";
    }
    return;
  }

  try {
    // Mock/Premiere未接続時: Worker/ブリッジ接続テストジョブ
    void buildJobRequest;
    const request = {
      type: "test",
      jobId: `test-${Date.now()}`,
      durationMs: 3000,
      payload: "kazucut-worker-check"
    };

    const jobId = bridge.startJob(JSON.stringify(request));
    currentJobId = jobId;
    const status = await pollJob(bridge, jobId, {
      intervalMs: 120,
      signal: abortController.signal,
      onProgress: (st) => {
        el<HTMLSpanElement>("progressPercent").textContent = `${Math.round(st.progress * 100)}%`;
        el<HTMLDivElement>("progressFill").style.width = `${st.progress * 100}%`;
        el<HTMLDivElement>("progressStage").textContent =
          st.stage === "silence" ? "現在：無音区間を検出しています" : "現在：音声を読み込んでいます";
      }
    });
    if (status.state === "completed") {
      if (bridgeIsMock) {
        // Mock経路: デモ用のダミー候補を表示
        renderCandidates(demoCandidates());
        showBanner(
          "ネイティブ未接続（Mockモード）です。表示中の候補はデモ用です。\n" +
          "Windows + Premiere環境でのセットアップはSDK_SETUP_REQUIRED.mdを参照してください。"
        );
      } else {
        // 実Worker経路: 結果のechoを検証して報告（Phase 1相当の実機確認）
        let echoOk = false;
        try {
          const result = JSON.parse(bridge.getJobResult(jobId)) as { echo?: string };
          echoOk = result.echo === "kazucut-worker-check";
        } catch {
          echoOk = false;
        }
        showBanner(
          echoOk
            ? "✅ Worker接続テスト成功: KazuCutWorker.exeの起動→進捗→結果受信まで動作しました。\n" +
              "もう一度押して解析中に「キャンセル」も試してください。\n" +
              "実メディアの無音解析はこの後の統合で有効になります。"
            : "⚠️ Workerは完了しましたが結果の検証に失敗しました。"
        );
      }
    } else if (status.state === "cancelled") {
      showBanner("処理をキャンセルしました。");
    } else {
      showBanner(`エラー: ${status.error?.userMessage ?? "不明なエラー"}`);
    }
    if (currentJobId) bridge.disposeJob(currentJobId);
  } finally {
    running = false;
    currentJobId = null;
    setControlsEnabled(true);
    $.progressArea().style.display = "none";
  }
}

function demoCandidates(): CutCandidate[] {
  const make = (id: string, startMs: number, endMs: number, retained: number): CutCandidate => ({
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

/** 候補の位置へ再生ヘッドを移動（解析時と同じシーケンスの場合のみ） */
async function jumpToCandidate(c: CutCandidate): Promise<void> {
  if (!ppro || !analysisContext) return;
  try {
    const mod = ppro as unknown as PproModule;
    const project = await mod.Project.getActiveProject();
    const seq = project ? await project.getActiveSequence() : null;
    if (!project || !seq || String(seq.guid) !== analysisContext.sequenceGuid) return;
    await seq.setPlayerPosition(mod.TickTime.createWithTicks(c.sequenceStartTicks));
  } catch {
    // ジャンプ失敗は無視（表示専用機能）
  }
}

function formatTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
}

function renderCandidates(list: CutCandidate[]): void {
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
    meta.style.cursor = "pointer";
    meta.title = "クリックでこの場面へジャンプ";
    meta.addEventListener("click", () => void jumpToCandidate(c));
    meta.innerHTML =
      `<div class="time">${formatTime(approxStartMs(c))}</div>` +
      `<div>${c.reason === "filler" ? `フィラー「${c.detectedText ?? ""}」` : "無音"}</div>` +
      `<div>${(c.originalDurationMs / 1000).toFixed(2)}秒 → ${(c.retainedDurationMs / 1000).toFixed(2)}秒</div>` +
      (c.warnings.length ? `<div class="warn">${c.warnings.join(" / ")}</div>` : "");
    div.appendChild(check);
    div.appendChild(meta);
    container.appendChild(div);
  }
  updateSummary();
  const bulk = document.getElementById("bulkOps");
  if (bulk) bulk.style.display = candidates.length > 0 ? "flex" : "none";
  $.applyArea().style.display = candidates.length > 0 ? "block" : "none";
  // 実解析済み（context保持）の場合のみ適用可能
  $.applyButton().disabled = analysisContext === null;
  el<HTMLDivElement>("applySummary").textContent =
    analysisContext === null
      ? "Premiere未接続のため適用できません（候補確認のデモ表示）。"
      : `対象: V${analysisContext.videoTrackIndex + 1} / A${analysisContext.audioTrackIndex + 1} ・ ` +
        "このシーケンスを直接カットします（戻す場合はCtrl+Z） ・ 対象外トラック: 変更しません";
}

function approxStartMs(c: CutCandidate): number {
  // 表示専用の概算
  const perMs = Number(msToTicks(1));
  return Math.round(Number(c.sequenceStartTicks) / perMs);
}

function updateSummary(): void {
  const selected = candidates.filter((c) => c.selected);
  const totalMs = selected.reduce((sum, c) => sum + c.removalDurationMs, 0);
  $.summaryLine().textContent =
    candidates.length === 0
      ? ""
      : `${candidates.length}件を検出 / 選択${selected.length}件 / 推定短縮：${(totalMs / 1000).toFixed(1)}秒`;
}

function setControlsEnabled(enabled: boolean): void {
  // 実行中は設定変更禁止（仕様32章）
  const ids = [
    "scopeSelect", "videoTrackSelect", "audioTrackSelect", "presetSelect",
    "silenceEnabled", "silenceMode", "retainMs", "fillerEnabled", "outputMode",
    "analyzeButton", "applyButton", "probeButton", "mutatingProbeButton", "phase3Button"
  ];
  for (const id of ids) {
    const node = document.getElementById(id);
    if (node) (node as HTMLInputElement).disabled = !enabled;
  }
}

// ---- API Probe ----
async function saveDiagnostics(fileName: string, json: string): Promise<void> {
  const uxpModule = (globalThis as { require?: (id: string) => unknown }).require?.("uxp") as {
    storage?: { localFileSystem?: { getDataFolder?: () => Promise<unknown> } };
  };
  const dataFolder = (await uxpModule?.storage?.localFileSystem?.getDataFolder?.()) as {
    createFile?: (name: string, opts: { overwrite: boolean }) => Promise<{
      write: (data: string) => Promise<void>;
    }>;
  };
  const file = await dataFolder?.createFile?.(fileName, { overwrite: true });
  await file?.write(json);
}

async function runProbe(): Promise<void> {
  if (!ppro) {
    showBanner("Premiere未接続のためAPI Probeを実行できません。");
    return;
  }
  const results = await runApiProbe(ppro, false);
  const json = JSON.stringify(results, null, 2);
  try {
    await saveDiagnostics("api-probe.json", json);
    showBanner(`API Probe完了（${results.length}項目）。plugin-dataへ保存しました。`);
  } catch (e) {
    showBanner(`API Probe完了（${results.length}項目）。保存失敗: ${e instanceof Error ? e.message : String(e)}\n` + json.slice(0, 500));
  }
}

/** 実シーケンスのトラック一覧をドロップダウンへ反映する */
async function populateTracksFromPremiere(): Promise<void> {
  if (!ppro) return;
  try {
    const mod = ppro as unknown as PproModule;
    const project = await mod.Project.getActiveProject();
    const seq = project ? await project.getActiveSequence() : null;
    if (!project || !seq) return;
    const vSel = el<HTMLSelectElement>("videoTrackSelect");
    const aSel = el<HTMLSelectElement>("audioTrackSelect");
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
    vSel.value = String(state.lastVideoTrackIndex < vCount ? state.lastVideoTrackIndex : 0);
    aSel.value = String(state.lastAudioTrackIndex < aCount ? state.lastAudioTrackIndex : 0);
  } catch {
    // シーケンス未オープン等。解析実行時に再チェックする
  }
}

async function runPhase3Ui(): Promise<void> {
  if (!ppro) {
    showBanner("Premiere未接続のため実行できません。");
    return;
  }
  if (running) return;
  running = true;
  setControlsEnabled(false);
  const videoIdx = Number(el<HTMLSelectElement>("videoTrackSelect").value || "0");
  const audioIdx = Number(el<HTMLSelectElement>("audioTrackSelect").value || "0");
  const logs: string[] = [];
  const renderLogs = (): void => {
    showBanner(
      `500ms削除実証を実行中（V${videoIdx + 1}/A${audioIdx + 1}）...\n` + logs.slice(-8).join("\n")
    );
  };
  renderLogs();
  try {
    const results = await runPhase3Demo(ppro as unknown as PproModule, videoIdx, audioIdx, (m) => {
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
        (allOk
          ? "✅ 500ms削除実証: 全ステップ成功！\n"
          : `⚠️ 500ms削除実証: ${okCount}/${results.length}ステップ成功\n`) +
        "複製シーケンスを開いて、再生・A/V同期・BGM位置を目視確認してください。\n" +
        "plugin-dataのphase3-result.jsonを共有してください。"
      );
    } catch {
      showBanner("実証完了（保存失敗のため先頭を表示）:\n" + json.slice(0, 800));
    }
  } catch (e) {
    showBanner(`500ms削除実証でエラー: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
    setControlsEnabled(true);
  }
}

/** 選択候補をタイムラインへ適用する（Phase 7・Phase 3実証済みエンジン使用） */
async function applySelected(): Promise<void> {
  if (running) return; // 連打防止（仕様32章）
  if (!ppro || analysisContext === null) {
    showBanner("先に「解析する」を実行してください。");
    return;
  }
  const selected = candidates.filter((c) => c.selected);
  if (selected.length === 0) {
    showBanner("選択された候補がありません。");
    return;
  }
  running = true;
  setControlsEnabled(false);
  uiToSettings();
  const logs: string[] = [];
  const renderLogs = (): void => {
    showBanner(`適用中（${selected.length}件）...\n` + logs.slice(-8).join("\n"));
  };
  renderLogs();
  try {
    const summary = await applyRealEdits(
      ppro as unknown as PproModule,
      analysisContext,
      candidates,
      (m) => {
        logs.push(m);
        renderLogs();
      }
    );
    try {
      await saveDiagnostics("apply-result.json", JSON.stringify(summary.results, null, 2));
    } catch {
      logs.push("（診断結果の保存に失敗）");
    }
    if (summary.ok) {
      showBanner(
        `✅ カット完了: ${summary.cutCount ?? 0}箇所 / ${((summary.removedMs ?? 0) / 1000).toFixed(1)}秒短縮。\n` +
        "このタイムライン上でカット済みです（切れ目+マーカー「KazuCut」付き）。\n" +
        "戻す場合は Ctrl+Z を数回押してください。\n" +
        (summary.bgmOverhangMessage ? summary.bgmOverhangMessage : "")
      );
      // 適用済み候補をクリア
      analysisContext = null;
      renderCandidates([]);
      $.summaryLine().textContent = "";
    } else {
      const failed = summary.results.filter((r) => !r.succeeded).map((r) => r.apiName);
      showBanner(
        `⚠️ 適用が完了しませんでした（失敗: ${failed.join(", ")}）。\n` +
        "apply-result.jsonを共有してください。元シーケンスの保護状態も記録されています。"
      );
    }
  } catch (e) {
    showBanner(`適用でエラー: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
    setControlsEnabled(true);
  }
}

async function runMutatingProbeUi(): Promise<void> {
  if (!ppro) {
    showBanner("Premiere未接続のため変更系Probeを実行できません。");
    return;
  }
  if (running) return;
  running = true;
  setControlsEnabled(false);
  showBanner(
    "変更系Probeを実行中...\n" +
    "アクティブシーケンスを複製し、複製上でClone/Move/In-Out/削除を実験します。\n" +
    "元のシーケンスは変更しません（終了時に不変を自動検証します）。"
  );
  try {
    const results = await runMutatingProbe(ppro as never);
    results.unshift({
      apiName: "probeVersion",
      available: true,
      succeeded: true,
      notes: [`build ${BUILD_ID}`]
    });
    const json = JSON.stringify(results, null, 2);
    const okCount = results.filter((r) => r.succeeded).length;
    const intact = results.find((r) => r.apiName === "元シーケンス不変検証");
    try {
      await saveDiagnostics("api-probe-mutating.json", json);
      showBanner(
        `変更系Probe完了: ${okCount}/${results.length}項目成功。\n` +
        `元シーケンス: ${intact?.succeeded ? "不変を確認 ✓" : "⚠️ 要確認"}\n` +
        "plugin-dataのapi-probe-mutating.jsonを共有してください。"
      );
    } catch {
      showBanner(`変更系Probe完了（保存失敗のため先頭を表示）:\n` + json.slice(0, 800));
    }
  } catch (e) {
    showBanner(`変更系Probeでエラー: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
    setControlsEnabled(true);
  }
}

// ---- 初期化 ----
let initialized = false;

function init(): void {
  // DOMContentLoadedとreadyState判定の両方から呼ばれても1回だけ実行する
  if (initialized) return;
  initialized = true;

  // ビルドIDをタイトル横へ常時表示（バージョン取り違え事故の防止）
  const h1 = document.querySelector("h1");
  if (h1) {
    const span = document.createElement("span");
    span.style.cssText = "font-size:10px;color:#888;margin-left:8px;font-weight:normal;";
    span.textContent = `build ${BUILD_ID}`;
    h1.appendChild(span);
  }

  populatePresets();
  settingsToUi();
  // UXPの<select>は明示的にvalueを設定しないと未選択表示になる
  el<HTMLSelectElement>("scopeSelect").value = "selection";
  // 保存済み設定を復元してからトラック一覧を反映（トラック選択の復元に依存）
  void restoreState().then(() => populateTracksFromPremiere());
  void initBridge();
  // 設定変更の自動保存（changeイベントはパネル全体からバブルする）
  document.getElementById("scrollRoot")?.addEventListener("change", scheduleSave);

  $.presetSelect().addEventListener("change", () => {
    const name = $.presetSelect().value;
    const preset = [...builtInPresets(), ...state.customPresets].find((p) => p.name === name);
    if (preset) {
      state.currentSettings = JSON.parse(JSON.stringify(preset.settings)) as AnalysisSettings;
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
  on("selectAllButton", () => {
    for (const c of candidates) c.selected = true;
    renderCandidates([...candidates]);
  });
  on("selectNoneButton", () => {
    for (const c of candidates) c.selected = false;
    renderCandidates([...candidates]);
  });
  on("applyButton", () => {
    void applySelected();
  });
  on("savePresetButton", () => {
    uiToSettings();
    const name = `カスタム ${new Date().toLocaleString("ja-JP")}`;
    state.customPresets.push({
      name,
      builtIn: false,
      settings: JSON.parse(JSON.stringify(state.currentSettings)) as AnalysisSettings
    });
    populatePresets();
    $.presetSelect().value = name;
    scheduleSave();
  });
}

/** 初期化が失敗しても白画面にせず、エラー内容を必ず表示する */
function safeInit(): void {
  try {
    init();
  } catch (e) {
    const message = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    const div = document.createElement("div");
    div.style.cssText =
      "background:#7a1f1f;color:#fff;padding:10px;border-radius:4px;white-space:pre-wrap;margin:10px;";
    div.textContent =
      "パネル初期化エラー（このメッセージを開発者へ報告してください）:\n" + message;
    document.body.insertBefore(div, document.body.firstChild);
  }
}

window.addEventListener("error", (ev) => {
  const div = document.createElement("div");
  div.style.cssText =
    "background:#7a1f1f;color:#fff;padding:8px;border-radius:4px;white-space:pre-wrap;margin:10px;";
  div.textContent = `実行時エラー: ${ev.message} (${ev.filename ?? ""}:${ev.lineno ?? ""})`;
  document.body.insertBefore(div, document.body.firstChild);
});

document.addEventListener("DOMContentLoaded", safeInit);
if (document.readyState !== "loading") safeInit();
