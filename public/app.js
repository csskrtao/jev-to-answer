// 使用本地 SVG 图标，不依赖 CDN，避免首次打开时图标或框架加载失败。
const paths = {
  book: "M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3z M21 4h-5a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h4z",
  "book-open":
    "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15",
  sparkles:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4 M18 4h4",
  history: "M3 11a9 9 0 1 1 2.6 7 M3 4v7h7 M12 7v5l3 2",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  pen: "m15 4 5 5 M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z M4 14l5 5",
  coffee:
    "M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z M16 9h2a3 3 0 0 1 0 6h-2 M7 2v3 M12 2v3 M2 23h18",
  briefcase: "M3 7h18v14H3z M8 7V3h8v4 M3 12q9 6 18 0 M10 13h4v4h-4z",
  heart: "M20 4a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-2 10 7 17 12 21c5-4 14-11 8-17z",
  sprout:
    "M12 21V11 M12 16C3 17 2 11 2 8c8-1 10 5 10 8z M12 11c0-7 4-9 10-8 0 6-4 10-10 8z",
  info: "M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  lightbulb:
    "M9 18v-1c0-3-4-3-4-8a7 7 0 0 1 14 0c0 5-4 5-4 8v1z M9 22h6 M12 11v7 M9 9l3 2 3-2",
  refresh:
    "M20 8a8 8 0 0 0-14-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 14 3l3-3 M16 16h5v5",
  layers: "m12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
  search: "M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  close: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L19 6",
  external: "M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7",
  copy: "M9 9h12v12H9z M5 15H3V3h12v2",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.sparkles}"/></svg>`;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
// 所有模型输出、用户输入和历史记录在进入 HTML 前统一转义，避免脚本注入。
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
// 只允许最简单的加粗格式；先转义再格式化，模型无法插入可执行 HTML。
const formatProse = (value) =>
  escapeHTML(value).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
const categories = {
  daily: "日常小事",
  work: "工作学业",
  relationship: "人际关系",
  growth: "自我成长",
};
const categoryIcons = {
  daily: "coffee",
  work: "briefcase",
  relationship: "heart",
  growth: "sprout",
};
const promptSets = [
  [
    {
      category: "daily",
      text: "这个周末，出门探索还是宅家充电？",
      question:
        "忙碌了一周，有点疲惫，但也想换换心情。这个周末该出去走走，还是留在家好好休息？",
    },
    {
      category: "work",
      text: "新的机会，值得走出舒适区吗？",
      question:
        "我目前工作稳定，但成长比较慢。最近有一个更有挑战的新机会，我想学习新技能，也担心压力太大，该怎么选择？",
    },
    {
      category: "relationship",
      text: "好久没联系，要不要主动问候？",
      question:
        "有个很久没联系的朋友，最近突然想起一起度过的时光。我想主动问候，又怕有些唐突，要不要发条消息？",
    },
  ],
  [
    {
      category: "growth",
      text: "想养成习惯，先读书还是先运动？",
      question:
        "我想养成一个能长期坚持的习惯，每天只有半小时空闲，先从读书还是运动开始比较好？",
    },
    {
      category: "daily",
      text: "晚餐尝点新鲜，还是熟悉的老店？",
      question:
        "今天心情不错，想一个人吃顿好饭。是试试一直想去的新餐厅，还是去熟悉的老店？预算100元，不想排太久。",
    },
    {
      category: "work",
      text: "新技能，报课还是自己摸索？",
      question:
        "我想利用业余时间学一项新技能，每周有5小时，预算有限。应该先自己找资料学习，还是报一个系统课程？",
    },
  ],
  [
    {
      category: "daily",
      text: "假期旅行，提前规划还是随心出发？",
      question:
        "下个月有三天假，想去附近城市旅行放松。我既希望玩得尽兴，又不想行程太赶，该详细规划还是轻松随走？",
    },
    {
      category: "relationship",
      text: "周末聚会，要不要接受邀请？",
      question:
        "朋友邀请我参加周末聚会，但最近有些累，也想见见朋友。我该去参加一会儿，还是留时间给自己？",
    },
    {
      category: "growth",
      text: "想法很多，先迈出哪一小步？",
      question:
        "我想尝试写作、画画和拍照，但一直没开始。每周只有一个下午空闲，应该怎么选一个容易开始的方向？",
    },
  ],
];
const HISTORY_KEY = "answer-book:history:v1";
const DRAFT_KEY = "answer-book:draft:v1";
// 旧历史没有 kind，仍按决策记录读取；直接回答不伪造选项和 Jev 决策。
const isDirect = (record) => record?.options?.kind === "direct";
const answerTitle = (record) => isDirect(record)
  ? record.options.title
  : record.options.choices.find((choice) => choice.id === record.decision.choiceId)?.title || "答案";
