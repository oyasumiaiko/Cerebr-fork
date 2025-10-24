/**
 * 创建 Gemini Computer Use API 客户端
 * @param {Object} appContext - 应用上下文
 * @returns {Object} 客户端实例
 */
export function createComputerUseApi(appContext) {
  const showNotification = appContext?.utils?.showNotification || (() => {});

  const STORAGE_KEY = 'computerUseApiConfig';
  const defaultConfig = {
    apiKey: '',
    modelName: 'gemini-2.5-computer-use-preview-10-2025',
    temperature: 0.2
  };

  let initialized = false;
  let currentConfig = { ...defaultConfig };
  const subscribers = new Set();

  function cloneConfig() {
    return { ...currentConfig };
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(key, (result) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            reject(err);
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(payload, () => {
          const err = chrome.runtime?.lastError;
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function loadConfig() {
    if (initialized) return;
    initialized = true;
    try {
      const stored = await storageGet(STORAGE_KEY);
      const saved = stored?.[STORAGE_KEY];
      if (saved && typeof saved === 'object') {
        currentConfig = { ...defaultConfig, ...saved };
      }
    } catch (error) {
      console.warn('加载电脑操作配置失败，将使用默认值:', error);
      currentConfig = { ...defaultConfig };
    }
  }

  async function persistConfig(partial) {
    await loadConfig();
    if (partial && typeof partial === 'object') {
      currentConfig = { ...currentConfig, ...partial };
    }
    try {
      await storageSet({ [STORAGE_KEY]: currentConfig });
      notifySubscribers();
    } catch (error) {
      console.warn('保存电脑操作配置失败:', error);
    }
  }

  function notifySubscribers() {
    const snapshot = cloneConfig();
    subscribers.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (err) {
        console.warn('电脑操作配置监听回调失败:', err);
      }
    });
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    callback(cloneConfig());
    return () => subscribers.delete(callback);
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
  async function startSession({ instruction, screenshotDataUrl }) {
    if (!instruction || !instruction.trim()) {
      throw new Error('请输入要执行的操作指令');
    }

    await loadConfig();
    const { apiKey, modelName, temperature } = currentConfig;
    const trimmedKey = (apiKey || '').trim();
    if (!trimmedKey) {
      throw new Error('请在电脑操作设置中填写专用的 Gemini API Key');
    }
    if (!modelName || !modelName.trim()) {
      throw new Error('请在电脑操作设置中填写电脑操作模型名称');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName.trim()}:generateContent?key=${encodeURIComponent(trimmedKey)}`;

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
        temperature: typeof temperature === 'number' ? temperature : defaultConfig.temperature,
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
      const parsed = normalizeResponse(payload);
      return {
        ...parsed,
        session: payload.session || null,
        finishReason: payload.candidates?.[0]?.finishReason || null
      };
    } catch (error) {
      console.error('调用 Gemini Computer Use 失败:', error);
      showNotification({ message: error.message || 'Computer Use 请求失败', type: 'error' });
      throw error;
    }
  }

  async function continueSession({ session, functionResponses }) {
    if (!session) {
      throw new Error('缺少会话信息，无法继续电脑操作流程');
    }

    await loadConfig();
    const { apiKey, modelName, temperature } = currentConfig;
    const trimmedKey = (apiKey || '').trim();
    if (!trimmedKey) {
      throw new Error('请在电脑操作设置中填写专用的 Gemini API Key');
    }
    if (!modelName || !modelName.trim()) {
      throw new Error('请在电脑操作设置中填写电脑操作模型名称');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName.trim()}:generateContent?key=${encodeURIComponent(trimmedKey)}`;

    const requestBody = {
      session,
      contents: [],
      tools: [
        {
          computerUse: {
            environment: 'ENVIRONMENT_BROWSER'
          }
        }
      ],
      toolResponse: functionResponses || [],
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : defaultConfig.temperature,
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
      const parsed = normalizeResponse(payload);
      return {
        ...parsed,
        session: payload.session || session,
        finishReason: payload.candidates?.[0]?.finishReason || null
      };
    } catch (error) {
      console.error('继续 Gemini Computer Use 失败:', error);
      showNotification({ message: error.message || 'Computer Use 请求失败', type: 'error' });
      throw error;
    }
  }

  return {
    init: loadConfig,
    getConfig: () => cloneConfig(),
    saveConfig: (partial) => persistConfig(partial),
    subscribe,
    startSession,
    continueSession
  };
}
