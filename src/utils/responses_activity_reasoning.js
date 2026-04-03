/**
 * Responses reasoning summary 文本清洗与合并工具。
 *
 * 设计目标：
 * - 兼容流式增量 / 完成态全量回传混用时出现的重复拼接；
 * - 把“被拼进同一段里的粗体标题”拆回独立段落，便于按参考样式展示；
 * - 尽量做成纯函数，既可用于 sender 合并时修正，也可用于 renderer 展示旧历史时兜底。
 */

import { mergeStreamingThoughts } from './thoughts_parser.js';

const STANDALONE_BOLD_HEADING_PATTERN = /\*\*[A-Z][^*\n]{0,120}\*\*/g;

function normalizeLineBreaks(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function insertSpacingAroundStandaloneBoldHeadings(text) {
  if (!text) return '';

  let nextText = normalizeLineBreaks(text);
  // 把“句末后直接接粗体标题”的情况拆成新段落，避免：
  // "...Let's get started!**Planning searches**"
  nextText = nextText.replace(
    /([^\n])(\*\*[A-Z][^*\n]{0,120}\*\*)(?=\s*(?:\n|$|[A-Z]))/g,
    '$1\n\n$2'
  );
  // 把“粗体标题后又直接跟正文”的情况拆开，确保标题独立成段。
  nextText = nextText.replace(
    /(\*\*[A-Z][^*\n]{0,120}\*\*)([^\n\s])/g,
    '$1\n\n$2'
  );
  // 若标题出现在单换行后，也提升为独立段落。
  nextText = nextText.replace(
    /([^\n])\n(\*\*[A-Z][^*\n]{0,120}\*\*)/g,
    '$1\n\n$2'
  );

  return nextText.replace(/\n{3,}/g, '\n\n').trim();
}

function isStandaloneBoldHeadingBlock(block) {
  if (typeof block !== 'string') return false;
  const trimmed = block.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith('**') || !trimmed.endsWith('**')) return false;
  const matches = trimmed.match(STANDALONE_BOLD_HEADING_PATTERN);
  return Array.isArray(matches) && matches.length === 1 && matches[0] === trimmed;
}

function splitResponsesReasoningSections(text) {
  const normalized = insertSpacingAroundStandaloneBoldHeadings(text);
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  const sections = [];
  let currentSection = null;

  blocks.forEach((block) => {
    if (isStandaloneBoldHeadingBlock(block)) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        heading: block,
        bodyBlocks: []
      };
      return;
    }

    if (!currentSection) {
      currentSection = {
        heading: '',
        bodyBlocks: []
      };
    }
    currentSection.bodyBlocks.push(block);
  });

  if (currentSection) sections.push(currentSection);
  return sections;
}

function sectionToText(section) {
  if (!section || typeof section !== 'object') return '';
  const parts = [];
  if (typeof section.heading === 'string' && section.heading.trim()) {
    parts.push(section.heading.trim());
  }
  if (Array.isArray(section.bodyBlocks) && section.bodyBlocks.length > 0) {
    section.bodyBlocks
      .map(block => (typeof block === 'string' ? block.trim() : ''))
      .filter(Boolean)
      .forEach(block => parts.push(block));
  }
  return parts.join('\n\n').trim();
}

function dedupeResponsesReasoningSections(sections) {
  const output = [];
  const seenExact = new Set();

  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const normalizedSection = {
      heading: typeof section?.heading === 'string' ? section.heading.trim() : '',
      bodyBlocks: Array.isArray(section?.bodyBlocks)
        ? section.bodyBlocks.map(block => (typeof block === 'string' ? block.trim() : '')).filter(Boolean)
        : []
    };
    const sectionText = sectionToText(normalizedSection);
    if (!sectionText) return;
    if (seenExact.has(sectionText)) return;

    const last = output[output.length - 1] || null;
    if (last) {
      const lastText = sectionToText(last);
      const sameHeading = (last.heading || '') === (normalizedSection.heading || '');
      if (sameHeading) {
        if (lastText === sectionText || lastText.includes(sectionText)) {
          seenExact.add(sectionText);
          return;
        }
        if (sectionText.includes(lastText)) {
          output[output.length - 1] = normalizedSection;
          seenExact.add(sectionText);
          return;
        }
      }
    }

    output.push(normalizedSection);
    seenExact.add(sectionText);
  });

  return output;
}

export function normalizeResponsesReasoningText(rawText) {
  const sections = splitResponsesReasoningSections(rawText);
  return dedupeResponsesReasoningSections(sections)
    .map(section => sectionToText(section))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function mergeResponsesReasoningText(existing, incoming) {
  const previous = normalizeResponsesReasoningText(existing);
  const next = normalizeResponsesReasoningText(incoming);

  if (!previous) return next;
  if (!next) return previous;
  if (previous === next) return previous;
  if (next.startsWith(previous) || next.includes(previous)) return next;
  if (previous.startsWith(next) || previous.includes(next)) return previous;

  return normalizeResponsesReasoningText(mergeStreamingThoughts(previous, next));
}
