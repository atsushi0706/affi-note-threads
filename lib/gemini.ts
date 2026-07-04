// Gemini API ラッパー（依存ゼロ・REST直叩き / BYO-key）
// 最新の3系を優先し、混雑・未対応なら順に安定モデルへフォールバックする。
// （秘書AI/冊子ジェネレーターと同じ「最新→ダメなら別」の思想）

// 注意: "gemini-3.1-flash"(無印) は存在せず必ず404になる（実在は -lite / -image 派生のみ）。
// 先頭に無効モデルを置くと毎回404で1往復ぶん時間を無駄にし、タイムアウトの一因になる。
// 無料で安定＆検索グラウンディング対応の 2.5-flash を主軸にする。
const MODELS = [
  "gemini-2.5-flash", // 主軸：無料で安定・grounding対応
  "gemini-flash-latest", // Google管理の最新安定flashエイリアス
  "gemini-2.5-flash-lite", // 最終手段（無料枠が一番多い）
];
const endpoint = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1回のcallGemini（モデルフォールバック＋リトライ全部込み）が暴走して器を
// 食い尽くさないための総時間の上限。これを超えたら諦めるのではなく throw して、
// 呼び出し元が「正直にエラーを出す」方に倒す（黙ってリサーチ無しで進めない）。
const TOTAL_DEADLINE_MS = 50_000;
// 1回のfetch単体に許す最大待ち時間（残り時間と小さい方を採用）。
const PER_ATTEMPT_MS = 40_000;

export async function callGemini(
  apiKey: string,
  prompt: string,
  opts: { json?: boolean; temperature?: number; search?: boolean } = {}
): Promise<string> {
  // Google検索グラウンディング(search)とJSON modeは併用しない。
  // search時はプロンプト側で「末尾にJSON」を指示し、parseJsonで取り出す。
  const useJson = opts.json && !opts.search;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.9,
      ...(useJson ? { responseMimeType: "application/json" } : {}),
    },
    ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
  });

  const MAX_RETRY = 2; // 各モデルあたりの一時エラー再試行回数
  const deadline = Date.now() + TOTAL_DEADLINE_MS; // これ以上は暴走とみなして打ち切る
  let lastDetail = "";
  let sawTransient = false;

  // モデルを順に試す（最新 → フォールバック）
  for (const model of MODELS) {
    let giveUpThisModel = false;
    for (let attempt = 0; attempt <= MAX_RETRY && !giveUpThisModel; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break; // 総時間切れ → これ以上リトライで暴れない
      let res: Response;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Math.min(PER_ATTEMPT_MS, remaining));
      try {
        res = await fetch(`${endpoint(model)}?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: ac.signal,
        });
      } catch {
        // ネットワーク瞬断 or タイムアウト中断 → 同じモデルでリトライ、尽きたら次のモデルへ
        if (attempt < MAX_RETRY) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        sawTransient = true;
        giveUpThisModel = true;
        break;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Geminiからの応答が空でした。もう一度お試しください。");
        return text as string;
      }

      const detail = await res.text().catch(() => "");
      lastDetail = detail;

      // APIキー不正はモデルを変えても無駄なので即終了
      if (res.status === 400 && /API key/i.test(detail)) {
        throw new Error("APIキーが正しくありません。Gemini APIキーを確認してください。");
      }
      // モデル未対応（404）→ このキーで使えない世代。次のモデルへ
      if (res.status === 404 || /not found|not supported/i.test(detail)) {
        giveUpThisModel = true;
        break;
      }
      // 一時的なエラー（503=混雑 / 500 / 429 / 408 等）→ 同モデルで再試行
      const transient = [408, 429, 500, 502, 503, 504].includes(res.status);
      if (transient) {
        sawTransient = true;
        if (attempt < MAX_RETRY) {
          await sleep(1500 * 2 ** attempt); // 1.5s → 3s
          continue;
        }
        giveUpThisModel = true; // この混雑モデルは諦めて次へ
        break;
      }
      // それ以外の致命的エラーは即終了
      throw new Error(`Gemini API エラー (${res.status}): ${detail.slice(0, 300)}`);
    }
    // 次のモデルへフォールバック
  }

  // すべてのモデルで失敗
  if (sawTransient) {
    throw new Error("Geminiが混雑しています（一時的）。数十秒おいて、もう一度生成してください。");
  }
  throw new Error(`Gemini API エラー: ${lastDetail.slice(0, 200) || "原因不明"}`);
}

// JSONレスポンスを安全にパース（```json フェンスにも対応）
export function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as T;
}
