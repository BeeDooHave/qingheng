# 轻衡 · 路线图与待做清单

> 给后续实施 agent(或未来会话)的总览。**动手前必读 `CLAUDE.md` 和下方「开发约定与可复用件」**。(原 PLAN-ai-nutrition.md / PLAN-sync.md 已实施并删除,需要时从 git 历史找回。)

## 当前状态(2026-07-10)

| 事项 | 状态 |
|---|---|
| 编辑功能(点条目重开 sheet 更新原对象) | ✅ 已完成 |
| AI 营养估算(DeepSeek v4-flash) | ✅ 已完成,手机+电脑实测通过,**浏览器直连无 CORS 问题** |
| 多设备同步(Gist + mergeDb + 墓碑) | ✅ 已完成 |
| 弹层交互修缮(v23–v28) | ✅ 内部可滚、下拉/灰条/取消关闭、背景锁滚、删除撤销带倒计时、AI 估算过期标记 |
| 数据导入(合并/覆盖) | ✅ 已完成(v29);覆盖导入后直推 gist 不走合并 |
| 营养进度 当日/近7天平均 切换 | ✅ 已完成(v29);平均只算有记录的天 |
| AI 周报(原未来展望 2) | ✅ 已完成(v29);报告存 localStorage `qingheng.aireport`,不进 db/同步 |
| 版本号 | 当前 **v40**。改完跑 `./bump.sh` 一键改齐;验证用 `test.html`(26 条冒烟断言,见 README 流程) |
| 部署 | 本地 `python3 -m http.server 5173 --bind 0.0.0.0`,手机走局域网,**不需要 push**(见 README) |

## 开发约定与可复用件(未来会话必读,先查这里再写新代码)

**流程铁律**:改完 `node --check app.js` → 桌面开 `test.html` 断言全绿 → `./bump.sh` → 手机强制刷新。新功能顺手往 test.html 加断言(UI 类放前段,纯函数类用 `window.__qh_test` 暴露后测)。

**架构规矩**(补充 PLAN-ai-nutrition 第 0 节,以此处为准):

- **新的顶层 `$('#xx').addEventListener` 必须判空**——SW 升级间隙会出现「旧 HTML + 新 JS」,不判空整个 IIFE 挂掉全页失效(v29 事故)。
- 密钥(dsKey/syncToken/gistId)**永不上传**:gistPayload 剥离、mergeDb 保本地、导出剥离。动这三处前先看 test.html 里的 mergeDb 断言。
- 弹层规矩:`open(name)`/`closeSheet()`,自带 body 锁滚、下拉关闭、grip/背景/取消三种关法;新弹层照抄现有结构即可,别自己写开关逻辑。
- 第三方轮子:npm 拿包 → 单文件进 `vendor/` → sw.js ASSETS → README 轮子表登记。禁 CDN。

**已有的工具函数(别重写)**,都在 app.js:

| 函数 | 用途 |
|---|---|
| `dsJson(system, user, maxTokens)` | DeepSeek json_object 调用,带超时/401/错误归一(AI 周报的 genReport 是纯文本变体) |
| `toast(msg, {label, fn})` | 第二参可选:带按钮+5 秒倒计时条(删除撤销在用) |
| `celebrate(big)` | confetti 彩带,自动判空可降级 |
| `applyMealToForm(m)` | 整餐带入表单(编辑与常用餐复制共用) |
| `mergeDb(local, remote)` | 唯一的合并入口,墓碑/复活/密钥语义有断言保护 |
| `emptyArt(kind)` / `I_TRASH` / `I_X` / `SYS_ICONS` | 自绘线性插画与图标,新图标沿用此风格(24 grid, stroke 2) |
| `nutritionOn(dk)` / `nutritionAvg7(dk)` / `sysPct` | 营养聚合,任何新统计从这取数 |
| `musclesFor(w)` / `MUSCLE_MAP` / `MUSCLE_CN` | 动作→肌群(AI 优先,关键词兜底) |
| `renderMuscleMap(k)` | 人体热力图(body-highlighter 封装) |
| `mealFoods(m)` / `splitNameAmount` / `parseAmount` | 餐名/食物文本解析 |
| `dlog(tag, msg)` | 持久化调试日志,进诊断页 |

**测试钩子**:`window.__qh_test = { mergeDb, cleanMuscles, splitNameAmount, mealFoods }`——新纯函数加进去并在 test.html 补断言。

## 待做清单(按此顺序执行)

