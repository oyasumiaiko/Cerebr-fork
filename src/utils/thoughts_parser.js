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

/**
 * 合并「流式返回」的思考摘要增量（delta），避免把每个增量都当成一段新段落。
 *
 * 典型问题复现：
 * - 某些模型/代理会把 reasoning/thought 以非常小的粒度分片流式输出；
 * - 如果直接复用 mergeThoughts() 用 `\n\n` 拼接，每个分片都会变成一个独立段落；
 * - Markdown 渲染后就会出现“每个词/每几个字都被包进一个 <p>”的情况，严重影响可读性。
 *
 * 设计原则：
 * - 不主动插入任何分隔符：默认把 incoming 视为“追加到末尾的增量”；
 * - 兼容少数实现的“全量回传”：如果 incoming 是截至目前的完整文本，则用它覆盖 existing；
 * - 兼容边界重复：如果 incoming 与 existing 末尾存在重叠（例如重复了最后几个字符），则去重后再拼接。
 *
 * @param {string|null|undefined} existing - 已累积的思考摘要（不做 trim，尽量保留模型输出的原始格式）
 * @param {string|null|undefined} incoming - 本次增量（或某些实现下的全量文本）
 * @param {{ maxOverlap?: number }} [options]
 * @returns {string}
 */
export function mergeStreamingThoughts(existing, incoming, options = {}) {
  const prev = (typeof existing === 'string') ? existing : '';
  const next = (typeof incoming === 'string') ? incoming : '';

  if (!prev) return next;
  if (!next) return prev;
  if (prev === next) return prev;

  // 1) 兼容“全量回传”：新文本以旧文本为前缀（最常见的累计输出形态）
  if (next.startsWith(prev)) {
    return next;
  }

  // 2) 兼容“边界重复”：寻找 prev 的最长后缀与 next 的最长前缀重叠并去重拼接
  const maxOverlap = Math.max(0, Number(options.maxOverlap) || 256);
  const cap = Math.min(prev.length, next.length, maxOverlap);
  for (let len = cap; len >= 1; len--) {
    if (prev.slice(prev.length - len) === next.slice(0, len)) {
      return prev + next.slice(len);
    }
  }

  // 3) 默认：视为纯增量，直接拼接
  return prev + next;
}
