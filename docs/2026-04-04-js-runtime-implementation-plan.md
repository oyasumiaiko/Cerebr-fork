# Cerebr JS Runtime 实现计划（2026-04-04）

> 目标：为 Cerebr 建立一套**浏览器内原生 JavaScript 执行环境**，优先服务“网页上下文分析 / 页面状态读取 / 扩展能力调用”，并作为后续自定义工具系统的底座。

---

## 一、为什么优先做 JS Runtime

在浏览器扩展里，页面理解和页面操作天然发生在 JavaScript / DOM 环境中。

和 Python 相比，JS Runtime 有几个决定性优势：

1. **直接操作 DOM**
   - 不需要把页面状态序列化后再发给外部运行时。
2. **能直接读取页面的即时状态**
   - 包括当前 DOM、滚动位置、选择区、表格、前端渲染后的内容。
3. **能和扩展现有消息桥天然衔接**
   - content script / background / sidebar 本来就是 JS。
4. **更适合作为“页面工具”底座**
   - 后续无论是页内搜索、结构化提取、元素定位、高亮还是页面审计，都可以建立在这层之上。

---

## 二、这次已经确认的关键事实

### 1. `chrome.scripting.executeScript()` 不适合做动态 JS REPL

官方文档明确说明：

- `scripting.executeScript()` 只能注入**文件**或**函数**
- **不能执行字符串**
- Manifest V3 也禁止 `eval()` / `new Function()`

这意味着它不适合作为“运行时生成代码”的核心执行方案。

### 2. `chrome.userScripts` 才是官方支持的动态代码执行入口

官方文档明确说明：

- `chrome.userScripts` 可以运行 **arbitrary code**
- `ScriptSource.code` 可直接传入字符串代码
- `chrome.userScripts.execute()`（Chrome 135+）可以做**一次性执行**
- 如果脚本返回 Promise，浏览器会等待其完成并返回结果

### 3. `USER_SCRIPT` world 是第一阶段最合适的执行环境

官方文档明确说明：

- `USER_SCRIPT` world 默认与页面主世界隔离
- 不会直接污染页面的 JS 全局环境
- 同时又可以访问页面 DOM
- 并且 **exempt from the page's CSP**

这非常适合作为第一阶段的默认执行环境。

### 4. userScripts 可以和扩展通信

官方文档明确说明：

- user scripts 可以使用 `runtime.sendMessage()` / `runtime.connect()`
- 但要先 `configureWorld({ messaging: true })`
- 接收端使用专门的：
  - `runtime.onUserScriptMessage`
  - `runtime.onUserScriptConnect`

这意味着我们可以在 userScripts 里暴露一个通用桥：

```js
await cerebr.invoke(method, params)
```

底层再转成扩展消息调用。

### 5. userScripts 的启用还依赖 Chrome 版本和用户侧开关

官方文档明确说明：

- Chrome 120+ 才有 `userScripts`
- Chrome 135+ 才有 `userScripts.execute()`
- Chrome 138+ 需要在扩展详情页开启 **Allow User Scripts**
- Chrome 138 之前常依赖 **Developer Mode**

因此第一阶段必须内置**可用性探测**和**清晰错误提示**。

---

## 三、对 Cerebr 来说，最合理的架构

### 第一层：JS 执行层

职责：

- 接收一段运行时代码字符串
- 注入到指定 tab / frame
- 在 `USER_SCRIPT` world 执行
- 收集结果并返回

建议实现：

- `background` 负责统一调度
- 使用 `chrome.userScripts.execute()`
- 使用一个固定 `worldId`

### 第二层：扩展桥接层

职责：

- 在执行环境里暴露一个统一入口：

```js
await cerebr.invoke(method, params)
```

- 不为每个扩展 API 做一堆零散 wrapper
- 统一走一个**通用 dispatcher**

第一阶段只保留极少量、高价值能力：

- `page.getContent`
- `page.captureVisible`
- `extension.getRuntimeStatus`

> 注意：这里的“少量能力”是实现层面的收敛，不等于最终产品只支持这几个。
> 后续扩展时，继续往 dispatcher 里加 method 即可，不要一开始做大而散的 API 树。

