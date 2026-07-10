# 轻衡 · AI 营养估算功能 — 实施方案

> 交给实施 agent 的完整规格。实施前请先通读「现有架构约定」,所有代码必须贴合现有风格。

## 0. 现有架构约定(必须遵守)

- 纯原生 JS 单页 PWA,**无构建工具、无框架、无 npm 依赖**。
- `app.js` 是一个 IIFE(`(function(){ 'use strict'; ... })()`),所有新代码写在该 IIFE 内。
- DOM 操作用现有 helper:`$ = document.querySelector`、`$$ = querySelectorAll`。
- 数据存 `localStorage`,key `qingheng.v1`,结构:
  `db = { meals[], workouts[], weights[], settings{name,target,bmr} }`
  meal 结构:`{id, date, type, name, kcal, protein}`。
- 修改 db 后必须 `save()`,UI 刷新用 `renderAll()` 或 `render(name)`。
- 弹层用 sheet 模式:`open('meal')` / `closeSheet()`,sheet 元素 id 为 `#sheet-<name>`,打开时会调 `reset<Name>Sheet()`。
- 提示用 `toast(msg)`;插值到 HTML 的用户输入必须过 `esc()`。
- UI 文案全中文;CSS 无框架,配色变量在 `styles.css` 顶部(`--teal`、`--coral`、`--muted` 等)。
- **每次改动 index.html / app.js / styles.css 后,必须 bump `sw.js` 里的 `CACHE` 版本号**(当前为 `qingheng-v2`,改完升到 `v3`,以此类推),否则 cache-first 的 SW 会一直用旧文件。
- 注意:该项目还有排队中的功能(常用项 chips、数据导入、动作历史、体重目标)也会改 `#sheet-meal` 和 `#sheet-settings`,本功能的改动请保持局部、可叠加,不要重排现有字段。

## 1. 功能目标

用户在「记一餐」时输入自然语言食物描述(如"鸡胸肉150g、西兰花一份、米饭半碗"),点「✨ AI 估算」,调用 DeepSeek API 一次性返回**每项食物 + 合计**的营养数据(热量、蛋白质、脂肪、碳水、纤维 + 主要微量元素),在 sheet 内以卡片显示明细;用户确认后一键把合计 kcal / 蛋白质填入表单,完整营养明细随 meal 一起保存。

设计决策(已定,勿改):
- **一次过输入整餐、单次调用**,不做逐项多次调用。
- 模型用 `deepseek-v4-flash` + **关闭 thinking**(营养估算不需要,省钱省时)。
- 微量元素仅作参考展示,UI 需标注「AI 估算,仅供参考」。

## 2. DeepSeek API 规格(2026-07 已核实)

- Endpoint:`POST https://api.deepseek.com/chat/completions`(OpenAI 格式)
- Header:`Authorization: Bearer <key>`、`Content-Type: application/json`
- 请求体关键参数:
  ```json
  {
    "model": "deepseek-v4-flash",
    "thinking": { "type": "disabled" },
    "response_format": { "type": "json_object" },
    "max_tokens": 2000,
    "temperature": 0.3,
    "messages": [ { "role": "system", "content": "<系统提示词>" },
                  { "role": "user", "content": "<食物描述>" } ]
  }
  ```
- 注意:
  - thinking 默认开启,必须显式 `{"thinking":{"type":"disabled"}}` 关闭(非 thinking 模式下 `temperature` 才生效)。
  - JSON 模式要求提示词中出现 "json" 字样,且必须在提示词里给出输出示例,否则可能返回空 content。
  - 结果在 `resp.choices[0].message.content`(JSON 字符串,需 `JSON.parse`)。
  - 价格:输入 $0.14/M、输出 $0.28/M tokens。单次调用成本约 $0.0005,余额无忧,无需做用量控制 UI。
- 旧模型名 `deepseek-chat` / `deepseek-reasoner` 于 2026-07-24 弃用,**不要使用**。

### CORS 前置验证(实施第一步)

浏览器直接 fetch `api.deepseek.com` 可能被 CORS 拦截。**动手写 UI 之前**,先用最小 fetch 在浏览器里验证(可临时写在 console)。若被拦截:停止实施,向用户报告,讨论代理方案;不要擅自引入服务端组件。

## 3. Prompt 设计

System prompt(建议,可微调):

```
你是营养估算助手。用户给出一餐吃的食物描述(中文,可能含模糊分量如"一碗""一份"),
你按中国常见份量估算,输出 JSON,不要输出任何其他文字。格式:
{
  "items": [
    { "name": "食物名", "amount": "估算的量,如 150g / 1碗(约200g)",
      "kcal": 0, "protein": 0, "fat": 0, "carbs": 0, "fiber": 0 }
  ],
  "total": { "kcal": 0, "protein": 0, "fat": 0, "carbs": 0, "fiber": 0 },
  "micros": { "钙": "xx mg", "铁": "xx mg", "锌": "xx mg", "钾": "xx mg",
              "维生素C": "xx mg", "维生素A": "xx μg" },
  "note": "一句话提醒(可选,如分量假设说明)"
}
数值单位:kcal 为千卡,protein/fat/carbs/fiber 为克,保留整数或一位小数。
如果输入不是食物,返回 {"error":"无法识别为食物"}。
```

