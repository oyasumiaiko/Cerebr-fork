/**
 * 提示词解析模块（纯函数，无副作用）
 * - 占位符替换
 * - URL 规则匹配
 * @since 1.1.0
 */

/**
 * 替换提示词中的时间占位符
 * 支持: {{datetime}} (ISO本地含时区), {{date}}, {{time}}
 * @param {string} text 原始文本
 * @returns {string} 替换后的文本
 */
export function replacePlaceholders(text) {
    if (typeof text !== 'string') return text;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const offsetMinutes = now.getTimezoneOffset();
    const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
    const offsetMins = Math.abs(offsetMinutes % 60);
    const offsetSign = offsetMinutes <= 0 ? '+' : '-';
    const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
    const isoLocalString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;

    return text
        .replace(/{{\s*datetime\s*}}/g, isoLocalString)
        .replace(/{{\s*date\s*}}/g, now.toLocaleDateString())
        .replace(/{{\s*time\s*}}/g, now.toLocaleTimeString());
}

/**
 * 根据 URL 与类型匹配规则并返回提示词
 * 规则示例: { pattern: "https://example.com/*", type: "system" | "summary", prompt: "..." }
 * 后添加的规则优先级更高
 * @param {string} url 当前页面 URL
 * @param {('system'|'summary')} type 规则类型
 * @param {Array<Object>} rules 规则数组
 * @returns {string|null}
 */
export function getMatchingUrlRule(url, type, rules) {
    if (!url || !Array.isArray(rules)) return null;
    for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (!rule || rule.type !== type || !rule.pattern) continue;
        try {
            const pattern = rule.pattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.');
            const regex = new RegExp('^' + pattern + '$');
            if (regex.test(url)) return rule.prompt || '';
        } catch (e) {
            console.error(`URL 规则无效: ${rule.pattern}`, e);
        }
    }
    return null;
}


