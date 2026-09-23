import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolid, randomIndex, wheelTargetAngle, EXAMPLES, exampleChoices, shortTitle } from '../public/random-shared.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

test('所有实体闭合且外法线正确，每个候选只占一个有效面', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    const { vertices, faces } = createSolid(count);
    assert.deepEqual(faces.filter(f => f.choiceIndex !== null).map(f => f.choiceIndex).sort((a,b) => a-b), Array.from({length:count},(_,i)=>i));
    const edges = new Map();
    for (const face of faces) {
      const [a,b,c] = face.indices.map(i => vertices[i]);
      const normal = cross(sub(b,a), sub(c,a));
      assert.ok(dot(normal,a) > 0, `${count} 面体的面朝外`);
      // 每个顶点都在每个面的内侧，确保可以作为物理引擎的凸碰撞体。
      vertices.forEach(v => assert.ok(dot(normal,sub(v,a)) < 1e-8));
      face.indices.forEach((index,i) => {
        const end = face.indices[(i+1)%face.indices.length];
        const key = [index,end].sort((a,b)=>a-b).join(',');
        edges.set(key,(edges.get(key)||0)+1);
      });
    }
    edges.forEach(times => assert.equal(times,2));
    if ([3,5].includes(count)) assert.equal(faces.filter(f => f.choiceIndex === null).length,2);
  }
});

test('等概率取样丢弃不可均分的尾部，并可命中每个索引', () => {
  let calls = 0;
  const samples = [0xffffffff, 5];
  const source = { getRandomValues(array) { array[0] = samples[calls++]; return array; } };
  assert.equal(randomIndex(3,source),2);
  assert.equal(calls,2);
  for (const count of [2,3,4,5,6,8]) {
    for (let i=0; i<count; i++) assert.equal(randomIndex(count,{getRandomValues(a){a[0]=i;return a;}}),i);
  }
  for (const count of [0,1,2.5,NaN,Infinity]) assert.throws(()=>randomIndex(count),RangeError);
});

test('转盘每个扇区的中心最终准确对齐顶部指针', () => {
  for (const count of [7,8,12,31]) for (let i=0;i<count;i++) {
    const center = Math.PI/2-i*2*Math.PI/count;
    const landed = center+wheelTargetAngle(i,count);
    assert.ok(Math.abs(Math.cos(landed))<1e-10);
    assert.ok(Math.abs(Math.sin(landed)-1)<1e-10);
  }
});

test('示例保持完整文字与唯一标识，表面缩略不截断 Unicode 字符', () => {
  for (const example of EXAMPLES) {
    const choices = exampleChoices(example);
    assert.equal(choices.length,example.count);
    assert.equal(new Set(choices.map(c=>c.id)).size,example.count);
    assert.deepEqual(choices.map(c=>c.title),example.titles);
  }
  assert.equal(shortTitle('读书'),'读书');
  assert.equal(shortTitle('🌲🌳🌴🌵',3),'🌲🌳…');
  assert.ok(exampleChoices(EXAMPLES.find(e=>e.count===5)).some(c=>c.title.length>8));
});
