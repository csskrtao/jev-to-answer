/** 风格集中维护；客户端仅取得展示文案，提示词始终由服务端决定。 */
export const RESPONSE_STYLES = Object.freeze([
  { id: 'gentle', label: '温和版', description: '自然清晰，体谅你的处境。', prompt: '自然、清晰、温和，体谅处境，不过度肯定。' },
  { id: 'roast', label: '毒舌版', description: '损友式直言，把问题说透。', prompt: '使用强烈的损友口吻，直接吐槽拖延、纠结和自我欺骗，犀利指出问题并给出有用建议。只针对有依据的行为，不编造事实，不用无依据的人身标签代替分析。' },
  { id: 'concise', label: '干练版', description: '结论先行，只说关键。', prompt: '结论先行，压缩铺垫，只保留关键理由与行动；简单问题一句话即可，不为凑字数扩写。' },
  { id: 'humorous', label: '幽默版', description: '轻松俏皮，让答案更有趣。', prompt: '轻松俏皮，适当使用贴切比喻，不让笑话掩盖答案或歪曲事实。' },
  { id: 'rational', label: '理性版', description: '讲依据、看条件、权衡取舍。', prompt: '强调依据、条件、取舍和不确定性，清晰区分事实与推断。' },
  { id: 'healing', label: '治愈版', description: '给你支持，从小步骤开始。', prompt: '提供鼓励与支持，给出容易开始的小步骤，避免空泛安慰，不擅自假定用户情绪。' },
].map(Object.freeze));

export function validateResponseStyle(style = 'gentle') {
  if (typeof style !== 'string' || !RESPONSE_STYLES.some((item) => item.id === style)) {
    throw Object.assign(new Error('回复风格无效，请选择已有风格'), { status: 400 });
  }
  return style;
}

export function responseStylePrompt(style = 'gentle') {
  const id = validateResponseStyle(style);
  return `回复表达风格：${RESPONSE_STYLES.find((item) => item.id === id).prompt} 风格仅影响措辞和篇幅，不能改变事实、原结论或安全约束。`;
}

export function publicResponseStyles() {
  return RESPONSE_STYLES.map(({ id, label, description }) => ({ id, label, description }));
}
