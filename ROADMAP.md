# 轻衡 · 路线图与待做清单

> 给后续实施 agent(或未来会话)的总览。配套文档:`PLAN-ai-nutrition.md`(AI 营养估算,已实施)、`PLAN-sync.md`(多设备同步,待实施)。架构约定见 PLAN-ai-nutrition.md 第 0 节,对所有任务生效。

## 当前状态(2026-07-09)

| 事项 | 状态 |
|---|---|
| 编辑功能(点条目重开 sheet 更新原对象) | ✅ 已完成 |
| AI 营养估算(DeepSeek v4-flash) | ✅ 已完成,手机+电脑实测通过,**浏览器直连无 CORS 问题** |
| SW 缓存版本 | 当前 `qingheng-v3`,每次改动 html/js/css 后必须 bump |

## 待做清单(按此顺序执行)

1. **[实施] 多设备同步** — 按 `PLAN-sync.md`。核心:Gist 存储、mergeDb 合并、墓碑防复活、记录级 ts。
2. **[实施] 数据导入(原功能 3)** — 设置页导入备份 JSON,校验 meals/workouts/weights/settings 字段;**合并模式复用同步的 mergeDb**,覆盖模式整库替换(保留本地 syncToken/gistId);导入前让用户选合并/覆盖(sheet 内两个按钮,默认合并)。
3. **[实施] 常用项快捷添加(原功能 2)** — 记一餐/加动作 sheet 顶部加「常用」chips:按最近使用去重取 5–8 个 meal.name / workout.name,点选回填全套表单(kcal/protein 或 cat/sets/duration)。新样式 `.chips/.chip` 横滚胶囊。
4. **[实施] 动作历史/PR(原功能 4)** — 训练条目行尾加 📈 小按钮(**点行主体=编辑,已占用**),打开 `#sheet-history`:该动作名跨日期的重量走势(复用 `lineChart()`;徒手看总次数、有氧看时长),显示 PR 和最近几次明细。无 db 变更。
5. **[实施] 体重目标(原功能 5)** — settings 加 `targetWeight`;stats 体重卡片显示「距目标还差 x.x kg」,达标显示庆祝文案。与同步方案的 settings.ts 机制兼容(保存设置刷新 ts 即可)。

每项完成后:`node --check app.js`、bump SW CACHE、让用户验证后再做下一项。

## 未来展望(未排期,按价值/成本粗排)

1. **Cloudflare Worker 统一后端**(条件触发):CORS 已实测无问题,此项仅在 Gist 同步方案不满意、或想把 DeepSeek key 移出浏览器(存 Worker 环境变量更安全)时考虑。
2. **AI 周报/复盘**:每周用 DeepSeek 汇总 7 天饮食+训练+体重,生成一段中文点评(缺口达成率、蛋白摄入、训练频率建议)。数据都在本地,一次调用,成本可忽略。stats 页加卡片。
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
