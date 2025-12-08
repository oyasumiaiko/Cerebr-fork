/**
 * 纯函数：提取文本中的 <think></think> 段落，返回净化后的正文与思考摘要。
 * @param {string} rawText - 包含思考标签的原始文本
 * @returns {{ cleanText: string, thoughtText: string }} 去除思考标签后的正文与提取的思考内容
 */
export function extractThinkingFromText(rawText) {
  if (typeof rawText !== 'string') {
    return { cleanText: rawText, thoughtText: '' };
  }

  const regex = /<think>([\s\S]*?)<\/think>/gi;
  const thoughts = [];
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    const captured = match[1]?.trim();
    if (captured) {
      thoughts.push(captured);
    }
  }

  if (thoughts.length === 0) {
    return { cleanText: rawText, thoughtText: '' };
  }

  const cleanText = rawText.replace(regex, '').replace(/^\s+/, '');
  const thoughtText = thoughts.join('\n\n').trim();
  return { cleanText, thoughtText };
}

/**
 * 合并已有思考内容与新增摘要，避免重复记录。
 * @param {string|null|undefined} existing - 已存在的思考摘要
 * @param {string|null|undefined} incoming - 新提取的思考摘要
 * @returns {string} 合并后的思考摘要
 */
export function mergeThoughts(existing, incoming) {
  const current = (typeof existing === 'string' && existing.trim()) ? existing.trim() : '';
  const extra = (typeof incoming === 'string' && incoming.trim()) ? incoming.trim() : '';

  if (!current && !extra) return '';
  if (current && !extra) return current;
  if (!current && extra) return extra;
  if (current === extra) return current;
  if (current.includes(extra)) return current;
  if (extra.includes(current)) return extra;
  return `${current}\n\n${extra}`;
}
