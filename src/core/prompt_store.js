/**
 * 提示词存储模块（无UI依赖）
 * - 负责从 chrome.storage.sync 读取/写入提示词配置
 * - 支持按类型分块存储以绕过单项字节限制
 * - 提供旧数据迁移能力（从 {prompts} 老格式迁移到分类型键）
 *
 * 偏函数式实现，便于复用与测试。
 * @since 1.1.0
 */

/** @typedef {Object} PromptItem
 * @property {string} prompt 提示词内容
 * @property {string} model 偏好模型（或 'follow_current'）
 */

/**
 * 常量定义
 */
export const MAX_SYNC_ITEM_BYTES = 8000; // 留出缓冲，chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 8192
export const PROMPT_KEY_PREFIX = 'prompt_';
export const PROMPT_CHUNK_KEY_PREFIX_SUFFIX = '_chunk_';

/**
 * 获取字符串的UTF-8字节长度
 * @param {string} str - 输入字符串
 * @returns {number} 字符串的UTF-8字节长度
 */
function getStringByteLength(str) {
  return new TextEncoder().encode(str).length;
}

/**
 * 迁移旧格式的提示词设置到新格式
 * 旧格式：chrome.storage.sync 下存在 { prompts: { [type]: { prompt, model } } }
 * 新格式：每个类型使用独立 key 'prompt_${type}'
 * @returns {Promise<void>}
 */
export async function migrateOldPromptSettings() {
  try {
    const oldData = await new Promise(resolve => {
      chrome.storage.sync.get(['prompts'], result => resolve(result.prompts));
    });

    if (!oldData) return;

    const migrationTasks = Object.entries(oldData).map(([type, settings]) =>
      new Promise(resolve => {
        chrome.storage.sync.set({ [`${PROMPT_KEY_PREFIX}${type}`]: settings }, resolve);
      })
    );
    await Promise.all(migrationTasks);

    await new Promise(resolve => chrome.storage.sync.remove(['prompts'], resolve));
  } catch (error) {
    console.error('迁移提示词设置时出错:', error);
  }
}

/**
 * 读取所有指定类型的提示词配置（自动组装分块）
 * @param {Array<string>} types - 提示词类型列表
 * @returns {Promise<Object<string, PromptItem>>} map: type -> { prompt, model }
 */
export async function loadAllPromptSettings(types) {
  const results = await Promise.all(types.map(type => loadPromptByType(type)));
  const map = {};
  results.forEach(([type, item]) => { map[type] = item; });
  return map;
}

/**
 * 读取单个类型的提示词配置
 * @param {string} type 提示词类型
 * @returns {Promise<[string, PromptItem]>}
 */
export async function loadPromptByType(type) {
  const mainKey = `${PROMPT_KEY_PREFIX}${type}`;
  return new Promise(resolve => {
    chrome.storage.sync.get([mainKey], async (result) => {
      if (chrome.runtime.lastError) {
        console.error(`Error loading prompt ${type}:`, chrome.runtime.lastError.message);
        resolve([type, { prompt: '', model: 'follow_current' }]);
        return;
      }

      let settings = result[mainKey];
      if (settings && settings.isChunked && typeof settings.chunkCount === 'number' && settings.chunkCount > 0) {
        const chunkKeyBase = `${PROMPT_KEY_PREFIX}${type}${PROMPT_CHUNK_KEY_PREFIX_SUFFIX}`;
        const chunkKeys = Array.from({ length: settings.chunkCount }, (_, i) => `${chunkKeyBase}${i}`);
        try {
          const chunkResults = await new Promise((res, rej) => {
            chrome.storage.sync.get(chunkKeys, (chunks) => {
              if (chrome.runtime.lastError) {
                rej(new Error(chrome.runtime.lastError.message));
              } else {
                res(chunks);
              }
            });
          });
          let fullPrompt = '';
          for (let i = 0; i < settings.chunkCount; i++) {
            fullPrompt += (chunkResults[`${chunkKeyBase}${i}`] || '');
          }
          settings = { prompt: fullPrompt, model: settings.model };
        } catch (e) {
          console.error(`读取分块失败: ${type}`, e);
          settings = { prompt: '', model: 'follow_current' };
        }
      }

      if (!settings) settings = { prompt: '', model: 'follow_current' };
      resolve([type, settings]);
    });
  });
}

