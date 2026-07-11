#!/usr/bin/env node
/**
 * 実素材評価（仕様34章）。
 * 使い方:
 *   node tools/evaluate/evaluate.mjs <正解区間.json> <KazuCut結果.json> [Premiere標準結果.json]
 *
 * 入力JSON形式（どちらも）: { "intervals": [{ "startMs": n, "endMs": n }], "label": "..." }
 * 出力: tools/evaluate/out/report.csv / report.html
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BOUNDARY_TOLERANCE_MS = 100;

function load(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw.intervals)) throw new Error(`${path}: intervals配列がありません`);
  return {
    label: raw.label ?? path,
    intervals: raw.intervals
      .map((iv) => ({ startMs: Number(iv.startMs), endMs: Number(iv.endMs) }))
      .sort((a, b) => a.startMs - b.startMs)
  };
}

function overlapMs(a, b) {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

function evaluate(truth, pred) {
  let tp = 0, fp = 0;
  const matchedTruth = new Set();
  const boundaryErrors = [];
  for (const p of pred.intervals) {
    const match = truth.intervals.find(
      (t) => overlapMs(t, p) > 0.5 * Math.min(t.endMs - t.startMs, p.endMs - p.startMs)
    );
    if (match) {
      tp++;
      matchedTruth.add(match);
      boundaryErrors.push(Math.abs(match.startMs - p.startMs));
      boundaryErrors.push(Math.abs(match.endMs - p.endMs));
    } else {
      fp++;
    }
  }
  const fn = truth.intervals.length - matchedTruth.size;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const totalRemovalMs = pred.intervals.reduce((s, iv) => s + (iv.endMs - iv.startMs), 0);
  const meanBoundaryErrorMs =
    boundaryErrors.length > 0
      ? boundaryErrors.reduce((a, b) => a + b, 0) / boundaryErrors.length
      : null;
  const withinTolerance =
    boundaryErrors.length > 0
      ? boundaryErrors.filter((e) => e <= BOUNDARY_TOLERANCE_MS).length / boundaryErrors.length
      : null;
  return { label: pred.label, tp, fp, fn, precision, recall, f1, totalRemovalMs, meanBoundaryErrorMs, withinTolerance };
}

const [truthPath, ...predPaths] = process.argv.slice(2);
if (!truthPath || predPaths.length === 0) {
  console.error("使い方: node evaluate.mjs <正解.json> <結果1.json> [結果2.json...]");
  process.exit(1);
}
const truth = load(truthPath);
const rows = predPaths.map((p) => evaluate(truth, load(p)));

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const header = "label,tp,fp,fn,precision,recall,f1,totalRemovalMs,meanBoundaryErrorMs,boundaryWithin100ms";
const csv = [header, ...rows.map((r) =>
  [r.label, r.tp, r.fp, r.fn, r.precision.toFixed(3), r.recall.toFixed(3), r.f1.toFixed(3),
   r.totalRemovalMs, r.meanBoundaryErrorMs?.toFixed(1) ?? "", r.withinTolerance?.toFixed(3) ?? ""].join(","))
].join("\n");
writeFileSync(join(outDir, "report.csv"), csv);

const html = `<!DOCTYPE html><html lang="ja"><meta charset="utf-8"><title>KazuCut評価レポート</title>
<style>body{font-family:sans-serif;margin:20px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px 10px}</style>
<h1>KazuCut 検出評価</h1>
<p>正解: ${truth.label}（${truth.intervals.length}区間） / 一致判定: 重なり50%超 / 境界許容: ${BOUNDARY_TOLERANCE_MS}ms</p>
<table><tr><th>結果</th><th>TP</th><th>FP(誤検出)</th><th>FN(見逃し)</th><th>Precision</th><th>Recall</th><th>F1</th><th>総短縮(ms)</th><th>境界誤差平均(ms)</th></tr>
${rows.map((r) => `<tr><td>${r.label}</td><td>${r.tp}</td><td>${r.fp}</td><td>${r.fn}</td><td>${r.precision.toFixed(3)}</td><td>${r.recall.toFixed(3)}</td><td>${r.f1.toFixed(3)}</td><td>${r.totalRemovalMs}</td><td>${r.meanBoundaryErrorMs?.toFixed(1) ?? "-"}</td></tr>`).join("")}
</table></html>`;
writeFileSync(join(outDir, "report.html"), html);

console.log(csv);
console.log(`\n出力: ${join(outDir, "report.csv")} / report.html`);
