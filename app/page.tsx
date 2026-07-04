"use client";

import { useEffect, useState } from "react";

type GenerateMode = "note" | "threads" | "threads-pin";

type ThreadItem = { no: number; type?: string; role?: string; hook?: string; body: string; hasCta?: boolean };
type NoteResult = { title: string; body: string; tags: string[] };
type Angle = { id: number; theme: string; angle: string; whoFor: string; value: string };
type Analysis = {
  target: string;
  painPoints: string[];
  benefits: string[];
  uniqueAngle: string;
  goal: string;
  tone: string;
  genre: string;
  searchKeywords: string[];
};

const MODE_LABEL: Record<GenerateMode, string> = {
  note: "note記事をつくる",
  threads: "Threads投稿 5本",
  "threads-pin": "Threadsピン止め 3連投",
};

// 毎回ランダムで振る「今日の切り口」プール
const ANGLE_POOL = [
  "最近ふと気づいた小さなこと",
  "多くの人がやりがちな勘違い・失敗",
  "読者への問いかけから入る",
  "自分が見聞きした体験・しくじり談",
  "意外な事実／常識の逆を突く",
  "ビフォーアフターの比較",
  "あるあるネタ",
  "数字・データから入る",
  "たとえ話・比喩で説明する",
  "今の季節や時期の話題にからめる",
  "一番伝えたい本音をズバッと言う",
  "初心者がつまずくポイントを先回り",
];
const TIMEFRAMES: Record<string, string> = {
  random: "",
  past: "過去を振り返る視点で（これまでの経験・失敗・変化を語る）",
  now: "今この瞬間・最近の出来事の視点で",
  trend: "これから・未来予測・最新トレンドの視点で",
};
const TIMEFRAME_LABELS: { key: string; label: string }[] = [
  { key: "random", label: "🎲 おまかせ（ランダム）" },
  { key: "past", label: "過去をふり返る" },
  { key: "now", label: "今・最近" },
  { key: "trend", label: "これから・トレンド" },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// レスポンスを安全に読む。JSONでない本文（Vercelのタイムアウト/エラーページ等）が
// 返ってきても、暗号のような "Unexpected token" ではなく人間に読める文言にする。
async function readResult<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const raw = await res.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    data = null;
  }
  if (!res.ok || data === null) {
    const msg =
      (data as { error?: string } | null)?.error ??
      (res.status === 504 || res.status === 502 || res.status === 500
        ? "サーバーが混雑またはタイムアウトしました。少し時間をおいて、もう一度お試しください。"
        : `通信に失敗しました（${res.status}）。もう一度お試しください。`);
    throw new Error(msg);
  }
  return data;
}