/**
 * 清除指定类型提示词的所有分块
 * @param {string} type 提示词类型
 * @returns {Promise<void>}
 */
export async function clearChunksForType(type) {
  try {
    const allItems = await new Promise(resolve => chrome.storage.sync.get(null, resolve));
    if (chrome.runtime.lastError) {
      console.error(`Error getting all items for chunk clearing (type: ${type}):`, chrome.runtime.lastError.message);
      return;
    }
    const chunkPrefix = `${PROMPT_KEY_PREFIX}${type}${PROMPT_CHUNK_KEY_PREFIX_SUFFIX}`;
    const keys = Object.keys(allItems).filter(k => k.startsWith(chunkPrefix));
    if (keys.length === 0) return;
    await new Promise((resolve, reject) => {
      chrome.storage.sync.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } catch (e) {
    console.error(`Exception while clearing chunks for type ${type}:`, e);
  }
}

/**
 * 批量保存提示词（自动分块）
 * @param {Object<string, PromptItem>} items 待保存数据（来自UI）
 * @param {Object<string, PromptItem>} previousSavedState 之前已保存状态（用于回退部分失败场景）
 * @returns {Promise<Object<string, PromptItem>>} 实际保存后的新状态（可能包含回退）
 */
export async function savePromptSettingsBulk(items, previousSavedState = {}) {
  const newState = {};
  const saveOps = [];

  for (const type in items) {
    const item = items[type];
    const mainKey = `${PROMPT_KEY_PREFIX}${type}`;

    await clearChunksForType(type);

    const itemToStore = { prompt: item.prompt, model: item.model };
    const itemBytes = getStringByteLength(JSON.stringify(itemToStore));

    if (itemBytes < MAX_SYNC_ITEM_BYTES) {
      // 直接存储
      saveOps.push(chrome.storage.sync.set({ [mainKey]: itemToStore }));
      newState[type] = { prompt: item.prompt, model: item.model };
      continue;
    }

    // 分块存储
    const chunkKeyBase = `${PROMPT_KEY_PREFIX}${type}${PROMPT_CHUNK_KEY_PREFIX_SUFFIX}`;
    const promptToChunk = item.prompt || '';
    let chunkIndex = 0;
    let charOffset = 0;
    const chunks = [];
    const maxBytesPerChunkData = MAX_SYNC_ITEM_BYTES - 1000; // 预留开销

    while (charOffset < promptToChunk.length) {
      let currentChunkStr = '';
      let currentChunkByteLen = 0;
      let currentEnd = charOffset;

      while (currentEnd < promptToChunk.length) {
        const nextChar = promptToChunk[currentEnd];
        const bytes = getStringByteLength(nextChar);
        if (currentChunkByteLen + bytes > maxBytesPerChunkData) {
          if (currentChunkStr === '') {
            console.error(`单字符过大，无法分块保存: type=${type}, index=${currentEnd}`);
            // 回退该类型
            newState[type] = previousSavedState[type] || { prompt: '', model: item.model };
            currentEnd = promptToChunk.length;
          }
          break;
        }
        currentChunkStr += nextChar;
        currentChunkByteLen += bytes;
        currentEnd++;
      }

      if (!currentChunkStr) break;
      chunks.push({ key: `${chunkKeyBase}${chunkIndex++}`, value: currentChunkStr });
      charOffset = currentEnd;
    }

    if (chunks.length > 0) {
      chunks.forEach(c => saveOps.push(chrome.storage.sync.set({ [c.key]: c.value })));
      saveOps.push(chrome.storage.sync.set({ [mainKey]: { model: item.model, isChunked: true, chunkCount: chunks.length } }));
      newState[type] = { prompt: item.prompt, model: item.model };
    } else if ((promptToChunk || '').length > 0) {
      console.warn(`Prompt 过长且分块失败，未保存: ${type}`);
      newState[type] = previousSavedState[type] || { prompt: '', model: item.model };
    } else {
      newState[type] = { prompt: '', model: item.model };
    }
  }

  await Promise.all(saveOps.map(op => op && op.catch?.(e => { throw e; })));
  return newState;
}


