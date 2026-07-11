// UXPパネルのバンドル（esbuild）。plugin/src/main.ts → plugin/dist/main.js
import { build } from "esbuild";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "plugin/src/main.ts")],
  outfile: join(root, "plugin/dist/main.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  // UXPのrequire("premierepro")等は実行時解決
  external: ["premierepro", "uxp", "kazucut-native.uxpaddon"],
  logLevel: "info"
});

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
