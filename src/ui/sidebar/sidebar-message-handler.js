// 监听来自content script的消息
window.addEventListener('message', (event) => {
    // 处理 URL 变化消息
    if (event.data && event.data.type === 'URL_CHANGED') {

    } else if (event.data && event.data.type === 'CLEAR_CHAT_COMMAND') {
        console.log('收到清空聊天记录命令');
        const clearChatButton = document.querySelector('#clear-chat');
        if (clearChatButton) {
            clearChatButton.click();
        }
    }
});

// 存储用户的问题历史
let userQuestions = [];

// 添加全局变量
let clearChat;

// 初始化历史消息
function initializeUserQuestions() {
    const userMessages = document.querySelectorAll('.user-message');
    userQuestions = Array.from(userMessages).map(msg => msg.textContent.trim());
    // console.log('初始化历史问题:', userQuestions);
}

// 等 DOM 加载完成
document.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('#message-input');
    const chatContainer = document.querySelector('#chat-container');
    // 初始化全局变量
    clearChat = document.querySelector('#clear-chat');

    // 初始化历史消息
    initializeUserQuestions();

    // 监听输入框的键盘事件
    input.addEventListener('keydown', async (event) => {
        // 处理输入框特定的键盘事件
        // 当按下向上键且输入框为空时
        if (event.key === 'ArrowUp' && event.target.textContent.trim() === '') {
            event.preventDefault(); // 阻止默认行为

            // 如果有历史记录
            if (userQuestions.length > 0) {
                // 如果是第一次按向上键从最后一个问题开始
                event.target.textContent = userQuestions[userQuestions.length - 1];
                // 触发入事件以调整高度
                event.target.dispatchEvent(new Event('input', { bubbles: true }));
                // 移动光标到末尾
                const range = document.createRange();
                range.selectNodeContents(event.target);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    });

    // 检测滚动条并动态调整padding
    function checkScrollbar() {
        const hasScrollbar = chatContainer.scrollHeight > chatContainer.clientHeight;
        if (hasScrollbar) {
            // 计算滚动条实际宽度
            const scrollbarWidth = chatContainer.offsetWidth - chatContainer.clientWidth;
            // 设置CSS自定义属性，让CSS处理padding调整
            chatContainer.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
            chatContainer.classList.add('has-scrollbar');
        } else {
            // 没有滚动条时移除类
            chatContainer.classList.remove('has-scrollbar');
        }
    }

    // 监听聊天容器的变化，检测新的用户消息
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.classList && node.classList.contains('user-message')) {
                    const question = node.textContent.trim();
                    // 只有当问题不在历史记录中时才添加
                    if (question && !userQuestions.includes(question)) {
                        userQuestions.push(question);
                        console.log('保存新问题:', question);
                        console.log('当前问题历史:', userQuestions);
                    }
                }
            });
        });
        
        // 每次DOM变化后检查滚动条状态
        setTimeout(checkScrollbar, 0);
    });

    // 开始观察聊天容器的变化
    observer.observe(chatContainer, { childList: true });

    // 初始化时检查滚动条状态
    checkScrollbar();

    // 监听窗口大小变化，重新检查滚动条状态
    window.addEventListener('resize', checkScrollbar);

    // 清空聊天记录时也清空问题历史
    if (clearChat) {
        clearChat.addEventListener('click', () => {
            userQuestions = userQuestions.slice(-1);
            console.log('清空问题历史');
            // 清空后重新检查滚动条状态
            setTimeout(checkScrollbar, 0);
        });
    }
});