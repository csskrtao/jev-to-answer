import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightPreview } from '../public/random-light.js';

// 只模拟渲染器使用的浏览器接口；所有面片、目标矩阵和动画仍由真实模块生成。
function mockBrowser(t) {
  const animations = [];
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.className = '';
      this.textContent = '';
      this.parentNode = null;
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const enabled = force ?? !this.classList.contains(name);
          this.classList[enabled ? 'add' : 'remove'](name);
          return enabled;
        },
      };
    }
    append(...children) {
      children.forEach(child => { child.parentNode = this; this.children.push(child); });
    }
    replaceChildren(...children) {
      this.children.forEach(child => { child.parentNode = null; });
      this.children = [];
      this.append(...children);
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      const matches = element => selector.startsWith('.') ? element.classList.contains(selector.slice(1)) : element.tagName === selector;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    set innerHTML(html) {
      this.replaceChildren();
      const stack = [this];
      for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (token.startsWith('<')) {
          const element = new Element(token.match(/^<(\w+)/)[1]);
          for (const attribute of token.matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attribute[1], attribute[2]);
          stack.at(-1).append(element);
          stack.push(element);
        } else stack.at(-1).textContent += token;
      }
    }
    animate(keyframes, options) {
      let resolve, reject;
      const animation = {
        element: this,
        keyframes,
        options,
        state: 'running',
        finished: new Promise((done, fail) => { resolve = done; reject = fail; }),
        cancel() {
          if (this.state !== 'running') return;
          this.state = 'cancelled';
          reject(new Error('Animation cancelled'));
        },
        finish() {
          if (this.state !== 'running') return;
          this.state = 'finished';
          resolve();
        },
      };
      animations.push(animation);
      return animation;
    }
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  return { host: new Element('main'), animations };
}

const choicesFor = count => Array.from({ length: count }, (_, index) => ({ id: `choice-${index}`, title: `第${index + 1}个完整中文候选答案🌳`, description: '用于核对完整结果，表面允许缩略。' }));

// 用渲染后的矩阵变换两条面内方向，再求法线；不复用渲染器的目标朝向算法。
function matrixFrom(element) {
  const match = element.style.transform.match(/^matrix3d\(([^)]+)\)$/);
  assert.ok(match, '结果应收束为确定的 3D 矩阵');
  const values = match[1].split(',').map(Number);
  assert.equal(values.length, 16);
  assert.ok(values.every(Number.isFinite));
  return values;
}
function transformDirection(matrix, direction) {
  return [0, 1, 2].map(row => direction.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
}
function assertFaceTowardCamera(face, rotor) {
  const faceMatrix = matrixFrom(face);
  const rotorMatrix = matrixFrom(rotor);
  const x = transformDirection(rotorMatrix, transformDirection(faceMatrix, [1, 0, 0]));
  const y = transformDirection(rotorMatrix, transformDirection(faceMatrix, [0, 1, 0]));
  const normal = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  assert.ok(Math.hypot(normal[0], normal[1], normal[2] - 1) < 1e-8, '实际命中面必须正对镜头');
  assert.ok(x[0] > .999 && y[1] > .999, '命中面的文字必须正向显示');
}
async function settles(promise) {
  let timeout;
  try {
    await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('播放 Promise 未结束')), 250); })]);
  } finally { clearTimeout(timeout); }
}

test('轻动画所有实体面均可命中，渲染矩阵朝向镜头且保留完整结果文字', async t => {
  const { host, animations } = mockBrowser(t);
  const preview = createLightPreview(host);
  for (const count of [2, 3, 4, 5, 6]) {
    const choices = choicesFor(count);
    preview.setChoices(choices);
    const scene = host.querySelector('.rl-scene');
    const rotor = host.querySelector('.rl-rotor');
    const selectable = host.querySelectorAll('.rl-face').filter(face => face.dataset.choiceIndex !== undefined);
    assert.equal(selectable.length, count, '端面不应意外承载额外候选');
    for (let index = 0; index < count; index++) {
      await preview.play(index, { reducedMotion: true });
      const selected = host.querySelectorAll('.rl-selected');
      assert.equal(selected.length, 1);
      assert.equal(Number(selected[0].dataset.choiceIndex), index);
      assert.equal(Number(scene.dataset.selectedIndex), index);
      assert.equal(selected[0].title, choices[index].title);
      assert.ok(selected[0].querySelector('.rl-face-label').textContent.endsWith('…'));
      assert.equal(host.querySelector('.rl-status').textContent, `命中 · ${choices[index].title}`);
      assertFaceTowardCamera(selected[0], rotor);
      preview.reset();
      assert.equal(scene.dataset.selectedIndex, undefined);
      assert.equal(host.querySelectorAll('.rl-selected').length, 0);
    }
  }
  assert.equal(animations.length, 0, '减少动态效果时不应创建动画');
  preview.dispose();
  assert.equal(host.children.length, 0);
});

