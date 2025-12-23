/**
 * 自适应 UI 更新节流器（面向“流式输出 + 高频刷新”的场景）。
 *
 * 背景问题：
 * - 流式接口可能以非常高的频率返回 token；
 * - 如果每个 token 都触发一次“整段 Markdown 渲染 + 高亮 + DOM 更新”，主线程会被频繁占用；
 * - 在长消息（或包含大量代码块/数学公式）的场景下，单次更新的耗时会明显增加，最终表现为严重卡顿。
 *
 * 设计目标：
 * - 合并多次 enqueue：始终只保留“最新的一份 payload”，做到“掉帧但不掉内容”；
 * - 用计时器测量阻塞：通过 setTimeout 的触发延迟（event loop lag）近似衡量主线程压力；
 * - 用执行耗时测量阻塞：用 performance.now() 记录 run() 的同步耗时；
 * - 自适应调整频率：根据内容规模（长度）与近期耗时，动态增大/减小最小刷新间隔；
 * - 可取消：在请求中断/结束时，确保不会有遗留定时器继续更新 DOM。
 *
 * 注意：
 * - 这是一个通用工具：只负责“何时执行”，不关心 payload 的业务含义；
 * - run() 应尽量是幂等的（同样的 payload 重复执行不会产生副作用）。
 */

/**
 * @typedef {Object} AdaptiveUpdateThrottler
 * @property {(payload: any, options?: { force?: boolean }) => void} enqueue - 提交最新 payload；默认按当前节流策略延后执行
 * @property {(options?: { force?: boolean }) => void} flush - 立即执行一次（若有待处理 payload）
 * @property {() => void} cancel - 取消待执行的定时器并清空待处理 payload
 * @property {() => number} getIntervalMs - 获取当前动态计算出的最小刷新间隔（毫秒）
 */

/**
 * 创建自适应 UI 更新节流器
 * @param {Object} options
 * @param {(payload: any) => void} options.run - 实际的“执行更新”函数（同步执行；内部会测量耗时）
 * @param {() => boolean} [options.shouldCancel] - 返回 true 时，节流器会跳过执行并清理状态（用于请求中断/页面卸载）
 * @param {(payload: any) => number} [options.getContentSize] - 从 payload 估算内容规模（用于“长消息”基线节流）
 * @param {(contentSize: number) => number} [options.getBaseIntervalMs] - 根据内容规模给出“基线最小间隔”
 * @param {number} [options.minIntervalMs=33] - 最小间隔下限（不会更快）
 * @param {number} [options.maxIntervalMs=1200] - 最小间隔上限（不会更慢）
 * @param {number} [options.targetDutyCycle=0.2] - 目标占用率（run() 时间 / 总时间），用于由耗时反推间隔
 * @param {number} [options.windowMs=2000] - 统计窗口（毫秒），用于平滑估计“近期占用率”
 * @param {number} [options.emaAlpha=0.2] - EMA 平滑系数（0~1，越大越敏感）
 * @returns {AdaptiveUpdateThrottler}
 */
