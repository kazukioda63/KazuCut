# AGENTS.md — KazuCut Local 開発エージェント指示書

このリポジトリは複数のAIエージェント（Claude Code / Codex）とオーナー（kazukioda63）の
共同開発である。**作業開始前に必ずこの順で読むこと:**

1. このファイル（ルールと現在地）
2. `WORKLOG.md` — 直近の作業日誌（他エージェントが何をしたか）
3. `PROGRESS.md` — フェーズ進捗
4. `docs/HANDOFF.md` — プロジェクト全体の引き継ぎサマリー
5. 実装判断に迷ったら `docs/PRODUCT_SPEC.md`（仕様の正本）と `DECISIONS.md`

## プロダクト概要（1段落）

Adobe Premiere Pro 26.3.0 (Windows x64) 用UXP Hybrid Plugin。1人喋りショート動画の
Aロールから無音を自動検出し、開いているシーケンスを直接カット（手動のカット+
リップル削除と同じ結果）する。C++ Worker（KazuCutWorker.exe）が音声解析、
UXPパネル（TypeScript）がUI/タイムライン編集を担当。**実機で解析→適用まで動作済み。**

## 共同作業プロトコル（必須）

- **作業の最初**: `WORKLOG.md` の末尾を読み、進行中・競合しそうな作業がないか確認
- **作業の最後**: `WORKLOG.md` 末尾へ追記（形式は同ファイル冒頭のテンプレート）。
  日時 / エージェント名 / やったこと / ビルドID / 未完・注意点 を必ず書く
- 設計判断をしたら `DECISIONS.md` へ D-0xx として追記（次の番号を使う）
- フェーズが進んだら `PROGRESS.md` を更新
- コミットは日本語で「何を・なぜ」。検証してから（下記コマンド全緑）コミット
- **未検証のものを「完成」「動作確認済み」と書かない**（Mock成功≠実機成功）

## 絶対に破ってはいけない安全条件（CLAUDE.mdと同一）

1. 取り返しのつかない編集をしない（全編集はUndo可能なTransaction。適用前後の自動検証必須）
2. BGM・ガイド画像・対象外トラックを移動/削除/短縮しない（適用後に指紋比較で機械検証）
3. Aロール映像と内蔵音声のA/V同期を維持（現実装は0 tick一致を検証）
4. Premiereをクラッシュさせない（DOM操作は一括Transaction化済み。逐次大量発行に戻さない）
5. フィラー削除OFF時はTranscript確認・Whisper初期化を一切しない（spyテストで保証）
6. 完全ローカル。ネットワーク送信・テレメトリーなし
7. Workerは同梱固定EXEのみ・Shell経由起動禁止
8. TickをNumberで演算しない（`plugin/src/ticks.ts` の文字列演算を使う）
9. 非対応素材（100%速度以外/逆再生/ネスト等）は処理せず日本語で理由表示
10. 実機で確認していない機能を完成と報告しない

## 実機で確定した知見（違反すると壊れる。docs/api-probe.md に詳細）

- **DOMオブジェクトはawaitを跨いで保持しない**。毎回スキャンして取り直す
  （"The script object is no longer valid." で失効する）
- Action生成→`executeTransaction` は `project.lockedAccess()` 内で同期実行
- `createMoveAction` は**相対オフセット**（目的地−現在地を渡す）
- `createSetInPointAction` は**末尾固定の先頭トリム**（startが動く）
- TrackItem CloneでリンクAudioは複製**されない**（V/A別々に処理）
- `getSpeed()` は倍率（1.0=100%）。×100してパーセント化して使う
- `getTrackItems` は**null要素を含む**ことがある。必ず `.filter((x) => x != null)`
- `createRemoveItemsAction(selection, false, Constants.MediaType.VIDEO/AUDIO, false)` の4引数形
- Hybrid Addonのロードは `await require("kazucut-native.uxpaddon")`（**非同期**）
- 一時領域に複数Cloneを置く間隔は「元クリップ長+マージン」（10秒固定だと上書き破壊）
- 1秒 = 254,016,000,000 ticks（実測確定）
- タイムライン操作は一括Transaction（トラックあたり4回）。逐次発行はクラッシュ実績あり

## ビルド・テスト（コミット前に全部通すこと）

```bash
npm run typecheck && npm run lint && npm test      # TS（Vitest 119件）
cmake -S worker -B build/worker && cmake --build build/worker -j && build/worker/worker_tests  # C++（Catch2）
npm run build:uxp                                   # パネルバンドル（BUILD_IDが更新される）
```

Windows実機用バイナリはmingwクロスコンパイルで生成し `plugin/win/x64/` へコミットする:

```bash
cmake -S worker -B build/worker-win -DCMAKE_TOOLCHAIN_FILE=cmake/mingw-w64-x64.cmake -DKAZUCUT_BUILD_TESTS=OFF && cmake --build build/worker-win -j
cmake -S addon  -B build/addon-win  -DCMAKE_TOOLCHAIN_FILE=cmake/mingw-w64-x64.cmake && cmake --build build/addon-win -j
cp build/worker-win/KazuCutWorker.exe build/addon-win/kazucut-native.uxpaddon plugin/win/x64/
```

**mingw時は必ず静的リンク**（CMakeに設定済み。libstdc++-6.dll依存が出たらNG。
`x86_64-w64-mingw32-objdump -p <bin> | grep "DLL Name"` で確認）。

## オーナーへの配布フロー（変更したら伝えること）

- オーナーのPremiereは `C:\Users\fyros\KazuCut` のプラグインを
  UXP Developer Tool（**略語UDT禁止**。必ず正式名で書く）でLoadしている
- オーナー側の更新は次の1行（管理者不要。raw CDNの5分キャッシュはSHA解決で回避済み）:
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ('https://raw.githubusercontent.com/kazukioda63/KazuCut/claude/kazucut-local-premiere-r7craw/scripts/update-local.ps1?v=' + (Get-Random)) | iex"
  ```
- パネルのタイトルに**ビルドID**（`build 20260712T1343` 形式、`npm run build:uxp` が
  main.jsへ埋め込む）が出る。オーナーへは「build XXXX を確認して」と必ず伝える
- ネイティブバイナリ（.exe/.uxpaddon）はPremiere起動中はロックされ更新不可。
  変更した時は「Premiereを終了してから更新」と伝える

## オーナーとのコミュニケーション規約

- 日本語。開発フェーズ番号などの内部用語で説明しない（一度「は？」と返された）
- 「UDT」と略さない（明示的に禁止された）
- 手順は具体的なコピペ可能コマンドで。結果確認方法（ビルドID等）をセットで示す
- 診断情報はパネルからplugin-dataへJSON保存させ、ファイルで送ってもらう方式が確立済み

## 現在のタスクボード（詳細は PROGRESS.md / docs/HANDOFF.md）

- 直近: 複数クリップ対応（build 20260712T1343）の実機確認待ち
- 次候補: プリセット実感チューニング / フィラー削除（Premiere Transcript経由が先）/
  解析キャッシュ / CCXパッケージ化 / MSVC公式ビルド
- ブロック中: whisper.cpp実行統合（Windows検証環境の問題。BLOCKING_REPORT.md）
