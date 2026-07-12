# HANDOFF — プロジェクト全体サマリー（2026-07-12時点）

新しく参加するエージェント向けの引き継ぎ文書。ルールは `AGENTS.md`、
仕様の正本は `docs/PRODUCT_SPEC.md`、日々の動きは `WORKLOG.md`。

## 何ができているか（実機 = オーナーのWindows + Premiere Pro 26.3.0で確認済み）

| 機能 | 状態 |
|---|---|
| パネル表示・日本語UI・スクロール・ビルドID表示 | ✅ 実機 |
| Hybrid Addonロード（`await require`・静的リンクmingwビルド） | ✅ 実機 |
| Worker検出（Addonがパス解決） | ✅ 実機 |
| 実メディア無音解析（Media Foundationデコード→C++無音検出→34候補検出実績） | ✅ 実機 |
| 候補リスト（選択/解除・時刻クリックでジャンプ・一括選択） | ✅ 実装（ジャンプは実機未報告） |
| 直接編集適用（Clone→トリム→削除→左詰めの一括Transaction） | ✅ 実機（単一クリップ・34候補30秒短縮） |
| 適用後検証（配置・A/V同期0tick・対象外トラック指紋・マーカー付与） | ✅ 実機 |
| 設定・プリセットのplugin-data永続化 | ✅ 実装（実機未報告） |
| 複数クリップ対応（トラック全体/選択クリップ+後続左詰め） | ⚠️ 実装済み・**実機未確認**（build 20260712T1343） |
| Workerキャンセル・強制終了・Premiere終了時の孤児防止 | ⚠️ Linuxでは実証済み・実機未確認（チェックリスト3,4,22） |
| フィラー削除 | ❌ 未配線（部品は完成、下記） |
| 解析キャッシュ・ログ・CCXパッケージ | ❌ 未着手 |

## アーキテクチャ（決定済み・ADR-001/003）

```
UXPパネル(TS, plugin/) ── await require ──> Hybrid Addon(C++, addon/)
     │                                            │ CreateProcessW + Job Object
     │ Premiere DOM操作(uxpTimeline.ts)           ▼
     └─ タイムライン編集・検証              KazuCutWorker.exe(C++, worker/)
                                            stdin/stdout JSON Lines
                                            MFデコード→無音検出
```

- 時間表現: Tick文字列（`plugin/src/ticks.ts`、BigInt非依存の10進文字列演算）
- タイムライン再構築: 戦略A（TrackItem Clone, isInsert=false）を実機採用
- 出力: **直接編集のみ**（D-020。複製シーケンス/バックアップは廃止。Ctrl+Z復元）

## 主要ファイル地図

```
plugin/src/
  main.ts                 パネル制御（解析/適用/設定保存/バナー）
  ticks.ts                Tick文字列演算（触るならテスト必須）
  premiere/
    uxpTimeline.ts        実機タイムライン操作の心臓部（実機知見の塊。慎重に）
    realAnalysis.ts       解析→候補化→適用のオーケストレーション（複数クリップ対応）
    pproTypes.ts          Premiere UXP APIの型（実測ベース）
    avPairResolver.ts     A/Vペア解決・非対応素材検査
    apiProbe.ts / mutatingProbe.ts / phase3Demo.ts   実機調査ツール（パネルのボタン）
  analysis/               候補統合・Keep Segment・編集計画（純ロジック、全てテスト済み）
  transcript/             フィラー用（正規化・辞書照合・防御的パーサ。未配線）
  state/                  プリセット・設定永続化
  native/                 Addonブリッジ・ジョブポーリング・Mock
worker/                   C++（無音検出エンジン/WAV・MFデコーダ/JSON Lines）
addon/                    C++（CreateProcessW+Job Object+UXPバインディング）
scripts/update-local.ps1  オーナーPCの更新スクリプト（SHA解決でCDNキャッシュ回避）
cmake/mingw-w64-x64.cmake Windowsクロスビルド用
tests/                    Vitest 119件 + premiere-mocks / worker/tests Catch2 25件
```

## 実機で踏んだ地雷（再発防止。詳細: docs/api-probe.md, DECISIONS.md D-012〜D-020）

1. DOM参照のawait跨ぎ保持 → 失効クラッシュ。毎回再スキャン
2. Action生成はlockedAccess内
3. Move=相対 / SetIn=末尾固定トリム / CloneはリンクAudio非複製 / getSpeed=倍率
4. getTrackItemsのnull混入
5. 逐次Transaction大量発行 → Premiereクラッシュ。一括バッチ（トラック4 Tx）へ
6. 一時領域のClone間隔不足 → 上書き破壊
7. mingw動的リンク → libstdc++-6.dll不在でAddonロード失敗。静的リンク必須
8. raw.githubusercontent.comの5分キャッシュ → 更新スクリプトはコミットSHA解決
9. UXPのrequire(addon)は非同期
10. Undo可能性のため各操作は名前付きTransaction（"KazuCut Local：..."）

## 未実装の設計方針（着手する人へ）

- **フィラー削除**: 入口は `analysisController.acquireTranscript`（テスト済み）。
  優先順位はPremiere Transcript→whisper.cpp。Transcript JSONの実Schemaが未採取なので、
  最初の仕事は実機で `Transcript.exportToJSON` 相当のProbe（mutatingProbeに雛形あり）。
  フィラーOFF時に一切動かない保証（spyテスト）を壊さないこと
- **キャッシュ**: キーは `plugin/src/cache/cacheKey.ts`（テスト済み）。Worker側の
  結果保存先はplugin-dataかWorker側ファイルか未決定 → DECISIONSへ
- **CCX化**: UXP Developer ToolのPackage機能を使う（独自ZIP禁止・仕様35章）。
  CCX内からのWorker起動可否は未検証の残リスク（ADR-001の注意点）
- **MSVC公式ビルド**: scripts/build-*.ps1 は用意済み・実行未検証

## オーナー（kazukioda63 / 動画クリエイター・非エンジニア）

- 説明は日本語・具体的コピペ手順・内部用語なし・「UDT」禁止（UXP Developer Toolと書く）
- 更新: AGENTS.md記載の1行コマンド → UXP Developer ToolでReload → ビルドID確認
- 診断: パネルのボタン→plugin-dataのJSON（api-probe*.json / apply-result.json）を
  チャットに添付してもらう運用が確立済み
- plugin-dataの場所: `%APPDATA%\Adobe\UXP\PluginsStorage\PPRO\26\Developer\com.kazu.premiere.kazucutlocal\PluginData\`
