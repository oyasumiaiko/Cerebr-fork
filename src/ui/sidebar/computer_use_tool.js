/**
 * Gemini 电脑操作面板控制器
 *
 * 负责：
 * 1. 请求宿主页面截图
 * 2. 调用 Gemini Computer Use API
 * 3. 展示模型返回的操作，并支持点击操作的执行
 */

function generateRequestId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createComputerUseTool(appContext) {
  const { dom, services, utils, state } = appContext;
  const computerUseApi = services.computerUseApi;
  const showNotification = utils.showNotification || (() => {});

  const pendingSnapshots = new Map();
  const pendingClicks = new Map();
  let latestScreenshot = null;
  let latestScreenshotAt = 0;
  let isLoading = false;

  function init() {
    if (!dom.computerUseMenuItem || !dom.computerUsePanel) {
      return;
    }

    dom.computerUseMenuItem.addEventListener('click', () => {
      if (state.isStandalone) {
        showNotification({ message: '独立聊天页面暂不支持电脑操作工具', type: 'warning' });
        return;
      }
      utils.closeExclusivePanels?.();
      openPanel();
    });

    dom.computerUseBackButton?.addEventListener('click', closePanel);
    dom.computerUseRunButton?.addEventListener('click', handleRunRequest);
    dom.computerUseCaptureButton?.addEventListener('click', refreshScreenshot);
  }

  function openPanel() {
    dom.computerUsePanel.classList.add('visible');
  }

  function closePanel() {
    dom.computerUsePanel.classList.remove('visible');
  }

  function setStatus(text, type = 'info') {
    if (!dom.computerUseStatus) return;
    dom.computerUseStatus.textContent = text || '';
    dom.computerUseStatus.dataset.statusType = type;
  }

  function setLoading(next, message) {
    isLoading = next;
    if (dom.computerUseRunButton) {
      dom.computerUseRunButton.disabled = next;
    }
    if (dom.computerUseCaptureButton) {
      dom.computerUseCaptureButton.disabled = next;
    }
    if (next && message) {
      setStatus(message, 'info');
    }
  }

  function updateSnapshotMeta() {
    if (!dom.computerUseSnapshotLabel) return;
    if (!latestScreenshotAt) {
      dom.computerUseSnapshotLabel.textContent = '当前截图：尚未生成';
    } else {
      const diff = Math.round((Date.now() - latestScreenshotAt) / 1000);
      dom.computerUseSnapshotLabel.textContent = `当前截图：${diff}s 前获取`;
    }
  }

  function requestScreenshot() {
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId('snap');
      const timeout = setTimeout(() => {
        pendingSnapshots.delete(requestId);
        reject(new Error('截图请求超时'));
      }, 15000);
      pendingSnapshots.set(requestId, { resolve, reject, timeout });
      window.parent.postMessage({ type: 'REQUEST_COMPUTER_USE_SNAPSHOT', requestId }, '*');
    });
  }

  async function refreshScreenshot() {
    try {
      setLoading(true, '正在截取网页截图...');
      const dataUrl = await requestScreenshot();
      latestScreenshot = dataUrl;
      latestScreenshotAt = Date.now();
      updateSnapshotMeta();
      setStatus('截图更新完成，可以继续生成操作。', 'success');
    } catch (error) {
      console.error('刷新截图失败:', error);
      setStatus(error.message || '截图失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function ensureScreenshot() {
    if (latestScreenshot) return latestScreenshot;
    const dataUrl = await requestScreenshot();
    latestScreenshot = dataUrl;
    latestScreenshotAt = Date.now();
    updateSnapshotMeta();
    return dataUrl;
  }

  function renderActions({ narration = '', actions = [] }) {
    if (dom.computerUseNarration) {
      dom.computerUseNarration.textContent = narration || '（模型未返回过程描述）';
    }

    if (!dom.computerUseActionList) return;
    dom.computerUseActionList.innerHTML = '';

    if (!actions.length) {
      const empty = document.createElement('div');
      empty.className = 'computer-use-empty';
      empty.textContent = '未返回可执行的操作指令，可尝试重新描述任务或更新截图。';
      dom.computerUseActionList.appendChild(empty);
      return;
    }

    actions.forEach((action, idx) => {
      const card = document.createElement('div');
      card.className = 'computer-use-action-card';

      const header = document.createElement('div');
      header.className = 'action-header';
      header.innerHTML = `<span class="action-index">#${idx + 1}</span><span class="action-name">${action.name}</span>`;
      card.appendChild(header);

      const argList = document.createElement('div');
      argList.className = 'action-args';
      const argsEntries = Object.entries(action.args || {});
      if (!argsEntries.length) {
        argList.textContent = '无参数';
      } else {
        argsEntries.forEach(([key, value]) => {
          const item = document.createElement('div');
          item.className = 'action-arg-item';
          item.textContent = `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`;
          argList.appendChild(item);
        });
      }
      card.appendChild(argList);

      if (action.name === 'click_at' && typeof action.args?.x === 'number' && typeof action.args?.y === 'number') {
        const button = document.createElement('button');
        button.className = 'computer-use-action-btn';
        button.textContent = '在页面执行点击';
        button.addEventListener('click', () => {
          executeClickAction(action.args);
        });
        card.appendChild(button);
      }

      dom.computerUseActionList.appendChild(card);
    });
  }

  async function handleRunRequest() {
    if (!computerUseApi) {
      setStatus('尚未初始化 Gemini API 配置', 'error');
      return;
    }

    const instruction = (dom.computerUseInstruction?.value || '').trim();
    if (!instruction) {
      setStatus('请先输入要执行的指令', 'warning');
      dom.computerUseInstruction?.focus();
      return;
    }

    try {
      setLoading(true, '正在向 Gemini 请求操作...');
      const screenshot = await ensureScreenshot();
      const result = await computerUseApi.sendInitialRequest({
        instruction,
        screenshotDataUrl: screenshot
      });
      renderActions(result);
      setStatus(result.actions?.length ? '已生成操作，可逐项执行。' : '模型未返回操作，请调整描述或刷新页面。', result.actions?.length ? 'success' : 'warning');
    } catch (error) {
      console.error('调用 Gemini Computer Use 失败:', error);
      setStatus(error.message || '请求失败，请检查控制台日志', 'error');
    } finally {
      setLoading(false);
    }
  }

  function requestClick(args) {
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId('click');
      const timeout = setTimeout(() => {
        pendingClicks.delete(requestId);
        reject(new Error('页面执行点击超时'));
      }, 8000);
      pendingClicks.set(requestId, { resolve, reject, timeout });
      window.parent.postMessage({
        type: 'PERFORM_COMPUTER_USE_CLICK',
        requestId,
        payload: { x: args.x, y: args.y }
      }, '*');
    });
  }

  async function executeClickAction(args) {
    try {
      if (typeof args.x !== 'number' || typeof args.y !== 'number') {
        setStatus('当前操作缺少坐标参数，无法执行点击。', 'warning');
        return;
      }
      setStatus(`正在执行点击 (${args.x}, ${args.y}) ...`, 'info');
      const result = await requestClick(args);
      const selector = result.selector ? `元素：${result.selector}` : '已尝试点击目标位置';
      setStatus(`点击完成，${selector}`, 'success');
    } catch (error) {
      console.error('执行页面点击失败:', error);
      setStatus(error.message || '执行点击失败', 'error');
    }
  }

  function handleSnapshotResult(message) {
    if (!message.requestId) return;
    const entry = pendingSnapshots.get(message.requestId);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pendingSnapshots.delete(message.requestId);
    if (message.success && message.dataURL) {
      entry.resolve(message.dataURL);
    } else {
      entry.reject(new Error(message.error || '截图失败'));
    }
  }

  function handleClickResult(message) {
    if (!message.requestId) return;
    const entry = pendingClicks.get(message.requestId);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pendingClicks.delete(message.requestId);
    if (message.success) {
      entry.resolve(message);
    } else {
      entry.reject(new Error(message.error || '点击失败'));
    }
  }

  return {
    init,
    openPanel,
    closePanel,
    handleSnapshotResult,
    handleClickResult
  };
}

