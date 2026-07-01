# affi-note-threads

LP（ランディングページ）の全文を貼るだけで、**note記事**と**Threads投稿**を生成する、汎用アフィリエイト記事ジェネレーター。
どの分野の案件でも、LPを貼り替えるだけで使い回せます。Vercel公開・BYO-key方式。

## 特徴

- **LP全文が唯一の元ネタ** — LPを差し替えれば別案件にそのまま対応
- **4つの生成モード**
  - noteメイン記事（自己紹介込み・冒頭/末尾にLPリンク）
  - note日常記事（メイン記事へ回遊させる軽い読み物）
  - Threads投稿（5本一括・URLなし・心理学hook＋逆説）
  - Threadsピン止め（プロフィール固定用・3連投の叩き台）
- **チェーンプロンプト** — LP分析 → 設計込み生成 →（任意）自己レビュー。一撃生成しない
- **BYO-key** — ユーザー各自のGemini無料APIキーを使用。サーバーにキーを保存しない
- **投稿は手動コピペ** — ワンクリックコピー。自動投稿はしない

## 動線の考え方

```
Threads（短文・回遊／URLなし・プロフ or 検索で誘導）
   ↓
note メイン記事（じっくり読ませる／冒頭・末尾にLPリンク）
   ↓
LP（セミナー登録などの最終ゴール）
```

## ⚠️ 生成物は必ず手直しを

Geminiの無料モデルを使用しているため、AI生成特有の文脈の不自然さが出ることがあります。
生成結果は**叩き台**として、お使いのAI（ChatGPT / Claude など）も活用しながら、ご自身の言葉で仕上げてください。
特にピン止め投稿は、しっかりリサーチして書くのがベストです（本ツールの出力は参考レベル）。

## ローカル実行

```bash
npm install
npm run dev
# http://localhost:3000
```

Gemini APIキーは [Google AI Studio](https://aistudio.google.com/app/apikey) で無料取得できます。

## Vercelデプロイ

GitHubに push → Vercelでインポートするだけ。環境変数は不要（キーは利用者が画面で入力）。

## 構成

```
app/
  page.tsx              メインUI（入力・生成・コピー）
  api/generate/route.ts チェーン生成API（Edge Runtime）
lib/
  gemini.ts             Gemini REST ラッパー
  prompts.ts            LP分析・各モードのプロンプト
```
