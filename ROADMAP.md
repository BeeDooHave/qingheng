# 轻衡 · 路线图与待做清单

> 给后续实施 agent(或未来会话)的总览。**动手前必读 `CLAUDE.md` 和下方「开发约定与可复用件」**。(原 PLAN-ai-nutrition.md / PLAN-sync.md 已实施并删除,需要时从 git 历史找回。)

## 当前状态(2026-07-11)

| 事项 | 状态 |
|---|---|
| 编辑功能(点条目重开 sheet 更新原对象) | ✅ 已完成 |
| AI 营养估算(DeepSeek v4-flash) | ✅ 已完成,手机+电脑实测通过,**浏览器直连无 CORS 问题** |
| 多设备同步(Gist + mergeDb + 墓碑) | ✅ 已完成 |
| 弹层交互修缮(v23–v28) | ✅ 内部可滚、下拉/灰条/取消关闭、背景锁滚、删除撤销带倒计时、AI 估算过期标记 |
| 数据导入(合并/覆盖) | ✅ 已完成(v29);覆盖导入后直推 gist 不走合并 |
| 营养进度 当日/近7天平均 切换 | ✅ 已完成(v29);平均只算有记录的天 |
| AI 周报(原未来展望 2) | ✅ 已完成(v29);报告存 localStorage `qingheng.aireport`,不进 db/同步 |
| 常用动作 chips(快捷添加收官) | ✅ 已完成(v42);`applyWorkoutToForm()` 编辑/复制共用,沿用上次 sets/burn/muscles |
| 动作历史 / PR | ✅ 已完成(v42);行尾折线图标开 `#sheet-history`,力量=最大重量、徒手=总次数、有氧=时长,无 db 变更 |
| 体重目标 + 达标预测 | ✅ 已完成(v42);`settings.targetWeight`,体重卡显示差距;预测按近14天有记录天的平均缺口、7700kcal≈1kg |
| CSV 导出 | ✅ 已完成(v42);餐/动作/体重三个文件,带 BOM,Excel 直接开,不含密钥 |
| 训练模板 | ✅ 已完成(v42);`db.templates[]` 走 mergeDb(id+ts+墓碑),训练页「模板 ›」存/套用/删(带撤销) |
| 组间休息计时器 | ✅ 已完成(v42);60/90/120s,结束哔两声+震动+toast。**没用 Notification API**:iOS PWA 本地通知不可靠(要推送服务),诚实做法是页面内提醒;iOS 切后台定时器会暂停,回到 app 立即补发 |
| 自校准 TDEE(v2 愿景 1) | ✅ 已完成(v42);数据页「自校准消耗」卡实时反推日常消耗,一键替换 BMR(带撤销)。假设见 `tdeeFromLogs()` 注释 |
| 视觉资产自有化(v2 愿景 7,缩水版) | ✅ 已完成(v43);emoji 全换自绘线性 icon(`MEAL_ICONS`/`CAT_ICONS`,含兜底共 9 个),字体升级为拉丁子集 `fonts/qh-latin-*.woff2`。**人体热力图保留 body-highlighter**(做过三方案样张对比,用户拍板不动,2026-07-11) |
| 食物全量索引 + 联想 + 全部列表 | ✅ 已完成(v44);`foodIndex()` 扫全部餐记录聚合 次数/最近量,修掉「上周吃过被最近记录挤出 chips 要重打」的问题。食物名打字即联想(带上次的量),弹层内「全部吃过的食物 ▾」折叠区按频次浏览;chips 改为 3 最近 + 频次补满 |
| 补剂每日打卡 | ✅ 已完成(v44);`db.supps[]`(定义,选填 kcal/蛋白)+ `db.suppLogs[]`(打卡),都走 mergeDb id+ts+墓碑。饮食页补剂卡点一下打卡,有热量的计入当天摄入(intakeOn/proteinOn/nutritionOn) |
| 补剂详细成分(照标签) | ✅ 已完成(v45);定义可选填 `micros{}`(MICROS 的 key,**只收用户照标签录的值,绝不 AI 估算**)。计入营养进度但来源区分:进度条双色(实心=食物/斜纹=补剂)、六系统实亮=食物吃够/虚框带「补」=靠补剂凑够、「补什么」推荐只按食物算(药片补齐不该让推荐闭嘴)。补剂行点击可编辑(保 id 不丢打卡) |
| 粘贴导入训练笔记 | ✅ 已完成(v46);训练页「粘贴导入 ›」,整段笔记一次 `dsJson` 调用解析+估算消耗+肌群(`PARSE_PROMPT`),预览可改可删再入库,热力图/历史/PR 零改动生效。拆组口径(2026-07-19 用户拍板):同一重量大次数=总次数按 10 次/组拆,逐段写的各算一组。草稿含已解析结果,误关不重花 AI 调用。**已知语义坑**:assist 器械 sets 存的是助力配重,PR「最大重量」对它方向是反的 |
| 编辑态改记录日期 | ✅ 已完成(v47);餐/动作编辑弹层顶部「记录日期 ‹ ›」行(`editDate{}`/`updateEditDate()`,仅编辑态显示),保存时整条挪天并跳到目标日,toast 说明。起因:7-20 记了 7-19 的饮食,之前只能删了重记 |
| 补剂卡与饮食列表粘连 | ✅ 修复(v48);`.meal-groups` 的 gap 只管内部,`#diet-list` 补了 margin-bottom:18px |
| 身体数据算消耗/摄入 | ✅ 已完成(v48);设置页 身高/年龄/性别 + 「按身体数据算」按钮:`mifflinCalc()`(Mifflin-St Jeor ×1.2 久坐,**不含训练所以不用运动系数**;建议摄入=消耗−500,下限 1200),填进两个输入框可手改再保存。设置字段 height/age/sex 走 settings 整体同步。「基础代谢 BMR」标签更正为「日常消耗(不含训练)」——语义本来就是它 |
| 首页消耗拆分显示 | ✅ 已完成(v48);`#sum-out-cap` 当天有训练时显示「消耗 含训练 +N」,训练部分 coral 色 |
| 当日动作按部位分组 | ✅ 已完成(v49);`groupWorkouts()`(纯函数)按六大部位(胸/背/肩/手臂/腿臀/核心)+有氧分组,组头小计(N组·容量/分钟),容量降序、有氧垫底、没肌群信息进「其他」。**零 AI 调用**:分类来自动作已有肌群(AI 优先/关键词兜底)。样式复用饮食页 mg-title |
| 训练卡片美化(方案C) | ✅ 已完成(v50);部位合卡(一个部位一张卡、行间 hairline)+ 组条图 `setBarsHtml()`(一组一根竖条,力量按重量/徒手按次数归一,3 档深浅,单组不画)+ 行副标题 `setsSummary()` 折叠文案。做过 4 方案样张对比,用户选 C(2026-07-20)。分类小图标在合卡里退场,编辑/删除/走势按钮保留 |
| AutoAnimate 决策 | ⛔ 用户拍板要引,实施前发现**与全量 innerHTML 重渲染架构不搭**:每次 render 全列表 remove+add 会整页闪烁(v29 教训同款)。诚实结论:等 v2 愿景 5 拆模块时做 keyed 渲染再配它,已记入待做 |
| 公网部署准备(v51) | ✅ 代码侧就绪;起因:Mac 睡眠/出门就用不了,且 **http 局域网下 SW 从未注册**,手机从没真正离线过。做了:`_headers`(CSP 含 deepseek/github/gist-raw 三个 connect-src,style 开 inline、script 不开)、内联 module 搬进 `vendor/bh-bridge.js`(CSP 友好)+ 进 sw ASSETS、README 加 Cloudflare Pages 部署与手机迁移步骤。**待用户做**:push → Cloudflare Pages 连仓库 → 手机换新域名重填密钥拉同步 |
| 版本号 | 当前 **v51**。改完跑 `./bump.sh` 一键改齐;验证用 `test.html`(40 条冒烟断言,见 README 流程) |
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
| `applyWorkoutToForm(w)` | 整条训练带入表单(编辑与常用动作 chips 共用,沿用 burn/muscles) |
| `toCsv(rows)` / `dlText(name, text)` | CSV 组装(逗号/引号转义)与带 BOM 下载 |
| `histSeries(list)` | 同名动作记录 → 走势序列 + PR(力量=最大重量/徒手=总次数/有氧=时长) |
| `forecastDays(kgLeft, avgDef)` / `avgDeficit14()` | 达标天数预测(7700kcal≈1kg;缺口只算记了饮食的天) |
| `tdeeFromLogs(weights, daysMap)` / `computeTdee()` | 自校准日常消耗;全部假设写在函数头注释里 |
| `startRest(sec)` / `stopRest()` | 组间休息计时(全局存活,关弹层不中断) |
| `renderTemplateSheet()` / `db.templates[]` | 训练模板;模板删除与餐/动作共用同一套墓碑 |
| `foodIndex(meals)` | 全量食物索引(纯函数):名→{count,lastTs,amt,unit};chips/联想/全部列表都从这取 |
| `fillFoodRow(row, name, amt, unit)` | 往已有食物行填名/量/单位(联想与全部列表共用) |
| `suppsOn(dk)` / `renderSuppCard()` / `renderSuppSheet()` | 补剂:某天已勾选定义 join / 饮食页打卡卡 / 管理弹层 |
| `suppNutrition(supps, logs, dk)` / `suppNutritionOn` / `suppNutritionAvg7` | 补剂营养聚合(纯函数);avg7 与 nutritionAvg7 用同一套「有记录的天」做分母 |
| `normalizeParsed(data, fallbackDate)` / `splitBigReps` / `parseSetsText` | 粘贴导入:AI 返回规范化(日期补年/类别白名单/拆组兜底/肌群过滤)、大次数拆组、预览组数文本解析,全是纯函数 |
| `PARSE_PROMPT` / `renderPastePreview()` | 整段训练笔记批量解析 prompt(消耗假设与 WO_PROMPT 同口径)与预览弹层;草稿在 `qingheng.pastedraft` |
| `mifflinCalc(kg, cm, age, sex)` | Mifflin-St Jeor 纯函数 → {bmr, daily(×1.2), intake(−500,≥1200)};假设全写在函数头注释 |
| `groupWorkouts(wos, musclesOf)` / `WO_REGIONS` | 动作→六大部位分组(纯函数,musclesOf 注入方便测试);训练页当日列表用它渲染 |
| `setsSummary(sets, cat)` / `setBarsHtml(sets, cat)` / `rowWoGrouped(w)` | 训练行:折叠文案、组条图(装饰即数据)、合卡行渲染;首页紧凑列表仍用 rowWorkout |

