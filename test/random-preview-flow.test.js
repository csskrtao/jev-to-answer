import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EXAMPLES, exampleChoices } from '../public/random-shared.js';

// 执行真实主控源码，仅替换模块边界，不复制被测的流程实现。
const source = readFileSync(new URL('../public/random-preview.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace("import('./random-physics.bundle.js')", 'loadPhysics()');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

// 小型 DOM 只实现本页面用到的接口，测试不依赖浏览器或额外安装包。
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      contains: name => this.classes.has(name),
    };
    this.value = '';
  }
  set textContent(value) { this.value = String(value); this.children = []; }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.value = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  dispatch(name, event = {}) { return this.listeners.get(name)?.(event); }
}

function renderer() {
  return {
    calls: [], choices: [], disposeCount: 0,
    setChoices(choices) { this.choices = choices; },
    play(index, settings) {
      // 故意不自动响应 abort，验证即便渲染器迟到也不能污染新结果。
      const completion = deferred();
      this.calls.push({ index, settings, completion });
      return completion.promise;
    },
    dispose() { this.disposeCount++; },
  };
}

async function fixture({ physicsFails = false, reducedMotion = false, index = 1 } = {}) {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  get('#physics-error').hidden = true;
  const light = renderer(), physics = renderer();
  const window = new Element(), media = new Element();
  media.matches = reducedMotion;
  const randomCalls = [], requests = [];
  const network = (...args) => { requests.push(args); throw new Error('动画演示不得请求业务网络'); };
  const context = vm.createContext({
    EXAMPLES, exampleChoices, AbortController,
    document: {
      querySelector: get,
      querySelectorAll: selector => selector === '.sample-tab' ? get('#sample-tabs').children : [],
      createElement: tag => new Element(tag),
      createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; },
    },
    window, matchMedia: () => media,
    fetch: network, XMLHttpRequest: network, WebSocket: network,
    navigator: { sendBeacon: network },
    randomIndex: count => { randomCalls.push(count); return index; },
    createLightPreview: () => light,
    loadPhysics: async () => {
      if (physicsFails) throw new Error('模拟 3D 模块加载失败');
      return { createPhysicsPreview: () => physics };
    },
  });
  await vm.runInContext(`(async () => { ${source}\n })()`, context);
  const play = () => get('#play-comparison').dispatch('click');
  const select = count => get('#sample-tabs').children.find(button => Number(button.dataset.count) === count).dispatch('click');
  const finish = call => {
    light.calls[call].completion.resolve();
    physics.calls[call]?.completion.resolve(physics.calls[call].index);
  };
  return { get, light, physics, window, media, randomCalls, requests, play, select, finish };
}

test('所有示例每轮只抽一次，两版收到相同结果，结果与完整候选一致且无业务网络请求', async () => {
  const f = await fixture();
  for (const [round, example] of EXAMPLES.entries()) {
    f.select(example.count);
    const task = f.play();
    const light = f.light.calls[round], physics = f.physics.calls[round];
    assert.equal(f.randomCalls.length, round + 1);
    assert.equal(f.randomCalls[round], example.count);
    assert.equal(light.index, 1);
    assert.equal(physics.index, light.index);
    assert.equal(light.settings.signal, physics.settings.signal);
    f.finish(round);
    await task;
    assert.ok(f.get('#light-result').textContent.includes(example.titles[1]));
    assert.equal(f.get('#light-result').textContent, f.get('#physics-result').textContent);
    const selected = f.get('#candidate-list').children.filter(item => item.classList.contains('is-selected'));
    assert.equal(selected.length, 1);
    assert.ok(selected[0].textContent.includes(example.titles[1]));
    assert.equal(selected[0].attributes['aria-current'], 'true');
  }
  assert.equal(f.requests.length, 0);
});

test('播放中重复触发不叠加动画，完成后允许再次播放', async () => {
  const f = await fixture();
  const task = f.play();
  assert.equal(f.get('#play-comparison').disabled, true);
  await f.play();
  assert.equal(f.randomCalls.length, 1);
  assert.equal(f.light.calls.length, 1);
  assert.equal(f.physics.calls.length, 1);
  f.finish(0);
  await task;
  assert.equal(f.get('#play-comparison').disabled, false);
  const next = f.play();
  assert.equal(f.randomCalls.length, 2);
  f.finish(1);
  await next;
});