export function createAdaptiveUpdateThrottler(options) {
  if (!options || typeof options.run !== 'function') {
    throw new Error('createAdaptiveUpdateThrottler: options.run 必须是函数');
  }

  const shouldCancel = (typeof options.shouldCancel === 'function') ? options.shouldCancel : () => false;
  const getContentSize = (typeof options.getContentSize === 'function') ? options.getContentSize : () => 0;
  const getBaseIntervalMs = (typeof options.getBaseIntervalMs === 'function')
    ? options.getBaseIntervalMs
    : (contentSize) => {
      // 基线节流（经验值）：
      // - 内容越长，单次渲染/高亮的成本越高，因此最小间隔需要更大。
      if (contentSize < 2000) return 50;
      if (contentSize < 8000) return 80;
      if (contentSize < 20000) return 120;
      if (contentSize < 50000) return 200;
      return 350;
    };

  const minIntervalMs = Math.max(0, Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : 33);
  const maxIntervalMs = Math.max(minIntervalMs, Number.isFinite(options.maxIntervalMs) ? options.maxIntervalMs : 1200);
  const targetDutyCycle = Math.min(0.9, Math.max(0.05, Number.isFinite(options.targetDutyCycle) ? options.targetDutyCycle : 0.2));
  const windowMs = Math.max(200, Number.isFinite(options.windowMs) ? options.windowMs : 2000);
  const emaAlpha = Math.min(0.5, Math.max(0.05, Number.isFinite(options.emaAlpha) ? options.emaAlpha : 0.2));

  const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  // ---- 内部状态 ----
  let latestPayload = null;
  let timerId = null;
  let scheduledTargetAtMs = 0;
  let lastFlushAtMs = nowMs();

  // 当前动态间隔（会在每次 flush 后更新）
  let currentIntervalMs = clamp(getBaseIntervalMs(0), minIntervalMs, maxIntervalMs);

  // 以 EMA 形式记录两类“阻塞信号”：
  // 1) run() 的同步执行耗时
  // 2) 定时器触发延迟（event loop lag）
  let emaRunCostMs = 0;
  let emaTimerLagMs = 0;

  // 近期窗口统计（用于估计占用率）
  const recent = [];
  let recentSumCostMs = 0;

  function clearTimer() {
    if (timerId !== null) {
      try { clearTimeout(timerId); } catch (_) {}
      timerId = null;
    }
    scheduledTargetAtMs = 0;
  }

  function recordCost(costMs) {
    const t = nowMs();
    const safeCost = Math.max(0, Number(costMs) || 0);
    recent.push({ t, cost: safeCost });
    recentSumCostMs += safeCost;
    while (recent.length > 0 && recent[0].t < (t - windowMs)) {
      recentSumCostMs -= recent[0].cost;
      recent.shift();
    }
  }

  function recomputeInterval(payload) {
    const contentSize = Math.max(0, Number(getContentSize(payload)) || 0);
    const baseInterval = clamp(getBaseIntervalMs(contentSize), minIntervalMs, maxIntervalMs);

    // 用“更保守”的阻塞信号作为成本（两者取较大值）：
    // - run() 耗时反映 DOM/渲染本身的成本；
    // - timer lag 反映主线程整体压力（包括布局/绘制等导致的延迟）。
    const effectiveCostMs = Math.max(emaRunCostMs || 0, emaTimerLagMs || 0);
    const costDrivenInterval = effectiveCostMs > 0
      ? Math.ceil(effectiveCostMs / targetDutyCycle)
      : baseInterval;

    // 近期占用率校正：如果窗口内占用率明显高于目标，则额外抬升间隔。
    const recentDuty = windowMs > 0 ? (recentSumCostMs / windowMs) : 0;
    const dutyDrivenInterval = (recentDuty > targetDutyCycle * 1.2)
      ? Math.ceil(currentIntervalMs * (recentDuty / targetDutyCycle))
      : 0;

    const targetInterval = clamp(
      Math.max(baseInterval, costDrivenInterval, dutyDrivenInterval || 0),
      minIntervalMs,
      maxIntervalMs
    );

    // 平滑更新，避免间隔在边界附近剧烈抖动
    currentIntervalMs = Math.round(currentIntervalMs * 0.7 + targetInterval * 0.3);
    currentIntervalMs = clamp(currentIntervalMs, baseInterval, maxIntervalMs);
  }

  function shouldSkip() {
    try { return !!shouldCancel(); } catch (_) { return false; }
  }

  function flush(options = {}) {
    const force = !!options.force;
    if (!latestPayload) return;
    if (shouldSkip()) {
      latestPayload = null;
      clearTimer();
      return;
    }

    const now = nowMs();
    if (!force && (now - lastFlushAtMs) < currentIntervalMs) {
      // 还没到时间：确保已经有一个定时器等待触发
      schedule();
      return;
    }

    clearTimer();

    const payload = latestPayload;
    latestPayload = null;

    const start = nowMs();
    try {
      options.run(payload);
    } catch (e) {
      // 更新失败不应影响主流程；保守打印一次，避免静默吞错导致难排查。
      console.warn('自适应节流器执行 run() 失败:', e);
    }
    const costMs = nowMs() - start;

    // 记录阻塞信号（EMA 平滑）
    emaRunCostMs = emaRunCostMs
      ? (emaRunCostMs * (1 - emaAlpha) + costMs * emaAlpha)
      : costMs;
    recordCost(costMs);
    recomputeInterval(payload);

    lastFlushAtMs = nowMs();
  }

  function schedule() {
    if (timerId !== null) return;
    if (!latestPayload) return;
    if (shouldSkip()) return;

    const now = nowMs();
    const dueInMs = Math.max(0, currentIntervalMs - (now - lastFlushAtMs));
    scheduledTargetAtMs = now + dueInMs;

    timerId = setTimeout(() => {
      timerId = null;
      const firedAtMs = nowMs();
      const lagMs = Math.max(0, firedAtMs - scheduledTargetAtMs);
      if (lagMs > 0) {
        emaTimerLagMs = emaTimerLagMs
          ? (emaTimerLagMs * (1 - emaAlpha) + lagMs * emaAlpha)
          : lagMs;
      }
      flush({ force: false, run: options.run });
    }, dueInMs);
  }

  function enqueue(payload, enqueueOptions = {}) {
    if (shouldSkip()) return;
    latestPayload = payload;

    if (enqueueOptions && enqueueOptions.force) {
      flush({ force: true, run: options.run });
      return;
    }

    // 如果已到达间隔，立即执行；否则合并并等待下一次定时器触发。
    const now = nowMs();
    if ((now - lastFlushAtMs) >= currentIntervalMs) {
      flush({ force: false, run: options.run });
      return;
    }

    schedule();
  }

  function cancel() {
    latestPayload = null;
    clearTimer();
  }

  function getIntervalMs() {
    return currentIntervalMs;
  }

  return {
    enqueue,
    flush: (opts) => flush({ ...(opts || {}), run: options.run }),
    cancel,
    getIntervalMs
  };
}