**测试钩子**:`window.__qh_test = { mergeDb, cleanMuscles, splitNameAmount, mealFoods, toCsv, forecastDays, histSeries, tdeeFromLogs, foodIndex, suppNutrition, normalizeParsed, parseSetsText, mifflinCalc, groupWorkouts, setsSummary, setBarsHtml }`——新纯函数加进去并在 test.html 补断言。

## 待做清单

- **keyed 列表渲染 + AutoAnimate**(2026-07-20):@formkit/auto-animate 0.10.0(MIT,~3KB,自托管进 vendor/)用户已认可,但必须先把列表渲染从全量 innerHTML 改成按 id 复用节点,否则全列表闪烁。适合与 v2 愿景 5(拆 ES modules)一起做,别单独硬上。

## v2 愿景(大改方向,2026-07-10 与用户对齐认可)

产品北极星:**降低录入摩擦到零,把统计升级成决策,底层保证数据永不丢。** App 保持安静——瞄一眼说清楚,不做话痨。

按实施价值排序:

1. ~~**自校准 TDEE**~~ — ✅ 已实施(v42)。实现为数据页「自校准消耗」卡:每次打开数据页实时反推(近42天、相邻称重段 3–21 天、饮食覆盖≥85%、多段按天数加权),一键替换 BMR 带撤销。**有意没做「每周全自动改写 BMR」**:静默改动能量数字太魔法,先让实测值被观察几周建立信任,之后想全自动再加一行代码的事。
2. **一句话即记录** — 只留一个输入框(+语音/快捷指令):「中午番茄炒蛋一碗饭,练了三组卧推60kg」一次 AI 调用解析出餐+营养+动作+肌群,确认即存。现有表单/chips/草稿都是填表的补丁,终局是消灭填表。
3. **首页倒转:从「记了什么」到「现在该做什么」** — 打开直接给「还剩 820 kcal、蛋白差 46g、钙没亮 → 推荐这几个常用餐微调」。六系统+补什么按钮是雏形,大改后它是首页,圆环退居二线。
4. **数据架构:append-only 事件日志** — 记/改/删都是不可变事件,同步=两份日志取并集,冲突在数学上不存在;墓碑/复活/覆盖防回流的特判全部消失;任意时间点重放即备份。存储迁 IndexedDB。
5. **代码拆 ES modules(无构建)** — store/sync/ai/views 分文件,test.html 升级为模块单测;design tokens + 暗色模式。
6. **每晚 agent 复盘** — 睡前自动分析当天、从常用餐组合出补齐明天缺口的三餐+购物清单,早上打开答案已在。
7. ~~**视觉资产自有化**~~ — 缩水完成(v43):emoji 图标全部换成自绘线性 icon,字体升级为 Space Grotesk 拉丁子集(ASCII+×·°±,约 7.5KB/字重)。**两个明确不做**:①人体热力图重绘——对比过「写实重绘/线性几何」两版样张,线性几何在 132px 下辨识度吃亏,写实重绘收益不抵折腾,保留 body-highlighter;②中文定制字库——体积(数 MB)与本地 PWA 定位冲突。
8. **每月相关性深报** — 缺口 vs 体重滞后关系、哪类晚餐易反弹;数据量够才做,警惕伪科学。

