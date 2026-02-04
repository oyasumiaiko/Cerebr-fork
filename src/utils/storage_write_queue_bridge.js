/**
 * 存储写入队列桥接层（ES Module）
 * - 统一从全局队列写入；未加载队列时回退为直接写入
 * - 供模块代码使用，避免在各处散落队列兼容逻辑
 */

function getQueue() {
  return globalThis.CerebrStorageWriteQueue || null;
}

function normalizeArea(area) {
  return area === 'local' ? 'local' : 'sync';
}

function canWrite(area) {
  return !!(globalThis.chrome && chrome.storage && chrome.storage[area] && chrome.storage[area].set);
}

export function queueStorageSet(area, payload, options = {}) {
  const targetArea = normalizeArea(area);
  const queue = getQueue();
  if (queue?.set) {
    return queue.set(targetArea, payload, options);
  }
  if (!canWrite(targetArea)) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'no_storage' });
  }
  return chrome.storage[targetArea].set(payload);
}

export function queueStoragePrime(area, payload) {
  const queue = getQueue();
  if (!queue?.prime) return;
  queue.prime(normalizeArea(area), payload);
}

export function queueStorageFlush(area) {
  const queue = getQueue();
  if (!queue?.flush) return Promise.resolve({ ok: false, skipped: true, reason: 'no_queue' });
  return queue.flush(normalizeArea(area));
}
