import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createSolid, wheelTargetAngle, shortTitle } from '../public/random-shared.js';

// 注入真实几何和物理引擎，只替换浏览器/GPU 边界，不复制被测的朝向算法。
const source = readFileSync(new URL('../preview-src/physics.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export function createPhysicsPreview', 'function createPhysicsPreview');

class Element {
  constructor() { this.style = {}; this.dataset = {}; this.children = []; this.attributes = {}; }
  appendChild(child) { this.children.push(child); child.parent = this; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getBoundingClientRect() { return { width: 500, height: 330 }; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}

function canvas() {
  const element = new Element();
  element.texts = [];
  const context = new Proxy({
    clearRect: () => { element.texts = []; },
    fillText: text => element.texts.push(text),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  element.getContext = () => context;
  return element;
}

function fixture(t) {
  const host = new Element();
  const callbacks = new Map();
  let sequence = 0, now = 0, snapshot;
  class Renderer {
    constructor() {
      this.domElement = new Element();
      this.shadowMap = {};
      this.capabilities = { getMaxAnisotropy: () => 4 };
    }
    setPixelRatio() {}
    setSize() {}
    render(scene, camera) {
      // 真正 WebGLRenderer 同样会更新世界矩阵；射线随后直接命中真实 BufferGeometry。
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      snapshot = { scene, camera };
    }
    dispose() {}
    forceContextLoss() {}
  }
  class Observer { observe() {} disconnect() {} }
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({
    THREE: { ...THREE, WebGLRenderer: Renderer }, CANNON,
    createSolid, wheelTargetAngle, shortTitle,
    document: { documentElement: new Element(), createElement: canvas },
    window: { devicePixelRatio: 1, matchMedia: () => media },
    ResizeObserver: Observer, MutationObserver: Observer,
    performance: { now: () => now },
    requestAnimationFrame: callback => { callbacks.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => callbacks.delete(id),
  });
  const preview = vm.runInContext(`${source}\ncreatePhysicsPreview`, context)(host);
  t.after(() => preview.dispose());
  function advanceTo(time) {
    while (now < time) {
      now = Math.min(time, now + 25);
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach(callback => callback(now));
    }
  }
  function jumpFrame(time) {
    now = time;
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach(callback => callback(now));
  }
  return { preview, host, advanceTo, jumpFrame, get now() { return now; }, get snapshot() { return snapshot; }, callbacks };
}

const choicesFor = count => Array.from({ length: count }, (_, index) => ({
  id: `choice-${index}`, title: `候选${index + 1}的完整中文答案`, description: '表面缩略，结果保留全文。',
}));

function texturedFaces(snapshot) {
  const faces = [];
  snapshot.scene.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material.map?.image?.texts.length) return;
    const positions = mesh.geometry.getAttribute('position');
    const unique = new Map();
    for (let index = 0; index < positions.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, index);
      unique.set(point.toArray().join(','), point);
    }
    const center = [...unique.values()].reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .divideScalar(unique.size).applyMatrix4(mesh.matrixWorld);
    const normal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('normal'), 0)
      .transformDirection(mesh.matrixWorld);
    const direction = snapshot.camera.position.clone().sub(center).normalize();
    faces.push({ mesh, center, normal, alignment: normal.dot(direction), title: mesh.material.map.image.texts.join('') });
  });
  return faces.sort((a, b) => b.alignment - a.alignment);
}

function assertFrontAnswer(f, choice, strictlyFacing = true) {
  const faces = texturedFaces(f.snapshot);
  assert.ok(faces.length >= 2);
  const front = faces[0];
  assert.equal(front.title, shortTitle(choice.title, 8), '真实最朝向用户的材质必须写着命中答案');
  if (strictlyFacing) assert.ok(front.alignment > 1 - 1e-8, `命中面必须准确正对相机，实际点积 ${front.alignment}`);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), f.snapshot.camera);
  const hit = ray.intersectObjects(f.snapshot.scene.children, true)[0];
  if (strictlyFacing) assert.equal(hit?.object, front.mesh, '落定时画面中央射线必须首先命中答案面，不能被其他面遮挡');
  return front.mesh.parent.quaternion.clone();
}