function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? "✓ コピーしました" : label}
    </button>
  );
}

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [lpText, setLpText] = useState("");
  const [lpUrl, setLpUrl] = useState("");
  const [persona, setPersona] = useState("");
  const [voiceSamples, setVoiceSamples] = useState("");
  const [timeframe, setTimeframe] = useState("random");

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [research, setResearch] = useState<unknown>(null);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [chosenAngle, setChosenAngle] = useState<Angle | null>(null);
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [activeMode, setActiveMode] = useState<GenerateMode | null>(null);
  const [noteResult, setNoteResult] = useState<NoteResult | null>(null);
  const [threadResult, setThreadResult] = useState<ThreadItem[]>([]);
  const [resultKind, setResultKind] = useState<"note" | "threads" | null>(null);
  const [loading, setLoading] = useState<GenerateMode | null>(null);
  const [phase, setPhase] = useState(""); // 「リサーチ中…」「執筆中…」などの進捗表示
  const [error, setError] = useState("");

  // 初回：このブラウザに保存した内容を復元（何百人が各自のブラウザで使う前提）
  useEffect(() => {
    const g = (k: string) => localStorage.getItem(k) ?? "";
    const ak = localStorage.getItem("gemini_api_key");
    if (ak) setApiKey(ak);
    setPersona(g("affi_persona"));
    setVoiceSamples(g("affi_voice"));
    setLpUrl(g("affi_lpurl"));
    setLpText(g("affi_lptext"));
    const tf = localStorage.getItem("affi_timeframe");
    if (tf) setTimeframe(tf);
  }, []);

  // 変更を自動保存（このブラウザにだけ保存。サーバーには送らない）
  useEffect(() => {
    if (apiKey) localStorage.setItem("gemini_api_key", apiKey);
  }, [apiKey]);
  useEffect(() => localStorage.setItem("affi_persona", persona), [persona]);
  useEffect(() => localStorage.setItem("affi_voice", voiceSamples), [voiceSamples]);
  useEffect(() => localStorage.setItem("affi_lpurl", lpUrl), [lpUrl]);
  useEffect(() => localStorage.setItem("affi_lptext", lpText), [lpText]);
  useEffect(() => localStorage.setItem("affi_timeframe", timeframe), [timeframe]);

  // 生成のたびに「今日の方向性」を完全ランダムで作る
  function buildDirection() {
    const d = new Date();
    const today = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    let tfKey = timeframe;
    if (tfKey === "random") tfKey = pick(["past", "now", "trend"]);
    const a1 = pick(ANGLE_POOL);
    let a2 = pick(ANGLE_POOL);
    if (a2 === a1) a2 = pick(ANGLE_POOL);
    const angleSeed = a1 === a2 ? a1 : `${a1} / ${a2}`;
    return { today, timeframe: TIMEFRAMES[tfKey], angleSeed };
  }

  async function generate(mode: GenerateMode) {
    setError("");
    setLoading(mode);
    setActiveMode(mode);
    const dir = buildDirection();
    try {
      // STEP A: 分析＋リサーチ。未取得なら prep で必ず実行（リサーチ無しでは書かない）。
      let curAnalysis = analysis;
      let curResearch = research;
      if (!curAnalysis || !curResearch) {
        setPhase("🔎 Web検索でリサーチ中…（30秒ほどかかります）");
        const prep = await readResult<{ analysis: Analysis; research: unknown }>(
          await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey,
              mode: "prep",
              lpText,
              analysis: curAnalysis ?? undefined,
            }),
          })
        );
        curAnalysis = prep.analysis;
        curResearch = prep.research;
        setAnalysis(prep.analysis);
        setResearch(prep.research);
      }

      // STEP B: 本文生成（リサーチ済みの内容を必ず渡す）。
      setPhase("✍️ 執筆中…");
      const data = await readResult<{ result: unknown }>(
        await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            mode,
            lpText,
            analysis: curAnalysis,
            research: curResearch,
            options: {
              lpUrl,
              chosenAngle: chosenAngle ?? undefined,
              persona,
              voiceSamples,
              ...dir,
            },
          }),
        })
      );
      if (mode === "note") {
        setNoteResult(data.result as NoteResult);
        setResultKind("note");
      } else {
        setThreadResult(data.result as ThreadItem[]);
        setResultKind("threads");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setLoading(null);
      setPhase("");
    }
  }

  // 方向性を5案出す（生成前に選ばせる）
  async function getAngles() {
    setError("");
    setAnglesLoading(true);
    const dir = buildDirection();
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          mode: "angles",
          lpText,
          analysis: analysis ?? undefined,
          // 方向性出しはアイデア出しなのでWeb検索リサーチは挟まない（軽く速く）。
          options: { ...dir },
        }),
      });
      const data = await readResult<{ analysis?: Analysis; result: unknown }>(res);
      if (data.analysis) setAnalysis(data.analysis);
      setAngles((data.result as Angle[]) || []);
      setChosenAngle(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setAnglesLoading(false);
    }
  }

  const busy = loading !== null;
  const ready = !!apiKey && !!lpText;
  const allThreadText = threadResult
    .map((t) => `【投稿${t.no} メイン】\n${t.hook ?? ""}\n\n【投稿${t.no} リプライ】\n${t.body}`)
    .join("\n\n――――――\n\n");
  const noteFullText = noteResult ? `${noteResult.title}\n\n${noteResult.body}` : "";

  return (
    <div className="wrap">
      <h1 className="title">affi-note-threads</h1>
      <p className="lead">
        紹介したいLP（ランディングページ）を貼るだけで、それを“紹介する”note記事とThreads投稿を自動でつくる、アフィリエイト専用ツールです。どの分野でも、LPを貼り替えれば使えます。
      </p>

      {/* 使い方 */}
      <div className="card howto">
        <b>📘 使い方（3ステップ）</b>
        <ol>
          <li><b>Gemini APIキー</b>（無料）を入れる … 取り方は STEP1 にあります</li>
          <li>紹介したい<b>LPの全文を貼る</b></li>
          <li><b>方向性を選んで生成</b> → 出てきた文章をコピーして note / Threads に貼る</li>
        </ol>
        <p className="hint" style={{ margin: "6px 0 0" }}>※ 投稿の自動化はしません。「文章づくり」までを助けるツールです。投稿は手動でコピペします。</p>
      </div>

      {/* 注意 */}
      <div className="card" style={{ background: "#fff8ec", borderColor: "#f0dcb4" }}>
        <p className="hint" style={{ fontSize: 13, color: "#7a5a17", margin: 0 }}>
          ⚠️ <b>出てきた文章は必ず手直ししてください。</b><br />
          無料のAI（Gemini）を使っているため、文章が不自然になることがあります。叩き台として、お使いのAI（ChatGPT / Claude など）も使いながら、ご自身の言葉で仕上げてください。
        </p>
      </div>

      {/* STEP1 APIキー */}
      <div className="card">
        <div className="step-h"><span className="step-no">1</span>Gemini APIキー（無料）を入れる</div>
        <p className="hint">Googleが無料で配っている「AIを動かすための鍵」です。これを入れないと文章が作れません。</p>
        <input type="password" placeholder="AIza... から始まる文字列を貼り付け" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <details open>
          <summary>🔑 APIキーの取り方（クリックで開閉）</summary>
          <ol className="guide">
            <li><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio のキー発行ページ</a> を開く</li>
            <li>自分のGoogleアカウントでログインする</li>
            <li>「Create API key（APIキーを作成）」を押す</li>
            <li>表示された <b>AIza…</b> で始まる文字列をコピーする</li>
            <li>上の入力欄に貼り付ける（次回からは自動で入ります）</li>
          </ol>
          <p className="hint">🔒 鍵はあなたのブラウザにだけ保存されます。こちらのサーバーには保存せず、文章を作るときにGoogleへ直接送るだけです。</p>
        </details>
      </div>

      {/* STEP2 LP */}
      <div className="card">
        <div className="step-h"><span className="step-no">2</span>紹介するLPの全文を貼る</div>
        <p className="hint">あなたが紹介したい商品・セミナーなどのLP（ランディングページ）の本文を、まるごとコピーして貼ってください。これが記事の“元ネタ”になります。LPを貼り替えれば、別の案件にもそのまま使えます。</p>
        <textarea
          rows={8}
          placeholder="紹介したいLPの本文を、まるごと貼り付けてください。"
          value={lpText}
          onChange={(e) => {
            setLpText(e.target.value);
            setAnalysis(null);
            setResearch(null);
            setAngles([]);
            setChosenAngle(null);
          }}
        />
      </div>

      {/* STEP3 くわしい設定 */}
      <div className="card">
        <div className="step-h"><span className="step-no">3</span>くわしい設定（すべて任意）</div>
        <p className="hint">空欄でも動きます。でも入れるほど“あなたらしい”紹介記事になります。</p>
        <p className="hint" style={{ color: "var(--accent)" }}>
          💾 入力した内容は<b>あなたのブラウザにだけ自動保存</b>され、次回も引き継がれます（他の人とは共有されません・一度入れれば毎回入力不要）。
        </p>

        <div className="field">
          <label className="label">LPのURL（アフィリエイトリンク）</label>
          <p className="hint">記事の案内ボックスに表示する、あなたのアフィリエイトリンク（誘導先のURL）です。</p>
          <input type="text" placeholder="https://..." value={lpUrl} onChange={(e) => setLpUrl(e.target.value)} />
        </div>

        <div className="field">
          <label className="label">あなたは何者か（立場・プロフィール）</label>
          <p className="hint">“紹介する人”としてのあなたの立場や背景。くわしく書くほど、記事に深みと説得力が出ます。経歴・きっかけ・今やっていること・どんな人かなど、自由に書いてください。</p>
          <textarea
            rows={5}
            placeholder="例: 会社員をしながら3年間、いろんな副業を試してきました。時間に追われる毎日で「もっと楽にできないか」とずっと探していて、AIに出会ってから働き方が変わりました。同じように時間で消耗している人に役立つ情報を発信しています。"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label">あなたの言葉サンプル（文体の参考）</label>
          <p className="hint">普段の言葉づかいや過去の投稿を数行。AIが“雰囲気”だけ真似ます（毎回同じにならないよう表現は変えます）。⚠️ 決まり文句より、あなたの生の言葉を。定型文だと毎回同じになります。</p>
          <textarea rows={3} placeholder="あなたが普段書いている文章を数行そのまま貼ってください。" value={voiceSamples} onChange={(e) => setVoiceSamples(e.target.value)} />
        </div>

        <div className="field">
          <label className="label">いつの視点で書く？（毎回の切り口）</label>
          <p className="hint">毎日投稿しても内容が被らないよう、生成のたびに切り口を自動で変えます。ボタンで選べます。</p>
          <div className="seg">
            {TIMEFRAME_LABELS.map((t) => (
              <button key={t.key} data-active={timeframe === t.key} onClick={() => setTimeframe(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <p className="hint" style={{ marginTop: 4 }}>
          💡 文章を作るときは、毎回かならずWeb検索で最新情報を調べてから書きます（自動）。
        </p>
      </div>

      {/* STEP4 方向性 */}
      <div className="card">
        <div className="step-h"><span className="step-no">4</span>方向性を選ぶ（内容の被りを防ぐ）</div>
        <p className="hint">
          同じLPでも毎回ちがう角度で書くために、まず「どんな方向性で書くか」を5案出します。1つ選ぶとその切り口で書きます（選ばなくてもOK＝おまかせ）。
        </p>
        <button className="btn" disabled={anglesLoading || !ready} onClick={getAngles}>
          {anglesLoading ? "考え中…" : angles.length ? "🎲 別の5案を出す" : "🎲 方向性を5案出す"}
        </button>
        {!ready ? <p className="hint" style={{ marginTop: 8 }}>STEP1とSTEP2を入れると押せます。</p> : null}
        {angles.length ? (
          <div style={{ marginTop: 14 }}>
            {angles.map((ag) => {
              const sel = chosenAngle?.id === ag.id;
              return (
                <div key={ag.id} className="angle" data-sel={sel} onClick={() => setChosenAngle(sel ? null : ag)}>
                  <div className="angle-head">
                    <b>{ag.id}. {ag.theme}</b>
                    <span className="angle-pick">{sel ? "✓ 選択中" : "これにする"}</span>
                  </div>
                  <p className="angle-body">{ag.angle}</p>
                  <p className="angle-meta">👤 {ag.whoFor} ／ 🎁 {ag.value}</p>
                </div>
              );
            })}
            <p className="hint" style={{ marginTop: 4 }}>
              {chosenAngle ? `選択中: ${chosenAngle.theme}` : "未選択（おまかせ）。1つ選ぶとその角度で書きます。"}
            </p>
          </div>
        ) : null}
      </div>

      {/* STEP5 生成 */}
      <div className="card">
        <div className="step-h"><span className="step-no">5</span>生成する</div>
        <p className="hint">つくりたいものを選んでください。出てきたら「コピー」して、note / Threads に貼り付けます。</p>
        <div className="btns">
          {(Object.keys(MODE_LABEL) as GenerateMode[]).map((m) => (
            <button key={m} className="btn" disabled={busy || !ready} onClick={() => generate(m)}>
              {loading === m ? "生成中…" : MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {!ready ? <p className="hint" style={{ marginTop: 8 }}>STEP1とSTEP2を入れると押せます。</p> : null}
        {busy ? (
          <p className="spinner" style={{ marginTop: 10 }}>
            {phase || "つくっています…（分析→Web検索リサーチ→執筆。少し時間がかかります）"}
          </p>
        ) : null}
      </div>

      {error ? <div className="err">{error}</div> : null}

      {/* 分析結果 */}
      {analysis ? (
        <div className="card">
          <details>
            <summary>AIがLPをどう読んだか見る</summary>
            <div className="analysis" style={{ marginTop: 10 }}>
              <p><b>ジャンル:</b> {analysis.genre}</p>
              <p><b>ターゲット:</b> {analysis.target}</p>
              <p><b>悩み:</b> {analysis.painPoints?.join(" / ")}</p>
              <p><b>提供価値:</b> {analysis.benefits?.join(" / ")}</p>
              <p><b>独自の切り口:</b> {analysis.uniqueAngle}</p>
              <p><b>誘導ゴール:</b> {analysis.goal}</p>
            </div>
          </details>
        </div>
      ) : null}

      {/* 結果: note */}
      {resultKind === "note" && noteResult ? (
        <div className="card">
          <div className="result-head">
            <span className="result-title">{noteResult.title}</span>
            <CopyButton text={noteFullText} label="タイトル＋本文をコピー" />
          </div>
          <div className="result">{noteResult.body}</div>
          {noteResult.tags?.length ? (
            <p className="hint" style={{ marginTop: 10 }}>タグ: {noteResult.tags.map((t) => `#${t}`).join("  ")}</p>
          ) : null}
        </div>
      ) : null}

      {/* 結果: threads / pin */}
      {resultKind === "threads" && threadResult.length ? (
        <div className="card">
          <div className="result-head">
            <span className="result-title">{activeMode ? MODE_LABEL[activeMode] : ""}</span>
            <CopyButton text={allThreadText} label="全部まとめてコピー" />
          </div>
          {threadResult.map((t) => (
            <div key={t.no} className="thread">
              <div className="thread-meta">
                <span
                  className={`tag ${
                    t.hasCta || t.type === "soft_cta" ? "soft_cta" : t.type === "talk" ? "talk" : "value"
                  }`}
                >
                  投稿{t.no}.{" "}
                  {t.role ||
                    (t.hasCta || t.type === "soft_cta"
                      ? "誘導あり"
                      : t.type === "talk"
                      ? "つぶやき・問いかけ"
                      : "価値提供")}
                </span>
              </div>
              {/* 1段目: メイン投稿（フック） */}
              {t.hook ? (
                <div className="post-step">
                  <div className="post-label">
                    <span>① メイン投稿（これを先に投稿）</span>
                    <CopyButton text={t.hook} />
                  </div>
                  <div className="thread-body">{t.hook}</div>
                </div>
              ) : null}
              {/* 2段目: リプライ（本文） */}
              <div className="post-step">
                <div className="post-label">
                  <span>② ↳ リプライ（①にぶら下げる）</span>
                  <CopyButton text={t.body} />
                </div>
                <div className="thread-body">{t.body}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p className="hint" style={{ textAlign: "center", marginTop: 32 }}>
        出てきた文章はそのまま投稿せず、必ずご自身で確認・手直ししてからご利用ください。
      </p>
    </div>
  );
}
