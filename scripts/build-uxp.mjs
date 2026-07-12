// UXPパネルのバンドル（esbuild）。plugin/src/main.ts → plugin/dist/main.js
import { build } from "esbuild";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const buildId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13); // 例: 20260712T0930

await build({
  entryPoints: [join(root, "plugin/src/main.ts")],
  outfile: join(root, "plugin/dist/main.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  // UXPのrequire("premierepro")等は実行時解決
  external: ["premierepro", "uxp", "kazucut-native.uxpaddon"],
  define: { __KAZUCUT_BUILD__: JSON.stringify(buildId) },
  logLevel: "info"
});
console.log(`BUILD_ID: ${buildId}`);

// アイコンのプレースホルダ（実配布時に差し替え）
const iconDir = join(root, "plugin/icons");
mkdirSync(iconDir, { recursive: true });
const iconPath = join(iconDir, "icon.png");
if (!existsSync(iconPath)) {
  // 23x23 の単色PNG（最小限のプレースホルダ）
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABcAAAAXCAYAAADgKtSgAAAAKklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCGgAADqYAAXHhL/kAAAAASUVORK5CYII=",
    "base64"
  );
  writeFileSync(iconPath, png);
}
console.log("UXP build完了: plugin/dist/main.js");