test('轻动画转盘每个实际扇区停在顶部指针处', async t => {
  const { host } = mockBrowser(t);
  const preview = createLightPreview(host);
  for (const count of [7, 8, 12]) {
    preview.setChoices(choicesFor(count));
    assert.ok(host.querySelector('.rl-scene').classList.contains('rl-is-wheel'));
    assert.ok(host.querySelector('.rl-pointer'));
    assert.equal(host.querySelectorAll('.rl-sector').length, count);
    for (let index = 0; index < count; index++) {
      await preview.play(index, { reducedMotion: true });
      const selected = host.querySelectorAll('.rl-selected');
      assert.equal(selected.length, 1);
      assert.equal(Number(selected[0].dataset.choiceIndex), index);
      const labelTransform = selected[0].querySelector('text').getAttribute('transform');
      const [, x, y] = labelTransform.match(/^translate\(([^ ]+) ([^)]+)\)/).map(Number);
      const angle = Number(host.querySelector('.rl-rotor').style.transform.match(/^rotate\((.+)rad\)$/)[1]);
      const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
      const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
      assert.ok(Math.abs(rotatedX) < 1e-8, '实际扇区中心应与指针对齐');
      assert.ok(rotatedY < -70, '命中扇区应在顶部而非底部');
    }
  }
  preview.dispose();
});

test('播放中切换候选会取消旧动画，旧 Promise 不会污染新场景', async t => {
  const { host, animations } = mockBrowser(t);
  const preview = createLightPreview(host);
  preview.setChoices(choicesFor(6));
  const previousPlay = preview.play(5);
  assert.equal(animations.filter(animation => animation.state === 'running').length, 3);
  assert.equal(host.querySelector('.rl-scene').dataset.selectedIndex, undefined);
  preview.setChoices(choicesFor(8));
  await settles(previousPlay);
  assert.ok(animations.every(animation => animation.state === 'cancelled'));
  assert.equal(host.querySelectorAll('.rl-selected').length, 0);
  assert.equal(host.querySelector('.rl-scene').dataset.selectedIndex, undefined);
  assert.equal(host.querySelectorAll('.rl-sector').length, 8);
  assert.equal(host.querySelector('.rl-status').textContent, '准备好，把选择交给随机。');
  await preview.play(2, { reducedMotion: true });
  assert.equal(Number(host.querySelector('.rl-scene').dataset.selectedIndex), 2);
  preview.dispose();
});

test('快速重复播放只揭晓最后一轮，正常结束后才能标记结果', async t => {
  const { host, animations } = mockBrowser(t);
  const preview = createLightPreview(host);
  preview.setChoices(choicesFor(4));
  const first = preview.play(0);
  const second = preview.play(3);
  await settles(first);
  assert.equal(animations.filter(animation => animation.state === 'cancelled').length, 3);
  assert.equal(host.querySelectorAll('.rl-selected').length, 0);
  assert.equal(host.querySelector('.rl-scene').dataset.selectedIndex, undefined);
  animations.filter(animation => animation.state === 'running').forEach(animation => animation.finish());
  await settles(second);
  assert.equal(Number(host.querySelector('.rl-scene').dataset.selectedIndex), 3);
  assert.equal(host.querySelectorAll('.rl-selected').length, 1);
  assertFaceTowardCamera(host.querySelector('.rl-selected'), host.querySelector('.rl-rotor'));
  preview.dispose();
});

test('外部取消及重复销毁不会遗留动画或悬挂 Promise', async t => {
  const { host, animations } = mockBrowser(t);
  const preview = createLightPreview(host);
  preview.setChoices(choicesFor(2));
  const controller = new AbortController();
  const playing = preview.play(1, { signal: controller.signal });
  controller.abort();
  await settles(playing);
  assert.ok(animations.every(animation => animation.state === 'cancelled'));
  assert.equal(host.querySelectorAll('.rl-selected').length, 0);
  assert.equal(host.querySelector('.rl-scene').classList.contains('rl-playing'), false);
  const next = preview.play(0);
  preview.dispose();
  preview.dispose();
  await settles(next);
  await settles(preview.play(0));
  assert.equal(host.children.length, 0);
  assert.ok(animations.every(animation => animation.state === 'cancelled'));
});
