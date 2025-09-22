import { createSidebarAppContext, registerSidebarUtilities } from './sidebar_app_context.js';
import { initializeSidebarServices } from './sidebar_bootstrap.js';
import { registerSidebarEventHandlers } from './sidebar_events.js';

document.addEventListener('DOMContentLoaded', async () => {
  const isStandalone = detectStandaloneMode();
  applyStandaloneClasses(isStandalone);

  const appContext = createSidebarAppContext(isStandalone);
  registerSidebarUtilities(appContext);
  setupLayoutObservers(appContext);
  exposeGlobals(appContext, isStandalone);

  await initializeSidebarServices(appContext);
  registerSidebarEventHandlers(appContext);
});

function detectStandaloneMode() {
  const currentUrl = new URL(window.location.href);
  const hashQuery = currentUrl.hash.startsWith('#') ? currentUrl.hash.substring(1) : '';
  const hashParams = new URLSearchParams(hashQuery);
  const standaloneParam = (
    currentUrl.searchParams.get('mode') === 'standalone' ||
    currentUrl.searchParams.get('standalone') === '1' ||
    hashParams.get('mode') === 'standalone' ||
    hashParams.get('standalone') === '1' ||
    currentUrl.hash.includes('standalone')
  );

  let isStandalone = standaloneParam;
  try {
    if (!isStandalone) {
      isStandalone = window.parent === window;
    }
  } catch (_) {
    // 跨域场景下访问 window.parent 可能抛异常，忽略并视为嵌入模式
  }
  return isStandalone;
}

function applyStandaloneClasses(isStandalone) {
  if (document?.body) {
    document.body.classList.toggle('standalone-mode', isStandalone);
  }
  if (document?.documentElement) {
    document.documentElement.classList.toggle('standalone-mode', isStandalone);
  }
}

function setupLayoutObservers(appContext) {
  appContext.utils.updateInputContainerHeightVar();
  window.addEventListener('resize', appContext.utils.updateInputContainerHeightVar);
  const resizeObserver = new ResizeObserver(() => appContext.utils.updateInputContainerHeightVar());
  const inputEl = document.getElementById('input-container');
  if (inputEl) resizeObserver.observe(inputEl);
}

function exposeGlobals(appContext, isStandalone) {
  window.cerebr = window.cerebr || {};
  window.cerebr.environment = isStandalone ? 'standalone' : 'embedded';
  window.cerebr.settings = {
    prompts: () => appContext.services.promptSettingsManager?.getPrompts()
  };
  window.cerebr.pageInfo = appContext.state.pageInfo;

  document.addEventListener('promptSettingsUpdated', () => {
    if (appContext.services.promptSettingsManager) {
      window.cerebr.settings.prompts = appContext.services.promptSettingsManager.getPrompts();
    }
  });
}

