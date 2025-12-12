/**
 * URL 候选前缀生成器（纯函数）
 *
 * 设计目标：
 * - 将一个完整 URL 生成一组“从严格到宽松”的候选前缀；
 * - 用于“按 URL 前缀匹配历史会话”这类场景（例如：继续本页对话 / 本页会话筛选）。
 *
 * 规则：
 * - 从完整 URL 开始，逐步去掉最后一个分隔符之后的部分；
 * - 分隔符包括：'/' '?' '&' '#'
 * - 始终保留 origin 作为最宽松候选；
 * - 结果按优先级从高到低（越靠前越严格）。
 *
 * @param {string} urlString
 * @returns {string[]} 候选前缀数组
 */
export function generateCandidateUrls(urlString) {
  const candidates = new Set();
  try {
    const urlObj = new URL(urlString);
    const origin = urlObj.origin;

    let current = urlString;

    while (current.length > origin.length) {
      candidates.add(current);

      const searchArea = current.substring(origin.length);
      const lastDelimiterIndexInSearchArea = Math.max(
        searchArea.lastIndexOf('/'),
        searchArea.lastIndexOf('?'),
        searchArea.lastIndexOf('&'),
        searchArea.lastIndexOf('#')
      );

      if (lastDelimiterIndexInSearchArea === -1) {
        break;
      }

      const delimiterIndex = origin.length + lastDelimiterIndexInSearchArea;
      current = current.substring(0, delimiterIndex);

      if (current === origin + '/') {
        current = origin;
      }
    }

    candidates.add(origin);
  } catch (error) {
    console.error('generateCandidateUrls error: ', error);
    if (urlString) candidates.add(urlString);
  }
  return Array.from(candidates);
}