test('3D 实际正面与预抽结果不一致时不显示错误的结果卡', async () => {
  const f = await fixture({ index: 1 });
  const task = f.play();
  f.light.calls[0].completion.resolve();
  f.physics.calls[0].completion.resolve(2);
  await task;
  assert.equal(f.get('#physics-result').classList.contains('is-revealed'), false);
  assert.equal(f.get('#physics-error').hidden, false);
  assert.equal(f.get('#light-result').classList.contains('is-revealed'), true);
  assert.equal(f.get('#play-comparison').disabled, false);
});

test('切换示例取消旧动画，迟到完成既不写结果也不解锁正在播放的新一轮', async () => {
  const f = await fixture();
  const old = f.play();
  f.select(2);
  assert.equal(f.light.calls[0].settings.signal.aborted, true);
  assert.equal(f.physics.calls[0].settings.signal.aborted, true);
  assert.equal(f.light.choices.length, 2);
  assert.equal(f.physics.choices.length, 2);
  const current = f.play();
  f.finish(0);
  await old;
  assert.equal(f.get('#light-result').classList.contains('is-revealed'), false);
  assert.equal(f.get('#physics-result').classList.contains('is-revealed'), false);
  assert.equal(f.get('#play-comparison').disabled, true);
  f.finish(1);
  await current;
  assert.ok(f.get('#light-result').textContent.includes(EXAMPLES[0].titles[1]));
});

test('3D 模块加载失败仍可播放轻动画，保留明确的不可用提示', async () => {
  const f = await fixture({ physicsFails: true });
  assert.equal(f.get('#physics-error').hidden, false);
  assert.match(f.get('#physics-error').textContent, /WebGL/);
  assert.equal(f.get('#play-comparison').disabled, false);
  const task = f.play();
  f.finish(0);
  await task;
  assert.equal(f.light.calls.length, 1);
  assert.equal(f.physics.calls.length, 0);
  assert.equal(f.get('#light-result').classList.contains('is-revealed'), true);
  assert.match(f.get('#physics-result').textContent, /无法展示 3D/);
  assert.equal(f.requests.length, 0);
});

test('减少动态效果设置传给两版，并在系统偏好改变后同步更新', async () => {
  const f = await fixture({ reducedMotion: true });
  assert.equal(f.get('#reduced-note').hidden, false);
  const first = f.play();
  assert.equal(f.light.calls[0].settings.reducedMotion, true);
  assert.equal(f.physics.calls[0].settings.reducedMotion, true);
  f.finish(0);
  await first;
  f.media.matches = false;
  f.media.dispatch('change');
  assert.equal(f.get('#reduced-note').hidden, true);
  const next = f.play();
  assert.equal(f.light.calls[1].settings.reducedMotion, false);
  assert.equal(f.physics.calls[1].settings.reducedMotion, false);
  f.finish(1);
  await next;
});

test('真正离开页面取消投掷并销毁两版资源，迟到完成不揭晓', async () => {
  const f = await fixture();
  const task = f.play();
  f.window.dispatch('pagehide', { persisted: false });
  assert.equal(f.light.calls[0].settings.signal.aborted, true);
  assert.equal(f.light.disposeCount, 1);
  assert.equal(f.physics.disposeCount, 1);
  f.finish(0);
  await task;
  assert.equal(f.get('#light-result').classList.contains('is-revealed'), false);
});

test('进入往返缓存只取消动画，恢复页面后可继续播放', async () => {
  const f = await fixture();
  const task = f.play();
  f.window.dispatch('pagehide', { persisted: true });
  assert.equal(f.light.calls[0].settings.signal.aborted, true);
  assert.equal(f.light.disposeCount, 0);
  assert.equal(f.physics.disposeCount, 0);
  f.finish(0);
  await task;
  f.window.dispatch('pageshow', { persisted: true });
  assert.equal(f.get('#play-comparison').disabled, false);
  const next = f.play();
  f.finish(1);
  await next;
  assert.equal(f.get('#light-result').classList.contains('is-revealed'), true);
});