## 未来展望(未排期,按价值/成本粗排)

1. **Cloudflare Worker 统一后端**(条件触发):CORS 已实测无问题,此项仅在 Gist 同步方案不满意、或想把 DeepSeek key 移出浏览器(存 Worker 环境变量更安全)时考虑。
2. ~~AI 周报~~(已实施,v29):每周用 DeepSeek 汇总 7 天饮食+训练+体重,生成一段中文点评。stats 页卡片。
3. ~~训练模板~~(已实施,v42):`db.templates[]` + 训练页「模板 ›」,存/套用/删带撤销,走 mergeDb 同步。
4. ~~组间休息计时器~~(已实施,v42):60/90/120s 页面内倒计时+哔声+震动。**决策记录:不用 Notification API**——iOS PWA 本地通知需要推送服务才可靠,半吊子体验不如页面内提醒诚实。
5. ~~体重目标预测~~(已实施,v42):体重卡随目标差距一起显示,假设(近14天有记录天平均缺口、7700kcal≈1kg)直接写在文案里。
6. ~~CSV 导出~~(已实施,v42):设置页导出餐/动作/体重三个 CSV,带 BOM。
7. **体围/照片记录**:腰围臂围等维度 + 进步对比。db 加 `measurements[]`,照片存 IndexedDB(localStorage 放不下)。**工作量在存储迁移,适合和 v2 愿景 4 一起做**。
8. **提醒**:定时提醒记录(PWA 通知在 iOS Safari 限制多,预期管理:可能只在 Android/桌面可靠;结合组间计时器的教训,大概率不值得做)。
9. **安全加固**:设置页的 dsKey/syncToken 用 WebCrypto 以用户 PIN 加密存储;导出备份时剥离密钥字段(已做剥离)。做同步/AI 普及使用后再考虑。

## 长期不做(明确排除)

- 多用户/账号系统、真实后端数据库 —— 与"个人、本地优先、零运维"的定位冲突。
- 构建工具/框架迁移 —— 现有规模(单 js 文件)不值得。
- 第三方食物数据库 API(如 USDA)—— LLM 估算已够用,引入会带来 key/配额/英文数据源问题。
- **拍照识别餐食**(2026-07-11 用户拍板移除)—— 需接视觉模型另算成本,文本估算已覆盖主要价值;不再列入展望。
