import { PromptSettings } from './prompt_settings.js';
import { createChatHistoryManager } from './chat_history_manager.js';
import { getAllConversations, putConversation, deleteConversation, getConversationById } from './indexeddb_helper.js';
import { initTreeDebugger } from './tree_debugger.js';
import { GoogleGenerativeAI } from './lib/generative-ai.js'; // 导入生成式 AI 模块
import { createMessageProcessor } from './message_processor.js'; // 导入消息处理模块
import { createImageHandler } from './image_handler.js'; // 导入图片处理模块
import { createChatHistoryUI } from './chat_history_ui.js'; // 导入聊天历史UI模块
import { createApiManager } from './api_settings.js'; // 导入 API 设置模块
import { createMessageSender } from './message_sender.js'; // 导入消息发送模块

document.addEventListener('DOMContentLoaded', async () => {
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const contextMenu = document.getElementById('context-menu');
    const copyMessageButton = document.getElementById('copy-message');
    const stopUpdateButton = document.getElementById('stop-update');
    const clearChatContextButton = document.getElementById('clear-chat-context');
    const settingsButton = document.getElementById('settings-button');
    const settingsMenu = document.getElementById('settings-menu');
    const toggleTheme = document.getElementById('toggle-theme');
    const sidebarWidth = document.getElementById('sidebar-width');
    const fontSize = document.getElementById('font-size');
    const widthValue = document.getElementById('width-value');
    const fontSizeValue = document.getElementById('font-size-value');
    const collapseButton = document.getElementById('collapse-button');
    const feedbackButton = document.getElementById('feedback-button');
    const fullscreenToggle = document.getElementById('fullscreen-toggle');
    const sendButton = document.getElementById('send-button');
    const sendChatHistorySwitch = document.getElementById('send-chat-history-switch');
    const showReferenceSwitch = document.getElementById('show-reference-switch');
    const copyCodeButton = document.getElementById('copy-code');
    const imageContainer = document.getElementById('image-container');
    const promptSettingsToggle = document.getElementById('prompt-settings-toggle');
    const promptSettings = document.getElementById('prompt-settings');
    const inputContainer = document.getElementById('input-container');
    const regenerateButton = document.getElementById('regenerate-message');

    let currentMessageElement = null;
    let isTemporaryMode = false; // 添加临时模式状态变量
    let isProcessingMessage = false; // 添加消息处理状态标志
    let shouldAutoScroll = true; // 控制是否自动滚动
    let isAutoScrollEnabled = true; // 自动滚动开关状态
    let currentController = null;  // 用于存储当前的 AbortController
    let isFullscreen = false; // 全屏模式
    let pageContent = null;  // 预存储的网页文本内容
    let shouldSendChatHistory = true; // 是否发送聊天历史
    let currentConversationId = null; // 当前会话ID
    let currentPageInfo = null;
    let currentCodeBlock = null;

    const screenshotButton = document.getElementById('screenshot-button');
    if(screenshotButton) {
        screenshotButton.addEventListener('click', () => {
            // 调用内置的 requestScreenshot() 函数
            requestScreenshot();
        });
    }

    /**
     * 迁移旧有的 chrome.storage.local 对话记录到 IndexedDB
     * @returns {Promise<void>}
     */
    async function migrateLocalHistoriesToIndexedDB() {
        return new Promise((resolve) => {
            chrome.storage.local.get({ conversationHistories: [] }, async (result) => {
                const localHistories = result.conversationHistories;
                if (localHistories && localHistories.length > 0) {
                    console.log("检测到 local storage 中已有对话记录，开始迁移到 IndexedDB...");
                    for (const conv of localHistories) {
                        try {
                            await putConversation(conv);
                        } catch (error) {
                            console.error("迁移对话记录失败:", conv.id, error);
                        }
                    }
                    chrome.storage.local.remove("conversationHistories", () => {
                        console.log("迁移完成：已从 chrome.storage.local 移除 conversationHistories");
                        resolve();
                    });
                } else {
                    console.log("没有检测到需要迁移的 local storage 对话记录");
                    resolve();
                }
            });
        });
    }

    // 执行对话记录的迁移
    await migrateLocalHistoriesToIndexedDB();

    // Create ChatHistoryManager instance
    const {
        chatHistory,
        addMessageToTree,
        getCurrentConversationChain,
        clearHistory,
        deleteMessage
    } = createChatHistoryManager();

    // 初始化图片预览元素
    const previewModal = document.querySelector('.image-preview-modal');
    const previewImage = previewModal.querySelector('img');
    const closeButton = previewModal.querySelector('.image-preview-close');

    // 创建图片处理器实例
    const imageHandler = createImageHandler({
        previewModal,
        previewImage,
        closeButton,
        imageContainer,
        messageInput
    });

    // 导入并初始化提示词设置
    const promptSettingsManager = new PromptSettings();

    // 创建消息处理器实例
    const messageProcessor = createMessageProcessor({
        chatContainer: chatContainer,
        chatHistory: chatHistory,
        addMessageToTree: addMessageToTree,
        scrollToBottom: scrollToBottom,
        showImagePreview: imageHandler.showImagePreview,
        processImageTags: imageHandler.processImageTags,
        showReference: showReferenceSwitch.checked
    });

    // 创建聊天历史UI实例
    const chatHistoryUI = createChatHistoryUI({
        chatContainer: chatContainer,
        appendMessage: messageProcessor.appendMessage,
        chatHistory: chatHistory,
        clearHistory: clearHistory,
        getPrompts: () => promptSettingsManager.getPrompts(),
        createImageTag: imageHandler.createImageTag
    });

    // API 设置功能
    const apiSettings = document.getElementById('api-settings');
    const apiSettingsToggle = document.getElementById('api-settings-toggle');
    const backButton = document.querySelector('.back-button');
    const apiCards = document.querySelector('.api-cards');

    // 创建 API 管理器实例
    const apiManager = createApiManager({
        apiSettings,
        apiCards,
        closeExclusivePanels: closeExclusivePanels
    });
    
    // 设置 API 设置 UI 事件处理
    apiManager.setupUIEventHandlers(apiSettingsToggle, backButton);
    
    // 初始化 API 配置
    await apiManager.init();

    // 创建消息发送器实例
    const messageSender = createMessageSender({
        apiManager,
        messageProcessor,
        imageHandler,
        chatHistoryUI,
        getCurrentConversationChain,
        chatContainer,
        messageInput,
        imageContainer,
        scrollToBottom,
        getPrompts: () => promptSettingsManager.getPrompts()
    });

    // 监听引用标记开关变化，更新消息处理器的showReference设置
    showReferenceSwitch.addEventListener('change', (e) => {
        updateReferenceVisibility(e.target.checked);
        saveSettings('showReference', e.target.checked);
    });

    // 监听聊天历史开关变化
    sendChatHistorySwitch.addEventListener('change', (e) => {
        messageSender.setSendChatHistory(e.target.checked);
        saveSettings('shouldSendChatHistory', e.target.checked);
    });

    // 添加全屏切换功能
    fullscreenToggle.addEventListener('click', async () => {
        const isFullscreen = !isFullscreen;
        // 直接向父窗口发送消息
        window.parent.postMessage({
            type: 'TOGGLE_FULLSCREEN',
            isFullscreen: isFullscreen
        }, '*');
    });

    // 监听来自 content script 的消息
    window.addEventListener('message', (event) => {
        if (event.data.type === 'DROP_IMAGE') {
            console.log('收到拖放图片数据');
            const imageData = event.data.imageData;
            if (imageData && imageData.data) {
                addImageToContainer(imageData.data, imageData.name);
            }
            if (event.data.explain) {
                messageSender.sendMessage();
            }
        } else if (event.data.type === 'FOCUS_INPUT') {
            messageInput.focus();
            const range = document.createRange();
            range.selectNodeContents(messageInput);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } else if (event.data.type === 'URL_CHANGED') {
            console.log('收到URL_CHANGED消息:', event.data);
            // 更新ChatHistoryUI中的页面信息
            chatHistoryUI.updatePageInfo(event.data);
        } else if (event.data.type === 'UPDATE_PLACEHOLDER') {
            console.log('收到更新placeholder消息:', event.data);
            if (messageInput) {
                messageInput.setAttribute('placeholder', event.data.placeholder);
                if (event.data.timeout) {
                    setTimeout(() => {
                        messageInput.setAttribute('placeholder', '输入消息...');
                    }, event.data.timeout);
                }
            }
        } else if (event.data.type === 'QUICK_SUMMARY_COMMAND') {
            messageSender.performQuickSummary(event.data.selectedContent);
        } else if (event.data.type === 'QUICK_SUMMARY_COMMAND_QUERY') {
            messageSender.performQuickSummary(event.data.selectedContent, true);
        } else if (event.data.type === 'TOGGLE_TEMP_MODE_FROM_EXTENSION') {
            messageSender.toggleTemporaryMode();
        }
    });

    // 自动调整文本框高度
    function adjustTextareaHeight(textarea) {
        textarea.style.height = 'auto';
        const maxHeight = 200;
        const scrollHeight = textarea.scrollHeight;
        textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
        textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    // 监听输入框变化
    messageInput.addEventListener('input', function () {
        adjustTextareaHeight(this);
        updateSendButtonState();

        // 处理 placeholder 的显示
        if (this.textContent.trim() === '') {
            // 如果内容空且没有图片标签，清空内容以显示 placeholder
            while (this.firstChild) {
                this.removeChild(this.firstChild);
            }
        }
    });

    // 处理换行和输入
    let isComposing = false;  // 跟踪输入法状态

    messageInput.addEventListener('compositionstart', () => {
        isComposing = true;
    });

    messageInput.addEventListener('compositionend', () => {
        isComposing = false;
    });

    // 统一的键盘事件监听器
    messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                // Shift+Enter 插入换行
                return;
            }

            if (isComposing) {
                // 如果正在使用输入法或正在处理消息，不发送消息
                return;
            }

            e.preventDefault();
            
            if (e.altKey) {
                e.preventDefault();
                if (isComposing) return; // 如果正在输入法中则不处理
                requestScreenshot(); // 发起截屏请求
                waitForScreenshot().then(() => {
                    messageSender.sendMessage();
                });
                return;
            }

            const text = this.textContent.trim();
            if (e.ctrlKey) {
                // Ctrl+Enter: 将输入内容作为selection类型发送
                const prompts = promptSettingsManager.getPrompts();
                const selectionPrompt = prompts.selection.prompt;
                if (selectionPrompt) {
                    this.textContent = selectionPrompt.replace('<SELECTION>', text);
                }
            }
            // 发送消息
            messageSender.sendMessage();
        } else if (e.key === '-') {
            // 检查输入框是否为空
            if (!this.textContent.trim() && !this.querySelector('.image-tag')) {
                e.preventDefault();
                messageSender.toggleTemporaryMode();
            }
        }
    });

    // 设置菜单开关函数
    function toggleSettingsMenu(show) {
        if (show === undefined) {
            // 如果没有传参数，就切换当前状态
            settingsMenu.classList.toggle('visible');
        } else {
            // 否则设置为指定状态
            if (show) {
                settingsMenu.classList.add('visible');
            } else {
                settingsMenu.classList.remove('visible');
            }
        }

        // 每次打开菜单时重新渲染收藏的API列表
        if (settingsMenu.classList.contains('visible')) {
            apiManager.renderFavoriteApis();
        }
    }

    // 修改点击事件监听器
    document.addEventListener('click', (e) => {
        // 如果点击的不是设置按钮本身和设置菜单，就关闭菜单
        if (!settingsButton.contains(e.target) && !settingsMenu.contains(e.target)) {
            toggleSettingsMenu(false);
        }
    });

    // 确保设置按钮的点击事件在文档点击事件之前处理
    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSettingsMenu();
    });

    // 添加输入框的事件监听器
    messageInput.addEventListener('focus', () => {
        toggleSettingsMenu(false);
    });

    // 设置按钮悬停事件
    settingsButton.addEventListener('mouseenter', () => {
        toggleSettingsMenu(true);
    });

    // 设置按钮和菜单的鼠标离开事件
    const handleMouseLeave = (e) => {
        const toElement = e.relatedTarget;
        if (!settingsButton.contains(toElement) && !settingsMenu.contains(toElement)) {
            toggleSettingsMenu(false);
        }
    };

    settingsButton.addEventListener('mouseleave', handleMouseLeave);
    settingsMenu.addEventListener('mouseleave', handleMouseLeave);

    // 添加输入框的事件监听器
    messageInput.addEventListener('focus', () => {
        toggleSettingsMenu(false);
    });

    // 主题切换
    const themeSwitch = document.getElementById('theme-switch');

    // 设置主题
    function setTheme(isDark) {
        // 获取根元素
        const root = document.documentElement;

        // 移除现有的主题类
        root.classList.remove('dark-theme', 'light-theme');

        // 添加新的主题类
        root.classList.add(isDark ? 'dark-theme' : 'light-theme');

        // 更新开关状态
        themeSwitch.checked = isDark;

        // 保存主题设置
        chrome.storage.sync.set({ theme: isDark ? 'dark' : 'light' });
    }

    // 初始化主题
    async function initTheme() {
        try {
            const result = await chrome.storage.sync.get('theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const isDark = result.theme === 'dark' || (!result.theme && prefersDark);
            setTheme(isDark);
        } catch (error) {
            console.error('初始化主题失败:', error);
            // 如果出错，使用系统主题
            setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
    }

    // 监听主题切换
    themeSwitch.addEventListener('change', () => {
        setTheme(themeSwitch.checked);
    });

    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        chrome.storage.sync.get('theme', (data) => {
            if (!data.theme) {  // 只有在用户没有手动设置主题时才跟随系统
                setTheme(e.matches);
            }
        });
    });

    // 初始化主题
    await initTheme();

    // 清空聊天记录功能，并保存当前对话至持久存储（每次聊天会话结束自动保存）
    async function clearChatHistory() { // 改为 async 函数
        await chatHistoryUI.clearChatHistory();
    }

    const clearChat = document.getElementById('clear-chat');
    clearChat.addEventListener('click', async () => {
        await clearChatHistory();
        toggleSettingsMenu(false);
        messageInput.focus();
        // 移动光标到输入框末尾
        const range = document.createRange();
        range.selectNodeContents(messageInput);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    });

    // 快速总结功能
    const quickSummary = document.getElementById('quick-summary');
    quickSummary.addEventListener('click', () => messageSender.performQuickSummary());

    // 添加点击事件监听
    chatContainer.addEventListener('click', () => {
        // 击聊天区域时让输入框失去焦点
        messageInput.blur();
    });

    // 监听输入框的焦点状态
    messageInput.addEventListener('focus', () => {
        // 输入框获得焦点，阻止事件冒泡
        messageInput.addEventListener('click', (e) => e.stopPropagation());
    });

    messageInput.addEventListener('blur', () => {
        // 输入框失去焦点时，移除点击事件监听
        messageInput.removeEventListener('click', (e) => e.stopPropagation());
    });

    // 修改右键菜单显示逻辑
    function showContextMenu(e, messageElement) {
        e.preventDefault();
        currentMessageElement = messageElement;

        // 设置菜单位置
        contextMenu.style.display = 'block';

        // 获取点击的代码块元素
        const codeBlock = e.target.closest('pre code');
        const copyCodeButton = document.getElementById('copy-code');

        // 根据消息状态显示或隐藏停止更新按钮
        if (messageElement.classList.contains('updating')) {
            stopUpdateButton.style.display = 'flex';
        } else {
            stopUpdateButton.style.display = 'none';
        }

        // 根据是否点击代码块显示或隐藏复制代码按钮
        if (codeBlock) {
            copyCodeButton.style.display = 'flex';
            currentCodeBlock = codeBlock;
        } else {
            copyCodeButton.style.display = 'none';
            currentCodeBlock = null;
        }

        // 调整菜单位置，确保菜单不超出视口
        const menuWidth = contextMenu.offsetWidth;
        const menuHeight = contextMenu.offsetHeight;
        let x = e.clientX;
        let y = e.clientY;
        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth;
        }
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight;
        }
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';

        // 新增：只在右键点击最后一条用户消息时显示"重新生成"按钮
        if (messageElement.classList.contains('user-message')) {
            // 获取所有用户消息
            const userMessages = chatContainer.querySelectorAll('.user-message');
            if (userMessages.length > 0 && messageElement === userMessages[userMessages.length - 1]) {
                regenerateButton.style.display = 'flex';
            } else {
                regenerateButton.style.display = 'none';
            }
        } else {
            regenerateButton.style.display = 'none';
        }
    }

    // 添加复制代码块功能
    function copyCodeContent() {
        if (currentCodeBlock) {
            const codeContent = currentCodeBlock.textContent;
            navigator.clipboard.writeText(codeContent).then(() => {
                hideContextMenu();
            }).catch(err => {
                console.error('复制失败:', err);
            });
        }
    }

    // 添加停止更新按钮的点击事件处理
    stopUpdateButton.addEventListener('click', () => {
        messageSender.abortCurrentRequest();
        hideContextMenu();
    });
    
    // 隐藏右键菜单
    function hideContextMenu() {
        contextMenu.style.display = 'none';
        currentMessageElement = null;
    }

    // 复制消息内容
    function copyMessageContent() {
        if (currentMessageElement) {
            // 获取存储的原始文本
            const originalText = currentMessageElement.getAttribute('data-original-text');
            navigator.clipboard.writeText(originalText).then(() => {
                hideContextMenu();
            }).catch(err => {
                console.error('复制失败:', err);
            });
        }
    }

    // 监听消息（用户或 AI）右键点击
    chatContainer.addEventListener('contextmenu', (e) => {
        // 如果按住了Ctrl、Shift或Alt键，则显示默认菜单
        if (e.ctrlKey || e.shiftKey || e.altKey) {
            return;
        }
        // 修改：允许用户和 AI 消息都触发右键菜单
        const messageElement = e.target.closest('.message');
        if (messageElement) {
        e.preventDefault();
        showContextMenu(e, messageElement);
        }
    });

    // 点击制按钮
    copyMessageButton.addEventListener('click', copyMessageContent);

    // 点击其他地方隐藏菜单
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // 滚动时隐藏菜单
    chatContainer.addEventListener('scroll', hideContextMenu);

    // 片粘贴功能
    messageInput.addEventListener('paste', async (e) => {
        e.preventDefault(); // 阻止默认粘贴行为

        const items = Array.from(e.clipboardData.items);
        const imageItem = items.find(item => item.type.startsWith('image/'));

        if (imageItem) {
            // 处理图片粘贴
            const file = imageItem.getAsFile();
            const reader = new FileReader();
            reader.onload = async () => {
                imageHandler.addImageToContainer(reader.result, file.name);
            };
            reader.readAsDataURL(file);
        } else {
            // 修改：处理纯文本粘贴，避免插入富文本
            const text = e.clipboardData.getData('text/plain');
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                // 移动光标到新插入的文本节点之后
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    });

    // 修改拖放处理
    messageInput.addEventListener('drop', (e) => imageHandler.handleImageDrop(e, messageInput));
    chatContainer.addEventListener('drop', (e) => imageHandler.handleImageDrop(e, chatContainer));

    // 阻止聊天区域的图片默认行为
    chatContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    // 初始化设置
    async function initSettings() {
        try {
            const result = await chrome.storage.sync.get([
                'sidebarWidth',
                'fontSize',
                'scaleFactor',
                'autoScroll',
                'clearOnSearch',
                'shouldSendChatHistory',
                'showReference' // 添加新的配置键
            ]);
            if (result.sidebarWidth) {
                document.documentElement.style.setProperty('--cerebr-sidebar-width', `${result.sidebarWidth}px`);
                sidebarWidth.value = result.sidebarWidth;
                widthValue.textContent = `${result.sidebarWidth}px`;
            }
            if (result.fontSize) {
                document.documentElement.style.setProperty('--cerebr-font-size', `${result.fontSize}px`);
                fontSize.value = result.fontSize;
                fontSizeValue.textContent = `${result.fontSize}px`;
            }
            if (result.scaleFactor) {
                const scaleFactorElem = document.getElementById('scale-factor');
                const scaleValue = document.getElementById('scale-value');
                scaleFactorElem.value = result.scaleFactor;
                scaleValue.textContent = `${result.scaleFactor}x`;
            }
            // 初始化自动滚动开关状态
            if (result.autoScroll !== undefined) {
                isAutoScrollEnabled = result.autoScroll;
                const autoScrollSwitch = document.getElementById('auto-scroll-switch');
                if (autoScrollSwitch) {
                    autoScrollSwitch.checked = isAutoScrollEnabled;
                }
            }
            // 初始化划词搜索清空聊天设置
            const clearOnSearchSwitch = document.getElementById('clear-on-search-switch');
            if (clearOnSearchSwitch) {
                clearOnSearchSwitch.checked = result.clearOnSearch !== false; // 默认为true
            }
            // 初始化聊天历史开关状态
            if (result.shouldSendChatHistory !== undefined) {
                messageSender.setSendChatHistory(result.shouldSendChatHistory);
                const sendChatHistorySwitch = document.getElementById('send-chat-history-switch');
                if (sendChatHistorySwitch) {
                    sendChatHistorySwitch.checked = result.shouldSendChatHistory;
                }
            }
            // 新增：初始化显示引用标记设置（默认显示）
            if (showReferenceSwitch) {
                if (result.showReference === undefined) {
                    showReferenceSwitch.checked = true;
                } else {
                    showReferenceSwitch.checked = result.showReference;
                }
                updateReferenceVisibility(showReferenceSwitch.checked);
                showReferenceSwitch.addEventListener('change', (e) => {
                    updateReferenceVisibility(e.target.checked);
                    saveSettings('showReference', e.target.checked);
                });
            }
        } catch (error) {
            console.error('初始化设置失败:', error);
        }
    }

    // 保存设置
    async function saveSettings(key, value) {
        try {
            await chrome.storage.sync.set({ [key]: value });
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    }

    // 新增：切换引用标记显示/隐藏的函数
    function updateReferenceVisibility(shouldShow) {
        if (shouldShow) {
            document.body.classList.remove('hide-references');
        } else {
            document.body.classList.add('hide-references');
        }
    }

    // 监听侧栏宽度变化
    sidebarWidth.addEventListener('input', (e) => {
        const width = e.target.value;
        widthValue.textContent = `${width}px`;
    });

    sidebarWidth.addEventListener('change', (e) => {
        const width = e.target.value;
        document.documentElement.style.setProperty('--cerebr-sidebar-width', `${width}px`);
        saveSettings('sidebarWidth', width);
        // 通知父窗口宽度变化
        window.parent.postMessage({
            type: 'SIDEBAR_WIDTH_CHANGE',
            width: parseInt(width)
        }, '*');
    });

    // 监听字体大小变化
    fontSize.addEventListener('input', (e) => {
        const size = e.target.value;
        fontSizeValue.textContent = `${size}px`;
    });

    fontSize.addEventListener('change', (e) => {
        const size = e.target.value;
        document.documentElement.style.setProperty('--cerebr-font-size', `${size}px`);
        saveSettings('fontSize', size);
    });

    // 监听缩放比例变化
    const scaleFactor = document.getElementById('scale-factor');
    const scaleValue = document.getElementById('scale-value');

    scaleFactor.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        scaleValue.textContent = `${value.toFixed(1)}x`;
    });

    scaleFactor.addEventListener('change', (e) => {
        const value = parseFloat(e.target.value);
        window.parent.postMessage({
            type: 'SCALE_FACTOR_CHANGE',
            value: value
        }, '*');
        saveSettings('scaleFactor', value);
    });

    // 添加自动滚动开关事件监听
    const autoScrollSwitch = document.getElementById('auto-scroll-switch');
    if (autoScrollSwitch) {
        autoScrollSwitch.addEventListener('change', (e) => {
            isAutoScrollEnabled = e.target.checked;
            saveSettings('autoScroll', isAutoScrollEnabled);
        });
    }

    // 初始化设置
    await initSettings();

    // 修改滚轮事件监听：
    // 当用户向上滚动时，禁用自动滚动；
    // 当用户向下滚动时，检查离底部距离，如果距离小于50px，则重新启用自动滚动
    chatContainer.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) { // 向上滚动
            shouldAutoScroll = false;
        } else if (e.deltaY > 0) { // 向下滚动时检查底部距离
            const threshold = 50; // 距离底部小于50px认为接近底部
            const distanceFromBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
            if (distanceFromBottom < threshold) {
                shouldAutoScroll = true;
            }
        }
    });

    // 简化滚动到底部的函数
    function scrollToBottom() { // 移除 force 参数
        if (!isAutoScrollEnabled) {
            return;
        }

        if (shouldAutoScroll) {
            requestAnimationFrame(() => {
                chatContainer.scrollTo({
                    top: chatContainer.scrollHeight,
                    behavior: 'auto' // 取消平滑滚动，立即滚动到底部
                });
            });
        }
    }

    // 添加收起按钮点击事件
    collapseButton.addEventListener('click', () => {
        window.parent.postMessage({
            type: 'CLOSE_SIDEBAR'
        }, '*');
    });

    // 添加划词搜索清空聊天开关事件监听
    const clearOnSearchSwitch = document.getElementById('clear-on-search-switch');
    if (clearOnSearchSwitch) {
        clearOnSearchSwitch.addEventListener('change', (e) => {
            saveSettings('clearOnSearch', e.target.checked);
        });
    }

    // 更新发送按钮状态
    function updateSendButtonState() {
        const hasContent = messageInput.textContent.trim() || inputContainer.querySelector('.image-tag');
        sendButton.disabled = !hasContent;
    }

    // 添加发送按钮点击事件
    sendButton.addEventListener('click', () => {
        messageSender.sendMessage();
    });

    // 添加清空聊天右键菜单项的点击事件处理
    clearChatContextButton.addEventListener('click', async () => {
        await chatHistoryUI.clearChatHistory();
        hideContextMenu();
    });

    // 点击聊天记录菜单项
    const chatHistoryMenuItem = document.getElementById('chat-history-menu');
    if (chatHistoryMenuItem) {
        chatHistoryMenuItem.addEventListener('click', () => {
            const isOpen = chatHistoryUI.isChatHistoryPanelOpen();
            closeExclusivePanels();
            if (!isOpen) {
                chatHistoryUI.showChatHistoryPanel();
            }
        });
    }

    copyCodeButton.addEventListener('click', copyCodeContent);
    const deleteMessageButton = document.getElementById('delete-message');
    if (deleteMessageButton) {
        deleteMessageButton.addEventListener('click', (e) => {
            deleteMessageContent(currentMessageElement);
        });
    }

    /**
     * 删除指定消息的函数，更新 UI 和聊天历史树（维护继承关系）
     */
    async function deleteMessageContent(messageElement) {
        if (!messageElement) return;
        const messageId = messageElement.getAttribute('data-message-id');
        // 从 DOM 中删除该消息元素
        messageElement.remove();

        if (!messageId) {
            console.error("未找到消息ID");
            hideContextMenu();
            return;
        }

        // 删除聊天历史中的消息，并更新继承关系
        const success = deleteMessage(messageId);
        if (!success) {
            console.error("删除消息失败: 未找到对应的消息节点");
        } else {
            // 更新并持久化聊天记录
            await chatHistoryUI.saveCurrentConversation(true);
        }
        hideContextMenu();
    }

    // 调试聊天记录树按钮绑定（该按钮在 sidebar.html 中设置了 id="debug-chat-tree-btn"）
    const debugTreeButton = document.getElementById('debug-chat-tree-btn');
    if (debugTreeButton) {
        debugTreeButton.addEventListener('click', () => {
            // 使用当前聊天记录树 chatHistory（由 createChatHistoryManager() 提供）初始化调试窗口
            initTreeDebugger(chatHistory);
        });
    }

    // 新增：辅助函数 将图片数据生成图片标签后，统一添加到图片容器
    function addImageToContainer(imageData, fileName) {
        const imageTag = imageHandler.createImageTag(imageData, fileName);
        imageContainer.appendChild(imageTag);
        // 触发输入事件以保证界面刷新
        messageInput.dispatchEvent(new Event('input'));
        console.log("图片插入到图片容器");
    }

    // 新增互斥面板切换函数
    function closeExclusivePanels() {
        // 定义需要互斥的面板ID列表
        const panels = ['api-settings', 'prompt-settings'];
        chatHistoryUI.closeChatHistoryPanel();
        panels.forEach(pid => {
            const panel = document.getElementById(pid);
            if (panel && panel.classList.contains('visible')) {
                panel.classList.remove('visible');
            }
        });
    }

    // 显示/隐藏提示词设置面板
    promptSettingsToggle.addEventListener('click', () => {
        const wasVisible = promptSettings.classList.contains('visible');
        closeExclusivePanels();

        if (!wasVisible) {
            promptSettings.classList.toggle('visible');
        }
    });

    // 新增：添加重新生成消息的按钮事件处理
    regenerateButton.addEventListener('click', async () => {
        // 获取当前聊天区域中的所有消息
        const messages = chatContainer.querySelectorAll('.message');
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            // 如果最后一条消息是助手消息，则删除
            if (lastMessage.classList.contains('ai-message')) {
                await deleteMessageContent(lastMessage);
            }
            // 调用发送消息接口，重新生成助手回复
            messageSender.sendMessage();
            hideContextMenu();
        }
    });

    /**
     * 轮询等待 image-container 中出现截屏图片
     * 每 0.1 秒检查一次，最多等待 10 秒
     * @returns {Promise<void>}
     */
    function waitForScreenshot() {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const screenshotImg = imageContainer.querySelector('img[alt="page-screenshot.png"]');
                if (screenshotImg) {
                    clearInterval(interval);
                    resolve();
                } else if (Date.now() - startTime > 5000) { // 5秒超时
                    clearInterval(interval);
                    console.warn('等待截屏图片超时');
                    resolve();
                }
            }, 100);
        });
    }

    function requestScreenshot() {
        window.parent.postMessage({
            type: 'CAPTURE_SCREENSHOT'
        }, '*');
    }
});