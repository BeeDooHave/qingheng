# 轻衡 · 多设备同步 — 实施方案

> 交给实施 agent 的完整规格。目标:手机和电脑的记录互通。实施前先读项目根目录 PLAN-ai-nutrition.md 的「现有架构约定」一节,全部适用(IIFE、$()、sheet 模式、中文文案、无构建无依赖、**改完 bump sw.js 的 CACHE 版本**,当前 v3)。

## 0. 方案选型(已定)

**用私有 GitHub Gist 做云端存储。** 理由:项目本身在 GitHub(有 origin remote),零新增账号;Gist API 支持浏览器 CORS;免费、无服务器、单用户够用。

- 备选方案 B(本次不做):Cloudflare Worker + KV,好处是顺带能当 DeepSeek 的 CORS 代理,但要引入部署流程,除非用户提出再考虑。
- 同步模型:**合并式 last-write-wins**,不是实时同步。每台设备定期拉取云端 → 三向合并 → 推回。对"追加为主"的记账数据,冲突极少。

## 1. 前置:用户侧准备(写进 README 或设置页 hint)

1. GitHub → Settings → Developer settings → Fine-grained personal access token,权限**只勾 Gists: read/write**,其余全不选。
2. 把 token 粘贴到 app 设置页新增的「同步 Token」字段。首次同步时 app 自动创建私有 gist 并记住 gistId,**用户无需手动建 gist**。
3. 第二台设备:填同一个 token,再把第一台设备设置页显示的 gistId 粘进「Gist ID」字段(或留空点同步,提示去第一台设备复制)。

## 2. 数据结构变更

```js
defaults 增加:
  settings: { ..., syncToken: '', gistId: '' }
  tombstones: {}        // { <记录id>: <删除时间戳ms> },顶层新字段
  syncedAt: 0           // 上次成功同步时间戳,仅本地展示用
```

- 每条 meal / workout 新增 `ts` 字段(Date.now()):**新建和每次编辑时都刷新**。旧数据没有 `ts` 视为 0。
- weights 以 date 为 key,新增 `ts` 同理(保存体重时写入)。
- 删除逻辑改造:现有 `data-del` 处理里,除了从数组移除,还要 `db.tombstones[id] = Date.now()`。weights 无删除入口,不用管。
- tombstones 清理:合并时删掉 >90 天的条目。

## 3. 合并算法(核心,单独函数 `mergeDb(local, remote)`)

对 meals 和 workouts(同构,写一个通用函数):

```
1. 建 map:id → 记录,先放 remote 的,再放 local 的;
   两边都有同 id 时,取 ts 大的那条。
2. 合并双方 tombstones(取每个 id 较大的时间戳)。
3. 从 map 中删除所有 tombstoned 的 id,且其 ts <= 墓碑时间
   (即"删除后又编辑/重建"的记录以较新者为准;简单起见:
    若记录 ts > 墓碑 ts 则保留记录并移除该墓碑,否则删记录)。
4. 输出数组按 date 排序(次序不影响现有渲染,保持稳定即可)。
```

- weights:按 date 合并,同 date 取 `ts` 大的。
- settings:整体取"较新的一方"——为此 settings 里加 `ts`(保存设置时写入);但 `syncToken/gistId` **始终保留本地值**(不同设备可能 token 相同但避免远端覆盖本地刚填的配置)。
- 合并函数必须是纯函数,方便测试;**功能 3(数据导入)的"合并"模式应复用同一个 mergeDb**。

## 4. Gist API(浏览器 fetch,全部带 `Authorization: Bearer <token>`、`Accept: application/vnd.github+json`)

- 创建(首次,gistId 为空时):
  `POST https://api.github.com/gists`
  body: `{"description":"qingheng-sync","public":false,"files":{"qingheng.json":{"content":"<JSON字符串>"}}}`
  → 存返回的 `id` 到 `db.settings.gistId`。
