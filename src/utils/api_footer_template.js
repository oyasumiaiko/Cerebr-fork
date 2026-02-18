/**
 * AI 消息 footer 模板工具：
 * - 统一解析可展示的 API 元数据；
 * - 提供模板渲染（支持 {{var}} 与 {{#var}}...{{/var}}）；
 * - 输出 footer 文本与 tooltip 标题，避免多处重复实现。
 */

export const DEFAULT_AI_FOOTER_TEMPLATE = '{{display_label}}';

function toTrimmedText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeTimestampMs(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function normalizeTokenValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function hasTemplateValue(value) {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value);
  return toTrimmedText(value).length > 0;
}

function applyConditionalSections(template, context) {
  let rendered = String(template ?? '');
  const sectionPattern = /{{#\s*([a-zA-Z0-9_]+)\s*}}([\s\S]*?){{\/\s*\1\s*}}/g;
  // 简单多轮替换，支持常见的浅层嵌套条件块。
  for (let i = 0; i < 8; i += 1) {
    let changed = false;
    rendered = rendered.replace(sectionPattern, (_, key, inner) => {
      changed = true;
      return hasTemplateValue(context[key]) ? inner : '';
    });
    if (!changed) break;
  }
  return rendered;
}

function normalizeFooterText(value) {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolveMatchedConfig(nodeLike, allConfigs) {
  if (!nodeLike || !Array.isArray(allConfigs) || allConfigs.length === 0) return null;
  const targetUuid = toTrimmedText(nodeLike.apiUuid);
  if (!targetUuid) return null;
  return allConfigs.find(config => config?.id === targetUuid) || null;
}

/**
 * 统一归一化 usage 字段，兼容 promptTokens / prompt_tokens 两种命名。
 * @param {any} rawUsage
 * @returns {{promptTokens:number|null,completionTokens:number|null,totalTokens:number|null}|null}
 */
export function normalizeApiUsageMeta(rawUsage) {
  if (!rawUsage || typeof rawUsage !== 'object') return null;
  const promptTokens = normalizeTokenValue(rawUsage.prompt_tokens ?? rawUsage.promptTokens);
  const completionTokens = normalizeTokenValue(rawUsage.completion_tokens ?? rawUsage.completionTokens);
  const totalTokens = normalizeTokenValue(rawUsage.total_tokens ?? rawUsage.totalTokens);
  if (promptTokens == null && completionTokens == null && totalTokens == null) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

/**
 * 生成 footer 模板可用上下文。
 * @param {any} nodeLike - 历史节点或等价对象
 * @param {any|null} matchedConfig - 按 apiUuid 匹配到的当前配置快照
 */
export function buildApiFooterContext(nodeLike, matchedConfig = null) {
  const displayName = toTrimmedText(matchedConfig?.displayName) || toTrimmedText(nodeLike?.apiDisplayName);
  const modelName = toTrimmedText(matchedConfig?.modelName) || toTrimmedText(nodeLike?.apiModelId);
  const apiName = displayName || modelName;
  const hasThoughtSignature = !!nodeLike?.thoughtSignature;
  const usage = normalizeApiUsageMeta(nodeLike?.apiUsage);
  const timestampMs = normalizeTimestampMs(nodeLike?.timestamp);
  const date = (timestampMs != null) ? new Date(timestampMs) : null;

  const displayLabel = hasThoughtSignature
    ? (apiName ? `signatured · ${apiName}` : 'signatured')
    : apiName;

  return {
    display_label: displayLabel || '',
    apiname: apiName || '',
    api_uuid: toTrimmedText(nodeLike?.apiUuid),
    display_name: displayName || '',
    model: modelName || '',
    signature: hasThoughtSignature ? 'signatured' : '',
    signature_prefix: hasThoughtSignature ? 'signatured · ' : '',
    signature_source: toTrimmedText(nodeLike?.thoughtSignatureSource),
    input_tokens: usage?.promptTokens ?? '',
    output_tokens: usage?.completionTokens ?? '',
    total_tokens: usage?.totalTokens ?? '',
    prompt_tokens: usage?.promptTokens ?? '',
    completion_tokens: usage?.completionTokens ?? '',
    timestamp: timestampMs != null ? String(timestampMs) : '',
    time: date ? date.toLocaleTimeString() : '',
    date: date ? date.toLocaleDateString() : '',
    datetime: date ? date.toLocaleString() : ''
  };
}

/**
 * 渲染 footer 模板。
 * 支持：
 * - 变量：{{apiname}}
 * - 条件块：{{#total_tokens}}总: {{total_tokens}}{{/total_tokens}}
 */
export function renderApiFooterTemplate(template, context = {}) {
  const source = (typeof template === 'string') ? template : DEFAULT_AI_FOOTER_TEMPLATE;
  const withSections = applyConditionalSections(source, context);
  const rendered = withSections.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = context[key];
    return value == null ? '' : String(value);
  });
  return normalizeFooterText(rendered);
}

/**
 * 生成 footer tooltip（标题）文本。
 */
export function buildApiFooterTitle(nodeLike, matchedConfig = null) {
  const displayName = toTrimmedText(matchedConfig?.displayName) || toTrimmedText(nodeLike?.apiDisplayName);
  const modelName = toTrimmedText(matchedConfig?.modelName) || toTrimmedText(nodeLike?.apiModelId);
  const hasThoughtSignature = !!nodeLike?.thoughtSignature;
  const usage = normalizeApiUsageMeta(nodeLike?.apiUsage);
  const titleLines = [
    `API uuid: ${toTrimmedText(nodeLike?.apiUuid) || '-'} | displayName: ${displayName || '-'} | model: ${modelName || '-'}`
  ];
  if (hasThoughtSignature) {
    titleLines.push('thought_signature: stored');
  }
  if (usage?.promptTokens != null) titleLines.push(`prompt_tokens: ${usage.promptTokens}`);
  if (usage?.completionTokens != null) titleLines.push(`completion_tokens: ${usage.completionTokens}`);
  if (usage?.totalTokens != null) titleLines.push(`total_tokens: ${usage.totalTokens}`);
  return titleLines.join('\n');
}

/**
 * 一次性输出 footer 渲染结果，供 UI 层直接消费。
 */
export function buildApiFooterRenderData(nodeLike, options = {}) {
  const allConfigs = Array.isArray(options.allConfigs) ? options.allConfigs : [];
  const matchedConfig = resolveMatchedConfig(nodeLike, allConfigs);
  const context = buildApiFooterContext(nodeLike, matchedConfig);
  const text = renderApiFooterTemplate(options.template, context);
  const title = buildApiFooterTitle(nodeLike, matchedConfig);
  return {
    text,
    title,
    context,
    matchedConfig
  };
}