test('物理 3D 全部实体答案面直接朝向镜头，实际射线、纹理和返回结果一致', async t => {
  const f = fixture(t);
  for (const count of [2, 3, 4, 5, 6]) {
    const choices = choicesFor(count);
    f.preview.setChoices(choices);
    for (let index = 0; index < count; index++) {
      assert.equal(await f.preview.play(index, { reducedMotion: true }), index);
      assertFrontAnswer(f, choices[index]);
      assert.equal(f.host.dataset.selectedIndex, String(index));
    }
  }
  assert.equal(f.callbacks.size, 0, '减少动态效果时不应创建动画帧');
});

test('所有实体最后下落与弹跳只展示同一答案面，停稳后不再翻向其他答案', async t => {
  const f = fixture(t);
  for (const count of [2, 3, 4, 5, 6]) {
    const choices = choicesFor(count);
    f.preview.setChoices(choices);
    for (let index = 0; index < count; index++) {
      const start = f.now;
      const playing = f.preview.play(index);
      f.advanceTo(start + 2100);
      const orientation = assertFrontAnswer(f, choices[index], false);
      assert.equal(f.host.dataset.selectedIndex, undefined, '尚未落稳时不提前揭晓结果');
      for (const elapsed of [3000, 3900, 4775, 4800]) {
        f.advanceTo(start + elapsed);
        const next = assertFrontAnswer(f, choices[index], elapsed >= 3900);
        assert.ok(1 - Math.abs(orientation.dot(next)) < 1e-10, '最后下落及停稳阶段不能再翻面');
        if (elapsed < 4800) assert.equal(f.host.dataset.selectedIndex, undefined, '落地后还需完整静止等待，不能提前高亮答案');
      }
      assert.equal(await playing, index);
      assert.equal(f.host.dataset.selectedIndex, String(index));
      assert.equal(f.callbacks.size, 0);
    }
  }
});

test('取消、切换及重复投掷不会留下旧动画或迟到结果', async t => {
  const f = fixture(t);
  f.preview.setChoices(choicesFor(6));
  const controller = new AbortController();
  const cancelled = f.preview.play(5, { signal: controller.signal });
  f.advanceTo(1000);
  controller.abort();
  await cancelled;
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.host.dataset.selectedIndex, undefined);

  const replaced = f.preview.play(2);
  f.preview.setChoices(choicesFor(3));
  await replaced;
  assert.equal(f.callbacks.size, 0);
  const first = f.preview.play(0);
  const second = f.preview.play(2);
  await first;
  const start = f.now;
  f.advanceTo(start + 4800);
  assert.equal(await second, 2);
  assertFrontAnswer(f, choicesFor(3)[2]);
  assert.equal(f.callbacks.size, 0);
  f.preview.dispose();
  f.preview.dispose();
  assert.equal(f.host.children.length, 0);
});

test('固定镜头展示完整下落，落地后静止九百毫秒才返回结果', async t => {
  const f = fixture(t);
  f.preview.setChoices(choicesFor(6));
  let completed = false;
  const playing = f.preview.play(3).then(index => { completed = true; return index; });
  f.advanceTo(2100);
  const face = texturedFaces(f.snapshot)[0];
  const object = face.mesh.parent;
  const raised = object.position.y;
  const camera = f.snapshot.camera.position.clone();
  f.advanceTo(3900);
  assert.ok(raised - object.position.y > 0.5, '物体应在固定镜头内明显下落');
  assert.ok(camera.distanceTo(f.snapshot.camera.position) < 1e-10, '最后下落时镜头不能跟着物体移动');
  const landed = object.position.clone();
  const bounds = new THREE.Box3().setFromObject(object);
  assert.ok(Math.abs(bounds.min.y - (-1.22 + 0.015)) < 1e-6, '物体底部必须真正触及桌面容差');
  f.advanceTo(4775);
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(f.host.dataset.selectedIndex, undefined);
  assert.ok(landed.distanceTo(object.position) < 1e-10, '揭晓前停留期保持静止');
  f.advanceTo(4800);
  assert.equal(await playing, 3);
});

test('后台卡顿跨过动画时间不能跳过下落与静止等待', async t => {
  const f = fixture(t);
  f.preview.setChoices(choicesFor(4));
  const playing = f.preview.play(1);
  f.advanceTo(500);
  f.jumpFrame(20000);
  assert.equal(f.host.dataset.selectedIndex, undefined);
  f.advanceTo(24225);
  assert.equal(f.host.dataset.selectedIndex, undefined);
  f.advanceTo(24250);
  assert.equal(await playing, 1);
});