### 第三层：调用入口层

第一阶段先做：

- 侧栏内部 `appContext.utils.executeJsRuntime(...)`
- 调试入口 `window.cerebr.debug.executeJsRuntime(...)`

先把基础通路打通，不急着加复杂 UI。

---

## 四、阶段拆分

## Phase 1：最小可用执行通路（本次开始实现）

目标：

1. manifest 增加 `userScripts` / `scripting` 权限
2. 背景页建立 JS Runtime manager
3. 建立 `USER_SCRIPT` world，并开启 messaging
4. 支持从侧栏发起一次性执行
5. 注入代码里默认可用：

```js
const result = await cerebr.invoke("page.getContent")
```

6. 提供清晰的“不可用原因”：
   - Chrome 版本过低
   - 未开启 Allow User Scripts / Developer Mode
   - 当前不是嵌入网页侧栏场景

**本阶段不做：**

- `MAIN` world
- `chrome.debugger`
- 控制台输出流式回传
- 面向普通用户的复杂交互 UI
- 每个扩展 API 都做独立 wrapper
- 细粒度权限编排 / 复杂 capability 分组

---

## Phase 2：把执行结果做得更像 REPL

目标：

- console 输出采集
- 错误栈标准化
- 多 frame / 指定 frame 执行
- 执行历史与最近结果缓存
- 可视化测试面板

---

## Phase 3：扩展为真正的页面工具层

目标：

- `page.search`
- `page.extract`
- `page.highlight`
- `page.inspectElement`
- `page.getSelectionSnapshot`
- `artifact.patch`

---

## Phase 4：高权限模式（仅在确有必要时）

候选：

- `MAIN` world
- `chrome.debugger` + CDP `Runtime.evaluate`

说明：

- 这会明显提高能力上限
- 也会显著提高复杂度和风险
- 在第一阶段稳定之前，不应该提前做

---

## 五、当前已知风险与约束

### 1. 用户侧开关不是扩展自己能静默打开的

即使 manifest 里声明了 `"userScripts"`，用户仍然要在 Chrome 里启用对应开关。

因此：

- 代码里必须做好 availability check
- UI/错误文案里必须给出明确提示

### 2. `USER_SCRIPT` world 不是页面主世界

这意味着：

- 能访问 DOM
- 但**不等于**能直接无缝访问页面 JS 私有运行时对象

如果后续必须读页面主世界对象，再考虑 `MAIN` world。

### 3. 不要把“任意扩展权限”直接裸暴露给执行代码

第一阶段虽然不做复杂 wrapper 分组，但仍然需要：

- 单一 dispatcher
- 明确 method 白名单
- 明确错误返回

避免把 background 整个消息总线直接暴露出去。

---

## 六、第一阶段完成后的验收标准

满足以下条件即可视为 Phase 1 完成：

1. 在嵌入网页的 Cerebr 侧栏环境中，可以执行：

```js
return document.title
```

并拿到结果。

2. 可以执行：

```js
return await cerebr.invoke("page.getContent")
```

并拿到网页内容结构。

3. 可以执行：

```js
return await cerebr.invoke("page.captureVisible")
```

并拿到截图数据或结构化返回。

4. 当 `userScripts` 不可用时，能返回明确的错误原因。

---

## 七、官方参考（后续继续实现时优先看这些）

- `chrome.userScripts`  
  https://developer.chrome.com/docs/extensions/reference/api/userScripts

- `chrome.scripting`  
  https://developer.chrome.com/docs/extensions/reference/scripting

- Manifest V3 安全迁移（关于不能执行任意字符串）  
  https://developer.chrome.com/docs/extensions/develop/migrate/improve-security

- Content Scripts / world 概念  
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

---

## 八、当前决策（避免后续反复摇摆）

1. **第一阶段就是 `userScripts.execute()`**
2. **默认 world 选 `USER_SCRIPT`**
3. **桥接 API 只提供一个通用入口 `cerebr.invoke(method, params)`**
4. **先打通基础执行链路，不先做复杂 UI**
5. **不做 debugger fallback**
6. **不做繁杂分组权限控制**

