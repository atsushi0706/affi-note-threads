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

export const runtime = "edge";
export const maxDuration = 60;

type Body = {
  apiKey: string;
  mode: GenerateMode;
  lpText?: string;
  analysis?: Analysis; // 2回目以降は使い回してコスト削減
  research?: Research | null; // 同上
  doResearch?: boolean; // Web検索リサーチを挟むか
  options?: Options;
  review?: boolean; // note記事に自己レビューを挟むか
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const { apiKey, mode, lpText, options = {}, doResearch, review } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini APIキーを入力してください。" }, { status: 400 });
    }
    if (!body.analysis && !lpText?.trim()) {
      return NextResponse.json({ error: "LPの全文を入力してください。" }, { status: 400 });
    }

    // STEP 1: LP分析（渡されていれば再利用）
    let analysis = body.analysis;
    if (!analysis) {
      const raw = await callGemini(apiKey, analyzePrompt(lpText!), { json: true, temperature: 0.4 });
      analysis = parseJson<Analysis>(raw);
    }

    // STEP 2: Web検索リサーチ（grounding）。失敗してもリサーチ無しで続行
    let research: Research | null = body.research ?? null;
    if (research === null && doResearch) {
      try {
        const raw = await callGemini(apiKey, researchPrompt(analysis), { json: true, search: true, temperature: 0.6 });
        research = parseJson<Research>(raw);
      } catch {
        research = null; // grounding不可・解析失敗時はフォールバック
      }
    }

    // STEP 3: モード別生成
    let result: unknown;
    if (mode === "angles") {
      const raw = await callGemini(apiKey, anglesPrompt(analysis, research ?? undefined, options), {
        json: true,
        temperature: 1.1,
      });
      result = parseJson(raw);
    } else if (mode === "threads") {
      const raw = await callGemini(apiKey, threadsPrompt(analysis, research ?? undefined, options), {
        json: true,
        temperature: 1.0,
      });
      result = parseJson(raw);
    } else if (mode === "threads-pin") {
      const raw = await callGemini(apiKey, threadsPinPrompt(analysis, research ?? undefined, options), {
        json: true,
        temperature: 1.0,
      });
      result = parseJson(raw);
    } else {
      // note
      let raw = await callGemini(apiKey, notePrompt(analysis, research ?? undefined, options), {
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
