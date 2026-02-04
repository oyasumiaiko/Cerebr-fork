/**
 * 统一存储写入队列（非模块脚本）
 * - 通过去抖+最小间隔+指数退避，降低 chrome.storage.sync 写入配额触发概率
 * - 只负责 set 写入合并，读取/删除仍由调用方自行处理
 * - 以全局对象形式暴露，供 content script 与模块代码共享
 */
(function initStorageWriteQueue() {
  if (globalThis.CerebrStorageWriteQueue) return;

  const STORAGE_WRITE_POLICY = {
    sync: {
      debounceMs: 400,
      minIntervalMs: 1500,
      retryBaseMs: 15000,
      retryMaxMs: 120000
    },
    local: {
      debounceMs: 200,
      retryBaseMs: 2000,
      retryMaxMs: 10000
    }
  };

  const state = {
    pending: { sync: {}, local: {} },
    timers: { sync: null, local: null },
    inFlight: { sync: false, local: false },
    lastPersisted: { sync: {}, local: {} },
    lastSyncWriteAt: 0,
    syncRetryBackoffMs: 0,
    nextSyncRetryAt: 0,
    lastErrorLogAt: 0
  };

  function normalizeArea(area) {
    return area === 'local' ? 'local' : 'sync';
  }

  function canWrite(area) {
    return !!(globalThis.chrome && chrome.storage && chrome.storage[area] && chrome.storage[area].set);
  }

  function isPrimitiveValue(value) {
    return value === null || (typeof value !== 'object' && typeof value !== 'function');
  }

  function scheduleFlush(area, delayMs) {
    const policy = STORAGE_WRITE_POLICY[area];
    let delay = Math.max(0, Number(delayMs ?? policy?.debounceMs ?? 0));
    if (area === 'sync' && state.nextSyncRetryAt) {
      const waitForRetry = state.nextSyncRetryAt - Date.now();
      if (waitForRetry > 0) {
        delay = Math.max(delay, waitForRetry);
      }
    }
    if (state.timers[area]) {
      clearTimeout(state.timers[area]);
    }
    state.timers[area] = setTimeout(() => {
      void flush(area);
    }, delay);
  }

  function getRetryDelay(area, error) {
    const policy = STORAGE_WRITE_POLICY[area];
    if (area !== 'sync') return policy.retryBaseMs;
    const message = error?.message || '';
    const hitQuota = /MAX_WRITE_OPERATIONS_PER_MINUTE/i.test(message);
    if (!hitQuota) return policy.retryBaseMs;
    state.syncRetryBackoffMs = state.syncRetryBackoffMs
      ? Math.min(state.syncRetryBackoffMs * 2, policy.retryMaxMs)
      : policy.retryBaseMs;
    return state.syncRetryBackoffMs;
  }

  function logWriteError(area, keys, error) {
    const now = Date.now();
    if (now - state.lastErrorLogAt < 5000) return;
    state.lastErrorLogAt = now;
    console.warn('存储写入失败，将稍后重试：', { area, keys }, error);
  }

  function prime(area, payload) {
    if (!payload || typeof payload !== 'object') return;
    const targetArea = normalizeArea(area);
    const persisted = state.lastPersisted[targetArea];
    const pending = state.pending[targetArea];
    Object.keys(payload).forEach((key) => {
      persisted[key] = payload[key];
      if (Object.prototype.hasOwnProperty.call(pending, key) && pending[key] === payload[key]) {
        delete pending[key];
      }
    });
  }

  async function flush(area) {
    const targetArea = normalizeArea(area);
    state.timers[targetArea] = null;
    if (!canWrite(targetArea)) return { ok: false, skipped: true, reason: 'no_storage' };

    if (state.inFlight[targetArea]) {
      scheduleFlush(targetArea);
      return { ok: true, queued: true };
    }

    const pending = state.pending[targetArea];
    const keys = Object.keys(pending);
    if (keys.length === 0) return { ok: true, skipped: true };

    if (targetArea === 'sync') {
      const now = Date.now();
      const elapsed = now - state.lastSyncWriteAt;
      const minInterval = STORAGE_WRITE_POLICY.sync.minIntervalMs;
      if (elapsed < minInterval) {
        scheduleFlush(targetArea, minInterval - elapsed);
        return { ok: true, queued: true };
      }
    }

    const payload = { ...pending };
    state.pending[targetArea] = {};
    state.inFlight[targetArea] = true;
    try {
      await chrome.storage[targetArea].set(payload);
      if (targetArea === 'sync') {
        state.lastSyncWriteAt = Date.now();
        state.syncRetryBackoffMs = 0;
        state.nextSyncRetryAt = 0;
      }
      Object.keys(payload).forEach((key) => {
        state.lastPersisted[targetArea][key] = payload[key];
      });
      return { ok: true, flushed: true };
    } catch (error) {
      state.pending[targetArea] = { ...payload, ...state.pending[targetArea] };
      logWriteError(targetArea, Object.keys(payload), error);
      const retryDelay = getRetryDelay(targetArea, error);
      if (targetArea === 'sync') {
        state.nextSyncRetryAt = Date.now() + retryDelay;
      }
      scheduleFlush(targetArea, retryDelay);
      return { ok: false, error };
    } finally {
      state.inFlight[targetArea] = false;
    }
  }

  function set(area, payload, options = {}) {
    const targetArea = normalizeArea(area);
    if (!canWrite(targetArea)) return Promise.resolve({ ok: false, skipped: true, reason: 'no_storage' });
    if (!payload || typeof payload !== 'object') return Promise.resolve({ ok: false, skipped: true, reason: 'invalid_payload' });

    const pending = state.pending[targetArea];
    const persisted = state.lastPersisted[targetArea];
    let changed = false;
    Object.keys(payload).forEach((key) => {
      const value = payload[key];
      if (Object.prototype.hasOwnProperty.call(pending, key) && pending[key] === value) return;
      if (isPrimitiveValue(value) && persisted[key] === value && !Object.prototype.hasOwnProperty.call(pending, key)) return;
      pending[key] = value;
      changed = true;
    });

    if (!changed) return Promise.resolve({ ok: true, skipped: true });

    const immediate = options?.flush === 'now' || options?.immediate === true;
    scheduleFlush(targetArea, immediate ? 0 : undefined);
    return Promise.resolve({ ok: true, queued: true });
  }

  globalThis.CerebrStorageWriteQueue = {
    set,
    flush,
    prime
  };
})();
