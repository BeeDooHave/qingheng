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
版本号要同步改三处感知点：`sw.js` 的 `CACHE`、`index.html` 底部的「轻衡 vXX」标签。git push 仅作代码备份。

## 部署到 GitHub Pages
1. 仓库 Settings → Pages → Source 选择 `main` 分支 `/ (root)`
2. 访问 `https://<用户名>.github.io/<仓库名>/`