1. **[实施] 常用项快捷添加(仅剩动作部分)** — 餐部分已完成(v37「最近的餐」chips,整份带入含营养明细);剩:加动作 sheet 的 workout.name chips 回填 cat/sets/duration。
2. **[实施] 动作历史/PR(原功能 4)** — 训练条目行尾加 📈 小按钮(**点行主体=编辑,已占用**),打开 `#sheet-history`:该动作名跨日期的重量走势(复用 `lineChart()`;徒手看总次数、有氧看时长),显示 PR 和最近几次明细。无 db 变更。
3. **[实施] 体重目标(原功能 5)** — settings 加 `targetWeight`;stats 体重卡片显示「距目标还差 x.x kg」,达标显示庆祝文案。与同步方案的 settings.ts 机制兼容(保存设置刷新 ts 即可)。

每项完成后:`node --check app.js`、bump SW CACHE、让用户验证后再做下一项。

## v2 愿景(大改方向,2026-07-10 与用户对齐认可)

产品北极星:**降低录入摩擦到零,把统计升级成决策,底层保证数据永不丢。** App 保持安静——瞄一眼说清楚,不做话痨。

按实施价值排序:

1. **自校准 TDEE(最便宜且最正确,可先行)** — 现在净缺口靠手填 BMR 蒙;用积累的摄入+体重曲线回归出真实每日消耗,每周自动修正。"缺口 624"从估计变成测量。纯本地计算。
2. **一句话即记录** — 只留一个输入框(+语音/快捷指令):「中午番茄炒蛋一碗饭,练了三组卧推60kg」一次 AI 调用解析出餐+营养+动作+肌群,确认即存。现有表单/chips/草稿都是填表的补丁,终局是消灭填表。
3. **首页倒转:从「记了什么」到「现在该做什么」** — 打开直接给「还剩 820 kcal、蛋白差 46g、钙没亮 → 推荐这几个常用餐微调」。六系统+补什么按钮是雏形,大改后它是首页,圆环退居二线。
4. **数据架构:append-only 事件日志** — 记/改/删都是不可变事件,同步=两份日志取并集,冲突在数学上不存在;墓碑/复活/覆盖防回流的特判全部消失;任意时间点重放即备份。存储迁 IndexedDB。
5. **代码拆 ES modules(无构建)** — store/sync/ai/views 分文件,test.html 升级为模块单测;design tokens + 暗色模式。
6. **每晚 agent 复盘** — 睡前自动分析当天、从常用餐组合出补齐明天缺口的三餐+购物清单,早上打开答案已在。
7. **视觉资产自有化** — 肌群人体图与全部插画重绘为一套自家风格,字体升级完整定制。
8. **每月相关性深报** — 缺口 vs 体重滞后关系、哪类晚餐易反弹;数据量够才做,警惕伪科学。

## 未来展望(未排期,按价值/成本粗排)

1. **Cloudflare Worker 统一后端**(条件触发):CORS 已实测无问题,此项仅在 Gist 同步方案不满意、或想把 DeepSeek key 移出浏览器(存 Worker 环境变量更安全)时考虑。
2. ~~AI 周报~~(已实施,v29):每周用 DeepSeek 汇总 7 天饮食+训练+体重,生成一段中文点评(缺口达成率、蛋白摄入、训练频率建议)。数据都在本地,一次调用,成本可忽略。stats 页加卡片。
3. **训练模板**:把某天的一组动作存为模板(如"推日/拉日/腿日"),一键套用到今天。db 加 `templates[]`。
4. **组间休息计时器**:加动作 sheet 里一个倒计时按钮(60/90/120s),用 Notification API 提醒(PWA 需授权,iOS 上受限,做成页面内提示兜底)。
5. **拍照识别餐食**:需要多模态模型(DeepSeek 当前 API 为文本;需接视觉模型另算成本)。先观望,文本估算已覆盖主要价值。
6. **体重目标预测**:基于近 14 天平均日缺口(7700 kcal ≈ 1kg)估算达到 targetWeight 的日期,显示在 stats。纯本地计算,依赖功能 6 完成。
7. **体围/照片记录**:腰围臂围等维度 + 进步对比。db 加 `measurements[]`,照片存 IndexedDB(localStorage 放不下)。
8. **CSV 导出**:meals/workouts 导出 CSV 方便进 Excel。低成本,顺手可做。
9. **提醒**:定时提醒记录(PWA 通知在 iOS Safari 限制多,预期管理:可能只在 Android/桌面可靠)。
10. **安全加固**:设置页的 dsKey/syncToken 用 WebCrypto 以用户 PIN 加密存储;导出备份时剥离密钥字段(或询问)。做同步/AI 普及使用后再考虑。

## 长期不做(明确排除)

- 多用户/账号系统、真实后端数据库 —— 与"个人、本地优先、零运维"的定位冲突。
- 构建工具/框架迁移 —— 现有规模(单 js 文件)不值得。
- 第三方食物数据库 API(如 USDA)—— LLM 估算已够用,引入会带来 key/配额/英文数据源问题。
