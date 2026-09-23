import { createSolid, wheelTargetAngle, shortTitle } from './random-shared.js';

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = value => value.map(component => component / Math.hypot(...value));
const svgNS = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

// 将数学坐标的 Y 轴翻转为屏幕坐标；CSS matrix3d 使用列优先排列。
function faceTransform(u, v, normal, origin) {
  return `matrix3d(${[u[0], -u[1], u[2], 0, -v[0], v[1], -v[2], 0, normal[0], -normal[1], normal[2], 0, origin[0], -origin[1], origin[2], 1].join(',')})`;
}

function facingTransform(u, v, normal) {
  return `matrix3d(${[u[0], -v[0], normal[0], 0, -u[1], v[1], -normal[1], 0, u[2], -v[2], normal[2], 0, 0, 0, 0, 1].join(',')})`;
}

function makeSolid(choices, rotor) {
  const solid = createSolid(choices.length);
  const size = choices.length === 2 ? 83 : 79;
  const targets = [];
  const faces = [];
  solid.faces.forEach(({ indices, choiceIndex }) => {
    const points = indices.map(index => solid.vertices[index]);
    const center = points.reduce((sum, point) => sum.map((value, i) => value + point[i] / points.length), [0, 0, 0]);
    const normal = normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
    // 为每个面建立正交的文字坐标，选中后文字也会自然转正。
    const reference = Math.abs(normal[0]) > .9 ? [0, 0, -1] : [1, 0, 0];
    const u = normalize(reference.map((value, i) => value - normal[i] * dot(reference, normal)));
    const v = cross(normal, u);
    const projected = points.map(point => [dot(subtract(point, center), u) * size, -dot(subtract(point, center), v) * size]);
    const minX = Math.min(...projected.map(point => point[0]));
    const minY = Math.min(...projected.map(point => point[1]));
    const width = Math.max(...projected.map(point => point[0])) - minX;
    const height = Math.max(...projected.map(point => point[1])) - minY;
    const origin = center.map((value, i) => value * size + minX * u[i] - minY * v[i]);
    const face = document.createElement('div');
    face.className = `rl-face${choiceIndex === null ? ' rl-edge' : ''}${choices.length === 4 ? ' rl-triangle' : ''}${choices.length === 2 && choiceIndex !== null ? ' rl-coin-face' : ''}`;
    face.style.width = `${width}px`;
    face.style.height = `${height}px`;
    face.style.transform = faceTransform(u, v, normal, origin);
    face.style.clipPath = `polygon(${projected.map(point => `${(point[0] - minX) / width * 100}% ${(point[1] - minY) / height * 100}%`).join(',')})`;
    if (choiceIndex !== null) {
      face.dataset.choiceIndex = choiceIndex;
      face.title = choices[choiceIndex].title;
      const label = document.createElement('span');
      label.className = 'rl-face-label';
      label.textContent = shortTitle(choices[choiceIndex].title, 7);
      // 三角面以几何重心放文字，避免落在边缘的尖角中。
      label.style.left = `${-minX}px`;
      label.style.top = `${-minY}px`;
      face.append(label);
      targets[choiceIndex] = facingTransform(u, v, normal);
      faces[choiceIndex] = face;
    }
    rotor.append(face);
  });
  return { targets, faces };
}

