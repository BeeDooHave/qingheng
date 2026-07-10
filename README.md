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
**改完代码不需要 git push**——服务直接读磁盘文件，bump `sw.js` 的 CACHE 版本后，手机上点设置页「强制刷新」即可拿到新版。
版本号要同步改三处：`sw.js` 的 `CACHE`、`index.html` 底部的「轻衡 vXX」标签、`index.html` 里的 `styles.css?v=XX` 和 `app.js?v=XX`。git push 仅作代码备份。

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
