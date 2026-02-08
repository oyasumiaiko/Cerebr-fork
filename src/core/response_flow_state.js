/**
 * 发送响应阶段的纯函数规则：
 * - 统一流式/非流式模式判定；
 * - 统一流式渲染阶段状态机（首帧/增量更新/空事件）。
 *
 * 设计原则：
 * - 只做输入 -> 输出的状态推导，不触发任何副作用；
 * - 便于在 message_sender 中集中处理 DOM/历史写入等副作用。
 */

function normalizeApiBase(value) {
  return (typeof value === 'string') ? value.trim().toLowerCase() : '';
}

/**
 * 统一判定本次请求应走流式还是非流式。
 *
 * @param {{
 *   apiBase?: string,
 *   geminiUseStreaming?: boolean,
 *   requestBodyStream?: boolean
 * }} [input]
 * @returns {'stream'|'non_stream'}
 */
export function resolveResponseHandlingMode(input = {}) {
  const apiBase = normalizeApiBase(input?.apiBase);
  const geminiUseStreaming = input?.geminiUseStreaming !== false;
  const requestBodyStream = input?.requestBodyStream === true;

  if (apiBase === 'genai') {
    return geminiUseStreaming ? 'stream' : 'non_stream';
  }
  return requestBodyStream ? 'stream' : 'non_stream';
}

/**
 * 统一流式渲染阶段状态机：
 * - 首帧：决定是否执行“占位升级/创建消息”；
 * - 后续帧：决定是否执行“增量更新”以及是否强制刷新；
 * - 空事件：保持状态不变，直接跳过。
 *
 * @param {{
 *   hasDelta?: boolean,
 *   hasStartedResponse?: boolean,
 *   hasMessageId?: boolean,
 *   hasAnswerContent?: boolean,
 *   hasEverShownAnswerContent?: boolean
 * }} [input]
 * @returns {{
 *   action: 'noop'|'first_chunk'|'wait_for_message'|'update_existing',
 *   forceUiUpdate: boolean,
 *   nextState: {
 *     hasStartedResponse: boolean,
 *     hasEverShownAnswerContent: boolean
 *   }
 * }}
 */
export function planStreamingRenderTransition(input = {}) {
  const hasDelta = input?.hasDelta === true;
  const hasStartedResponse = input?.hasStartedResponse === true;
  const hasMessageId = input?.hasMessageId === true;
  const hasAnswerContent = input?.hasAnswerContent === true;
  const hasEverShownAnswerContent = input?.hasEverShownAnswerContent === true;

  if (!hasDelta) {
    return {
      action: 'noop',
      forceUiUpdate: false,
      nextState: {
        hasStartedResponse,
        hasEverShownAnswerContent
      }
    };
  }

  if (!hasStartedResponse) {
    return {
      action: 'first_chunk',
      forceUiUpdate: false,
      nextState: {
        hasStartedResponse: true,
        hasEverShownAnswerContent: hasAnswerContent
      }
    };
  }

  const nextHasEverShownAnswerContent = hasEverShownAnswerContent || hasAnswerContent;
  if (!hasMessageId) {
    return {
      action: 'wait_for_message',
      forceUiUpdate: false,
      nextState: {
        hasStartedResponse: true,
        hasEverShownAnswerContent: nextHasEverShownAnswerContent
      }
    };
  }

  const forceUiUpdate = hasAnswerContent && !hasEverShownAnswerContent;
  return {
    action: 'update_existing',
    forceUiUpdate,
    nextState: {
      hasStartedResponse: true,
      hasEverShownAnswerContent: nextHasEverShownAnswerContent
    }
  };
}
