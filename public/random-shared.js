// 两种动画共用候选、几何和抽签规则，渲染方式不会影响命中概率。
export const EXAMPLES = [
  { count: 2, name: '抛硬币', question: '今晚，要不要出门走走？', titles: ['出去走走', '留在家里'] },
  { count: 3, name: '三棱骰子', question: '给自己留一个慢下来的下午。', titles: ['逛逛书店', '喝杯咖啡', '去公园散步'] },
  { count: 4, name: '四面骰子', question: '这个周末，想怎样度过？', titles: ['山间徒步', '看场电影', '在家做饭', '拜访朋友'] },
  { count: 5, name: '五棱骰子', question: '给今天加一点不一样。', titles: ['听张新专辑', '尝试新菜谱', '整理小角落', '写一封信', '沿着河边散步，看看日落再慢慢回家'] },
  { count: 6, name: '六面骰子', question: '下一段空闲，交给哪件小事？', titles: ['读几页书', '伸展身体', '画一幅画', '拍些照片', '照顾植物', '好好睡一觉'] },
  { count: 8, name: '幸运转盘', question: '下一站，去遇见一点新鲜。', titles: ['街角面包店', '城市美术馆', '湖边骑行', '旧书集市', '山顶看云', '植物园', '小巷探店', '海边听风'] },
];

export function exampleChoices(example) {
  return example.titles.map((title, index) => ({ id: `option_${index + 1}`, title, description: `给「${title}」留一点时间，享受这一次小小的选择。` }));
}

export function shortTitle(text, max = 8) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}

// 拒绝尾部无法均分的随机数，避免直接取模造成微小偏差。
export function randomIndex(count, cryptoSource = globalThis.crypto) {
  if (!Number.isSafeInteger(count) || count < 2 || count > 0x100000000) throw new RangeError('候选数量无效');
  const limit = Math.floor(0x100000000 / count) * count;
  const sample = new Uint32Array(1);
  do { cryptoSource.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % count;
}

// 第 0 扇区中心位于顶部；渲染时其他扇区顺时针排列。
export function wheelTargetAngle(index, count) { return index * Math.PI * 2 / count; }

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

export function createSolid(count) {
  let vertices = [], faces = [];
  if (count === 4) {
    vertices = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v => v.map(x => x / Math.sqrt(3)));
    faces = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]].map((indices, choiceIndex) => ({ indices, choiceIndex }));
  } else if (count === 6) {
    vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(v => v.map(x => x * .72));
    faces = [[4,5,6,7],[1,0,3,2],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]].map((indices, choiceIndex) => ({ indices, choiceIndex }));
  } else if ([2, 3, 5].includes(count)) {
    const sides = count === 2 ? 48 : count;
    const halfHeight = count === 2 ? .13 : .8;
    for (const y of [-halfHeight, halfHeight]) {
      for (let i = 0; i < sides; i++) {
        const angle = (i - .5) * 2 * Math.PI / sides;
        vertices.push([Math.sin(angle), y, Math.cos(angle)]);
      }
    }
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      faces.push({ indices: [i, next, next + sides, i + sides], choiceIndex: count === 2 ? null : i });
    }
    faces.push({ indices: Array.from({ length: sides }, (_, i) => i), choiceIndex: count === 2 ? 0 : null });
    faces.push({ indices: Array.from({ length: sides }, (_, i) => sides + i), choiceIndex: count === 2 ? 1 : null });
  } else throw new RangeError('该数量请使用转盘');
  // 将所有顶点绕序规范为外法线，CSS 面片与物理碰撞共用同一实体。
  faces.forEach(face => {
    const [a, b, c] = face.indices.map(i => vertices[i]);
    if (dot(cross(sub(b, a), sub(c, a)), a) < 0) face.indices.reverse();
  });
  return { vertices, faces, radius: Math.max(...vertices.map(v => Math.hypot(...v))) };
}
