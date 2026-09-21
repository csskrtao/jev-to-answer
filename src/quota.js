const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function positiveInteger(value, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
  return Number(value);
}

export function quotaLimits(env = {}) {
  return {
    perMinute: positiveInteger(env.REQUESTS_PER_MINUTE, 'REQUESTS_PER_MINUTE', 12),
    perDay: positiveInteger(env.REQUESTS_PER_DAY, 'REQUESTS_PER_DAY', 60),
    globalPerDay: positiveInteger(env.GLOBAL_REQUESTS_PER_DAY, 'GLOBAL_REQUESTS_PER_DAY', 3000),
  };
}

function limited(message, resetAt, now) {
  return Response.json({ ok: false, error: message }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.max(1, Math.ceil((resetAt - now) / 1000))) },
  });
}

// 只保留当前 UTC 日期及当前分钟的计数，过期窗口按需归零。
function currentState(previous, now) {
  const day = Math.floor(now / DAY_MS);
  const minute = Math.floor(now / MINUTE_MS);
  return {
    day, minute,
    dayCount: previous?.day === day ? previous.dayCount : 0,
    minuteCount: previous?.minute === minute ? previous.minuteCount : 0,
  };
}

function checkState(state, limits, now) {
  if (state.dayCount >= limits.perDay) {
    return limited('今日使用次数已达上限，请明天再试。', (state.day + 1) * DAY_MS, now);
  }
  if (state.minuteCount >= limits.perMinute) {
    return limited('提问过于频繁，请稍后再试。', (state.minute + 1) * MINUTE_MS, now);
  }
  return null;
}

export class UsageQuota {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    let limits;
    try {
      const body = await request.json();
      limits = {
        perMinute: positiveInteger(body.perMinute, 'perMinute'),
        perDay: positiveInteger(body.perDay, 'perDay'),
      };
      if (!limits.perMinute || !limits.perDay) throw new Error('缺少限流配置');
    } catch {
      return Response.json({ ok: false, error: '限流配置必须包含正整数 perMinute 和 perDay。' }, { status: 400 });
    }

    // 事务保证多个并发请求不能同时读取旧计数并突破额度。
    return this.storage.transaction(async (txn) => {
      const now = Date.now();
      const state = currentState(await txn.get('state'), now);
      const rejection = checkState(state, limits, now);
      if (rejection) return rejection;
      state.dayCount += 1;
      state.minuteCount += 1;
      await txn.put('state', state);
      return Response.json({ ok: true });
    });
  }
}

export function createMemoryQuota({ perMinute = 12, perDay = 60, globalPerDay = 3000, now = Date.now } = {}) {
  const limits = quotaLimits({ REQUESTS_PER_MINUTE: perMinute, REQUESTS_PER_DAY: perDay, GLOBAL_REQUESTS_PER_DAY: globalPerDay });
  const entries = new Map();
  let globalDay = null;
  let globalCount = 0;

  // 本地运行只覆盖单进程；线上使用 Durable Object 统一保存计数。
  return function check(key) {
    const timestamp = now();
    const day = Math.floor(timestamp / DAY_MS);
    if (globalDay !== day) {
      globalDay = day;
      globalCount = 0;
      entries.clear();
    }
    if (globalCount >= limits.globalPerDay) {
      return limited('今日全站免费额度已用完，请明天再试。', (day + 1) * DAY_MS, timestamp);
    }
    const state = currentState(entries.get(key), timestamp);
    const rejection = checkState(state, limits, timestamp);
    if (rejection) return rejection;
    state.dayCount += 1;
    state.minuteCount += 1;
    entries.set(key, state);
    globalCount += 1;
    return null;
  };
}
