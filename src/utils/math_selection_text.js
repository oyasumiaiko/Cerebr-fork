/**
 * 数学选区文本序列化工具。
 *
 * 目标：
 * - 让侧栏内包含 KaTeX 的选区在提取文本时回退为原始 LaTeX；
 * - 统一 Ctrl/Cmd+C、快速总结、划词线程等“读取 selectedText”路径；
 * - 非数学内容保持原样，不改变现有纯文本体验。
 */

/**
 * 从 KaTeX 节点中提取原始 TeX（优先读取 annotation）。
 * @param {Element|null|undefined} katexElement
 * @returns {string}
 */
function extractKaTeXSource(katexElement) {
  if (!(katexElement instanceof Element)) return '';
  const annotation = katexElement.querySelector('annotation[encoding="application/x-tex"]');
  return (annotation?.textContent || '').trim();
}

/**
 * 将选区片段中的 KaTeX 渲染结果替换为 TeX 文本。
 * @param {DocumentFragment} fragment
 * @returns {boolean} 是否至少替换过一个公式节点
 */
function replaceKaTeXNodes(fragment) {
  if (!(fragment instanceof DocumentFragment)) return false;
  let replaced = false;

  // 先处理块级公式，避免后续行内选择器重复命中。
  const displayNodes = Array.from(fragment.querySelectorAll('.katex-display'));
  displayNodes.forEach((displayNode) => {
    const katexNode = displayNode.querySelector('.katex');
    const source = extractKaTeXSource(katexNode || displayNode);
    if (!source) return;
    displayNode.replaceWith(document.createTextNode(`\\[${source}\\]`));
    replaced = true;
  });

  // 再处理行内公式。
  const inlineNodes = Array.from(fragment.querySelectorAll('.katex'));
  inlineNodes.forEach((katexNode) => {
    if (katexNode.closest('.katex-display')) return;
    const source = extractKaTeXSource(katexNode);
    if (!source) return;
    katexNode.replaceWith(document.createTextNode(`\\(${source}\\)`));
    replaced = true;
  });

  return replaced;
}

/**
 * 将 Range 序列化为文本，并把 KaTeX 渲染结果还原成 TeX。
 * @param {Range|null|undefined} range
 * @param {{ trim?: boolean }} [options]
 * @returns {string}
 */
export function serializeRangeTextWithMath(range, options = {}) {
  if (!range) return '';
  const fragment = range.cloneContents();
  if (!(fragment instanceof DocumentFragment)) return '';

  replaceKaTeXNodes(fragment);

  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  let text = (wrapper.innerText || wrapper.textContent || '').replace(/\r\n/g, '\n');
  if (options.trim !== false) {
    text = text.trim();
  }
  return text;
}

/**
 * 将 Selection 序列化为文本，并把 KaTeX 渲染结果还原成 TeX。
 * @param {Selection|null|undefined} selection
 * @param {{ trim?: boolean }} [options]
 * @returns {string}
 */
export function serializeSelectionTextWithMath(selection, options = {}) {
  const targetSelection = selection || window.getSelection();
  if (!targetSelection || targetSelection.rangeCount === 0 || targetSelection.isCollapsed) {
    return '';
  }
  return serializeRangeTextWithMath(targetSelection.getRangeAt(0), options);
}
