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
