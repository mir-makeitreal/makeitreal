[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [中文](README.zh.md)

# Make It Real

**Make It Simple. Make It Work. Make It Real.**

*プロダクトのドキュメントを先に書く。Claude Codeが仕様通りに実装する。*

<p align="center">
  <img src="https://img.shields.io/badge/tests-424-brightgreen" alt="424 tests" />
  <img src="https://img.shields.io/badge/dependencies-0-lightgrey" alt="zero deps" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node" />
</p>

<p align="center">
  <a href="#60秒で試す">試してみる</a> •
  <a href="#beforeafter">Before / After</a> •
  <a href="#どう動くのか">仕組み</a> •
  <a href="docs/README.md">ドキュメント</a>
</p>

---

## 60秒で試す

インストール不要。リポジトリをクローンしてデモを実行するだけです：

```bash
git clone https://github.com/mir-makeitreal/makeitreal && cd makeitreal
node bin/harness.mjs demo rest-api --pretty
```

PRD・コントラクト・作業項目 DAG・ダッシュボード HTML を含む完全な Blueprint が一時ディレクトリに生成されます。ダッシュボードを開いて確認してください：

```bash
# runDir はデモ出力に表示されます
open <runDir>/preview/index.html
```

Claude Code 内であれば、同じことが一行で済みます：

```
/mir:demo rest-api
```

テンプレートは 3 種類：`todo-app`（シンプル）・`rest-api`（中規模）・`auth-system`（複雑）。

---

## Docs First という考え方

> 「プロダクトのドキュメントを先に書く。それから Make It Real。」

これは単なる「Blueprint ファーストの Claude Code プラグイン」ではありません。もっと大きな思想です。

**PM・アーキテクト・エンジニアが同じ言語で話す。**

従来の開発では、要件定義書・設計書・実装が別々の場所に存在し、いつの間にかズレていきます。Make It Real では、ドキュメントが唯一の真実です。コードはドキュメントに従い、ドキュメントがコードに従うことは決してありません。

| 原則 | 意味 |
|------|------|
| **仕様 = テスト** | OpenAPI コントラクトと型付きインターフェースはそのまま適合性テストになります。テストが通れば、仕様を満たしていることが機械的に証明されます。 |
| **コントラクト = インターフェース** | モジュール境界は「ドキュメント」ではなく「実行可能な制約」です。サブエージェントはコントラクトに対して実装します。 |
| **承認なし = 実装なし** | Blueprint を承認するまでコードは一行も書かれません。承認にはフィンガープリントが付き、成果物が変われば再承認が必要です。 |

この哲学の詳細：[コンセプト: Blueprints](docs/concepts/blueprints.md) · [コンセプト: Contracts](docs/concepts/contracts.md)

---

## Before / After

4 モジュール構成の認証システムを Claude Code に作らせると、何が変わるか：

|  | Make It Real なし | Make It Real あり |
|---|---|---|
| **計画** | すぐにコーディングを始める | モジュール境界・コントラクト・依存グラフを含む Blueprint を生成。コードが書かれる前にレビューと承認を行う。 |
| **境界** | 1 つのエージェントがすべてに触れる。Auth が DB 層に侵入する。 | 各サブエージェントは `allowedPaths` を持ち、自分のモジュール外のファイルを物理的に編集できない。 |
| **コントラクト** | 最後にモジュールがうまく合うことを祈る | OpenAPI スペックと型付きインターフェースを実装前に凍結。サブエージェントはそれに対して実装する。 |
| **並列性** | 逐次実行、または手動で `Task` ツールを呼ぶ | クレーム・リース・リトライ付きの DAG スケジュール済みサブエージェント。 |
| **統合** | 「自分のブランチでは動く」→ マージコンフリクト | コントラクト適合テストが通る → 統合はすでに証明済み。 |
| **証拠** | 「たぶん完成してると思います」 | 各作業項目に構造化された検証エビデンス。証明が存在するまでゲートが「完了」をブロックする。 |

---

## どう動くのか

```mermaid
flowchart LR
    A["あなたのリクエスト"] --> B["Blueprint"]
    B --> C["コントラクト凍結"]
    C --> D["作業項目 DAG"]
    D --> E1["エージェント 1"]
    D --> E2["エージェント 2"]
    D --> E3["エージェント 3"]
    E1 --> F["検証済み ✓"]
    E2 --> F
    E3 --> F
```

1. **やりたいことを書く。** 一文で十分です。
2. **エンジンが Blueprint を生成する。** PRD・アーキテクチャ・モジュールインターフェース・OpenAPI コントラクト・責任境界・作業項目 DAG — すべてコードの前に生成・検証されます。
3. **あなたが承認する。** Blueprint をレビューし、変更を求めるか、却下できます。承認はフィンガープリント付き — 成果物が変更されると、ゲートは再承認があるまでブロックします。
4. **サブエージェントが並列でビルドする。** 各エージェントは 1 つの責任単位を担当し、凍結されたコントラクトに対して実装し、宣言されたファイルパスにしか触れられません。
5. **ゲートが完了を強制する。** Ready ゲートは Blueprint が健全になるまでローンチをブロック。Done ゲートは検証エビデンスが存在するまで完了をブロック。自己申告の「完了」はありません。

詳細なパイプラインのウォークスルー：[How It Works](docs/how-it-works.md)

---

## 3 つのコマンド

| コマンド | 役割 |
|---------|------|
| `/mir:plan "あなたのリクエスト"` | リクエストから Blueprint を生成。インラインでレビューと承認を行う。 |
| `/mir:launch` | 承認済み Blueprint を実行 — DAG 順にサブエージェントをディスパッチする。 |
| `/mir:status` | 現在のフェーズ・作業項目の状態・ブロッカー・ダッシュボード URL。 |

これがコアループです：**plan → launch → status**。

パワーユーザー向けの追加コマンドについては [コマンドリファレンス](docs/command-reference.md) を参照。

すべての `/mir:` コマンドには `/makeitreal:` という長い形式の等価コマンドがあります。

---

## 生成されるもの

```
.makeitreal/runs/<run-id>/
├── prd.json                    # ゴール・受け入れ基準・非ゴール
├── design-pack.json            # アーキテクチャトポロジー・API・境界
├── responsibility-units.json   # allowedPaths 付き所有権境界
├── work-item-dag.json          # コントラクトエッジ付き依存グラフ
├── blueprint-review.json       # フィンガープリント付き承認状態
├── contracts/                  # 凍結されたインターフェース仕様
│   ├── *.openapi.json          #   例付き OpenAPI 3.x
│   └── *.json                  #   モジュールサーフェスシグネチャ
├── work-items/                 # 検証コマンド付き項目別タスク
├── evidence/                   # 検証 + wiki 同期エビデンス
├── preview/                    # ダッシュボード HTML
└── board.json                  # 全作業項目の Kanban 状態
```

---

## なぜ機能するのか

**424 テスト。依存関係ゼロ。**

エンジンは純粋な Node.js バリデーションロジックです — ネットワーク呼び出しなし、API キーなし、外部サービスなし。Claude Code のランタイム内で動作します。

**コントラクトはドキュメントではありません。** 機械検証可能なインターフェース仕様（OpenAPI 3.x + 型付きモジュールサーフェス）であり、適合性テストを生成します。サブエージェントのテストが通れば、コントラクトを正しく実装していることが証明されます。統合は別フェーズではなく、コントラクト適合の副産物として得られます。

**パス境界は提案ではありません。** エンジンは、サブエージェントが `allowedPaths` 外のファイルに触れていないことを検証します。`src/auth/**` に割り当てられたエージェントが `src/database/schema.ts` を編集すると、検証は失敗します。

詳細：[Contracts](docs/concepts/contracts.md) · [Responsibility Units](docs/concepts/responsibility-units.md) · [Blueprints](docs/concepts/blueprints.md)

---

## 要件

- Claude Code（最新版）
- Node.js ≥ 20

---

## 他のツールとの比較

|  | Make It Real | Vanilla Claude Code | Superpowers | Spec Kit | GSD |
|---|:---:|:---:|:---:|:---:|:---:|
| コードの前にアーキテクチャ | ✅ | ❌ | ✅ | ✅ | ✅ |
| 機械検証可能なコントラクト | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| DAG スケジュール並列エージェント | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| パス境界の強制 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 品質ゲート（エンジン強制） | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| インタラクティブダッシュボード | ✅ | ❌ | ❌ | ❌ | ❌ |
| ランタイム依存関係ゼロ | ✅ | ✅ | ✅ | ❌ | ⚠️ |

各ツールが勝る点・負ける点の正直な比較：[docs/comparison.md](docs/comparison.md)

---

## コントリビューション

バグを発見した？アイデアがある？[Issue を開く](https://github.com/mir-makeitreal/makeitreal/issues)。

```bash
git clone https://github.com/mir-makeitreal/makeitreal && cd makeitreal
node --test          # 424 テストをすべて実行、約 12 秒
```

ビルドステップなし。インストールする依存関係なし。クローンしてテストするだけ。

---

## ライセンス

MIT — [LICENSE](LICENSE) 参照。

---

<p align="center">
  <a href="docs/getting-started.md"><strong>はじめる →</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="docs/README.md">ドキュメントを読む</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/mir-makeitreal/makeitreal/issues">Issue を報告する</a>
</p>
