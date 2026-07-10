#!/bin/bash
# 一键 bump 版本号:sw.js 的 CACHE + index.html 的版本标签和两个 ?v= 参数
set -e
cd "$(dirname "$0")"
cur=$(grep -o 'qingheng-v[0-9]*' sw.js | head -1 | tr -dc '0-9')
[ -z "$cur" ] && { echo "找不到当前版本号"; exit 1; }
next=$((cur + 1))
perl -pi -e "s/qingheng-v$cur/qingheng-v$next/" sw.js
perl -pi -e "s/轻衡 v$cur/轻衡 v$next/; s/styles\.css\?v=$cur/styles.css?v=$next/; s/app\.js\?v=$cur/app.js?v=$next/" index.html
echo "v$cur → v$next"
grep -o 'qingheng-v[0-9]*' sw.js | head -1
grep -o 'v=[0-9]*' index.html | sort -u
