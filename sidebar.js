import { PromptSettings } from './prompt_settings.js';
import { createChatHistoryManager } from './chat_history_manager.js';
import { getAllConversations, putConversation, deleteConversation, getConversationById } from './indexeddb_helper.js';
import { initTreeDebugger } from './tree_debugger.js';
import { GoogleGenerativeAI } from './lib/generative-ai.js'; // 导入生成式 AI 模块
import { createMessageProcessor } from './message_processor.js'; // 导入消息处理模块
import { createImageHandler } from './image_handler.js'; // 导入图片处理模块
import { createChatHistoryUI } from './chat_history_ui.js'; // 导入聊天历史UI模块

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
        appendMessage: appendMessage,
        chatHistory: chatHistory,
        clearHistory: clearHistory,
        getPrompts: () => promptSettingsManager.getPrompts(),
        createImageTag: imageHandler.createImageTag
    });

    // 监听引用标记开关变化，更新消息处理器的showReference设置
    showReferenceSwitch.addEventListener('change', (e) => {
        updateReferenceVisibility(e.target.checked);
        saveSettings('showReference', e.target.checked);
    });

    // 监听聊天历史开关变化
    sendChatHistorySwitch.addEventListener('change', (e) => {
        shouldSendChatHistory = e.target.checked;
        saveSettings('shouldSendChatHistory', shouldSendChatHistory);
    });

    // 添加全屏切换功能
    fullscreenToggle.addEventListener('click', async () => {
        isFullscreen = !isFullscreen;
        // 直接向父窗口发送消息
        window.parent.postMessage({
            type: 'TOGGLE_FULLSCREEN',
            isFullscreen: isFullscreen
        }, '*');
    });

    // 添加公共的图片处理函数
    function processImageTags(content, imagesHTML) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = imagesHTML;
        const imageTags = tempDiv.querySelectorAll('.image-tag');

        if (imageTags.length > 0) {
            const result = [];
            // 添加文本内容
            if (content) {
                result.push({
                    type: "text",
                    text: content
                });
            }
            // 添加图片
            imageTags.forEach(tag => {
                const base64Data = tag.getAttribute('data-image');
                if (base64Data) {
                    result.push({
                        type: "image_url",
                        image_url: {
                            url: base64Data
                        }
                    });
                }
            });
            return result;
        }
        return content;
    }

    // 获取网页内容
    async function getPageContent() {
        try {
            console.log('getPageContent 发送获取网页内容请求');
            const response = await chrome.runtime.sendMessage({
                type: 'GET_PAGE_CONTENT_FROM_SIDEBAR'
            });
            return response;
        } catch (error) {
            console.error('获取网页内容失败:', error);
            return null;
        }
    }

    /**
     * 为消息添加引用标记和来源信息
     * @param {string} text - 原始消息文本
     * @param {Object} groundingMetadata - 引用元数据对象
     * @returns {(string|Object)} 如果没有引用信息返回原文本，否则返回包含处理后文本和引用信息的对象
     */
    function addGroundingToMessage(text, groundingMetadata) {
        return messageProcessor.addGroundingToMessage(text, groundingMetadata);
    }

    /**
     * 获取提示词类型
     * @param {HTMLElement|string} content - 输入内容，可以是HTML元素或字符串
     * @returns {string} 提示词类型 ('image'|'pdf'|'summary'|'selection'|'query'|'system')
     */
    function getPromptTypeFromContent(content) {
        const prompts = promptSettingsManager.getPrompts();
        return messageProcessor.getPromptTypeFromContent(content, prompts);
    }

    // 在 getPromptTypeFromContent 函数之后，新增如下辅助函数

    /** 
     * 提取提示文本中的系统消息内容
     *
     * 此函数扫描输入的提示文本，并提取被 {{system}} 和 {{end_system}} 标记包裹的内容，
     * 该内容通常作为系统级指令被单独处理。
      *
      * @param {string} promptText - 包含自定义系统标记的提示文本
      * @returns {string} 返回提取出的系统消息内容；如果不存在则返回空字符串
      * @example
      * // 输入 "请总结以下内容 {{system}}额外指令{{end_system}}"，返回 "额外指令"
      */
    function extractSystemContent(promptText) {
        return messageProcessor.extractSystemContent(promptText);
    }

    async function sendMessage() {
        
        function clearMessageInput() {
            messageInput.innerHTML = '';
            imageContainer.innerHTML = '';
        }

        function checkAPI(){
            let config = apiConfigs[selectedConfigIndex];
            if (!config?.baseUrl || !config?.apiKey) {
                appendMessage('请在设置中完善 API 配置', 'ai', true);
                return;
            }    
        }
        
        const imageTags = imageContainer.querySelectorAll('.image-tag');
        let messageText = messageInput.textContent;

        const imageContainsScreenshot = imageContainer.querySelector('img[alt="page-screenshot.png"]');


        // 如果消息为空且没有图片标签，则不发送消息
        const isEmptyMessage = !messageText && imageTags.length === 0;

        // 获取当前提示词设置
        const prompts = promptSettingsManager.getPrompts();
        const shouldUseImagePrompt = imageTags.length > 0 && messageText.trim() === '';
        if (shouldUseImagePrompt) {
            messageText = prompts.image.prompt;
        }
        const currentPromptType = getPromptTypeFromContent(messageText);

        // 提前创建 loadingMessage 配合finally使用
        let loadingMessage;

        try {
            // 开始处理消息
            isProcessingMessage = true;
            shouldAutoScroll = true;

            // 如果存在之前的请求，先中止它
            if (currentController) {
                currentController.abort();
                currentController = null;
            }

            // 创建新的 AbortController
            currentController = new AbortController();
            const signal = currentController.signal;

            // 当开始生成时，给聊天容器添加 glow 效果
            chatContainer.classList.add('auto-scroll-glow');

            // 提取提示词中注入的系统消息
            const systemMessageRegex = /{{system}}([\s\S]*?){{end_system}}/g;
            const injectedSystemMessages = [];
            messageText = messageText.replace(systemMessageRegex, (match, capture) => {
                injectedSystemMessages.push(capture);
                console.log('捕获注入的系统消息：', injectedSystemMessages);
                return '';
            });

            let userMessageDiv;
            if (!isEmptyMessage) {
                // 添加用户消息，同时包含文本和图片区域
                userMessageDiv = appendMessage(messageText, 'user', false, null, imageContainer.innerHTML);
            }

            clearMessageInput();
            adjustTextareaHeight(messageInput);

            // 添加加载状态消息
            loadingMessage = appendMessage('正在处理...', 'ai', true);
            loadingMessage.classList.add('loading-message');

            // 如果不是临时模式，获取网页内容
            if (!isTemporaryMode) {
                loadingMessage.textContent = '正在获取网页内容...';
                const pageContentResponse = await getPageContent();
                if (pageContentResponse) {
                    pageContent = pageContentResponse;
                    // 创建字数统计元素
                    const footer = document.createElement('div');
                    footer.classList.add('content-length-footer');
                    const contentLength = pageContent.content ? pageContent.content.length : 0;
                    footer.textContent = `↑ ${contentLength.toLocaleString()}`;
                    // 添加到用户消息下方
                    userMessageDiv?.appendChild(footer);
                } else {
                    pageContent = null;
                    console.error('获取网页内容失败。');
                }
            } else {
                pageContent = null;  // 临时模式下不使用网页内容
            }

            // 构建消息数组
            const messages = [];

            const pageContentPrompt = pageContent
                ? `\n\n当前网页内容：\n标题：${pageContent.title}\nURL：${pageContent.url}\n内容：${pageContent.content}`
                : '';

            // 组合系统消息+注入的系统消息+网页内容
            let systemMessageContent = prompts.system.prompt;

            if (imageContainsScreenshot) {
                systemMessageContent += "\n用户附加了当前页面的屏幕截图";
            }
            systemMessageContent += "\n" + injectedSystemMessages.join('\n');
            systemMessageContent += pageContentPrompt;

            // 构建系统消息对象
            const systemMessage = {
                role: "system",
                content: systemMessageContent
            };
            
            // 将系统消息添加到消息数组
            messages.push(systemMessage);

            // 获取当前会话链
            const conversationChain = getCurrentConversationChain();

            // 根据设置决定是否发送聊天历史
            const SendChatHistory = shouldSendChatHistory && currentPromptType !== 'selection' && currentPromptType !== 'image';
            if (SendChatHistory) {
                messages.push(...conversationChain.map(node => ({
                    role: node.role,
                    content: node.content
                })));
            } else {
                // 只发送最后一条消息
                if (conversationChain.length > 0) {
                    const lastMessage = conversationChain[conversationChain.length - 1];
                    messages.push({
                        role: lastMessage.role,
                        content: lastMessage.content
                    });
                }
            }

            // 确定要使用的模型配置
            let targetConfig = null;
            // 只判断一次 prompttype，重用之前的 currentPromptType
            if (currentPromptType !== 'none' && prompts[currentPromptType] && prompts[currentPromptType].model !== 'follow_current') {
                targetConfig = apiConfigs.find(c => c.modelName === prompts[currentPromptType].model);
            }

            // 如果没找到目标配置，使用当前配置
            const config = targetConfig || apiConfigs[selectedConfigIndex];

            // 更新加载状态消息
            loadingMessage.textContent = '正在等待 AI 回复...';

            // 构造 API 请求体
            let requestBody = {
                model: config.modelName,
                messages: messages,
                stream: true,
                temperature: config.temperature,
                top_p: 0.95,
            };

            // 如果存在自定义参数，则尝试解析 JSON 字符串并合并到请求体中
            if (config.customParams) {
                try {
                    const extraParams = JSON.parse(config.customParams);
                    requestBody = { ...requestBody, ...extraParams };
                } catch (e) {
                    console.error("解析自定义参数 JSON 失败，请检查格式。", e);
                }
            }

            // 发送API请求
            const response = await fetch(config.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API错误 (${response.status}): ${error}`);
            }

            const reader = response.body.getReader();
            let hasStartedResponse = false;
            let aiResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = new TextDecoder().decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const content = line.slice(6);
                        if (content.trim() === '[DONE]') continue;
                        try {
                            const data = JSON.parse(content);
                            const deltaContent = data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.reasoning_content;
                            if (deltaContent) {
                                if (!hasStartedResponse) {
                                    // First tokens received: remove the loading message and auto-scroll immediately.
                                    loadingMessage.remove();
                                    hasStartedResponse = true;
                                    scrollToBottom(); // <-- New call to ensure auto-scroll on first tokens.
                                }
                                aiResponse += deltaContent;
                                aiResponse = aiResponse.replace(/\nabla/g, '\\nabla');
                                updateAIMessage(aiResponse, data.choices?.[0]?.groundingMetadata);
                            }
                        } catch (e) {
                            console.error('解析响应出错:', e);
                        }
                    }
                }
            }

            // 消息处理完成后，自动保存会话
            if (currentConversationId) {
                chatHistoryUI.saveCurrentConversation(true); // 更新现有会话记录
            } else {
                chatHistoryUI.saveCurrentConversation(false); // 新会话，生成新的 conversation id
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('用户手动停止更新');
                return;
            }
            console.error('发送消息失败:', error);
            // 更新加载状态消息显示错误
            if (loadingMessage) {
                loadingMessage.textContent = '发送失败: ' + error.message;
                loadingMessage.classList.add('error-message');
            }
        } finally {
            // 无论成功还是失败，都重置处理状态
            isProcessingMessage = false;
            shouldAutoScroll = false;
            // 当生成结束时，移除 glow 效果
            chatContainer.classList.remove('auto-scroll-glow');
            // 当生成结束时，移除 loading 效果
            const lastMessage = chatContainer.querySelector('.ai-message:last-child');
            if (lastMessage) {
                lastMessage.classList.remove('updating');
            }
        }
    }

    /**
     * 更新AI消息内容
     * @param {string} aiResponse - 消息文本内容
     * @param {Object|null} groundingMetadata - 引用元数据对象，包含引用信息
     */
    function updateAIMessage(aiResponse, groundingMetadata) {
        return messageProcessor.updateAIMessage(aiResponse, groundingMetadata);
    }

    // 提取公共配置
    const MATH_DELIMITERS = {
        delimiters: [
            { left: '\\(', right: '\\)', display: false },  // 行内公式
            { left: '\\\\(', right: '\\\\)', display: false },  // 行内公式
            { left: '\\[', right: '\\]', display: true },   // 行间公式
            { left: '$$', right: '$$', display: true },     // 行间公式
            { left: '$', right: '$', display: false }       // 行内公式
        ],
        throwOnError: false
    };

    // 处理数学公式和Markdown
    function processMathAndMarkdown(text) {
        return messageProcessor.processMathAndMarkdown(text);
    }

    // 预处理 Markdown 文本，修正 "**bold**text" 这类连写导致的粗体解析问题
    function fixBoldParsingIssue(text) {
        // 使用模块中的实现
        const processed = messageProcessor.processMathAndMarkdown(text);
        return processed;
    }

    // 对消息进行折叠处理，根据正则折叠消息文本
    function foldMessageContent(text) {
        // 使用模块中的实现
        const processed = messageProcessor.processMathAndMarkdown(text);
        return processed;
    }

    // 监听来自 content script 的消息
    window.addEventListener('message', (event) => {
        if (event.data.type === 'DROP_IMAGE') {
            console.log('收到拖放图片数据');
            const imageData = event.data.imageData;
            if (imageData && imageData.data) {
                addImageToContainer(imageData.data, imageData.name);
            }
            if (event.data.explain) {
                sendMessage();
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
            // 更新存储的URL和域名
            currentPageInfo = event.data;
            // 更新ChatHistoryUI中的页面信息
            chatHistoryUI.updatePageInfo(event.data);
            // 清空页面内容，等待下次发送消息时重新获取
            pageContent = null;
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
            performQuickSummary(event.data.selectedContent);
        } else if (event.data.type === 'QUICK_SUMMARY_COMMAND_QUERY') {
            performQuickSummary(event.data.selectedContent, true);
        } else if (event.data.type === 'TOGGLE_TEMP_MODE_FROM_EXTENSION') {
            // 调用已有的toggle逻辑
            if (isTemporaryMode) {
                exitTemporaryMode();
            } else {
                enterTemporaryMode();
            }
        }
    });

    /**
     * 添加消息到聊天窗口，同时支持文本和图片区域。
     * @param {string} text - 文本消息内容
     * @param {string} sender - 消息发送者 ('user' 或 'ai')
     * @param {boolean} skipHistory - 是否不更新历史记录
     * @param {HTMLElement|null} fragment - 如使用文档片段则追加到此处，否则直接追加到聊天容器
     * @param {string|null} imagesHTML - 图片部分的 HTML 内容（可为空）
     * @returns {HTMLElement} 新生成的消息元素
     */
    function appendMessage(text, sender, skipHistory = false, fragment = null, imagesHTML = null) {
        return messageProcessor.appendMessage(text, sender, skipHistory, fragment, imagesHTML);
    }

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

    // 添加临时模式相关函数
    function enterTemporaryMode() {
        isTemporaryMode = true;
        messageInput.classList.add('temporary-mode');
        document.body.classList.add('temporary-mode');
        messageInput.setAttribute('placeholder', '临时模式 - 不获取网页内容');
    }

    function exitTemporaryMode() {
        isTemporaryMode = false;
        messageInput.classList.remove('temporary-mode');
        document.body.classList.remove('temporary-mode');
        messageInput.setAttribute('placeholder', '输入消息...');
    }

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
                    sendMessage();
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
            sendMessage();
            } else if (e.key === '-') {
                // 检查输入框是否为空
                if (!this.textContent.trim() && !this.querySelector('.image-tag')) {
                    e.preventDefault();
                    if (isTemporaryMode) {
                        exitTemporaryMode();
                    } else {
                        enterTemporaryMode();
                    }
                    console.log('临时模式状态:', isTemporaryMode); // 添加调试日志
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
            renderFavoriteApis();
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

    // API 设置功能
    const apiSettings = document.getElementById('api-settings');
    const apiSettingsToggle = document.getElementById('api-settings-toggle');
    const backButton = document.querySelector('.back-button');
    const apiCards = document.querySelector('.api-cards');

    // 加载保存的 API 配置
    let apiConfigs = [];
    let selectedConfigIndex = 0;

    // 从存储加载配置
    async function loadAPIConfigs() {
        try {
            const result = await chrome.storage.sync.get(['apiConfigs', 'selectedConfigIndex']);
            if (result.apiConfigs && result.apiConfigs.length > 0) {
                apiConfigs = result.apiConfigs;
                selectedConfigIndex = result.selectedConfigIndex || 0;
            } else {
                // 创建默认配置
                apiConfigs = [{
                    apiKey: '',
                    baseUrl: 'https://api.openai.com/v1/chat/completions',
                    modelName: 'gpt-4o',
                    temperature: 1,
                    isFavorite: false  // 添加收藏状态字段
                }];
                selectedConfigIndex = 0;
                await saveAPIConfigs();
            }
        } catch (error) {
            console.error('加载 API 配置失败:', error);
            // 如果加载失败，也创建默认配置
            apiConfigs = [{
                apiKey: '',
                baseUrl: 'https://api.openai.com/v1/chat/completions',
                modelName: 'gpt-4o',
                temperature: 1,
                isFavorite: false  // 添加收藏状态字段
            }];
            selectedConfigIndex = 0;
        }

        // 暴露 apiConfigs 到 window 对象
        window.apiConfigs = apiConfigs;
        // 触发配置更新事件
        window.dispatchEvent(new Event('apiConfigsUpdated'));

        // 确保一定会渲染卡片和收藏列表
        renderAPICards();
        renderFavoriteApis();
    }

    // 保存配置到存储
    async function saveAPIConfigs() {
        try {
            await chrome.storage.sync.set({
                apiConfigs,
                selectedConfigIndex
            });
            // 更新 window.apiConfigs 并触发事件
            window.apiConfigs = apiConfigs;
            window.dispatchEvent(new Event('apiConfigsUpdated'));
        } catch (error) {
            console.error('保存 API 配置失败:', error);
        }
    }

    // 渲染 API 卡片
    function renderAPICards() {
        // 确保模板元素在
        const templateCard = document.querySelector('.api-card.template');
        if (!templateCard) {
            console.error('找不到模板卡片元素');
            return;
        }

        // 保存模板的副本
        const templateClone = templateCard.cloneNode(true);

        // 清空现有卡片
        apiCards.innerHTML = '';

        // 先重新添加模板（保持隐藏状态）
        apiCards.appendChild(templateClone);

        // 渲染实际的卡
        apiConfigs.forEach((config, index) => {
            const card = createAPICard(config, index, templateClone);
            apiCards.appendChild(card);
        });
    }

    /**
     * @function createAPICard
     * 创建并渲染单个 API 配置卡片
     * @param {Object} config - API 配置对象
     * @param {string} [config.apiKey] - API 密钥
     * @param {string} [config.baseUrl] - API 基础 URL
     * @param {string} [config.modelName] - 模型名称
     * @param {number} [config.temperature] - temperature 值（可为 0）
     * @param {boolean} [config.isFavorite] - 是否收藏
     * @param {number} index - 该配置在 apiConfigs 数组中的索引
     * @param {HTMLElement} templateCard - 用于克隆的卡片模板 DOM
     * @returns {HTMLElement} 渲染后的卡片元素
     * @throws {Error} 当复制或渲染卡片失败时抛出异常
     * @example
     * const card = createAPICard(apiConfigs[0], 0, document.querySelector('.api-card.template'));
     * document.querySelector('.api-cards').appendChild(card);
     * @since 1.0.0
     */
    function createAPICard(config, index, templateCard) {
        // 克隆模板
        const template = templateCard.cloneNode(true);
        template.classList.remove('template');
        template.style.display = '';

        if (index === selectedConfigIndex) {
            template.classList.add('selected');
        }

        // 设置标题
        const titleElement = template.querySelector('.api-card-title');
        titleElement.textContent = config.modelName || config.baseUrl || '新配置';

        const apiKeyInput = template.querySelector('.api-key');
        const baseUrlInput = template.querySelector('.base-url');
        const modelNameInput = template.querySelector('.model-name');
        const temperatureInput = template.querySelector('.temperature');
        const temperatureValue = template.querySelector('.temperature-value');
        const apiForm = template.querySelector('.api-form');
        const favoriteBtn = template.querySelector('.favorite-btn');
        const togglePasswordBtn = template.querySelector('.toggle-password-btn');
        const selectBtn = template.querySelector('.select-btn');

        // 选择按钮点击事件
        selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 移除其他卡片的选中状态
            document.querySelectorAll('.api-card').forEach(card => {
                card.classList.remove('selected');
            });
            // 设置当前卡片为选中状态
            template.classList.add('selected');
            selectedConfigIndex = index;
            saveAPIConfigs();
            // 关闭设置菜单
            apiSettings.classList.remove('visible');
        });

        // 点击卡片只展开/折叠表单
        template.addEventListener('click', () => {
            template.classList.toggle('expanded');
        });

        // 添加密码切换按钮的点击事件监听器
        togglePasswordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = apiKeyInput.type === 'password' ? 'text' : 'password';
            apiKeyInput.type = type;
            togglePasswordBtn.classList.toggle('visible');
        });

        // 添加点击外部自动隐藏密码的功能
        document.addEventListener('click', (e) => {
            // 如果点击的不是API Key输入框和切换按钮
            if (!apiKeyInput.contains(e.target) && !togglePasswordBtn.contains(e.target)) {
                // 如果当前是显示状态，则切换回密码状态
                if (apiKeyInput.type === 'text') {
                    apiKeyInput.type = 'password';
                    togglePasswordBtn.classList.remove('visible');
                }
            }
        });

        // 当输入框失去焦点时也隐藏密码
        apiKeyInput.addEventListener('blur', () => {
            if (apiKeyInput.type === 'text') {
                apiKeyInput.type = 'password';
                togglePasswordBtn.classList.remove('visible');
            }
        });

        // 使用 ?? 替代 || 来防止 0 被错误替换
        apiKeyInput.value = config.apiKey ?? '';
        baseUrlInput.value = config.baseUrl ?? 'https://api.openai.com/v1/chat/completions';
        modelNameInput.value = config.modelName ?? 'gpt-4o';
        temperatureInput.value = config.temperature ?? 1;
        temperatureValue.textContent = (config.temperature ?? 1).toFixed(1);

        // 监听温度变化
        temperatureInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            temperatureValue.textContent = value.toFixed(1);
            // 保存温度值
            apiConfigs[index] = {
                ...apiConfigs[index],
                temperature: value
            };
            saveAPIConfigs();
        });

        // 检查是否已收藏
        if (config.isFavorite) {
            favoriteBtn.classList.add('active');
        }

        // 收藏按钮点击事件
        favoriteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 直接切换当前配置的收藏状态
            apiConfigs[index].isFavorite = !apiConfigs[index].isFavorite;

            if (apiConfigs[index].isFavorite) {
                favoriteBtn.classList.add('active');
            } else {
                favoriteBtn.classList.remove('active');
            }

            saveAPIConfigs();
            renderFavoriteApis();
        });

        // 阻止输入框和按钮点击事件冒泡
        const stopPropagation = (e) => e.stopPropagation();
        apiForm.addEventListener('click', stopPropagation);
        template.querySelector('.api-card-actions').addEventListener('click', stopPropagation);

        // 输入变化时保存
        [apiKeyInput, baseUrlInput, modelNameInput, temperatureInput].forEach(input => {
            input.addEventListener('change', () => {
                apiConfigs[index] = {
                    ...apiConfigs[index],
                    apiKey: apiKeyInput.value,
                    baseUrl: baseUrlInput.value,
                    modelName: modelNameInput.value,
                    temperature: parseFloat(temperatureInput.value)
                };
                // 更新标题
                titleElement.textContent = apiConfigs[index].modelName || apiConfigs[index].baseUrl || '新配置';
                saveAPIConfigs();
            });
        });

        // 复制配置
        template.querySelector('.duplicate-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            apiConfigs.push({ ...config });
            saveAPIConfigs();
            renderAPICards();
        });

        // 删除配置
        template.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (apiConfigs.length > 1) {
                apiConfigs.splice(index, 1);
                if (selectedConfigIndex >= apiConfigs.length) {
                    selectedConfigIndex = apiConfigs.length - 1;
                }
                saveAPIConfigs();
                renderAPICards();
            }
        });

        // 新增：处理自定义参数输入
        const customParamsInput = template.querySelector('.custom-params');
        if (customParamsInput) {
            customParamsInput.value = config.customParams || '';
            customParamsInput.addEventListener('change', () => {
                apiConfigs[index].customParams = customParamsInput.value;
                saveAPIConfigs();
            });
            // 当输入完成后，尝试格式化为美化后的 JSON 格式，并在格式错误时在UI上提示
            customParamsInput.addEventListener('blur', () => {
                // 如果输入内容为空，则不作解析
                if (customParamsInput.value.trim() === "") {
                    customParamsInput.style.borderColor = "";
                    let errorElem = customParamsInput.parentNode.querySelector('.custom-params-error');
                    if (errorElem) {
                        errorElem.remove();
                    }
                    apiConfigs[index].customParams = "";
                    saveAPIConfigs();
                    return;
                }
                try {
                    const parsed = JSON.parse(customParamsInput.value);
                    // 格式化为两格缩进的 JSON 字符串
                    customParamsInput.value = JSON.stringify(parsed, null, 2);
                    apiConfigs[index].customParams = customParamsInput.value;
                    // 如果存在错误提示，则移除
                    let errorElem = customParamsInput.parentNode.querySelector('.custom-params-error');
                    if (errorElem) {
                        errorElem.remove();
                    }
                    customParamsInput.style.borderColor = "";
                    saveAPIConfigs();
                } catch (e) {
                    // 设置红色边框
                    customParamsInput.style.borderColor = "red";
                    // 创建或更新错误提示元素
                    let errorElem = customParamsInput.parentNode.querySelector('.custom-params-error');
                    if (!errorElem) {
                        errorElem = document.createElement("div");
                        errorElem.className = "custom-params-error";
                        errorElem.style.color = "red";
                        errorElem.style.fontSize = "12px";
                        errorElem.style.marginTop = "4px";
                        customParamsInput.parentNode.appendChild(errorElem);
                    }
                    errorElem.textContent = "格式化失败：请检查 JSON 格式";
                    console.error("自定义参数格式化失败:", e);
                }
            });
        }

        return template;
    }

    // 渲染收藏的API列表
    function renderFavoriteApis() {
        const favoriteApisList = document.querySelector('.favorite-apis-list');
        favoriteApisList.innerHTML = '';

        // 过滤出收藏的API
        const favoriteConfigs = apiConfigs.filter(config => config.isFavorite);

        if (favoriteConfigs.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.style.padding = '4px 8px';
            emptyMessage.style.opacity = '0.7';
            emptyMessage.style.fontSize = '12px';
            emptyMessage.textContent = '暂无收藏的API';
            favoriteApisList.appendChild(emptyMessage);
            return;
        }

        // 获取当前使用的API配置
        const currentConfig = apiConfigs[selectedConfigIndex];

        favoriteConfigs.forEach((config) => {
            const item = document.createElement('div');
            item.className = 'favorite-api-item';

            // 检查是否是当前使用的API
            if (currentConfig &&
                currentConfig.apiKey === config.apiKey &&
                currentConfig.baseUrl === config.baseUrl &&
                currentConfig.modelName === config.modelName) {
                item.classList.add('current');
            }

            const apiName = document.createElement('span');
            apiName.className = 'api-name';
            apiName.textContent = config.modelName || config.baseUrl;

            item.appendChild(apiName);

            // 点击切换到该API配置
            item.addEventListener('click', () => {
                const configIndex = apiConfigs.findIndex(c =>
                    c.apiKey === config.apiKey &&
                    c.baseUrl === config.baseUrl &&
                    c.modelName === config.modelName
                );

                if (configIndex !== -1) {
                    selectedConfigIndex = configIndex;
                    saveAPIConfigs();
                    renderAPICards();
                }
            });

            favoriteApisList.appendChild(item);
        });
    }

    // 等待 DOM 加载完成后再初始化
    await loadAPIConfigs();

    // 显示/隐藏 API 设置
    apiSettingsToggle.addEventListener('click', () => {
        const wasVisible = apiSettings.classList.contains('visible');
        closeExclusivePanels();

        if (!wasVisible) {
            apiSettings.classList.toggle('visible');
            renderAPICards();
        }
    });

    // 返回聊天界面
    backButton.addEventListener('click', () => {
        apiSettings.classList.remove('visible');
    });

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

    // 添加获取页面类型的函数
    async function getDocumentType() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'GET_DOCUMENT_TYPE'
            });
            return response?.contentType;
        } catch (error) {
            console.error('获取页面类型失败:', error);
            return null;
        }
    }

    // 导入并初始化提示词设置
    const promptSettingsManager = new PromptSettings();

    async function performQuickSummary(webpageSelection = null, forceQuery = false) {
        const wasTemporaryMode = isTemporaryMode;
        try {
            // 检查焦点是否在侧栏内
            const isSidebarFocused = document.hasFocus();
            const sidebarSelection = window.getSelection().toString().trim();

            // 获取选中的文本内容
            const selectedText = (isSidebarFocused && sidebarSelection) ?
                sidebarSelection :
                webpageSelection?.trim() || '';

            // 获取页面类型
            const contentType = await getDocumentType();
            const isPDF = contentType === 'application/pdf';

            // 获取当前提示词设置
            const prompts = promptSettingsManager.getPrompts();

            if (selectedText) {
                // 检查是否需要清空聊天记录
                const result = await chrome.storage.sync.get(['clearOnSearch']);
                if (result.clearOnSearch !== false) { // 默认为true
                    await chatHistoryUI.clearChatHistory();
                }

                // 根据模型名称决定使用哪个提示词
                // 新增：forceQuery为true时, 强制使用 'query' 提示词
                const promptType = forceQuery ? 'query' : ((prompts.selection.model || '').endsWith('-search') ? 'selection' : 'query');
                const prompt = prompts[promptType].prompt.replace('<SELECTION>', selectedText);
                messageInput.textContent = prompt;

                // 发送消息
                await sendMessage();
            } else {
                if (wasTemporaryMode) {
                    exitTemporaryMode();
                }
                await clearChatHistory();

                // 为PDF文件使用自定义的PDF提示词
                if (isPDF) {
                    messageInput.textContent = prompts.pdf.prompt;
                } else {
                    messageInput.textContent = prompts.summary.prompt;
                }
                // 发送消息
                await sendMessage();
            }
        } catch (error) {
            console.error('获取选中文本失败:', error);
        } finally {
            // 如果之前是临时模式，恢复
            if (wasTemporaryMode) {
                enterTemporaryMode();
            }
        }
    }

    // 快速总结功能
    const quickSummary = document.getElementById('quick-summary');
    quickSummary.addEventListener('click', () => performQuickSummary());

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
        if (currentController) {
            currentController.abort();  // 中止当前请求
            currentController = null;
            hideContextMenu();
        }
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
                shouldSendChatHistory = result.shouldSendChatHistory;
                const sendChatHistorySwitch = document.getElementById('send-chat-history-switch');
                if (sendChatHistorySwitch) {
                    sendChatHistorySwitch.checked = shouldSendChatHistory;
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
        const text = messageInput.textContent.trim();
        sendMessage();
    });

    // 初始化发送按钮状态
    //updateSendButtonState();

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

    // 新增：统一关闭聊天记录面板的函数
    function closeChatHistoryPanel() {
        chatHistoryUI.closeChatHistoryPanel();
    }

    // ----- 修改 2：增加全局 ESC 键监听，实现面板切换 -----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape'){
            chatHistoryUI.toggleChatHistoryPanel();
            e.preventDefault();
        }
    });

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
            sendMessage();
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