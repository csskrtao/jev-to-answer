import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createSolid, wheelTargetAngle, shortTitle } from '../public/random-shared.js';

const FLOOR_Y = -1.22;
const VIEW_NORMAL = new THREE.Vector3(0, 0.34, 0.94).normalize();
// 在首次弹起时完成朝向调整，落地及静止阶段不再翻面。
const ALIGN_START = 900;
const ALIGN_END = 2100;
const LAND_END = 3900;
const SETTLED_HOLD = 900;

/** 独立的物理预览器；随机结果由页面统一生成，本模块只负责表现。 */
export function createPhysicsPreview(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    throw new Error('当前浏览器无法启用 WebGL，物理 3D 版暂时无法预览。请体验左侧立体轻动画。');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
  renderer.domElement.setAttribute('aria-label', '物理 3D 随机道具动画');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  const ambient = new THREE.HemisphereLight(0xffffff, 0xa5ada4, 1.65);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(0xffffff, 1.15);
  light.position.set(-3, 7, 5);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -5, right: 5, top: 6, bottom: -4, near: 0.5, far: 20 });
  light.shadow.normalBias = 0.03;
  light.shadow.radius = 4;
  scene.add(light);

  // 桌面固定纸色，仅用独立阴影层承接光影，避免灯光把背景照成黄白。
  const floorMaterial = new THREE.MeshBasicMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#293b2d', opacity: 0.2 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = FLOOR_Y + 0.002;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -14, 0) });
  world.defaultContactMaterial.friction = 0.38;
  world.defaultContactMaterial.restitution = 0.49;
  world.allowSleep = true;
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.position.y = FLOOR_Y;
  world.addBody(ground);
  // 无形托盘边界防止高速硬币滚出镜头，仍通过真实接触产生反弹。
  const boundaries = [
    { position: [-2.15, 0, 0], rotation: [0, Math.PI / 2, 0] },
    { position: [2.15, 0, 0], rotation: [0, -Math.PI / 2, 0] },
    { position: [0, 0, -1.65], rotation: [0, 0, 0] },
    { position: [0, 0, 1.65], rotation: [0, Math.PI, 0] },
  ].map(({ position, rotation }) => {
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    wall.position.set(...position);
    wall.quaternion.setFromEuler(...rotation);
    world.addBody(wall);
    return wall;
  });

  let choices = [];
  let solid = null;
  let group = null;
  let moving = null;
  let body = null;
  let faceFrames = [];
  let faceTextCenters = [];
  let textureRecords = [];
  let selected = -1;
  let disposed = false;
  let running = null;
  let raf = 0;
  let cameraDistance = 5.25;
  let cameraTargetY = 0.12;
  const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && themeQuery.matches);
  const palette = () => isDark()
    ? { surface: '#303a34', ink: '#eee9dd', line: '#667569', accent: '#d89b72', win: '#f2c79b' }
    : { surface: '#f7f2e5', ink: '#3d493c', line: '#b8bba5', accent: '#ab6245', win: '#e9c89f' };

  function drawFace(record) {
    const { canvas, choiceIndex, texture } = record;
    const ctx = canvas.getContext('2d');
    const colors = palette();
    const winning = selected === choiceIndex && choiceIndex !== null;
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = winning ? colors.win : colors.surface;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = winning ? colors.accent : colors.line;
    ctx.lineWidth = 9;
    ctx.strokeRect(12, 12, 488, 488);
    if (choiceIndex !== null) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = winning ? '#493724' : colors.ink;
      const title = Array.from(shortTitle(choices[choiceIndex].title, 8));
      const rowLength = choices.length === 4 ? (title.length > 6 ? 3 : 2) : choices.length === 5 ? 3 : 5;
      const rows = [];
      for (let offset = 0; offset < title.length; offset += rowLength) rows.push(title.slice(offset, offset + rowLength).join(''));
      const fontSize = choices.length === 4 ? (rows.length > 2 ? 55 : 72) : 72;
      ctx.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`;
      const centerY = choices.length === 4 ? (faceTextCenters[choiceIndex] ?? 256) : 256;
      rows.forEach((row, i) => ctx.fillText(row, 256, centerY + (i - (rows.length - 1) / 2) * (fontSize + 14), choices.length === 4 ? 230 : 408));
    }
    texture.needsUpdate = true;
  }

  function drawWheel(record) {
    const { canvas, texture } = record;
    const ctx = canvas.getContext('2d');
    const colors = palette();
    const size = canvas.width;
    const center = size / 2;
    const step = Math.PI * 2 / choices.length;
    ctx.clearRect(0, 0, size, size);
    choices.forEach((choice, index) => {
      const angle = -Math.PI / 2 + index * step;
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, center - 6, angle - step / 2, angle + step / 2);
      ctx.closePath();
      ctx.fillStyle = selected === index ? colors.win : (index % 2 ? colors.surface : (isDark() ? '#435144' : '#e2e5d4'));
      ctx.fill();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.save();
      ctx.translate(center + Math.cos(angle) * size * 0.32, center + Math.sin(angle) * size * 0.32);
      // 切向文字随转盘一起转动，命中扇区在顶部时自然恢复正向。
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = selected === index ? '#493724' : colors.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 51px "Microsoft YaHei", sans-serif';
      const chars = Array.from(shortTitle(choice.title, 8));
      const rows = chars.length > 3 ? [chars.slice(0, 3).join(''), chars.slice(3, 6).join(''), chars.slice(6).join('')].filter(Boolean) : [chars.join('')];
      rows.forEach((row, rowIndex) => ctx.fillText(row, 0, (rowIndex - (rows.length - 1) / 2) * 54, 180));
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(center, center, 38, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    texture.needsUpdate = true;
  }

  function makeTexture(choiceIndex, wheel = false) {
    // 硬币薄边的几十个面复用一张纹理，降低显存占用。
    const existing = textureRecords.find(record => !wheel && !record.wheel && record.choiceIndex === choiceIndex);
    if (existing) return existing.texture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = wheel ? 1024 : 512;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const record = { canvas, texture, choiceIndex, wheel };
    textureRecords.push(record);
    (wheel ? drawWheel : drawFace)(record);
    return texture;
  }

  function render() {
    if (!disposed) renderer.render(scene, camera);
  }

  function refreshTheme() {
    floorMaterial.color.set(isDark() ? '#222c26' : '#efefe6');
    textureRecords.forEach(record => (record.wheel ? drawWheel : drawFace)(record));
    render();
  }

  function resize() {
    if (disposed) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height || 330);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    updateCamera();
    camera.updateProjectionMatrix();
    render();
  }

  function updateCamera(distance = cameraDistance, targetY = cameraTargetY) {
    cameraDistance = distance;
    cameraTargetY = targetY;
    camera.position.copy(VIEW_NORMAL).multiplyScalar(Math.max(cameraDistance, 3.9 / camera.aspect));
    camera.position.y += cameraTargetY;
    camera.lookAt(0, cameraTargetY, 0);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (running) {
      const current = running;
      running = null;
      current.signal?.removeEventListener('abort', current.abort);
      // 中止是正常的预览切换，不产生未处理的 Promise rejection。
      current.resolve();
    }
  }

  function clearObject() {
    stop();
    if (body) world.removeBody(body);
    body = null;
    if (group) {
      scene.remove(group);
      group.traverse(node => {
        node.geometry?.dispose();
        if (node.material) {
          (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose());
        }
      });
    }
    textureRecords.forEach(record => record.texture.dispose());
    textureRecords = [];
    faceFrames = [];
    faceTextCenters = [];
    group = moving = null;
  }

  function buildSolid() {
    solid = createSolid(choices.length);
    group = moving = new THREE.Group();
    const vertices = solid.vertices.map(v => new THREE.Vector3(...v));
    solid.faces.forEach(face => {
      const points = face.indices.map(index => vertices[index]);
      const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
      const normal = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0])).normalize();
      const up = Math.abs(normal.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const horizontal = new THREE.Vector3().crossVectors(up, normal).normalize();
      const vertical = new THREE.Vector3().crossVectors(normal, horizontal).normalize();
      const projected = points.map(point => ({ x: point.dot(horizontal), y: point.dot(vertical) }));
      const xMin = Math.min(...projected.map(p => p.x));
      const xMax = Math.max(...projected.map(p => p.x));
      const yMin = Math.min(...projected.map(p => p.y));
      const yMax = Math.max(...projected.map(p => p.y));
      if (face.choiceIndex !== null) {
        // 三角面可能朝上或朝下，文字以面的重心定位，避免落到狭窄尖角。
        faceTextCenters[face.choiceIndex] = (yMax - center.dot(vertical)) / (yMax - yMin) * 512;
      }
      const positions = [];
      const normals = [];
      const uvs = [];
      for (let i = 1; i < points.length - 1; i += 1) {
        for (const index of [0, i, i + 1]) {
          positions.push(...points[index].toArray());
          normals.push(...normal.toArray());
          uvs.push((projected[index].x - xMin) / (xMax - xMin), (projected[index].y - yMin) / (yMax - yMin));
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const material = new THREE.MeshStandardMaterial({ map: makeTexture(face.choiceIndex), roughness: 0.62, metalness: choices.length === 2 ? 0.35 : 0.04 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.choiceIndex = face.choiceIndex;
      mesh.userData.faceCenter = center;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (face.choiceIndex !== null) {
        faceFrames[face.choiceIndex] = { normal, horizontal, vertical, center };
      }
    });
    // 渲染与碰撞使用同一份顶点，棱柱的两个端面只负责碰撞，不对应答案。
    const shape = new CANNON.ConvexPolyhedron({
      vertices: solid.vertices.map(v => new CANNON.Vec3(...v)),
      faces: solid.faces.map(face => face.indices.slice()),
    });
    body = new CANNON.Body({ mass: 1.2, shape, angularDamping: 0.22, linearDamping: 0.13 });
    world.addBody(body);
    scene.add(group);
  }

  function buildWheel() {
    solid = null;
    group = new THREE.Group();
    group.position.y = 0.25;
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), VIEW_NORMAL);
    moving = new THREE.Group();
    group.add(moving);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.2, 80), new THREE.MeshStandardMaterial({ color: '#a67551', metalness: 0.35, roughness: 0.5 }));
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = rim.receiveShadow = true;
    moving.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.18, 96), new THREE.MeshStandardMaterial({ map: makeTexture(null, true), roughness: 0.65 }));
    face.position.z = 0.105;
    moving.add(face);
    const pointerGeometry = new THREE.BufferGeometry();
    pointerGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.13, 1.46, 0.17, 0, 1.16, 0.17, 0.13, 1.46, 0.17], 3));
    pointerGeometry.computeVertexNormals();
    group.add(new THREE.Mesh(pointerGeometry, new THREE.MeshStandardMaterial({ color: '#b76c49', side: THREE.DoubleSide, metalness: 0.2 })));
    body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(1.22), angularDamping: 0.5, collisionFilterMask: 0 });
    // 转盘只保留 Z 轴转动自由度，位置由轴承固定，不受重力影响。
    body.linearFactor.set(0, 0, 0);
    body.angularFactor.set(0, 0, 1);
    world.addBody(body);
    scene.add(group);
  }

  function targetQuaternion(index) {
    const frame = faceFrames[index];
    const source = new THREE.Matrix4().makeBasis(frame.horizontal, frame.vertical, frame.normal);
    const targetVertical = new THREE.Vector3().crossVectors(VIEW_NORMAL, new THREE.Vector3(1, 0, 0));
    const target = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), targetVertical, VIEW_NORMAL);
    return new THREE.Quaternion().setFromRotationMatrix(target.multiply(source.transpose()));
  }

  function groundedPosition(quaternion) {
    const minimum = Math.min(...solid.vertices.map(vertex => new THREE.Vector3(...vertex).applyQuaternion(quaternion).y));
    return new THREE.Vector3(0, FLOOR_Y - minimum + 0.015, 0);
  }

  function syncBody() {
    moving.position.set(body.position.x, body.position.y, body.position.z);
    moving.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  }

  function reset() {
    if (disposed || !group) return;
    stop();
    selected = -1;
    delete host.dataset.selectedIndex;
    renderer.domElement.setAttribute('aria-label', `物理 3D 道具：${choices.length} 个候选，等待投掷`);
    if (solid) {
      moving.quaternion.copy(targetQuaternion(0));
      moving.position.copy(groundedPosition(moving.quaternion));
    } else {
      moving.rotation.set(0, 0, 0);
      moving.position.set(0, 0, 0);
    }
    // 镜头与命中面使用相同的中心轴，避免构图偏移使结果面朝向旁边。
    updateCamera(5.25, solid ? moving.position.y : group.position.y);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    refreshTheme();
  }

  function setChoices(next) {
    if (disposed) return;
    if (!Array.isArray(next) || next.length < 2) throw new Error('动画预览至少需要两个候选答案。');
    clearObject();
    choices = next;
    selected = -1;
    if (choices.length >= 7) buildWheel();
    else buildSolid();
    reset();
  }

  function visibleChoiceIndex() {
    if (!solid) {
      const turn = Math.PI * 2;
      const angle = ((moving.rotation.z % turn) + turn) % turn;
      return Math.round(angle / turn * choices.length) % choices.length;
    }
    // 读取真实网格的法线和世界位置，不只相信预抽索引或 DOM 标记。
    group.updateMatrixWorld(true);
    let front = -1, bestAlignment = -Infinity;
    group.children.forEach(mesh => {
      if (mesh.userData.choiceIndex === null) return;
      const normal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('normal'), 0)
        .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
      const center = mesh.userData.faceCenter.clone().applyMatrix4(mesh.matrixWorld);
      const alignment = normal.dot(camera.position.clone().sub(center).normalize());
      if (alignment > bestAlignment) { bestAlignment = alignment; front = mesh.userData.choiceIndex; }
    });
    return front;
  }

  function reveal(expectedIndex) {
    const index = visibleChoiceIndex();
    if (index !== expectedIndex) throw new Error('道具正面与抽签结果未对齐，请重新播放。');
    selected = index;
    host.dataset.selectedIndex = String(index);
    renderer.domElement.setAttribute('aria-label', `物理 3D 结果：${choices[index].title}`);
    refreshTheme();
    return index;
  }

  function play(index, { signal, reducedMotion = false } = {}) {
    if (disposed || !group || signal?.aborted) return Promise.resolve();
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) return Promise.reject(new Error('候选答案索引无效。'));
    stop();
    selected = -1;
    delete host.dataset.selectedIndex;
    refreshTheme();
    const isWheel = !solid;
    const finalQuaternion = isWheel ? null : targetQuaternion(index);
    const finalPosition = isWheel ? null : groundedPosition(finalQuaternion);
    if (reducedMotion) {
      updateCamera(5.25, isWheel ? group.position.y : finalPosition.y);
      if (isWheel) moving.rotation.z = wheelTargetAngle(index, choices.length);
      else {
        moving.quaternion.copy(finalQuaternion);
        moving.position.copy(finalPosition);
      }
      try { return Promise.resolve(reveal(index)); }
      catch (error) { return Promise.reject(error); }
    }

    body.wakeUp();
    body.force.setZero();
    body.torque.setZero();
    // 抛掷时稍拉远镜头，停稳时推近，让答案面足够大且飞行过程保持在画面内。
    updateCamera(isWheel ? 5.25 : 7.4, isWheel ? group.position.y : 0.12);
    body.position.set(isWheel ? 0 : -0.7, isWheel ? 0 : 1.0, 0);
    body.velocity.set(isWheel ? 0 : 1.0, isWheel ? 0 : -1.3, isWheel ? 0 : -0.25);
    body.quaternion.setFromEuler(0.25, -0.65, 0.35);
    body.angularVelocity.set(isWheel ? 0 : 8.5, isWheel ? 0 : 10, isWheel ? -18 : 4);
    if (isWheel) body.quaternion.set(0, 0, 0, 1);
    world.accumulator = 0;
    const start = performance.now();
    let last = start;
    let settling = null;
    let wheelAngle = 0;
    let elapsed = 0;
    let settledAt = null;

    return new Promise((resolve, reject) => {
      const abort = () => stop();
      running = { resolve, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      function frame(now) {
        if (!running || disposed) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        // 只推进实际展示过的帧；后台停顿或卡顿不能直接跳到揭晓。
        elapsed += dt * 1000;
        last = now;
        if (elapsed < (isWheel ? 1950 : ALIGN_START)) {
          world.step(1 / 60, dt, 4);
          if (isWheel) {
            wheelAngle += body.angularVelocity.z * dt;
            moving.rotation.z = wheelAngle;
          } else syncBody();
        } else if (!isWheel) {
          if (!settling) settling = { position: moving.position.clone(), quaternion: moving.quaternion.clone() };
          if (elapsed < ALIGN_END) {
            const t = Math.min(1, (elapsed - ALIGN_START) / (ALIGN_END - ALIGN_START));
            const ease = t * t * (3 - 2 * t);
            const landingStart = finalPosition.clone().add(new THREE.Vector3(0, 0.6, 0));
            moving.quaternion.slerpQuaternions(settling.quaternion, finalQuaternion, ease);
            moving.position.lerpVectors(settling.position, landingStart, ease);
            moving.position.y += Math.sin(Math.PI * t) * 0.8;
            moving.position.y = Math.max(moving.position.y, groundedPosition(moving.quaternion).y);
            updateCamera(THREE.MathUtils.lerp(7.4, 5.25, ease), THREE.MathUtils.lerp(0.12, finalPosition.y, ease));
          } else {
            // 最后一次下落开始前已经正对用户；此后只允许位移和轻弹跳。
            moving.quaternion.copy(finalQuaternion);
            moving.position.copy(finalPosition);
            const t = Math.min(1, (elapsed - ALIGN_END) / (LAND_END - ALIGN_END));
            const height = t < 0.55 ? 0.6 * (1 - (t / 0.55) ** 2)
              : 0.10 * Math.sin(Math.PI * (t - 0.55) / 0.45);
            moving.position.y += Math.max(0, height);
            // 镜头固定看向落点，让下落和触地清晰可见，避免跟随物体造成悬浮感。
            updateCamera(5.25, finalPosition.y);
          }
        } else {
          if (!settling) {
            const targetAngle = isWheel ? wheelTargetAngle(index, choices.length) : 0;
            let endAngle = targetAngle + Math.floor((wheelAngle - targetAngle) / (Math.PI * 2)) * Math.PI * 2;
            const startSlope = body.angularVelocity.z * (LAND_END - 1950) / 1000;
            // 给当前角速度留出减速距离，三次插值同时匹配起始速度与终点静止。
            if (isWheel && wheelAngle - endAngle < Math.abs(startSlope) / 3) endAngle -= Math.PI * 2;
            settling = {
              position: moving.position.clone(), quaternion: moving.quaternion.clone(), angle: wheelAngle,
              endAngle, startSlope,
            };
          }
          const t = Math.min(1, (elapsed - 1950) / (LAND_END - 1950));
          const distance = settling.endAngle - settling.angle;
          moving.rotation.z = settling.angle + distance * (3 * t * t - 2 * t * t * t)
            + settling.startSlope * (t * t * t - 2 * t * t + t);
        }
        if (elapsed >= LAND_END) {
          updateCamera(5.25, isWheel ? group.position.y : finalPosition.y);
          if (isWheel) moving.rotation.z = wheelTargetAngle(index, choices.length);
          else {
            moving.quaternion.copy(finalQuaternion);
            moving.position.copy(finalPosition);
          }
          // 先展示真正落定的姿态，再开始静止等待；等待期仍不高亮、不返回结果。
          if (settledAt === null) settledAt = elapsed;
        }
        render();
        if (settledAt !== null && elapsed - settledAt >= SETTLED_HOLD) {
          try {
            const visibleIndex = reveal(index);
            resolve(visibleIndex);
          } catch (error) { reject(error); }
          finally { stop(); }
        } else raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    });
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const themeObserver = new MutationObserver(refreshTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  themeQuery.addEventListener('change', refreshTheme);
  refreshTheme();
  resize();

  function dispose() {
    if (disposed) return;
    clearObject();
    disposed = true;
    resizeObserver.disconnect();
    themeObserver.disconnect();
    themeQuery.removeEventListener('change', refreshTheme);
    world.removeBody(ground);
    boundaries.forEach(wall => world.removeBody(wall));
    floor.geometry.dispose();
    floorMaterial.dispose();
    shadowFloor.geometry.dispose();
    shadowFloor.material.dispose();
    light.shadow.map?.dispose();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return { setChoices, play, reset, dispose };
}