- 拉取:`GET https://api.github.com/gists/{gistId}` → `files["qingheng.json"].content`(注意:大文件 content 可能 `truncated: true`,此时用 `files["qingheng.json"].raw_url` 再 GET 一次;个人数据量短期内不会触发,但要处理)。
- 推送:`PATCH https://api.github.com/gists/{gistId}`,body 同创建的 files 部分。
- 错误映射:401/403 → 「Token 无效或权限不足」;404 → 「Gist 不存在,检查 Gist ID」;网络错误 → 「同步失败,检查网络」。60s 超时(AbortController)。

## 5. 同步流程 `async function syncNow(silent)`

```
1. 守卫:无 token → return(非 silent 时 toast 引导);离线 → return;
   已在同步中(模块级 flag)→ return。
2. 无 gistId:直接创建 gist(内容=当前 db 去掉 syncedAt),保存 gistId,完成。
3. 有 gistId:GET 远端 → JSON.parse(失败则 toast「云端数据损坏」并中止,不覆盖)
   → merged = mergeDb(db, remote)
   → PATCH 推回 merged → db = merged(保留本地 syncToken/gistId)
   → db.syncedAt = Date.now(); save(); renderAll();
4. 非 silent 时 toast「已同步」/错误信息;设置页刷新「上次同步」显示。
```

触发时机:
- app 启动时(init 处)`syncNow(true)`,静默;
- 每次 `save()` 后 **debounce 30 秒** 触发 `syncNow(true)`(注意:syncNow 内部成功后又调 save(),必须避免循环——加参数或 flag 跳过 debounce 调度);
- 设置 sheet 加「立即同步」按钮,手动 `syncNow(false)`。

## 6. UI 变更(全部在 `#sheet-settings`)

- 「同步 Token」:`<input id="set-synctoken" type="password" placeholder="GitHub token(仅 gist 权限)">`
- 「Gist ID」:`<input id="set-gistid" type="text" placeholder="首次同步自动生成">`
- 按钮「☁️ 立即同步」 + 状态行:`上次同步:x 分钟前 / 从未同步`(相对时间,粗粒度即可)。
- `fillSettings` / `save-settings` 接上这两个字段(trim)。
- hint 文案说明:token 只需 gist 权限;第二台设备填同一 token + 同一 Gist ID。

## 7. 边界与风险

- **并发写覆盖**:两台设备同时在 30s 窗口内推送,后推的会覆盖先推的云端版本——但因为推送前都先拉取合并,丢数据窗口极小,个人应用可接受。不做 etag/版本号乐观锁(想加的话:比对 gist 的 `updated_at`,冲突就重拉重合并一次)。
- **安全**:token 存 localStorage 且会进导出备份,设置页 hint 里明示;建议 fine-grained token 只授 gist 权限,泄露影响可控。
- **首次双端各有数据**:合并算法天然处理(并集),无需特殊迁移。
- **备份导出**(现有 #export-data)导出的是整个 db,含 tombstones/syncedAt,导入(功能 3)时这些字段也要按 mergeDb 规则处理。
- 不做:实时推送、多于 2 台设备的特殊处理(算法本身支持 N 台)、历史版本回滚(gist 自带 revision 历史,算免费彩蛋,README 提一句即可)。

## 8. 验收清单

1. 设备 A 填 token → 立即同步 → 自动创建私有 gist,显示 gistId 和「已同步」。
2. 设备 B(可用同机第二个浏览器模拟)填 token+gistId → 同步 → A 的数据全部出现。
3. A 加一条 meal、B 加一条 workout → 各自同步 → 双方都有两条,无重复。
4. A 删除一条 meal → 双方同步后,B 上该条也消失(墓碑生效),且不会在下次同步"复活"。
5. A、B 编辑同一条记录 → 同步后保留 ts 较新的版本。
6. 错误路径:错 token / 错 gistId / 离线 → 对应 toast,本地数据不受损。
7. 不填 token 时,app 一切行为与之前完全一致(零回归)。
8. `node --check app.js` 通过;sw.js CACHE 已 bump。

## 9. 与待办功能的关系

- 功能 3(数据导入)尚未实施:实施顺序建议先做本同步方案,导入功能直接复用 `mergeDb`。
- 功能 2/4/5 与本方案无交集,注意都会改 settings sheet 的只有功能 5(目标体重字段),字段并存即可。
