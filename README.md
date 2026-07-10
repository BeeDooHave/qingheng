# 轻衡 (Qingheng)

个人健身 PWA —— 记录减脂餐与训练，看清每天的能量收支。

## 功能
- 饮食记录（早/午/晚/加餐分组，热量与蛋白质追踪）
- 训练记录（力量 / 有氧 / 徒手，支持多组）
- 数据可视化（体重曲线、7 天摄入/消耗对比、周缺口统计）
- 离线可用（Service Worker 缓存 app shell）
- 可安装到手机主屏幕（PWA）

## 使用
直接打开 `index.html`，或部署到任意静态托管（GitHub Pages / Netlify / Vercel）即可使用。

## 当前实际部署方式（本地局域网，非 GitHub Pages）
在 Mac 上于项目根目录运行：

```
python3 -m http.server 5173 --bind 0.0.0.0
```

同一 Wi-Fi 下手机访问 `http://192.168.0.113:5173/`（Mac 的局域网 IP，路由器重新分配后需更新）。
**改完代码不需要 git push**——服务直接读磁盘文件，手机上点设置页「强制刷新」即可拿到新版。git push 仅作代码备份。

改完代码的固定流程：

1. `node --check app.js`
2. 桌面浏览器打开 `http://localhost:5173/test.html`——25 条冒烟断言全绿再继续（页面渲染、弹层开关、营养进度交互、body 滚动锁、无未捕获错误、数据无丢失；全程只读不碰真实记录）
3. `./bump.sh`——一条命令改齐 4 处版本号（sw.js CACHE、「轻衡 vXX」标签、styles/app 的 `?v=`）
4. 手机「强制刷新」验收

## 备份策略(三层)

1. **云端 Gist(实时)**:app 内配置同步后每次改动 30 秒内推云端;gist 自带修订历史,在 `gist.github.com/<GIST_ID>/revisions` 可翻任意历史版本,误删可从旧版本复制 JSON 用「导入数据备份 → 覆盖导入」恢复。
2. **Mac 每日快照(独立副本)**:`./backup.sh` 从 gist 拉数据存 `backups/qingheng-日期.json`,保留 30 份。首次使用建 `.backup-secrets`(两行 `TOKEN=` / `GIST_ID=`,已 gitignore 千万别提交,GitHub 扫到会自动吊销 token);自动化:`crontab -e` 加 `30 22 * * * /Users/ljh/Documents/qingheng/backup.sh >/dev/null 2>&1`。
3. **手动导出(异地/换机)**:设置页「导出数据备份」,下方会显示上次导出时间,超 30 天变红提醒。

恢复统一走设置页「导入数据备份」:合并导入(常规)或覆盖导入(整库回滚,会直推云端)。

## 第三方轮子(全部自托管,禁止 CDN 引用)

| 文件 | 来源 | 版本 | License | 用途 |
|---|---|---|---|---|
| `vendor/confetti.min.js` | [canvas-confetti](https://github.com/catdad/canvas-confetti) | 1.9.x | ISC | 达标庆祝彩带(`celebrate()`) |
| `vendor/body-highlighter.esm.js` | [body-highlighter](https://github.com/lahaxearnaud/body-highlighter) | 3.0.2 | MIT | 训练部位人体热力图(`renderMuscleMap()`,经 `<script type="module">` 挂到 `window.BodyHighlighter`) |
| `fonts/qh-num-*.woff2` | [Space Grotesk](https://github.com/floriankarsten/space-grotesk)(经 @fontsource) | 2.x | OFL | 大数字展示字体,pyftsubset 只保留 `0-9.,/%+-:kcalgmin` 字符 |

新增轮子的规矩:npm 拿包 → 单文件进 `vendor/` → 加进 `sw.js` ASSETS → 在此表登记。

## 部署到 GitHub Pages
1. 仓库 Settings → Pages → Source 选择 `main` 分支 `/ (root)`
2. 访问 `https://<用户名>.github.io/<仓库名>/`
