# Hololive AI Quiz

兎田ぺこら・さくらみこに関する4択クイズを、Gemini APIで生成するWebアプリです。Vercel Functions上のAPIが参照ページを読み取り、構造化JSONとして問題を生成します。

> **非公式ファンメイド作品です。** カバー株式会社およびhololive productionとは関係ありません。

## 主な機能

- キャラクターと3段階の難易度を選択
- Gemini 3.1 Flash-Liteによる低遅延な問題生成
- URL Contextで公式プロフィール・非公式wikiを参照
- JSON Schemaによる構造化出力とサーバー側バリデーション
- 回答後の解説・参照元表示
- 連続正解、ベスト、正解率のローカル保存
- キーボード操作、レスポンシブ表示、`prefers-reduced-motion`対応
- 正解を生成APIのレスポンスに直接含めない構成

## 技術構成

- Frontend: HTML / CSS / Vanilla JavaScript
- Backend: Node.js / Vercel Functions
- AI: Gemini Interactions API (`gemini-3.1-flash-lite`)
- Deployment: Vercel
- Test: Node.js built-in test runner

## 処理の流れ

1. ブラウザがキャラクター・難易度を `/api/generate` に送信します。
2. APIが許可済みURLを指定し、URL ContextとJSON Schemaを使って問題を生成します。
3. APIは出力を検証し、正解情報を暗号化した短時間有効のトークンを返します。
4. 回答時に `/api/answer` がトークンを復号し、正誤・解説・参照元を返します。

この構成により、生成時のレスポンスをブラウザの開発者ツールで確認しても、正解が平文で表示されません。

## ローカル実行

### 1. リポジトリを取得

```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_REPOSITORY_NAME>
```

### 2. Vercel CLIを用意

```bash
npm install -g vercel
```

### 3. 環境変数を設定

`.env.example`を参考に、`.env.local`を作成します。

```env
GEMINI_API_KEY=your_gemini_api_key
QUIZ_SIGNING_SECRET=your_32_or_more_character_random_secret
GEMINI_MODEL=gemini-3.1-flash-lite
```

秘密文字列は、たとえば次のコマンドで生成できます。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. 起動

```bash
npm run dev
```

## Vercelへのデプロイ

Vercelのプロジェクト設定に、次のEnvironment Variablesを登録してから再デプロイします。

- `GEMINI_API_KEY`
- `QUIZ_SIGNING_SECRET`
- `GEMINI_MODEL`（省略時は`gemini-3.1-flash-lite`）

APIキーや秘密文字列はGitHubへコミットしないでください。

## テストと静的チェック

```bash
npm run check
npm test
```

## API

### `POST /api/generate`

Request:

```json
{
  "mode": "easy",
  "character": "pekora",
  "excludeQuestions": ["直近に出題された問題文"]
}
```

Response:

```json
{
  "question": "問題文",
  "choices": ["A", "B", "C", "D"],
  "answerToken": "encrypted-token",
  "expiresAt": 0,
  "requestId": "..."
}
```

### `POST /api/answer`

Request:

```json
{
  "selectedIndex": 0,
  "answerToken": "encrypted-token"
}
```

Response:

```json
{
  "correct": true,
  "correctIndex": 0,
  "explanation": "正解の根拠",
  "sources": [{ "title": "参照元", "url": "https://..." }],
  "requestId": "..."
}
```

## 設計上の判断

### 出典の制限

プロンプトにURLを書くのみでは、モデルが実際にページを読んだ保証になりません。本アプリではGeminiのURL Contextを有効にし、参照先をキャラクターごとにサーバー側で固定しています。

### 構造化出力

問題・選択肢・正解・解説をJSON Schemaで制約し、さらにアプリ側でも文字数、選択肢数、重複、正解との一致を検証します。

### 正解情報の扱い

生成APIは正解を平文で返さず、AES-256-GCMで暗号化した回答トークンを返します。これはカジュアルな不正防止を目的としたもので、競技用途を想定した完全なチート対策ではありません。

## 今後の改善候補

- キャラクター追加と参照URL管理の外部データ化
- 永続的なレート制限と利用量監視
- 出題品質を確認する自動評価・回帰テスト
- PWA対応とオフライン用の固定問題セット

## 注意事項

生成AIの性質上、参照元を指定しても誤りや曖昧な出題が発生する可能性があります。公開運用では、API利用量・料金・レート制限をGoogle AI StudioおよびVercel側でも監視してください。
