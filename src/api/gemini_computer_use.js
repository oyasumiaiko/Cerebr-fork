/**
 * 创建 Gemini Computer Use API 客户端
 * @param {Object} appContext - 应用上下文
 * @returns {Object} 客户端实例
 */
export function createComputerUseApi(appContext) {
  const apiManager = appContext?.services?.apiManager;
  const showNotification = appContext?.utils?.showNotification || (() => {});

  /**
   * 校验并获取当前选中的 API 配置
   * @returns {Object}
   */
  function getValidConfig() {
    const config = apiManager?.getSelectedConfig?.();
    if (!config) {
      throw new Error('未找到可用的 API 配置');
    }
    if ((config.baseUrl || '').toLowerCase() !== 'genai') {
      throw new Error('当前配置不是 Gemini API，请选择 Gemini 电脑操作模型');
    }
    if (!String(config.modelName || '').includes('computer-use')) {
      throw new Error('请选择 Gemini 电脑操作模型 (computer-use)');
    }
    const rawKey = Array.isArray(config.apiKey) ? config.apiKey[0] : config.apiKey;
    const apiKey = (rawKey || '').trim();
    if (!apiKey) {
      throw new Error('当前配置缺少有效的 API Key');
    }
    return { config, apiKey };
  }

  /**
   * 将 dataURL 转换为裸的 Base64 字符串
   * @param {string} dataUrl - 形如 data:image/png;base64,... 的字符串
   * @returns {string}
   */
  function extractBase64(dataUrl) {
    if (!dataUrl) return '';
    const commaIndex = dataUrl.indexOf(',');
    return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  }

  /**
   * 解析模型响应，提取叙述与操作指令
   * @param {Object} payload - 原始响应
   * @returns {{ narration: string, actions: Array<Object>, candidate: Object }}
   */
  function normalizeResponse(payload) {
    const candidate = payload?.candidates?.[0];
    if (!candidate) {
      throw new Error('Gemini 返回结果为空');
    }
    const parts = candidate.content?.parts || [];
    const narrationPieces = [];
    const actions = [];

    for (const part of parts) {
      if (part?.text) {
        narrationPieces.push(part.text);
      }
      if (part?.functionCall) {
        actions.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {}
        });
      }
    }

    return {
      narration: narrationPieces.join('\n') || '',
      actions,
      candidate
    };
  }

  /**
   * 发送初始 Computer Use 请求
   * @param {Object} options
   * @param {string} options.instruction - 用户提供的指令
   * @param {string} options.screenshotDataUrl - 当前页面的截图（dataURL）
   * @returns {Promise<{ narration: string, actions: Array<Object>, candidate: Object }>}
   */
  async function sendInitialRequest({ instruction, screenshotDataUrl }) {
    if (!instruction || !instruction.trim()) {
      throw new Error('请输入要执行的操作指令');
    }

    const { config, apiKey } = getValidConfig();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const inlineData = extractBase64(screenshotDataUrl);
    if (!inlineData) {
      throw new Error('未获取到有效的页面截图');
    }

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: instruction.trim() },
            {
              inline_data: {
                mime_type: 'image/png',
                data: inlineData
              }
            }
          ]
        }
      ],
      tools: [
        {
          computerUse: {
            environment: 'ENVIRONMENT_BROWSER'
          }
        }
      ],
      generationConfig: {
        temperature: config.temperature ?? 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Computer Use 请求失败 (${response.status}): ${detail}`);
      }

      const payload = await response.json();
      return normalizeResponse(payload);
    } catch (error) {
      console.error('调用 Gemini Computer Use 失败:', error);
      showNotification({ message: error.message || 'Computer Use 请求失败', type: 'error' });
      throw error;
    }
  }

  return {
    sendInitialRequest
  };
}