function makeWheel(choices, rotor) {
  const svg = svgElement('svg', { viewBox: '-130 -130 260 260', 'aria-hidden': 'true' });
  svg.classList.add('rl-wheel');
  const faces = [];
  choices.forEach((choice, index) => {
    const angle = index * Math.PI * 2 / choices.length - Math.PI / 2;
    const half = Math.PI / choices.length;
    const radius = 119;
    const point = value => `${Math.cos(value) * radius} ${Math.sin(value) * radius}`;
    const group = svgElement('g', { 'data-choice-index': index });
    group.classList.add('rl-sector');
    if (index % 2) group.classList.add('rl-sector-alternate');
    group.append(svgElement('path', { d: `M 0 0 L ${point(angle - half)} A ${radius} ${radius} 0 0 1 ${point(angle + half)} Z` }));
    const text = svgElement('text', { transform: `translate(${Math.cos(angle) * 77} ${Math.sin(angle) * 77}) rotate(${angle * 180 / Math.PI + 90})`, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    text.textContent = shortTitle(choice.title, 5);
    group.append(text);
    svg.append(group);
    faces.push(group);
  });
  svg.append(svgElement('circle', { cx: 0, cy: 0, r: 15, class: 'rl-wheel-hub' }));
  rotor.append(svg);
  return { faces, targets: choices.map((_, index) => `rotate(${-wheelTargetAngle(index, choices.length)}rad)`) };
}

export function createLightPreview(host) {
  const scene = document.createElement('div');
  scene.className = 'rl-scene';
  scene.innerHTML = '<div class="rl-floor"></div><div class="rl-shadow"></div><div class="rl-lifter"><div class="rl-rotor"></div></div><div class="rl-pointer" aria-hidden="true"></div><div class="rl-status">准备好，把选择交给随机。</div>';
  host.append(scene);
  const rotor = scene.querySelector('.rl-rotor');
  const lifter = scene.querySelector('.rl-lifter');
  const shadow = scene.querySelector('.rl-shadow');
  const status = scene.querySelector('.rl-status');
  let choices = [], geometry = { faces: [], targets: [] }, animations = [], cancelCurrent = null, disposed = false;

  function cancel() {
    if (cancelCurrent) cancelCurrent();
    animations.forEach(animation => animation.cancel());
    animations = [];
    scene.classList.remove('rl-playing');
  }

  function reset() {
    cancel();
    geometry.faces.forEach(face => face.classList.remove('rl-selected'));
    rotor.style.transform = choices.length >= 7 ? 'rotate(0rad)' : `rotateX(-18deg) rotateY(24deg) ${geometry.targets[0] || ''}`;
    lifter.style.transform = '';
    status.textContent = '准备好，把选择交给随机。';
    delete scene.dataset.resultIndex;
    delete scene.dataset.selectedIndex;
  }

  function setChoices(nextChoices) {
    if (disposed) return;
    cancel();
    choices = nextChoices;
    rotor.replaceChildren();
    scene.classList.toggle('rl-is-wheel', choices.length >= 7);
    scene.classList.toggle('rl-is-coin', choices.length === 2);
    geometry = choices.length >= 7 ? makeWheel(choices, rotor) : makeSolid(choices, rotor);
    reset();
  }

  async function play(index, { signal, reducedMotion = false } = {}) {
    if (disposed || signal?.aborted) return;
    if (!Number.isInteger(index) || !choices[index]) throw new RangeError('候选答案序号无效');
    cancel();
    geometry.faces.forEach(face => face.classList.remove('rl-selected'));
    scene.classList.add('rl-playing');
    status.textContent = choices.length >= 7 ? '转盘正在慢慢决定…' : '让它在空中，再想一想…';
    delete scene.dataset.resultIndex;
    delete scene.dataset.selectedIndex;
    let aborted = false;
    let finishCancellation;
    const cancelled = new Promise(resolve => { finishCancellation = resolve; });
    const abort = () => {
      aborted = true;
      animations.forEach(animation => animation.cancel());
      scene.classList.remove('rl-playing');
      status.textContent = '动画已停止。';
      finishCancellation();
    };
    cancelCurrent = abort;
    signal?.addEventListener('abort', abort, { once: true });
    const target = geometry.targets[index];
    // 视觉随机性只改变抛掷路径，最终答案始终由外部统一抽取。
    if (!reducedMotion && typeof rotor.animate === 'function') {
      if (choices.length >= 7) {
        const degrees = -wheelTargetAngle(index, choices.length) * 180 / Math.PI;
        animations.push(rotor.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${1800 + degrees}deg)` }], { duration: 3000, easing: 'cubic-bezier(.12,.68,.13,1)', fill: 'forwards' }));
      } else {
        const turns = choices.length === 2 ? 1080 : 720;
        animations.push(rotor.animate([
          { transform: rotor.style.transform, offset: 0 },
          { transform: `rotateX(${turns * .4}deg) rotateY(260deg) rotateZ(-24deg) ${target}`, offset: .35 },
          { transform: `rotateX(${turns - 95}deg) rotateY(670deg) rotateZ(16deg) ${target}`, offset: .68 },
          { transform: `rotateX(${turns + 14}deg) rotateY(727deg) rotateZ(-4deg) ${target}`, offset: .88 },
          { transform: `rotateX(${turns}deg) rotateY(720deg) rotateZ(0deg) ${target}`, offset: 1 },
        ], { duration: 3000, easing: 'ease-in-out', fill: 'forwards' }));
        animations.push(lifter.animate([
          { transform: 'translate3d(0,0,0)', offset: 0 },
          { transform: 'translate3d(-18px,-72px,0)', offset: .3 },
          { transform: 'translate3d(12px,20px,0)', offset: .6 },
          { transform: 'translate3d(6px,-24px,0)', offset: .73 },
          { transform: 'translate3d(0,7px,0)', offset: .87 },
          { transform: 'translate3d(0,0,0)', offset: 1 },
        ], { duration: 3000, easing: 'ease-in-out', fill: 'forwards' }));
        animations.push(shadow.animate([{ transform: 'translateX(-50%) scale(1)', opacity: .2 }, { transform: 'translateX(-50%) scale(.6)', opacity: .08, offset: .3 }, { transform: 'translateX(-50%) scale(1.1)', opacity: .25, offset: .6 }, { transform: 'translateX(-50%) scale(1)', opacity: .2 }], { duration: 3000, fill: 'forwards' }));
      }
    }
    await Promise.race([Promise.all(animations.map(animation => animation.finished.catch(() => {}))), cancelled]);
    signal?.removeEventListener('abort', abort);
    if (aborted || disposed) {
      if (cancelCurrent === abort) cancelCurrent = null;
      return;
    }
    animations.forEach(animation => animation.cancel());
    animations = [];
    cancelCurrent = null;
    rotor.style.transform = target;
    scene.classList.remove('rl-playing');
    geometry.faces[index].classList.add('rl-selected');
    scene.dataset.resultIndex = index;
    scene.dataset.selectedIndex = index;
    status.textContent = `命中 · ${choices[index].title}`;
  }

  function dispose() {
    cancel();
    disposed = true;
    scene.remove();
  }

  return { setChoices, play, reset, dispose };
}
