import { NextRequest, NextResponse } from "next/server";
import { callGemini, parseJson } from "@/lib/gemini";
import {
  analyzePrompt,
  researchPrompt,
  anglesPrompt,
  notePrompt,
  threadsPrompt,
  threadsPinPrompt,
  reviewPrompt,
  type Analysis,
  type Research,
  type GenerateMode,
  type Options,
} from "@/lib/prompts";

// Edge は「最初の応答までの猶予」が短く（Hobbyで約25秒）、重いLLMチェーンを
// 回し切ってから一気にJSONを返すこの作りとは相性が悪くタイムアウトしやすい。
// Node.js ランタイムにすると maxDuration がそのまま効く（Hobby最大60秒/Pro最大300秒）。
export const runtime = "nodejs";
export const maxDuration = 60;

// チェーンを1リクエストに詰め込むと実行時間の壁とレースしてタイムアウトする。
// そこで重い工程を「短いリクエスト」に分割し、フロントが順に叩く：
//   prep  = LP分析 ＋ Web検索リサーチ（重い。これだけを単独で完走させる）
//   angles= 方向性のアイデア出し（リサーチ不要・軽い）
//   note/threads/threads-pin = 本文生成（prepで取得したリサーチを必ず使う）
// 「リサーチ無しで本文を書く」フォールバックは廃止。リサーチが取れなければ
// 黙って薄い記事を返さず、正直にエラーを返す。
type Mode = GenerateMode | "prep";

type Body = {
  apiKey: string;
  mode: Mode;
  lpText?: string;
  analysis?: Analysis; // 2回目以降は使い回してコスト削減
  research?: Research | null; // prepで取得済みのものを本文生成で再利用
  options?: Options;
  review?: boolean; // note記事に自己レビューを挟むか
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const { apiKey, mode, lpText, options = {}, review } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini APIキーを入力してください。" }, { status: 400 });
    }
    if (!body.analysis && !lpText?.trim()) {
      return NextResponse.json({ error: "LPの全文を入力してください。" }, { status: 400 });
    }

    // LP分析（渡されていれば再利用）。prep / angles どちらでも必要。
    let analysis = body.analysis;
    if (!analysis) {
      const raw = await callGemini(apiKey, analyzePrompt(lpText!), { json: true, temperature: 0.4 });
      analysis = parseJson<Analysis>(raw);
    }

    // prep: 分析＋リサーチだけを返す。重い検索グラウンディングはこの1リクエストに隔離。
    // リサーチは必須 — 失敗したら握りつぶさず throw して正直にエラーを返す。
    if (mode === "prep") {
      const research = body.research ?? parseJson<Research>(
        await callGemini(apiKey, researchPrompt(analysis), { json: true, search: true, temperature: 0.6 })
      );
      return NextResponse.json({ analysis, research });
    }

    // angles: 方向性のアイデア出し。web検索は不要なので軽い。
    if (mode === "angles") {
      const raw = await callGemini(apiKey, anglesPrompt(analysis, undefined, options), {
        json: true,
        temperature: 1.1,
      });
      return NextResponse.json({ analysis, result: parseJson(raw) });
    }

    // ここから本文生成（note / threads / threads-pin）。リサーチは prep 済みが前提。
    // リサーチ無しでは絶対に書かない。
    const research = body.research ?? null;
    if (research === null) {
      return NextResponse.json(
        { error: "リサーチが未完了です。先にリサーチを実行してください。" },
        { status: 400 }
      );
    }

    let result: unknown;
    if (mode === "threads") {
      const raw = await callGemini(apiKey, threadsPrompt(analysis, research, options), {
        json: true,
        temperature: 1.0,
      });
      result = parseJson(raw);
    } else if (mode === "threads-pin") {
      const raw = await callGemini(apiKey, threadsPinPrompt(analysis, research, options), {
        json: true,
        temperature: 1.0,
      });
      result = parseJson(raw);
    } else {
      // note
      let raw = await callGemini(apiKey, notePrompt(analysis, research, options), {
        json: true,
        temperature: 0.9,
      });
      if (review) {
        raw = await callGemini(apiKey, reviewPrompt(raw, analysis), { json: true, temperature: 0.5 });
      }
      result = parseJson(raw);
    }

    return NextResponse.json({ analysis, research, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "不明なエラーが発生しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
