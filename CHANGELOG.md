# CHANGELOG

## 0.1.0 (開発中・未リリース)

- 初期実装
  - UXPパネル（日本語UI、プリセット、候補確認、Mock/実機自動判別）
  - 無音検出エンジン（自動しきい値、ヒステリシス、VAD、小声保護）
  - Keep Segment方式のタイムライン再構築（戦略A、Mock検証済み）
  - 対象外トラックSnapshot保護、A/V同期検証、直接編集バックアップ
  - KazuCutWorker（ジョブ1件=プロセス1件、JSON Lines IPC、協調キャンセル）
  - Hybrid Addonソース（CreateProcessW+Job Object、SDK未取得のため未ビルド）
  - フィラー検出基盤（辞書・正規化・Provider抽象。実行は初期値OFF）
- 未検証: Premiere実機・Media Foundation・Hybrid Addonビルド（FINAL_REPORT.md参照）
