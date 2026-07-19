# 轻衡 (Qingheng)

个人健身 PWA —— 记录减脂餐与训练，看清每天的能量收支。

## 功能
- 饮食记录（早/午/晚/加餐分组，热量与蛋白质追踪，AI 营养估算，常用餐/常用动作一键带入）
- 训练记录（力量 / 有氧 / 徒手，支持多组；组间休息计时器；训练模板一键套用；动作历史与 PR 走势）
- 数据可视化（体重曲线 + 目标差距与达标日预测、7 天摄入/消耗对比、周缺口统计、自校准 TDEE、AI 周报）
- 数据导出（JSON 备份 + 餐/动作/体重 CSV）
- 离线可用（Service Worker 缓存 app shell）
- 可安装到手机主屏幕（PWA）

## 使用
直接打开 `index.html`，或部署到任意静态托管（GitHub Pages / Netlify / Vercel）即可使用。

## 公网部署(Cloudflare Pages)——解决「Mac 一睡/出门就用不了」

局域网 http 有两个死穴:依赖 Mac 开机在线,且 **http 下 Service Worker 不注册**(SW 要求 HTTPS/localhost),手机上从来没有真正离线过。公网部署一次性解决:

1. Mac 上 `git add -A && git commit -m "vXX" && git push`(部署起点就是 push,以后 push 即发布)
2. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Pages → Connect to Git → 选 `qingheng` 仓库;Build command 留空、Output directory `/`(纯静态无构建)→ Deploy,得到 `https://<项目名>.pages.dev`
3. 手机迁移(**换域名 localStorage 不跟随**,数据靠 gist 拉回):
   a. 旧地址设置页确认「同步状态」是最新(保险起见再导出一份 JSON)
   b. 手机开新域名 → 添加到主屏幕(HTTPS → SW 生效,离线可用)
   c. 设置页填 DeepSeek Key、同步 Token、Gist ID → 立即同步 → 数据全部回来
4. 日常:改完代码照旧流程,最后 `git push` 替代「手机强刷」(Pages 自动部署约 1 分钟;手机端 SW 是 network-first,打开即最新)
5. `_headers` 已配 CSP/nosniff 等(改外部 API 域名时记得同步改 connect-src)

本地 `python3 -m http.server 5173` 保留作开发预览;test.html 流程不变。

## 当前实际部署方式（本地局域网，非 GitHub Pages）
在 Mac 上于项目根目录运行：

```
python3 -m http.server 5173 --bind 0.0.0.0
```

同一 Wi-Fi 下手机访问 `http://192.168.0.113:5173/`（Mac 的局域网 IP，路由器重新分配后需更新）。
**改完代码不需要 git push**——服务直接读磁盘文件，手机上点设置页「强制刷新」即可拿到新版。git push 仅作代码备份。

改完代码的固定流程：

1. `node --check app.js`
2. 桌面浏览器打开 `http://localhost:5173/test.html`——35 条冒烟断言全绿再继续（页面渲染、弹层开关、营养进度交互、body 滚动锁、纯函数逻辑、无未捕获错误、数据无丢失；全程只读不碰真实记录）
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
| `fonts/qh-latin-*.woff2` | [Space Grotesk](https://github.com/floriankarsten/space-grotesk)(经 @fontsource 5.2.10) | 2.x | OFL | 展示字体,pyftsubset 取 ASCII 全拉丁+`×·°±–—…`(约 7.5KB/字重),数字与英文单位统一显示 |

新增轮子的规矩:npm 拿包 → 单文件进 `vendor/` → 加进 `sw.js` ASSETS → 在此表登记。

## 部署到 GitHub Pages
1. 仓库 Settings → Pages → Source 选择 `main` 分支 `/ (root)`
2. 访问 `https://<用户名>.github.io/<仓库名>/`
