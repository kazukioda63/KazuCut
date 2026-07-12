# KazuCut Local — 開発ガイド

Adobe Premiere Pro 26.3.0 (Windows x64) 用 UXP Hybrid Plugin。
1人喋りショート動画のAロールから無音・フィラーを安全に自動カットする。

仕様の正本: `docs/PRODUCT_SPEC.md`（実装判断はすべてこのファイルに従う）
進捗管理: `PROGRESS.md`（各フェーズ終了時・エラー時・中断前に必ず更新）
決定記録: `DECISIONS.md` と `docs/adr/`

## 絶対に破ってはいけない安全条件

1. 取り返しのつかない編集をしない（編集は必ずUndo可能なTransactionのみ。適用前後の自動検証必須。D-020により複製/バックアップ方式は廃止、直接編集+Ctrl+Z復元が正）
2. BGM・ガイド画像・対象外トラックを移動/削除/短縮しない（トラックロックを安全根拠にしない）
3. Aロール映像と内蔵音声のA/V同期を維持する（許容: 映像1フレーム未満）
4. Premiere本体をクラッシュさせない（Native例外は必ず境界で捕捉）
5. フィラー削除OFF時はTranscript確認・Whisper初期化・フィラー解析を一切実行しない
6. 完全ローカル処理。ネットワーク送信・テレメトリー・APIキーなし
7. 任意のユーザー指定EXEを起動しない。Workerは同梱固定EXEのみ、Shell経由禁止
8. TickをNumberだけで扱わない（Premiere境界はTick文字列、Native側は64bit整数）
9. 100%速度以外・逆再生・ネスト・マルチカム・A/Vペア曖昧な素材は処理せず日本語で理由表示
10. 実機で確認していない機能を「完成」と報告しない

## 使用技術

- UXP Panel: TypeScript (strict) + esbuild, Manifest v6
- Hybrid Addon: C++20 / UXP Hybrid Plugin SDK (Windows x64)
- Worker: C++20 単発プロセス `KazuCutWorker.exe`, Media Foundation, whisper.cpp(任意), JSON Lines IPC
- テスト: Vitest (TS), Catch2 (C++)
- ビルド: npm + CMake + PowerShell scripts (`scripts/`)

## 作業フェーズ

Phase 0 環境/仕様固定 → 1 Addon/Worker最小実証 → 2 API Probe → 3 500ms削除実証 →
4 MF音声デコード → 5 無音検出 → 6 候補UI → 7 本番適用 → 8 Premiere Transcript →
9 whisper.cpp → 10 プリセット/キャッシュ/ログ/エラー → 11 実機試験/配布/README/最終報告

各Phase終了時: テスト → ビルド → PROGRESS.md更新 → DECISIONS.md更新 → 安定ならcommit。

## テスト・ビルドの必須条件

- `npm run typecheck` / `npm run lint` / `npm test` が全て成功してからコミット
- C++コア(移植可能部)は Linux でも `cmake --build` + ctest が通ること
- Windows専用部(MF/Addon)はWindows実機でのみビルド検証。未検証は未検証と明記
- Mock成功をPremiere実機成功と報告しない

## 共同作業プロトコル（Codexと共有）

本リポジトリはCodexとの共同開発。`AGENTS.md`（Codex用指示書・同内容のルール）と
`WORKLOG.md`（共有作業日誌）を運用する。
**作業開始時にWORKLOG.md末尾を読み、終了時に必ず追記**（日時/エージェント名/
やったこと/ビルドID/未完・注意）。全体像の引き継ぎは `docs/HANDOFF.md`。

## 開発環境の注意

現在のCI/開発コンテナはLinuxのため、Windowsビルド・Premiere実機・Hybrid SDKは利用不可。
Windows側の手順は `SDK_SETUP_REQUIRED.md` と `MANUAL_TEST_CHECKLIST.md` を参照。
