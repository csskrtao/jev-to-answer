import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { withTimeout } from './timeout.js';

/**
 * Jev 双接入方式:
 * - vercel:   通过 Vercel AI Gateway(experimental_evaluate + @ai-sdk/gateway,vck_ key)
 * - typesafe: 通过 TypeSafe 官方 API(POST /v1/systemone,apikey_ key,noul 类型)
 */
export async function runEvaluate(jev, payload) {
  const { state, questions } = payload ?? {};
  if (state === undefined) {
    throw Object.assign(new Error('state 必填'), { status: 400 });
  }
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    throw Object.assign(new Error('questions 必填且为对象'), { status: 400 });
  }
  if (jev?.provider === 'typesafe') {
    return runTypeSafe(jev.typesafe, { state, questions });
  }
  return runVercel(jev?.vercel ?? jev, { state, questions });
}

/** Vercel AI Gateway 通道 */
async function runVercel(vercel, { state, questions }) {
  if (!vercel?.apiKey) {
    throw Object.assign(new Error('Jev(Vercel) API Key 未配置'), { status: 400 });
  }
  const provider = createGateway({
    baseURL: vercel.baseURL || 'https://ai-gateway.vercel.sh/v4/ai',
    apiKey: vercel.apiKey,
  });
  try {
    const result = await withTimeout((abortSignal) => evaluate({
      model: provider.evaluationModel(vercel.model || 'typesafe-ai/jev'),
      state,
      questions,
      abortSignal,
      maxRetries: 1,
    }), 45_000, 'Jev');
    return { ...result, provider: 'vercel' };
  } catch (error) {
    if (error.status === 504) throw error;
    throw Object.assign(new Error('Jev 调用失败，请检查通道配置与密钥后重试'), { status: 502 });
  }
}

/** TypeSafe 官方 API 通道(noul ↔ boolean 归一化) */
async function runTypeSafe(ts, { state, questions }) {
  if (!ts?.apiKey) {
    throw Object.assign(new Error('Jev(TypeSafe) API Key 未配置'), { status: 400 });
  }
  // boolean 是 AI SDK 抽象;TypeSafe 原生类型为 noul
  const qs = {};
  for (const [id, q] of Object.entries(questions)) {
    qs[id] = q.type === 'boolean' ? { ...q, type: 'noul' } : q;
  }
  const base = String(ts.baseURL || 'https://api.typesafe.ai/v1').replace(/\/+$/, '');
  const body = await withTimeout(async (signal) => {
    const res = await fetch(`${base}/systemone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ts.apiKey}`,
      },
      body: JSON.stringify({ model: ts.model || 'jev-latest', state, questions: qs }),
      signal,
    });
    if (!res.ok) {
      throw Object.assign(new Error(`TypeSafe API 请求失败 [${res.status}]，请检查配置后重试`), { status: 502 });
    }
    try {
      return await res.json();
    } catch {
      throw Object.assign(new Error('TypeSafe API 未返回有效 JSON，请稍后重试'), { status: 502 });
    }
  }, 45_000, 'Jev');
  // 归一化为 AI SDK 风格 answers:noul → { type:'boolean', probability }
  const answers = {};
  for (const [id, ans] of Object.entries(body.answers ?? {})) {
    if (ans?.type === 'noul') {
      answers[id] = { type: 'boolean', probability: ans.noul };
    } else {
      answers[id] = ans;
    }
  }
  return {
    provider: 'typesafe',
    model: body.model,
    answers,
    usage: body.usage,
    raw: body,
  };
}
