#!/bin/bash
# 从云端 gist 拉当前数据,存 backups/qingheng-日期.json,保留最近 30 份。
# 首次使用:在项目根目录建 .backup-secrets(已 gitignore,勿提交),内容两行:
#   TOKEN=ghp_xxx        # 与 app 设置页同一个 token(仅 gist 权限)
#   GIST_ID=xxxxxxxx     # app 设置页显示的 Gist ID
# 每日自动:crontab -e 加一行
#   30 22 * * * /Users/ljh/Documents/qingheng/backup.sh >/dev/null 2>&1
set -e
cd "$(dirname "$0")"
CONF=".backup-secrets"
[ -f "$CONF" ] || { echo "缺 $CONF(TOKEN=... / GIST_ID=... 两行)"; exit 1; }
# shellcheck disable=SC1090
source "$CONF"
[ -n "$TOKEN" ] && [ -n "$GIST_ID" ] || { echo "$CONF 里 TOKEN/GIST_ID 不全"; exit 1; }
mkdir -p backups
out="backups/qingheng-$(date +%F).json"
curl -sf -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/gists/$GIST_ID" \
  | python3 -c "
import json, sys, urllib.request
d = json.load(sys.stdin)
f = d['files']['qingheng.json']
if f.get('truncated'):
    req = urllib.request.Request(f['raw_url'], headers={'Authorization': 'Bearer ' + '$TOKEN'})
    print(urllib.request.urlopen(req).read().decode())
else:
    print(f['content'])
" > "$out"
python3 -c "import json; d=json.load(open('$out')); print('OK:', len(d.get('meals',[])), 'meals,', len(d.get('workouts',[])), 'workouts ->', '$out')"
ls -t backups/qingheng-*.json 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