const answerBody = (record) => isDirect(record) ? record.options.answer : record.decision.explanation;
function validAnswerRecord(record) {
  if (isDirect(record)) {
    return ["evaluation", "fact", "chat", "clarification"].includes(record.options.intent) &&
      typeof record.options.title === "string" && typeof record.options.answer === "string";
  }
  return Array.isArray(record.options?.choices) && record.options.choices.length >= 2 &&
    record.options.choices.every((choice) => typeof choice?.id === "string" &&
      typeof choice.title === "string" && typeof choice.description === "string") &&
    record.options.choices.some((choice) => choice.id === record.decision?.choiceId) &&
    record.decision.probabilities && typeof record.decision.probabilities === "object" &&
    typeof record.decision.explanation === "string";
}
// 手机通过局域网 HTTP 访问时 randomUUID 可能不可用；记录 ID 不承担鉴权用途。
const createRecordId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `answer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const state = {
  category: "daily",
  view: "home",
  busy: false,
  followupBusy: false,
  ready: null,
  promptIndex: 0,
  current: null,
  pending: null,
  // 补充草稿按答案隔离；取消、重试或收藏重绘时，不丢失正在输入的信息。
  supplementDrafts: new Map(),
  supplementOpen: null,
  // 书页与追问页码仅影响阅读，不改变答案或发送给模型的完整上下文。
  readerTab: "answer",
  readerRecordId: null,
  followupPage: 0,
  pendingFollowup: null,
  followupDrafts: new Map(),
  controller: null,
  records: [],
  storageAvailable: true,
};
let toastTimer;

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
}
function toast(message) {
  clearTimeout(toastTimer);
  // dialog 位于浏览器顶层，提示也放入当前阅读器，避免被遮罩挡住。
  const host = $("#reader-dialog").open ? $(".reader-shell") : document.body;
  host.append($("#toast"));
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4000);
}
function showError(selector, message) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
}
async function api(path, { body, signal, timeout = 125000 } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("服务暂时没有响应，请稍后再试。");
  }
  if (!response.ok || !data.ok)
    throw new Error(data.error || "这次请求没有完成，请稍后重试。");
  return data;
}
function readableError(error) {
  if (error.name === "TimeoutError")
    return "这次思考花的时间有点久，请稍后重试，或检查模型服务是否可用。";
  if (error instanceof TypeError)
    return "暂时连不上服务，请检查网络或稍后再试。";
  return String(error.message || "暂时没有得到答案，请重试。").slice(0, 500);
}

// 历史只保留在当前浏览器；读取时做基本结构检查，损坏的数据不会阻止页面启动。
function restoreLocalData() {
  try {
    const records = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(records))
      state.records = records
        .filter(
          (record) =>
            typeof record?.id === "string" &&
            typeof record.question === "string" &&
            validAnswerRecord(record) &&
            Number.isFinite(record.createdAt),
        )
        .slice(0, 100);
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (typeof draft?.question === "string")
      $("#question").value = draft.question.slice(0, 1000);
    if (categories[draft?.category]) state.category = draft.category;
  } catch {
    state.storageAvailable = false;
  }
}
function persistRecords() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.records));
    state.storageAvailable = true;
  } catch {
    state.storageAvailable = false;
    toast("浏览器存储暂不可用，当前答案仍可查看和复制。");
  }
  updateCounts();
}
function saveDraft() {
  $("#character-count").textContent = $("#question").value.length;
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        question: $("#question").value,
        category: state.category,
      }),
    );
  } catch {
    /* 隐私模式禁用存储时，仍允许正常提问。 */
  }
}
function updateCounts() {
  $("#history-count").textContent = state.records.length;
  $("#favorite-count").textContent = state.records.filter(
    (record) => record.favorite,
  ).length;
}
function selectCategory(category) {
  if (state.busy) return;
  state.category = category;
  $$("[data-category]").forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  saveDraft();
}
function renderPrompts() {
  $("#prompt-grid").innerHTML = promptSets[state.promptIndex]
    .map(
      (prompt, index) =>
        `<button class="prompt-card" data-prompt="${index}" type="button"><span class="prompt-label">${icon(categoryIcons[prompt.category])}${categories[prompt.category]}</span><p>${escapeHTML(prompt.text)}</p><span class="prompt-arrow">${icon("arrow")}</span></button>`,
    )
    .join("");
  if (state.busy)
    $$(".prompt-card").forEach((button) => {
      button.disabled = true;
    });
}
function setView(view) {
  state.view = ["home", "history", "favorites"].includes(view) ? view : "home";
  $("#home-view").hidden = state.view !== "home";
  $("#library-view").hidden = state.view === "home";
  const label = {
    home: "翻开答案",
    history: "我的答案",
    favorites: "收藏的启示",
  }[state.view];
  $("#breadcrumb-label").textContent = label;
  $$("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
    if (button.dataset.view === state.view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (state.view !== "home") renderHistory();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function setBusy(busy) {
  state.busy = busy;
  $("#question").disabled = busy;
  $("#ask-button").disabled = busy;
  $("#ask-button").innerHTML = busy
    ? '<span class="spinner"></span><span>正在寻找答案</span>'
    : `${icon("sparkles")}<span>翻开我的答案</span>${icon("arrow")}`;
  $$("[data-category],.prompt-card,#shuffle-prompts").forEach((button) => {
    button.disabled = busy;
  });
  $$("#supplement-input,#supplement-send,#followup-input,#followup-send,[data-followup],[data-action='favorite-current'],.reader-actions [data-action='new']").forEach((control) => {
    control.disabled = busy;
  });
  if ($("#supplement-form")) $("#supplement-form").setAttribute("aria-busy", String(busy));
  $("#question-form").setAttribute("aria-busy", String(busy));
  $("#reader-cancel").hidden = !busy || !state.followupBusy;
  if (!busy && state.current && recordSupplements(state.current).length >= 5 && $("#supplement-send")) {
    $("#supplement-send").disabled = true;
    $("#supplement-input").disabled = true;
  }
  updateReaderResume();
}

// 合上书本不会中断请求；可以继续编辑首页或通过入口回到同一页。
function updateReaderResume() {
  $("#resume-reader").hidden = !state.current && !state.pending;
  $("#resume-reader-label").textContent = state.busy ? "回到正在翻开的这一页" : "继续阅读这一页";
}
function openReader() {
  const dialog = $("#reader-dialog");
  if (!dialog.open) dialog.showModal();
  updateReaderResume();
}
function closeReader() {
  $("#reader-dialog").close();
  updateReaderResume();
}
function showReaderTab(tab, focus = false) {
  if (!["answer", "choices", "followup", "supplement"].includes(tab)) return;
  if (isDirect(state.current) && tab === "choices") tab = "answer";
  state.readerTab = tab;
  state.supplementOpen = tab === "supplement" ? state.current?.id : null;
  $$("[data-reader-tab]").forEach((button) => {
    const active = button.dataset.readerTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus({ preventScroll: true });
  });
  $$("[data-reader-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.readerPanel !== tab;
  });
  const tabs = $$("[data-reader-tab]");
  const index = tabs.findIndex((button) => button.dataset.readerTab === tab);
  if ($("#reader-page-number")) $("#reader-page-number").textContent = `0${index + 1} / 0${tabs.length}`;
}
function renderJourney(phase, options, error) {
  const element = $("#journey");
  const failed = phase === "error";
  element.hidden = false;
  $("#result").hidden = true;
  element.innerHTML = `<div class="journey-book" aria-hidden="true"><span></span><span></span></div><span class="journey-kicker">A NEW CHAPTER IS WAITING</span><div class="journey-top">${failed ? icon("info") : '<span class="spinner"></span>'}<div><h3>${failed ? "答案还差最后一步" : phase === "options" ? "正在理解你的问题…" : "这一页，正在为你慢慢翻开…"}</h3><p>${failed ? escapeHTML(error) : phase === "options" ? "AI 正在识别你的提问，组织贴题的回答。" : "Jev 正在认真权衡，为你选出一个方向。"}</p></div></div>${options?.choices ? `<ul class="journey-options">${options.choices.map((choice, index) => `<li><small>${String.fromCharCode(65 + index)}</small>${escapeHTML(choice.title)}</li>`).join("")}</ul>` : ""}<div class="journey-progress" aria-label="生成进度"><span class="${options ? "is-complete" : "is-current"}">01 理解问题</span><span class="${options ? "is-current" : ""}">02 翻开答案</span></div><div class="journey-actions">${failed ? '<button class="secondary-button" data-action="retry">' + icon("refresh") + '重试这一步</button><button class="text-button" data-action="' + (state.current ? "back-to-answer" : "close-reader") + '">' + (state.current ? "返回原答案" : "返回修改问题") + '</button>' : '<button class="text-button" data-action="cancel">取消等待</button>'}</div>`;
}
async function askQuestion(event) {
  event?.preventDefault();
  if (state.busy) return;
  const question = $("#question").value.trim();
  if (!question) {
    showError("#form-error", "先写下一个问题，让答案之书为你翻开。");
    $("#question").focus();
    return;
  }
  if (question.length > 1000) {
    showError("#form-error", "问题最多 1000 字，请精简后重试。");
    return;
  }
  showError("#form-error", "");
  if (state.ready === false) {
    showError("#form-error", "服务暂未就绪，请等待管理员配置后再试。");
    return;
  }
  state.pending = { question, category: state.category, supplements: [], options: null };
  state.current = null;
  $("#result").hidden = true;
  await runJourney();
}
async function runJourney() {
  const pending = state.pending;
  if (!pending || state.busy) return;
  setBusy(true);
  const controller = new AbortController();
  state.controller = controller;
  openReader();
  try {
    if (!pending.options) {
      renderJourney("options");
      const data = await api("/api/book/options", {
        body: {
          question: pending.question,
          category: categories[pending.category],
          supplements: pending.supplements || [],
        },
        signal: controller.signal,
      });
      pending.options = data.options;
    }
    let decision = null;
    // 评价、事实和闲聊已经有直接回复，仅选择问题才进入 Jev。
    if (pending.options.kind !== "direct") {
      renderJourney("decide", pending.options);
      ({ decision } = await api("/api/book/decide", {
        body: { question: pending.question, supplements: pending.supplements || [], options: pending.options },
        signal: controller.signal,
      }));
    }
    if (controller.signal.aborted) return;
    const record = {
      id: createRecordId(),
      createdAt: Date.now(),
      question: pending.question,
      category: pending.category,
      options: pending.options,
      decision,
      favorite: false,
      ...(pending.parentId ? { parentId: pending.parentId } : {}),
    };
    // 新判断另存一条历史，旧答案和旧追问仍可回看，避免把两次判断混在一起。
    if (pending.parentId) state.supplementDrafts.delete(pending.parentId);
    state.supplementOpen = null;
    state.current = record;
    state.records.unshift(record);
    state.records = state.records.slice(0, 100);
    persistRecords();
    state.pending = null;
    $("#journey").hidden = true;
    renderResult(record);
    if ($("#reader-dialog").open) $("#reader-tab-answer").focus({ preventScroll: true });
    if (state.view !== "home") {
      renderHistory();
      toast("你的新答案已准备好，已收录到「我的答案」。");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      $("#journey").hidden = true;
      state.pending = null;
      if (state.current) renderResult(state.current);
      else closeReader();
      toast(pending.parentId ? "已取消重新回答，原答案和补充内容已保留。" : "已取消等待，可以修改问题再试一次。");
    } else renderJourney("error", pending.options, readableError(error));
  } finally {
    setBusy(false);
    state.controller = null;
  }
}
// 将补充绑定到生成它的选项，读历史、复制和继续追问时使用同一份上下文。
function recordSupplements(record) {
  return Array.isArray(record?.options?.supplements)
    ? record.options.supplements.filter((item) => typeof item === "string").slice(0, 5)
    : [];
}

function renderSupplement(record) {
  const supplements = recordSupplements(record);
  const atLimit = supplements.length >= 5;
  $("#reader-panel-supplement").innerHTML = `<span class="section-kicker">ADD A LITTLE CONTEXT</span><h3 class="reader-panel-heading">让答案，更懂你的处境。</h3><p class="supplement-intro">${isDirect(record) ? "补充你指的具体事件、对象或想了解的内容，我们会结合原问题重新回答。" : "补充时间、预算或新的顾虑，我们会结合原问题重新选择。"}原答案和对话会留在「我的答案」中。</p><form id="supplement-form"><label class="sr-only" for="supplement-input">补充信息</label><textarea id="supplement-input" rows="5" maxlength="1000" placeholder="${isDirect(record) ? "比如：我指的是这件事，具体发生了…" : "比如：我只有周六下午有空，预算不超过 100 元，希望尽量少走路…"}" aria-describedby="supplement-hint" ${atLimit ? "disabled" : ""}></textarea><div class="supplement-form-bottom"><span id="supplement-hint">${atLimit ? "已补充 5 次，可以整理信息后再问一题。" : `第 ${supplements.length + 1} 次补充 · 最多 1000 字`}</span><button type="submit" class="primary-button" id="supplement-send" ${atLimit ? "disabled" : ""}>${isDirect(record) ? "结合补充重新回答" : "结合补充重新选择"}${icon("arrow")}</button></div></form><div id="supplement-error" class="form-error" role="alert" hidden></div>${supplements.length ? `<details class="supplement-context"><summary>回看之前的 ${supplements.length} 条补充</summary><ol>${supplements.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ol></details>` : ""}`;
  $("#supplement-input").value = state.supplementDrafts.get(record.id) || "";
}

async function askSupplement(event) {
  event?.preventDefault();
  if (state.busy || !state.current) return;
  const input = $("#supplement-input");
  const supplement = input.value.trim();
  const previous = recordSupplements(state.current);
  if (!supplement || supplement.length > 1000 || previous.length >= 5) {
    showError("#supplement-error", previous.length >= 5 ? "已补充 5 次，请整理已有信息后再问一题。" : "请填写补充信息，每次最多 1000 字。");
    input.focus();
    return;
  }
  if (state.ready === false) {
    showError("#supplement-error", "服务暂未就绪，请等待管理员配置后再试。");
    return;
  }
  showError("#supplement-error", "");
  state.supplementDrafts.set(state.current.id, input.value);
  // 无论原问题输入框是否被改动，补充始终作用于当前正在阅读的答案。
  state.pending = {
    question: state.current.question,
    category: state.current.category,
    supplements: [...previous, supplement],
    parentId: state.current.id,
    options: null,
  };
  await runJourney();
}

function renderResult(record) {
  const { options, decision } = record;
  const direct = isDirect(record);
  const chosen = direct ? { title: options.title } : options.choices.find(
    (choice) => choice.id === decision.choiceId,
  );
  const hasProbabilities = !direct && options.choices.every(
    (choice) =>
      Number.isFinite(decision.probabilities?.[choice.id]) &&
      decision.probabilities[choice.id] >= 0 &&
      decision.probabilities[choice.id] <= 1,
  );
  // 打开新答案时从第一页开始；同一条记录重绘时保留当前页码和草稿。
  const openingNewPage = state.readerRecordId !== record.id;
  if (openingNewPage) {
    state.readerRecordId = record.id;
    state.readerTab = "answer";
    state.followupPage = Math.max(0, validFollowups(record).length - 1);
  }
  const tabs = [["answer", "答案"], ...(!direct ? [["choices", "其他可能"]] : []), ["followup", "继续聊"], ["supplement", direct ? "补充信息" : "补充条件"]];
  const suggestions = direct
    ? [["能具体解释一下刚才的回答吗？", "展开说说"], ["这个回答的依据是什么？有哪些不能确定的地方？", "依据是什么？"], ["从另一个角度看，还有什么可能被忽略的因素？", "换个角度"]]
    : [["为什么更推荐这个选择？有哪些需要留意的地方？", "为什么这样选？"], ["如果决定这样做，我可以从哪些具体的小步骤开始？", "该怎么开始？"], ["从另一个角度看，还有什么可能被忽略的因素？", "换个角度"]];
  const choices = (direct ? [] : options.choices).map((choice, index) => {
    const selected = choice.id === decision.choiceId;
    const percent = hasProbabilities ? Math.round(decision.probabilities[choice.id] * 1000) / 10 : null;
    return `<details class="reader-choice ${selected ? "chosen" : ""}" ${selected ? "open" : ""}><summary class="choice-title"><span class="choice-letter">${String.fromCharCode(65 + index)}</span><b>${escapeHTML(choice.title)}</b>${selected ? icon("check") : ""}${hasProbabilities ? `<span class="choice-percent">${percent}%</span>` : ""}${icon("chevron")}</summary><p class="choice-description">${escapeHTML(choice.description)}</p>${hasProbabilities ? `<div class="probability-track" aria-hidden="true"><div class="probability-fill" style="width:${percent}%"></div></div>` : ""}</details>`;
  }).join("");
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(record.createdAt);
  $("#journey").hidden = true;
  $("#result").hidden = false;
  $("#result").innerHTML = `
    <div class="reader-book">
      <aside class="reader-context" aria-label="这一页的问题">
        <div class="reader-context-top"><span class="section-kicker">A MOMENT OF CLARITY</span><span class="reader-ribbon" aria-hidden="true">✧</span></div>
        <div class="reader-dedication"><h3>写给，<br>${direct ? "正在提问的你。" : "正在犹豫的你。"}</h3><p>${direct ? "把问题留在这一页，让想法清晰一点。" : "把问题留在这一页，让下一步清晰一点。"}</p></div>
        <blockquote class="reader-question">${escapeHTML(record.question.length > 160 ? `${record.question.slice(0, 160)}…` : record.question)}</blockquote>
        ${record.question.length > 160 ? `<details class="reader-question-details"><summary>阅读完整问题</summary><p>${escapeHTML(record.question)}</p></details>` : ""}
        <div class="reader-context-bottom"><span>${escapeHTML(categories[record.category] || "日常小事")}${recordSupplements(record).length ? ` · 已结合 ${recordSupplements(record).length} 条补充` : ""}</span><time datetime="${new Date(record.createdAt).toISOString()}">${date}</time><span class="reader-ornament" aria-hidden="true">— ✧ —</span></div>
      </aside>
      <div class="reader-page">
        <div class="reader-tabs" role="tablist" aria-label="翻阅答案">${tabs.map(([tab, label], index) => `<button type="button" role="tab" id="reader-tab-${tab}" class="reader-tab" data-reader-tab="${tab}" aria-controls="reader-panel-${tab}" aria-selected="false" tabindex="-1"><span class="reader-tab-number">0${index + 1}</span>${label}</button>`).join("")}</div>
        <div class="reader-panels">
          <section id="reader-panel-answer" class="reader-panel reader-scroll" data-reader-panel="answer" role="tabpanel" aria-labelledby="reader-tab-answer" tabindex="0">
            <div class="reader-answer-kicker">${icon("sparkles")}${direct ? "对你问题的回答" : "Jev 为你翻到的答案"}</div>
            <h3 class="reader-answer-title">${escapeHTML(chosen.title)}</h3>
            ${direct ? "" : `<p class="reader-answer-description">${escapeHTML(chosen.description)}</p>`}
            <div class="reader-divider" aria-hidden="true">✦</div>
            <p class="reader-explanation">${formatProse(answerBody(record))}</p>
            ${decision?.explanationUnavailable ? '<p class="probability-note">本次解读暂不可用，Jev 的选择已保留。</p>' : ""}
            ${direct ? "" : '<p class="reader-gentle-note">答案是启发，选择始终在你。</p>'}
          </section>
          ${direct ? "" : `<section id="reader-panel-choices" class="reader-panel reader-scroll" data-reader-panel="choices" role="tabpanel" aria-labelledby="reader-tab-choices" tabindex="0" hidden>
            <h3 class="reader-panel-heading">每一种可能，都值得看见。</h3><p class="reader-panel-intro">点开卡片，看看每个方向意味着什么。</p>
            <div class="choice-list">${choices}</div><p class="probability-note">${hasProbabilities ? "百分比表示模型对这些选项的相对倾向，不是现实中的成功率。" : "本次服务未提供概率分布，已保留 Jev 返回的选择。"}</p>
          </section>`}
          <section id="reader-panel-followup" class="reader-panel" data-reader-panel="followup" role="tabpanel" aria-labelledby="reader-tab-followup" hidden>
            <div class="followup-pagination" aria-label="追问卡片翻页"><button type="button" class="icon-button" data-followup-page="-1" aria-label="上一条追问">${icon("chevron")}</button><span id="followup-page-label" aria-live="polite"></span><button type="button" class="icon-button" data-followup-page="1" aria-label="下一条追问">${icon("chevron")}</button></div>
            <div id="followup-messages" class="followup-messages" aria-live="polite" tabindex="0" aria-label="当前追问内容"></div>
            <div class="followup-suggestions">${suggestions.map(([prompt, label]) => `<button type="button" data-followup="${escapeHTML(prompt)}">${label}</button>`).join("")}</div>
            <form id="followup-form"><label class="sr-only" for="followup-input">继续追问</label><textarea id="followup-input" rows="2" maxlength="1000" placeholder="带着这一页答案，继续聊聊…"></textarea><div class="followup-form-bottom"><span>AI 解读 · 参考最近 6 轮对话</span><button type="submit" class="primary-button" id="followup-send">继续追问${icon("arrow")}</button></div></form><div id="followup-error" class="form-error" role="alert" hidden></div>
          </section>
          <section id="reader-panel-supplement" class="reader-panel reader-scroll" data-reader-panel="supplement" role="tabpanel" aria-labelledby="reader-tab-supplement" tabindex="0" hidden></section>
        </div>
      </div>
      ${openingNewPage ? '<div class="reader-opening-cover" aria-hidden="true"><span>THE BOOK OF ANSWERS</span><strong>答案之书</strong><i>✧</i><small>每一页，都是一种可能</small></div>' : ""}
    </div>
    <footer class="reader-footer"><div class="reader-page-marker"><span id="reader-page-number">01 / 04</span><small>${direct ? "慢慢读，我们接着聊" : "慢慢读，不必急着决定"}</small></div><div class="reader-actions"><button type="button" class="secondary-button ${record.favorite ? "is-saved" : ""}" data-action="favorite-current" aria-pressed="${!!record.favorite}">${icon("bookmark")}${record.favorite ? "已收藏" : "收藏启示"}</button><button type="button" class="secondary-button" data-action="copy">${icon("copy")}复制答案</button><button type="button" class="secondary-button" data-action="new">再问一题${icon("arrow")}</button></div></footer>`;
  renderSupplement(record);
  $("#followup-input").value = state.followupDrafts.get(record.id) || "";
  renderFollowups(record);
  showReaderTab(state.readerTab);
  updateReaderResume();
}

function validFollowups(record) {
  return Array.isArray(record.followups)
    ? record.followups
        .filter(
          (message) =>
            typeof message?.question === "string" &&
            typeof message.answer === "string",
        )
        .slice(-20)
    : [];
}
function renderFollowups(record, pendingQuestion) {
  const container = $("#followup-messages");
  if (!container) return;
  const messages = validFollowups(record);
  const total = messages.length + (pendingQuestion ? 1 : 0);
  state.followupPage = Math.max(0, Math.min(state.followupPage, total - 1));
  const message = messages[state.followupPage];
  $("#followup-page-label").textContent = total ? `追问 ${state.followupPage + 1} / ${total}` : "这一页，留给你的追问";
  $("[data-followup-page='-1']").disabled = state.followupPage === 0;
  $("[data-followup-page='1']").disabled = state.followupPage >= total - 1;
  // 每次只渲染当前一轮，翻页不会让整个页面继续变长。
  container.innerHTML = message
    ? `<div class="followup-turn"><div class="chat-question"><span>你的追问 · ${state.followupPage + 1}</span><p>${escapeHTML(message.question)}</p></div><div class="chat-answer"><span>${icon("sparkles")}答案之书 · AI 解读</span><p>${formatProse(message.answer)}</p></div></div>`
    : pendingQuestion
      ? `<div class="followup-turn"><div class="chat-question"><span>你的追问</span><p>${escapeHTML(pendingQuestion)}</p></div><div class="chat-answer chat-thinking"><span class="spinner"></span>正在结合前面的对话思考…<button type="button" class="text-button" data-action="cancel">取消</button></div></div>`
      : `<div class="reader-chat-empty">${icon("book-open")}<h3>一个答案，也可以是对话的开始。</h3><p>${isDirect(record) ? "想了解更多，或补充具体情况？" : "为什么这样选，下一步怎么做？"}<br>你的每次追问，都会成为一张新的卡片。</p></div>`;
  container.scrollTop = 0;
}
async function askFollowup(event) {
  event?.preventDefault();
  if (state.busy || !state.current) return;
  const input = $("#followup-input");
  const followUp = input.value.trim();
  if (!followUp) {
    showError("#followup-error", "写下想深入了解的内容，我们接着聊。");
    input.focus();
    return;
  }
  if (followUp.length > 1000) {
    showError("#followup-error", "追问最多 1000 字，请精简后重试。");
    return;
  }
  const record = state.current;
  const controller = new AbortController();
  state.controller = controller;
  state.followupBusy = true;
  setBusy(true);
  showError("#followup-error", "");
  input.disabled = true;
  $("#followup-send").disabled = true;
  $$("[data-followup]").forEach((button) => {
    button.disabled = true;
  });
  state.pendingFollowup = followUp;
  state.followupPage = validFollowups(record).length;
  state.followupDrafts.set(record.id, input.value);
  renderFollowups(record, followUp);
  try {
    // 最近六轮用于模型上下文，完整可见对话保留最近二十轮并随答案存储。
    const { answer } = await api("/api/book/follow-up", {
      body: {
        question: record.question,
        supplements: recordSupplements(record),
        options: record.options,
        decision: record.decision,
        messages: validFollowups(record).slice(-6),
        followUp,
      },
      signal: controller.signal,
      timeout: 75000,
    });
    if (controller.signal.aborted) return;
    record.followups = [
      ...validFollowups(record),
      { question: followUp, answer },
    ].slice(-20);
    state.pendingFollowup = null;
    state.followupPage = record.followups.length - 1;
    state.followupDrafts.delete(record.id);
    persistRecords();
    renderFollowups(record);
    input.value = "";
    if (state.view !== "home") {
      renderHistory();
      toast("追问解读已完成，已保存到这条答案。");
    }
  } catch (error) {
    state.pendingFollowup = null;
    renderFollowups(record);
    if (controller.signal.aborted) toast("已取消等待，追问内容已保留。");
    else
      showError(
        "#followup-error",
        `${readableError(error)} 追问内容已保留，可以重新发送。`,
      );
  } finally {
    state.followupBusy = false;
    state.controller = null;
    setBusy(false);
    input.disabled = false;
    $("#followup-send").disabled = false;
    $$("[data-followup]").forEach((button) => {
      button.disabled = false;
    });
  }
}
function toggleFavorite(id) {
  if (state.busy) {
    toast("当前思考完成后就可以收藏这条答案。");
    return;
  }
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  record.favorite = !record.favorite;
  persistRecords();
  if (state.current?.id === id) {
    state.current = record;
    // 收藏只更新按钮，保留输入、展开状态、阅读位置和键盘焦点。
    const button = $("[data-action='favorite-current']");
    if (button) {
      button.classList.toggle("is-saved", record.favorite);
      button.setAttribute("aria-pressed", String(record.favorite));
      button.innerHTML = `${icon("bookmark")}${record.favorite ? "已收藏" : "收藏启示"}`;
    }
  }
  if (state.view !== "home") renderHistory();
  toast(
    record.favorite
      ? "这一页启示，已为你收藏。"
      : "已取消收藏，答案仍在历史中。",
  );
}
function renderHistory() {
  const favorites = state.view === "favorites";
  $("#library-title").textContent = favorites ? "收藏的启示" : "我的答案";
  $("#library-description").textContent = favorites
    ? "有些答案，值得在需要时再读一遍。"
    : "把走过的犹豫，留成下一次的勇气。";
  const search = $("#history-search").value.trim().toLocaleLowerCase();
  const records = state.records.filter(
    (record) =>
      (!favorites || record.favorite) &&
      `${record.question} ${recordSupplements(record).join(" ")} ${isDirect(record) ? answerTitle(record) : record.options.choices.map((choice) => choice.title).join(" ")} ${answerBody(record)}`
        .toLocaleLowerCase()
        .includes(search),
  );
  $("#history-list").innerHTML = records.length
    ? records
        .map((record) => {
          const title = answerTitle(record);
          return `<article class="history-card"><div class="history-meta"><span>${escapeHTML(categories[record.category] || "日常小事")}${recordSupplements(record).length ? ` · 补充 ${recordSupplements(record).length} 次` : ""}</span><time datetime="${new Date(record.createdAt).toISOString()}">${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(record.createdAt)}</time></div><h3>${escapeHTML(record.question)}</h3><div class="history-answer">${icon("sparkles")}${escapeHTML(title)}</div><div class="history-actions"><button class="text-button delete-record" data-delete="${escapeHTML(record.id)}" aria-label="删除这条答案">${icon("trash")}</button><button class="secondary-button ${record.favorite ? "is-saved" : ""}" data-favorite="${escapeHTML(record.id)}" aria-label="${record.favorite ? "取消收藏" : "收藏这条答案"}" aria-pressed="${!!record.favorite}">${icon("bookmark")}</button><button class="secondary-button" data-record="${escapeHTML(record.id)}">重读这一页${icon("arrow")}</button></div></article>`;
        })
        .join("")
    : `<div class="empty-state"><span>${icon(search ? "search" : favorites ? "bookmark" : "book-open")}</span><h3>${search ? "还没找到这一页" : favorites ? "为触动你的答案，折一个角" : "你的故事，从第一个问题开始"}</h3><p>${search ? "试试其他关键词，或清空搜索。" : favorites ? "在答案下点击「收藏启示」，就能在这里重温。" : "写下此刻的困惑，答案会被收录在这里。"}</p>${search ? '<button class="secondary-button" data-action="clear-search">清空搜索</button>' : '<button class="primary-button" data-view="home">翻开第一个答案' + icon("arrow") + "</button>"}</div>`;
  $("#history-list").insertAdjacentHTML(
    "beforeend",
    `<p class="storage-note">${state.storageAvailable ? "最多保存最近 100 条答案，仅保存在当前浏览器。" : "浏览器存储不可用，本次记录仅在当前页面保留。"}</p>`,
  );
}
function newQuestion() {
  if (state.busy) {
    toast("请先等待当前问题完成，或取消等待。");
    return;
  }
  state.current = null;
  state.pending = null;
  state.supplementOpen = null;
  state.readerRecordId = null;
  closeReader();
  $("#result").hidden = true;
  $("#journey").hidden = true;
  $("#question").value = "";
  saveDraft();
  showError("#form-error", "");
  setView("home");
  $("#question").focus();
  updateReaderResume();
}
async function copyAnswer() {
  const record = state.current;
  if (!record) return;
  const choice = isDirect(record) ? null : record.options.choices.find(
    (item) => item.id === record.decision.choiceId,
  );
  const conversation = validFollowups(record)
    .map(
      (message) => `\n\n追问：${message.question}\nAI 解读：${message.answer}`,
    )
    .join("");
  const supplements = recordSupplements(record).map((item, index) => `\n\n补充 ${index + 1}：${item}`).join("");
  const text = isDirect(record)
    ? `答案之书\n\n我的问题：${record.question}${supplements}\n\n${answerTitle(record)}\n${answerBody(record)}${conversation}`
    : `答案之书 · 遇事不决，Jev 解决\n\n我的问题：${record.question}${supplements}\n\nJev 的选择：${choice.title}\n${choice.description}\n\n${record.decision.explanation}${conversation}\n\n答案是启发，选择始终在你。`;
  try {
    await navigator.clipboard.writeText(text);
    toast("答案已复制，带着它迈出下一步。");
  } catch {
    // 普通局域网 HTTP 可能没有 Clipboard API，使用传统选区复制降级。
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;top:0;left:-9999px";
    ($("#reader-dialog").open ? $(".reader-shell") : document.body).append(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      /* 保留页面可选中的答案作为最后降级。 */
    }
    textarea.remove();
    toast(
      copied ? "答案已复制。" : "浏览器不支持自动复制，请长按答案文字复制。",
    );
  }
}

// 访客只获取服务是否就绪，不读取模型地址、密钥或其他管理员配置。
async function loadStatus() {
  try {
    const { ready } = await api("/api/status", { timeout: 10000 });
    state.ready = ready === true;
  } catch {
    state.ready = false;
  }
  $("#connection").classList.toggle("unconfigured", !state.ready);
  $("#connection-label").textContent = state.ready ? "服务可用" : "暂未就绪";
  $("#connection").title = state.ready
    ? "服务已配置，点击刷新状态"
    : "服务暂未就绪，请等待管理员配置或稍后再试；点击刷新状态";
}

// 事件委托覆盖动态结果和历史卡片，不重复绑定监听器。
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.view) {
    $("#history-search").value = "";
    setView(button.dataset.view);
  }
  if (button.dataset.category) selectCategory(button.dataset.category);
  if (button.dataset.prompt !== undefined) {
    const prompt = promptSets[state.promptIndex][Number(button.dataset.prompt)];
    selectCategory(prompt.category);
    $("#question").value = prompt.question;
    saveDraft();
    $("#question").focus();
    showError("#form-error", "");
  }
  if (button.dataset.favorite) toggleFavorite(button.dataset.favorite);
  if (button.dataset.followup) {
    $("#followup-input").value = button.dataset.followup;
    if (state.current) state.followupDrafts.set(state.current.id, button.dataset.followup);
    $("#followup-input").focus();
  }
  if (button.dataset.readerTab) showReaderTab(button.dataset.readerTab);
  if (button.dataset.followupPage && state.current) {
    state.followupPage += Number(button.dataset.followupPage);
    renderFollowups(state.current, state.pendingFollowup);
  }
  if (button.dataset.record) {
    if (state.busy) {
      toast("请先等待当前问题完成。");
      return;
    }
    const record = state.records.find(
      (item) => item.id === button.dataset.record,
    );
    if (record) {
      state.current = record;
      state.pending = null;
      setView("home");
      $("#question").value = record.question;
      selectCategory(record.category);
      $("#journey").hidden = true;
      renderResult(record);
      openReader();
    }
  }
  if (button.dataset.delete) {
    if (state.busy) {
      toast("请先等待当前对话完成，再整理历史记录。");
      return;
    }
    if (button.dataset.confirm !== "true") {
      button.dataset.confirm = "true";
      button.textContent = "确定删除这一条？";
      setTimeout(() => {
        if (button.isConnected) {
          button.dataset.confirm = "false";
          button.innerHTML = icon("trash");
        }
      }, 4000);
      return;
    }
    state.records = state.records.filter(
      (record) => record.id !== button.dataset.delete,
    );
    if (state.current?.id === button.dataset.delete) {
      state.current = null;
      state.pending = null;
      state.readerRecordId = null;
      $("#result").hidden = true;
      updateReaderResume();
    }
    persistRecords();
    renderHistory();
    toast("已删除这一条答案。");
  }
  const action = button.dataset.action;
  if (action === "resume-reader") openReader();
  if (action === "close-reader") {
    closeReader();
    $("#question").focus();
  }
  if (action === "back-to-answer" && state.current) {
    state.pending = null;
    renderResult(state.current);
  }
  if (action === "refresh-status") loadStatus();
  if (action === "cancel") state.controller?.abort();
  if (action === "retry") {
    if (state.pending?.parentId) {
      // 编辑补充后必须重新生成选项；原样重试则继续失败的阶段。
      const latest = state.pending.supplements.at(-1);
      if ($("#supplement-input")?.value.trim() !== latest) askSupplement();
      else runJourney();
      return;
    }
    // 用户编辑问题后重新开始；未编辑则复用已生成选项，避免重复请求大模型。
    if (
      $("#question").value.trim() !== state.pending?.question ||
      state.category !== state.pending?.category
    )
      askQuestion();
    else runJourney();
  }
  if (action === "favorite-current" && state.current)
    toggleFavorite(state.current.id);
  if (action === "copy") copyAnswer();
  if (action === "new") newQuestion();
  if (action === "clear-search") {
    $("#history-search").value = "";
    renderHistory();
  }
});
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  setView("home");
});
$("#question-form").addEventListener("submit", askQuestion);
$("#close-reader").addEventListener("click", closeReader);
$("#reader-dialog").addEventListener("close", () => {
  document.body.append($("#toast"));
  updateReaderResume();
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "followup-form") askFollowup(event);
  if (event.target.id === "supplement-form") askSupplement(event);
});
document.addEventListener("input", (event) => {
  if (event.target.id === "supplement-input" && state.current) {
    state.supplementDrafts.set(state.current.id, event.target.value);
  }
  if (event.target.id === "followup-input" && state.current) {
    state.followupDrafts.set(state.current.id, event.target.value);
  }
});
document.addEventListener("keydown", (event) => {
  // 标准页签键盘行为：左右键切页，Home / End 到首尾，Tab 进入当前内容。
  if (event.target.matches("[data-reader-tab]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const tabs = $$("[data-reader-tab]");
    const index = tabs.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    showReaderTab(tabs[next].dataset.readerTab, true);
    return;
  }
  if (event.target.id === "supplement-input" && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
    askSupplement(event);
    return;
  }
  if (
    event.target.id === "followup-input" &&
    (event.ctrlKey || event.metaKey) &&
    event.key === "Enter"
  )
    askFollowup(event);
});
$("#question").addEventListener("input", saveDraft);
$("#question").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
    askQuestion(event);
});
$("#shuffle-prompts").addEventListener("click", () => {
  state.promptIndex = (state.promptIndex + 1) % promptSets.length;
  renderPrompts();
});
$("#history-search").addEventListener("input", renderHistory);
hydrateIcons();
restoreLocalData();
selectCategory(state.category);
updateCounts();
renderPrompts();
setView("home");
loadStatus();