解析后必须校验:`items` 是数组、`total.kcal` 是数字;含 `error` 字段或校验失败则 toast 报错,不渲染结果。

## 4. 数据结构变更

- `defaults.settings` 加 `dsKey: ''`(DeepSeek API key)。旧数据兼容由现有 `Object.assign(defaults.settings, db.settings)` 自动完成,无需迁移。
- meal 对象新增可选字段 `nutrients`:保存 AI 返回的 `{items, total, micros}` 原样(仅当用户用了 AI 估算)。不影响现有 `kcal/protein` 字段和所有统计逻辑。

## 5. UI 变更

### 5.1 设置 sheet(`#sheet-settings`)
- 「基础代谢 BMR」下方加一个字段:
  `<label class="field"><span>DeepSeek API Key(AI 营养估算)</span><input id="set-dskey" type="password" placeholder="sk-..." autocomplete="off"/></label>`
- `fillSettings()` / `#save-settings` 同步读写 `db.settings.dsKey`(trim)。

### 5.2 记一餐 sheet(`#sheet-meal`)
- 「吃了什么」输入框下方加一行按钮:`<button class="ai-btn" id="ai-estimate">✨ AI 估算营养</button>`
- 按钮下方加结果容器 `<div id="ai-result" hidden></div>`。
- 交互流程:
  1. 点按钮:取 `#meal-name` 的值(trim,空则 toast「先填吃了什么」);无 `dsKey` 则 toast「先在设置里填 DeepSeek API Key」。
  2. 请求中:按钮文字改「估算中…」并 `disabled`;用 `AbortController` 设 30s 超时;`!navigator.onLine` 直接 toast「离线状态无法估算」。
  3. 成功:渲染结果卡片到 `#ai-result`(见 5.3),并自动把 `total.kcal` / `total.protein` 填入 `#meal-kcal` / `#meal-protein`(四舍五入为整数),同时把返回对象暂存到模块级变量 `aiNutrients`。
  4. 失败(HTTP 非 200 / 解析失败 / 超时):toast 对应错误(401 → 「API Key 无效」;其余 → 「估算失败,稍后再试」),恢复按钮。
  5. `resetMealSheet()` 时清空 `#ai-result`、`aiNutrients = null`、恢复按钮状态。
  6. 保存 meal 时若 `aiNutrients` 非空,写入 `meal.nutrients`(编辑模式同样适用)。
- 编辑已有 meal(`startEdit`)时:若 `m.nutrients` 存在,直接渲染其结果卡片到 `#ai-result`,方便回看。

### 5.3 结果卡片(纯展示,插入 `#ai-result`)
- 每个 item 一行:名称 + 估算量(灰字)+ kcal(右对齐)。
- 合计行加粗:kcal / 蛋白 / 脂肪 / 碳水 / 纤维。
- micros 用小号灰字一行流式排列(`钙 xx mg · 铁 xx mg · …`)。
- 底部固定小字:「AI 估算,仅供参考」+ `note`(如有)。
- 所有模型返回的字符串插入 HTML 前必须 `esc()`。
- 样式:新增 `.ai-btn`、`.ai-card` 等 class,风格贴近现有 `.field` / `.hint`(圆角、`--teal-wash` 底色即可),写在 `styles.css` 末尾。

## 6. app.js 新增代码组织

在 meal sheet 区块附近加一节 `/* ---------- AI nutrition ---------- */`:
- `let aiNutrients = null;`
- `async function estimateNutrition(text)` — 封装 fetch + 解析 + 校验,返回对象或抛错。
- `function renderAiResult(data)` — 生成卡片 HTML。
- `#ai-estimate` 的 click 监听(直接 `$('#ai-estimate').addEventListener`,与现有写法一致;IIFE 内可用 async 函数)。

不要引入任何第三方库;fetch 原生即可。

## 7. 验收清单

1. 无 key 时点估算 → 引导去设置;设置里能存 key,导出备份含 `dsKey`(顺带提醒用户备份文件含密钥)。
2. 输入「鸡胸肉150g、西兰花一份、米饭半碗」→ 3 个 item + 合计,kcal/蛋白自动填入,保存后 meal 带 `nutrients`。
3. 编辑该 meal → 结果卡片回显;再次估算可覆盖。
4. 输入非食物(如"asdf")→ 报错 toast,不污染表单。
5. 断网 / 错误 key / 超时 → 各自的 toast,按钮恢复可用。
6. 完全不用 AI 功能时,记一餐流程与之前完全一致(零回归)。
7. `sw.js` CACHE 已 bump;`node --check app.js` 通过。
