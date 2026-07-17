# WORKLOG — 共有作業日誌

Claude / Codex / オーナーの共有ログ。**全エージェントは作業開始時に末尾を読み、
作業終了時に末尾へ追記すること**（AGENTS.mdのプロトコル）。

テンプレート:

```
## YYYY-MM-DD HH:MM (エージェント名)
- やったこと: （1〜5行。コミットハッシュがあれば添える）
- ビルドID: （plugin/dist/main.jsを再ビルドした場合。例 20260712T1343）
- 未完・注意: （引き継ぎ事項。無ければ「なし」）
```

---

## 2026-07-11〜12 (Claude Code) 初期開発の要約

- Phase 0-2: 仕様固定（PRODUCT_SPEC/ADR-001〜006）、TSコア+テスト119件、
  C++ Worker（無音検出/WAV・MFデコーダ/JSON Lines IPC）+Catch2 25件、
  Hybrid Addon（CreateProcessW+Job Object）。UXP SDKヘッダーをベンダリングし
  mingw静的リンクでWindowsバイナリを生成・同梱（ビルド不要セットアップ確立）
- 実機調査: API Probe読取系/変更系を完遂。Tick分解能・Move相対・SetIn末尾固定トリム・
  Clone非連動・MediaType定数などを確定（docs/api-probe.md）
- Phase 3: 500ms削除実証が実機で全9ステップ成功（A/V同期0tick）→ ADR-003 Accepted
- Phase 4-7統合: 実素材の無音解析（34候補）→適用が実機成功。
  クラッシュ対策で一括Transaction化（トラック4Tx）
- D-020仕様改定（オーナー決定）: 直接編集のみ・カット位置マーカー・Ctrl+Z復元
- UX: 設定のplugin-data永続化 / 候補クリックでジャンプ / 一括選択 /
  「対象」実装（選択クリップ/トラック全体・複数クリップ+累積左詰め）
- 配布: scripts/update-local.ps1（SHA解決でCDNキャッシュ回避・ログをデスクトップへ）

## 2026-07-12 (Claude Code)
- やったこと: 共同作業体制の構築（AGENTS.md / docs/HANDOFF.md / WORKLOG.md 新設、
  CLAUDE.mdへプロトコル追記）
- ビルドID: 20260712T1343（コード変更なし）
- 未完・注意: 複数クリップ対応（build 20260712T1343）の実機確認がまだ。
  オーナーの視聴フィードバック（切りすぎ/残しすぎ）待ち → プリセット調整に使う

## 2026-07-17 13:30 (Claude Code)
- やったこと: 1コマ分の空白バグ修正（D-021）。無音カット境界をシーケンスの
  フレーム境界へ安全側に丸める frameQuantizer.ts / frameGrid.ts を新設し、
  keepSegmentPlanner / buildEditPlan / applyRealEdits へ配線。テスト13件追加（計132件）
- ビルドID: 20260717T1329
- 未完・注意: フレームレート取得API（Sequence.getTimebase / getSettings）は実機未検証。
  取得失敗時は丸めなしで続行し apply-result.json の「フレーム境界の取得」noteに理由が残る。
  オーナーの実機確認待ち（複数クリップ対応 build 20260712T1343 の確認も引き続き未了）

## 2026-07-17 13:52 (Claude Code)
- やったこと: UX改善（オーナー要望）。①「解析と適用（おまかせ）」ボタン新設
  （解析成功+候補ありなら自動で適用まで実行。失敗/候補0件なら止まる）
  ②対象の初期値を「Aロールトラック全体」へ ③設定類を「⚙ 設定」開閉へ集約、
  診断ボタンは「🔧 診断ツール」開閉へ移動し、ボタンをパネル最上部に配置
- ビルドID: 20260717T1351
- 未完・注意: 実機確認待ち（フレーム量子化 D-021 も同ビルドで確認可能）
