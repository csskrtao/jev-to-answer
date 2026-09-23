import { EXAMPLES, exampleChoices, randomIndex } from './random-shared.js';
import { createLightPreview } from './random-light.js';

const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let example = EXAMPLES[3], choices = exampleChoices(example);
let controller = null, generation = 0, physics = null, physicsReady = false;
const light = createLightPreview($('#light-stage'));

// 所有模型文字通过 textContent 写入，演示以后接入真实候选时也不会执行 HTML。
function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function result(slot, choice = null, unavailable = false) {
  slot.classList.toggle('is-revealed', Boolean(choice));
  const body = textElement('p', choice ? choice.title : unavailable ? '这台设备暂时无法展示 3D。' : '答案，还藏在可能里。');
  body.append(textElement('small', choice ? '本次随机抽中 · 每个答案机会相同' : unavailable ? '左侧轻动画仍可正常体验' : '播放后在这里揭晓'));
  slot.replaceChildren(textElement('span', choice ? '✦' : '✧', 'result-spark'), body);
}

function status(title, subtitle) {
  $('#play-status').replaceChildren(document.createTextNode(title), textElement('small', subtitle));
}

function renderCandidates(selected = -1) {
  $('#candidate-list').replaceChildren(...choices.map((choice, index) => {
    const item = document.createElement('li');
    item.classList.toggle('is-selected', index === selected);
    if (index === selected) item.setAttribute('aria-current', 'true');
    item.append(textElement('span', String(index + 1).padStart(2, '0')), textElement('span', choice.title));
    return item;
  }));
}

function selectExample(next) {
  // 代次标识与 AbortSignal 同时使用，旧动画的回调不能覆盖新示例。
  generation++;
  controller?.abort();
  controller = null;
  example = next;
  choices = exampleChoices(example);
  light.setChoices(choices);
  physics?.setChoices(choices);
  if (physics) $('#physics-error').hidden = true;
  document.querySelectorAll('.sample-tab').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.count) === example.count)));
  $('#sample-question').textContent = example.question;
  $('#odds-label').textContent = `每个答案 · 1/${example.count} 的机会`;
  $('#candidate-count').textContent = `${example.count} 个候选 · 等概率`;
  $('#light-stage').setAttribute('aria-label', `立体轻动画：${example.name}，等待投掷`);
  $('#physics-stage').setAttribute('aria-label', `物理 3D：${example.name}，等待投掷`);
  renderCandidates();
  result($('#light-result'));
  result($('#physics-result'), null, !physics && !$('#physics-error').hidden);
  status('同一组候选，同一个随机结果。', '两版同时播放，让感觉来做选择。');
  $('#play-comparison').disabled = !physicsReady;
  $('#play-label').textContent = physicsReady ? '播放对比' : '准备道具中';
}

async function playComparison() {
  if (controller || !physicsReady) return;
  const token = ++generation;
  controller = new AbortController();
  const { signal } = controller;
  $('#play-comparison').disabled = true;
  $('#play-label').textContent = '让答案落下来…';
  renderCandidates();
  result($('#light-result'));
  result($('#physics-result'), null, !physics);
  status('答案正在路上。', '同一个随机结果，以两种方式落下。');
  if (physics) $('#physics-error').hidden = true;
  try {
    const selected = randomIndex(choices.length);
    // 只抽一次，两版收到相同 index；每次投掷不产生任何网络请求。
    const settings = { signal, reducedMotion: reducedMotion.matches };
    // 手机上的按钮位于两张卡片下方，开始时将动画带回视野。
    $('.comparison-grid').scrollIntoView?.({ behavior: settings.reducedMotion ? 'instant' : 'smooth', block: 'start' });
    const outcomes = await Promise.allSettled([light.play(selected, settings), physics?.play(selected, settings)]);
    if (signal.aborted || token !== generation) return;
    if (outcomes[0].status === 'rejected') throw outcomes[0].reason;
    result($('#light-result'), choices[selected]);
    // 3D 返回从实际正面核对出的索引，结果卡不再直接照抄预抽值。
    const visibleIndex = outcomes[1].status === 'fulfilled' ? outcomes[1].value : null;
    const physicsAligned = physics && Number.isInteger(visibleIndex) && visibleIndex === selected;
    if (physicsAligned) result($('#physics-result'), choices[visibleIndex]);
    else if (physics) {
      $('#physics-error').hidden = false;
      $('#physics-error').textContent = '3D 动画未能完成，请切换示例或刷新页面后重试。';
      result($('#physics-result'), null, true);
    }
    renderCandidates(selected);
    $('#light-stage').setAttribute('aria-label', `立体轻动画落定：${choices[selected].title}`);
    if (physicsAligned) $('#physics-stage').setAttribute('aria-label', `物理 3D 落定：${choices[visibleIndex].title}`);
    status(`这次，随机选中了「${choices[selected].title}」。`, '可以换个道具继续比较。此页仅为动画演示。');
  } catch (error) {
    if (!signal.aborted && token === generation) status('这次动画没有完成。', '请重新播放，或切换示例再试。');
  } finally {
    if (token === generation) {
      controller = null;
      $('#play-comparison').disabled = false;
      $('#play-label').textContent = '再次播放对比';
    }
  }
}

for (const item of EXAMPLES) {
  const button = textElement('button', '', 'sample-tab');
  button.type = 'button';
  button.dataset.count = item.count;
  button.setAttribute('aria-pressed', 'false');
  button.append(textElement('b', String(item.count)), document.createTextNode(item.name));
  button.addEventListener('click', () => selectExample(item));
  $('#sample-tabs').append(button);
}
$('#play-comparison').addEventListener('click', playComparison);
function updateMotionNotice() { $('#reduced-note').hidden = !reducedMotion.matches; }
updateMotionNotice();
reducedMotion.addEventListener('change', updateMotionNotice);
selectExample(example);

// 3D 模块加载失败不阻止轻动画，也不影响网站原来的问答入口。
try {
  const { createPhysicsPreview } = await import('./random-physics.bundle.js');
  physics = createPhysicsPreview($('#physics-stage'));
  physics.setChoices(choices);
} catch (error) {
  physics?.dispose();
  physics = null;
  $('#physics-error').hidden = false;
  $('#physics-error').textContent = '当前浏览器无法启动 WebGL 3D 预览。请开启硬件加速后重试，或先体验左侧轻动画。';
  result($('#physics-result'), null, true);
}
physicsReady = true;
$('#play-comparison').disabled = false;
$('#play-label').textContent = '播放对比';

// 页面真正离开时销毁 GPU 资源；进入往返缓存时仅取消在途动画。
window.addEventListener('pagehide', event => {
  generation++;
  controller?.abort();
  controller = null;
  if (!event.persisted) { light.dispose(); physics?.dispose(); }
});
window.addEventListener('pageshow', event => { if (event.persisted) selectExample(example); });
