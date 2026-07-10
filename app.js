/* ================= 轻衡 · app logic ================= */
(function () {
  'use strict';

  /* ---------- storage ---------- */
  const KEY = 'qingheng.v1';
  const defaults = {
    meals: [],      // {id,date,type,name,kcal,protein,ts}
    workouts: [],   // {id,date,cat,name,sets:[{w,reps}],duration,distance,burn,ts}
    weights: [],    // {date,kg,ts}
    settings: { name: '', target: 1600, bmr: 1400, dsKey: '', syncToken: '', gistId: '', ts: 0 },
    tombstones: {}, // { <记录id>: <删除时间戳ms> }
    syncedAt: 0      // 上次成功同步时间戳,仅本地展示
  };
  let db;
  try {
    db = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}'));
    db.settings = Object.assign({}, defaults.settings, db.settings || {});
    db.tombstones = Object.assign({}, db.tombstones || {});
    db.syncedAt = db.syncedAt || 0;
  } catch (e) { db = JSON.parse(JSON.stringify(defaults)); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('保存失败,存储空间可能已满'); }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- debug log (persisted, for cross-device troubleshooting) ---------- */
  const LOGKEY = 'qingheng.log';
  let logs = [];
  try { logs = JSON.parse(localStorage.getItem(LOGKEY) || '[]'); } catch (e) { logs = []; }
  function dlog(tag, msg) {
    logs.push({ t: Date.now(), tag: String(tag), msg: String(msg) });
    if (logs.length > 60) logs = logs.slice(-60);
    try { localStorage.setItem(LOGKEY, JSON.stringify(logs)); } catch (e) {}
  }

  /* ---------- date helpers ---------- */
  function key(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const todayKey = key(new Date());
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function labelForKey(k) {
    if (k === todayKey) return '今天';
    const d = fromKey(k);
    const y = key(new Date(Date.now() - 86400000));
    if (k === y) return '昨天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function shiftKey(k, dir) {
    const d = fromKey(k); d.setDate(d.getDate() + dir); return key(d);
  }

  /* ---------- selected dates per screen ---------- */
  const sel = { today: todayKey, diet: todayKey, training: todayKey };

  /* ---------- calculations ---------- */
  const mealsOn = k => db.meals.filter(m => m.date === k);
  const workoutsOn = k => db.workouts.filter(w => w.date === k);
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

  function intakeOn(k) { return sum(mealsOn(k), m => m.kcal); }
  function proteinOn(k) { return sum(mealsOn(k), m => m.protein); }

  function volumeOn(k) {
    return sum(workoutsOn(k), w => (w.sets || []).reduce((a, s) => a + (Number(s.w) || 0) * (Number(s.reps) || 0), 0));
  }
  function trainingBurnOn(k) {
    return workoutsOn(k).reduce((a, w) => {
      if (w.burn) return a + Number(w.burn); // 手填或 AI 估算,任何类别都优先用
      if (w.cat === '有氧') return a + Math.round((Number(w.duration) || 0) * 8);
      return a + (w.sets || []).length * 6; // 兜底粗估:每组 6 kcal
    }, 0);
  }
  function outputOn(k) { return (Number(db.settings.bmr) || 0) + trainingBurnOn(k); }
  function deficitOn(k) { return outputOn(k) - intakeOn(k); }

  /* ---------- DOM ---------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------- navigation ---------- */
  function goto(name) {
    if (name === 'today') sel.today = todayKey; // tapping the 今天 tab always returns to today
    $$('.screen').forEach(s => s.hidden = s.dataset.screen !== name);
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.goto === name));
    window.scrollTo(0, 0);
    render(name);
  }

  /* ---------- render dispatch ---------- */
  function renderAll() { renderToday(); renderDiet(); renderTraining(); renderStats(); }
  function render(name) {
    if (name === 'today') renderToday();
    else if (name === 'diet') renderDiet();
    else if (name === 'training') renderTraining();
    else if (name === 'stats') renderStats();
  }

  /* ---------- TODAY ---------- */
  function renderToday() {
    const k = sel.today;
    const isToday = k === todayKey;
    const dd = fromKey(k);
    $('#today-date').textContent = `${dd.getMonth() + 1}月${dd.getDate()}日 · 周${WD[dd.getDay()]}`;
    if (isToday) {
      const hr = new Date().getHours();
      const hello = hr < 5 ? '夜深了' : hr < 11 ? '早上好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
      $('#greeting').textContent = db.settings.name ? `${hello},${db.settings.name}` : hello;
    } else {
      $('#greeting').textContent = labelForKey(k);
    }

    const inK = intakeOn(k), outK = outputOn(k), net = outK - inK;
    $('#sum-in').textContent = inK;
    $('#sum-out').textContent = outK;
    $('#net-deficit').textContent = net;
    $('#net-deficit').style.color = net >= 0 ? 'var(--ink)' : 'var(--coral-ink)';

    // ring: budget = outK. teal = eaten portion, coral = deficit portion
    const C = 2 * Math.PI * 86;
    const budget = Math.max(outK, 1);
    const eatenFrac = Math.min(inK / budget, 1);
    const deficitFrac = Math.max((outK - inK) / budget, 0);
    const eatenLen = eatenFrac * C;
    const deficitLen = deficitFrac * C;
    const rin = $('#ring-in'), rout = $('#ring-out');
    rin.style.strokeDasharray = `${eatenLen} ${C}`;
    rin.style.strokeDashoffset = '0';
    rout.style.strokeDasharray = `${deficitLen} ${C}`;
    rout.style.strokeDashoffset = `${-eatenLen}`;

    // meals / workouts for the selected day (read-only compact)
    const meals = mealsOn(k);
    $('#today-meals').innerHTML = meals.length
      ? meals.map(m => rowMeal(m, false)).join('')
      : `<div class="empty">${isToday ? '还没记今天的餐 🥗' : '这天没有饮食记录'}</div>`;
    const wos = workoutsOn(k);
    $('#today-workouts').innerHTML = wos.length
      ? wos.map(w => rowWorkout(w, false)).join('')
      : `<div class="empty">${isToday ? '还没记今天的训练 💪' : '这天没有训练记录'}</div>`;
    renderNutritionProgress();
  }

  /* ---------- daily nutrition targets + today's progress ---------- */
  // 目标:三大营养素据热量目标/体重推算;微量元素统一用男性 RDA;
  // 植物化合物用软参考目标(标注 AI 粗估)。AI 估算的 micros 用固定数字 key(见 AI_PROMPT)。
  const MICROS = [
    { k: 'vitC', n: '维生素 C', en: 'Vitamin C', u: 'mg', t: 90, src: '彩椒·猕猴桃·柑橘·西兰花', grp: 'vit' },
    { k: 'vitE', n: '维生素 E', en: 'Vitamin E', u: 'mg', t: 15, src: '杏仁·葵花籽·植物油·菠菜', grp: 'vit' },
    { k: 'vitA', n: '维生素 A', en: 'Vitamin A', u: 'µg', t: 900, src: '动物肝·蛋黄·深色蔬果', grp: 'vit' },
    { k: 'se', n: '硒', en: 'Selenium', u: 'µg', t: 55, src: '巴西坚果·海鲜·蛋', grp: 'min' },
    { k: 'zn', n: '锌', en: 'Zinc', u: 'mg', t: 11, src: '牡蛎·红肉·南瓜籽·豆类', grp: 'min' },
    { k: 'cu', n: '铜', en: 'Copper', u: 'mg', t: 0.9, src: '动物肝·贝类·坚果·可可', grp: 'min' },
    { k: 'mn', n: '锰', en: 'Manganese', u: 'mg', t: 2.3, src: '全谷·坚果·茶·绿叶菜', grp: 'min' },
    { k: 'ca', n: '钙', en: 'Calcium', u: 'mg', t: 1000, src: '奶·豆腐·绿叶菜·芝麻', grp: 'min' },
    { k: 'fe', n: '铁', en: 'Iron', u: 'mg', t: 8, src: '红肉·动物肝·豆类·绿叶菜', grp: 'min' },
    { k: 'k', n: '钾', en: 'Potassium', u: 'mg', t: 3400, src: '香蕉·土豆·豆类·菠菜', grp: 'min' },
    { k: 'anthocyanin', n: '花青素', en: 'Anthocyanins', u: 'mg', t: 100, src: '蓝莓·黑莓·黑枸杞·紫甘蓝·紫薯', grp: 'phyto', soft: true, star: true },
    { k: 'lycopene', n: '番茄红素', en: 'Lycopene', u: 'mg', t: 10, src: '熟番茄·番茄酱·西瓜·粉红葡萄柚', grp: 'phyto', soft: true },
    { k: 'lutein', n: '叶黄素', en: 'Lutein/Zeaxanthin', u: 'mg', t: 10, src: '羽衣甘蓝·菠菜·蛋黄·玉米·枸杞', grp: 'phyto', soft: true },
    { k: 'betacarotene', n: 'β-胡萝卜素', en: 'β-Carotene', u: 'mg', t: 6, src: '胡萝卜·南瓜·红薯·深绿叶菜', grp: 'phyto', soft: true }
  ];
  function latestWeight() {
    const ws = (db.weights || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);
    return ws.length ? Number(ws[0].kg) || 0 : 0;
  }
  function macroTargets() {
    const kcal = Number(db.settings.target) || 1600;
    const w = latestWeight();
    const proteinG = w > 0 ? Math.round(1.6 * w) : Math.round(kcal * 0.30 / 4);
    const fatG = Math.round(kcal * 0.25 / 9);
    const carbsG = Math.round(Math.max(kcal - proteinG * 4 - fatG * 9, 0) / 4);
    return [
      { k: 'protein', n: '蛋白质', en: 'Protein', u: 'g', t: proteinG, src: '肉·蛋·奶·豆·鱼虾' },
      { k: 'fat', n: '脂肪', en: 'Fat', u: 'g', t: fatG, src: '油·坚果·蛋黄·肥肉' },
      { k: 'carbs', n: '碳水', en: 'Carbs', u: 'g', t: carbsG, src: '米面·薯类·水果·豆类' }
    ];
  }
  // 旧格式 micros 用中文字符串 key(如 "维生素C":"60 mg"),映射到新数字 key 做兼容
  const OLD_MICRO_ALIAS = { ca: '钙', fe: '铁', zn: '锌', k: '钾', vitC: '维生素C', vitA: '维生素A' };
  // 汇总某天所有餐:宏量(含手动餐蛋白)+ 微量(AI 估算过的餐;旧格式做兼容解析)
  function nutritionOn(dk) {
    const acc = { protein: 0, fat: 0, carbs: 0 };
    MICROS.forEach(m => acc[m.k] = 0);
    mealsOn(dk).forEach(meal => {
      const nu = meal.nutrients, t = (nu && nu.total) || null;
      acc.protein += (t && t.protein != null) ? Number(t.protein) || 0 : Number(meal.protein) || 0;
      if (t) { acc.fat += Number(t.fat) || 0; acc.carbs += Number(t.carbs) || 0; }
      const mi = (nu && nu.micros) || {};
      MICROS.forEach(m => {
        let v = mi[m.k];
        if ((v == null || v === '') && OLD_MICRO_ALIAS[m.k] != null && mi[OLD_MICRO_ALIAS[m.k]] != null) {
          v = parseFloat(String(mi[OLD_MICRO_ALIAS[m.k]]));  // parse "60 mg" -> 60
        }
        acc[m.k] += Number(v) || 0;
      });
    });
    return acc;
  }

  // 近 7 天滚动平均(只算有饮食记录的天,避免没记的日子稀释平均值)
  function nutritionAvg7(dk) {
    const acc = {}; let n = 0;
    for (let i = 0; i < 7; i++) {
      const day = shiftKey(dk, -i);
      if (!mealsOn(day).length) continue;
      n++;
      const g = nutritionOn(day);
      Object.keys(g).forEach(k => acc[k] = (acc[k] || 0) + g[k]);
    }
    if (n) Object.keys(acc).forEach(k => acc[k] /= n);
    return { got: acc, days: n };
  }

  const fmtN = v => { const n = Number(v) || 0; return n >= 100 ? Math.round(n) : n % 1 ? Math.round(n * 10) / 10 : n; };
  function progRow(item, got) {
    const tgt = Number(item.t) || 0;
    const pct = tgt > 0 ? Math.round(got / tgt * 100) : 0;
    const over = pct >= 100;
    return `<div class="mg-item${item.star ? ' star' : ''}" data-nutrient="${esc(item.k)}" data-unit="${esc(item.u)}">
      <div class="mg-row1"><span class="mg-n">${esc(item.n)} <span class="mg-en">${esc(item.en)}</span>${item.soft ? '<span class="mg-tag">AI粗估</span>' : ''}</span>
        <span class="mg-amt${over ? ' done' : ''}">${fmtN(got)} / ${fmtN(tgt)} ${esc(item.u)}<b>${pct}%</b></span></div>
      <div class="mg-bar"><div class="mg-fill${over ? ' over' : ''}" style="width:${Math.min(pct, 100)}%"></div></div>
      <p class="mg-src">来源:${esc(item.src)}${item.soft ? ' · 软参考目标' : ''}</p>
      <div class="mg-detail" hidden></div>
    </div>`;
  }
  function mealMicro(m, key) {
    const mi = m.nutrients && m.nutrients.micros; if (!mi) return 0;
    let v = mi[key];
    if ((v == null || v === '') && OLD_MICRO_ALIAS[key] != null && mi[OLD_MICRO_ALIAS[key]] != null) v = parseFloat(String(mi[OLD_MICRO_ALIAS[key]]));
    return Number(v) || 0;
  }
  function macroFromMeal(m, key) {
    const t = m.nutrients && m.nutrients.total;
    if (t && t[key] != null) return Number(t[key]) || 0;
    return key === 'protein' ? Number(m.protein) || 0 : 0;
  }
  // 某营养素当天的来源明细:优先按「每样食物」拆(item 级 micros),
  // 无 item 级数据时回退到按「整餐」拆。
  function nutrientBreakdown(dk, key) {
    const isMacro = key === 'protein' || key === 'fat' || key === 'carbs';
    const out = [];
    mealsOn(dk).forEach(m => {
      const nu = m.nutrients;
      const items = nu && Array.isArray(nu.items) ? nu.items : null;
      let usedItems = false;
      if (items && items.length) {
        items.forEach(it => {
          let v = 0;
          if (isMacro) v = Number(it[key]) || 0;
          else if (it.micros && it.micros[key] != null) { v = Number(it.micros[key]) || 0; usedItems = true; }
          if (v > 0) out.push({ name: it.name || '?', v });
        });
        if (isMacro) usedItems = true;
      }
      if (!usedItems) {
        const v = isMacro ? macroFromMeal(m, key) : mealMicro(m, key);
        if (v > 0) out.push({ name: m.name || m.type, v });
      }
    });
    return out.sort((a, b) => b.v - a.v);
  }
  let mgMode = 'day'; // 'day' 当日 | 'avg7' 近7天平均
  const mgGrpOpen = { 0: true }; // 组折叠状态:默认只展开三大营养素

  /* ---------- 六系统点亮(趣味参考) ---------- */
  const SYS_ICONS = {
    eye: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    bone: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 10c.7-.7 1.69-1 2.5-.5a2.5 2.5 0 1 0-3-3c.5.81.2 1.8-.5 2.5l-9 9c-.7.7-1.69 1-2.5.5a2.5 2.5 0 1 0 3 3c-.5-.81-.2-1.8.5-2.5Z"/></svg>',
    drop: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s6 6.5 6 11a6 6 0 0 1-12 0C6 8.5 12 2 12 2z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    muscle: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11"/><path d="M21 21l-1.5-1.5"/><path d="M3 3l1.5 1.5"/><path d="M18 22l4-4"/><path d="M2 6l4-4"/><path d="M3 10l7-7"/><path d="M14 21l7-7"/></svg>'
  };
  const SYSTEMS = [
    { n: '眼', icon: 'eye', nut: ['lutein', 'vitA'] },
    { n: '骨', icon: 'bone', nut: ['ca'] },
    { n: '血', icon: 'drop', nut: ['fe'] },
    { n: '免疫', icon: 'shield', nut: ['vitC', 'zn'] },
    { n: '皮肤', icon: 'spark', nut: ['vitE', 'anthocyanin'] },
    { n: '肌肉', icon: 'muscle', nut: ['protein'] }
  ];
  function sysPct(got, key) {
    if (key === 'protein') { const t = macroTargets()[0].t; return t ? (got.protein || 0) / t : 0; }
    const m = MICROS.find(x => x.k === key);
    return m && m.t ? (got[key] || 0) / m.t : 0;
  }
  let sysTipOpen = false;
  function sysAvg(got, s) {
    return s.nut.reduce((a, k) => a + Math.min(sysPct(got, k), 1.5), 0) / s.nut.length;
  }
  // 没点亮的系统 → 汇总其欠缺营养素的来源食物,一物多补的排前面
  function sysTipsHtml(got) {
    const unlit = SYSTEMS.filter(s => sysAvg(got, s) < 0.7);
    if (!unlit.length) return '';
    const foodMap = {}; // 食物 -> 覆盖的系统名
    unlit.forEach(s => s.nut.forEach(k => {
      if (sysPct(got, k) >= 1) return; // 该营养素本身已够
      const src = k === 'protein' ? '肉·蛋·奶·豆·鱼虾' : (MICROS.find(x => x.k === k) || {}).src || '';
      src.split('·').forEach(f => {
        f = f.trim(); if (!f) return;
        if (!foodMap[f]) foodMap[f] = [];
        if (foodMap[f].indexOf(s.n) < 0) foodMap[f].push(s.n);
      });
    }));
    const ranked = Object.keys(foodMap)
      .sort((a, b) => foodMap[b].length - foodMap[a].length)
      .slice(0, 5);
    const btn = `<button class="sys-tip-btn" data-systips>补什么 ${sysTipOpen ? '▾' : '▸'}</button>`;
    const box = sysTipOpen
      ? `<div class="sys-tips">还差 <b>${unlit.map(s => s.n).join('、')}</b>,顺手吃点:${ranked.map(f =>
          `<span class="sys-food">${esc(f)}<small>${foodMap[f].join('+')}</small></span>`).join('')}</div>`
      : '';
    return { btn, box };
  }
  function sysRowHtml(got) {
    const items = SYSTEMS.map((s, si) => {
      return `<button class="sys-it${sysAvg(got, s) >= 0.7 ? ' lit' : ''}" data-sys="${si}">${SYS_ICONS[s.icon]}<span>${s.n}</span></button>`;
    }).join('');
    const tips = sysTipsHtml(got) || { btn: '', box: '' };
    return `<div class="sys-row">${items}</div>
      <div class="sys-note">吃够对应营养素就点亮 · 趣味参考${tips.btn}</div>${tips.box}`;
  }
  function progressHtml(dk) {
    const avg = mgMode === 'avg7' ? nutritionAvg7(dk) : null;
    const got = avg ? avg.got : nutritionOn(dk);
    const toggle = `<div class="mg-mode">
      <button data-mgmode="day"${mgMode === 'day' ? ' class="active"' : ''}>当日</button>
      <button data-mgmode="avg7"${mgMode === 'avg7' ? ' class="active"' : ''}>近7天</button>
      ${avg ? `<span class="mg-mode-note">${avg.days ? '有记录的 ' + avg.days + ' 天平均' : '近7天没有记录'}</span>` : ''}
    </div>`;
    const groups = [
      { title: '三大营养素', note: '目标据热量目标 / 最近体重推算', items: macroTargets() },
      { title: '抗氧化植物化合物', note: '软参考目标 · AI 粗估,仅看趋势', items: MICROS.filter(m => m.grp === 'phyto') },
      { title: '抗氧化维生素', note: '男性 RDA', items: MICROS.filter(m => m.grp === 'vit') },
      { title: '矿物质', note: '男性 RDA / AI', items: MICROS.filter(m => m.grp === 'min') }
    ];
    return toggle + sysRowHtml(got) + groups.map((g, gi) => {
      const doneN = g.items.filter(it => Number(it.t) > 0 && (got[it.k] || 0) >= Number(it.t)).length;
      const openG = !!mgGrpOpen[gi];
      return `<div class="mg-group">
        <button class="mg-ghead" data-mggrp="${gi}">
          <span class="mg-gtitle">${esc(g.title)}</span>
          <span class="mg-gsum${doneN === g.items.length ? ' done' : ''}">${doneN}/${g.items.length} 达标<i>${openG ? '▾' : '▸'}</i></span>
        </button>
        ${openG ? `<p class="mg-gnote">${esc(g.note)}</p>` + g.items.map(it => progRow(it, got[it.k] || 0)).join('') : ''}
      </div>`;
    }).join('') +
      `<p class="mg-foot">点组名展开明细,点营养素看是哪几餐贡献的。进度只统计用 AI 估算过的餐(手动记的餐仅计蛋白/热量);旧餐想算进来:编辑它 → 再点一次「AI 估算」。目标参考 NIH DRI(统一男性值),植物化合物为软目标。仅供参考,非医疗建议。</p>`;
  }
  let mgOpen = true, mgOpenD = true;
  function renderNutritionProgress() {
    const box = $('#micro-guide'); if (!box) return;
    box.hidden = !mgOpen; box.innerHTML = progressHtml(sel.today);
  }
  function renderDietProgress() {
    const box = $('#diet-micro'); if (!box) return;
    box.hidden = !mgOpenD; box.innerHTML = progressHtml(sel.diet);
  }

  /* ---------- inline icons (lucide) & empty-state art ---------- */
  const I_TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  const I_X = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  function emptyArt(kind) {
    const sw = 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"';
    if (kind === 'diet') return `<svg class="empty-art" viewBox="0 0 120 84" width="108" height="76" aria-hidden="true">
      <circle cx="60" cy="46" r="28" fill="var(--teal-wash)"/>
      <path d="M34 46a26 22 0 0 0 52 0" fill="var(--card)" stroke="var(--teal-ink)" ${sw}/>
      <path d="M32 46h56" stroke="var(--teal-ink)" ${sw}/>
      <path d="M52 72h16" stroke="var(--teal-ink)" ${sw}/>
      <path d="M50 36c0-4 4-5 4-9M64 38c0-4 4-5 4-9" stroke="var(--teal)" ${sw}/>
      <path d="M90 20l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="var(--coral)" opacity=".75"/>
    </svg>`;
    if (kind === 'training') return `<svg class="empty-art" viewBox="0 0 120 84" width="108" height="76" aria-hidden="true">
      <circle cx="60" cy="44" r="28" fill="var(--coral-wash)"/>
      <path d="M44 44h32" stroke="var(--coral-ink)" ${sw}/>
      <rect x="34" y="32" width="9" height="24" rx="3.5" fill="var(--card)" stroke="var(--coral-ink)" stroke-width="2.2"/>
      <rect x="26" y="36" width="7" height="16" rx="3" fill="var(--card)" stroke="var(--coral-ink)" stroke-width="2.2"/>
      <rect x="77" y="32" width="9" height="24" rx="3.5" fill="var(--card)" stroke="var(--coral-ink)" stroke-width="2.2"/>
      <rect x="87" y="36" width="7" height="16" rx="3" fill="var(--card)" stroke="var(--coral-ink)" stroke-width="2.2"/>
      <path d="M30 18c6-4 13-6 20-7" stroke="var(--teal)" ${sw}/>
    </svg>`;
    return `<svg class="empty-art" viewBox="0 0 120 84" width="108" height="76" aria-hidden="true">
      <circle cx="60" cy="42" r="28" fill="var(--teal-wash)"/>
      <rect x="38" y="24" width="44" height="34" rx="9" fill="var(--card)" stroke="var(--teal-ink)" stroke-width="2.2"/>
      <path d="M51 40a9 9 0 0 1 18 0" stroke="var(--teal-ink)" ${sw}/>
      <path d="M60 40l6-7" stroke="var(--coral)" ${sw}/>
      <path d="M32 72c12 2 26-2 33-11" stroke="var(--teal)" ${sw}/>
      <path d="M66 60l8-2-3 8z" fill="var(--teal)"/>
    </svg>`;
  }

  /* ---------- celebration (canvas-confetti, self-hosted, optional) ---------- */
  function celebrate(big) {
    if (typeof confetti !== 'function') return;
    confetti({
      particleCount: big ? 130 : 60,
      spread: big ? 75 : 55,
      origin: { y: 0.72 },
      colors: ['#0fae9c', '#ff6a45', '#f3c53d', '#1a1d1a']
    });
  }

  /* ---------- row templates ---------- */
  function mealFoods(m) {
    const items = m.nutrients && Array.isArray(m.nutrients.items) ? m.nutrients.items : null;
    return items && items.length
      ? items.map(it => (it.name || '').trim()).filter(Boolean)
      : (m.name || '').split(/[、,，]/).map(p => splitNameAmount(p.trim()).name).filter(Boolean);
  }
  function rowMeal(m, del) {
    // 标题:前 3 个食物名;副标题:餐型(仅未分组的今天页)· n 样食物 · 蛋白
    const names = mealFoods(m);
    const title = names.length ? names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '') : (m.name || m.type);
    const bits = [];
    if (!del) bits.push(m.type); // 饮食页已按餐型分组,不重复
    if (names.length > 1) bits.push(names.length + ' 样食物');
    if (m.protein) bits.push('蛋白 ' + m.protein + 'g');
    return `<div class="row" data-edit="meal" data-id="${m.id}">
      <div class="r-icon i-teal">${mealEmoji(m.type)}</div>
      <div class="r-body"><p class="r-title">${esc(title)}</p>
        <p class="r-sub">${esc(bits.join(' · ') || m.type)}</p></div>
      <p class="r-val">${m.kcal || 0}<small>kcal</small></p>
      ${del ? `<button class="r-del" data-del="meal" data-id="${m.id}">${I_TRASH}</button>` : ''}
    </div>`;
  }
  function rowWorkout(w, del) {
    let sub, val;
    if (w.cat === '有氧') {
      sub = [w.duration ? w.duration + ' 分钟' : '', w.distance ? w.distance + ' km' : ''].filter(Boolean).join(' · ') || '有氧';
      val = `${w.burn || Math.round((Number(w.duration) || 0) * 8)}<small>kcal</small>`;
    } else {
      const sets = (w.sets || []);
      const best = sets.reduce((a, s) => Math.max(a, Number(s.w) || 0), 0);
      sub = `${sets.length} 组` + (w.cat === '力量' && best ? ` · 最重 ${best}kg` : '');
      const vol = sets.reduce((a, s) => a + (Number(s.w) || 0) * (Number(s.reps) || 0), 0);
      val = vol ? `${vol}<small>kg·量</small>` : `${sets.reduce((a, s) => a + (Number(s.reps) || 0), 0)}<small>次</small>`;
    }
    return `<div class="row" data-edit="workout" data-id="${w.id}">
      <div class="r-icon i-coral">${catEmoji(w.cat)}</div>
      <div class="r-body"><p class="r-title">${esc(w.name || w.cat)}</p><p class="r-sub">${w.cat} · ${sub}</p></div>
      <p class="r-val">${val}</p>
      ${del ? `<button class="r-del" data-del="workout" data-id="${w.id}">${I_TRASH}</button>` : ''}
    </div>`;
  }
  const mealEmoji = t => ({ '早餐': '🍳', '午餐': '🍚', '晚餐': '🥗', '加餐': '🍎' }[t] || '🍽️');
  const catEmoji = c => ({ '力量': '🏋️', '有氧': '🏃', '徒手': '🤸' }[c] || '💪');

  /* ---------- DIET ---------- */
  function renderDiet() {
    const k = sel.diet;
    $('#diet-date').textContent = labelForKey(k);
    const total = intakeOn(k), target = Number(db.settings.target) || 1600;
    $('#diet-total').textContent = total;
    $('#diet-target').textContent = target;
    $('#diet-protein').innerHTML = proteinOn(k) + '<span>g</span>';
    const remain = target - total;
    $('#diet-remain').textContent = remain >= 0 ? `还可摄入 ${remain} kcal` : `已超出 ${-remain} kcal`;
    const bar = $('#diet-bar');
    bar.style.width = Math.min(total / target * 100, 100) + '%';
    bar.classList.toggle('over', total > target);

    const meals = mealsOn(k);
    const order = ['早餐', '午餐', '晚餐', '加餐'];
    const groups = order.map(type => {
      const items = meals.filter(m => m.type === type);
      if (!items.length) return '';
      const sub = sum(items, m => m.kcal);
      return `<div><div class="mg-title">${type}<span>${sub} kcal</span></div>
        <div class="stack">${items.map(m => rowMeal(m, true)).join('')}</div></div>`;
    }).filter(Boolean).join('');
    $('#diet-list').innerHTML = groups || `<div class="empty">${emptyArt('diet')}这天还没有饮食记录<br>点下面「记一餐」开始</div>`;
    renderDietProgress();
  }

  /* ---------- TRAINING ---------- */
  function renderTraining() {
    const k = sel.training;
    $('#training-date').textContent = labelForKey(k);
    const wos = workoutsOn(k);
    $('#train-vol').textContent = volumeOn(k);
    $('#train-count').textContent = wos.length;
    $('#train-burn').textContent = trainingBurnOn(k);
    $('#training-list').innerHTML = wos.length
      ? wos.map(w => rowWorkout(w, true)).join('')
      : `<div class="empty">${emptyArt('training')}这天还没有训练记录<br>点下面「加动作」开始</div>`;
    renderMuscleMap(k);
  }

  /* ---------- STATS ---------- */
  function renderStats() {
    // weight chart
    const ws = db.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(-14);
    const wc = $('#weight-chart'), we = $('#weight-empty');
    if (ws.length < 1) {
      wc.innerHTML = ''; we.style.display = 'block';
      we.innerHTML = emptyArt('weight') + '还没有体重记录,点右上角记一次吧。';
      $('#weight-trend').textContent = '—';
    }
    else {
      we.style.display = 'none';
      wc.innerHTML = lineChart(ws.map(x => x.kg), ws.map(x => x.date));
      if (ws.length >= 2) {
        const diff = +(ws[ws.length - 1].kg - ws[0].kg).toFixed(1);
        const el = $('#weight-trend');
        el.textContent = (diff <= 0 ? '↓ ' : '↑ ') + Math.abs(diff) + ' kg';
        el.className = 'trend ' + (diff <= 0 ? 'down' : 'up');
      } else $('#weight-trend').textContent = '—';
    }

    // energy chart — last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(key(d)); }
    $('#energy-chart').innerHTML = energyChart(days);

    // week overview
    let deficit = 0, trained = 0, logged = 0;
    days.forEach(k => {
      const hasMeal = mealsOn(k).length, hasWo = workoutsOn(k).length;
      if (hasMeal) deficit += deficitOn(k);
      if (hasWo) trained++;
      if (hasMeal || hasWo) logged++;
    });
    $('#wk-deficit').textContent = deficit;
    $('#wk-trained').textContent = trained;
    $('#wk-logged').textContent = logged;
    renderReport();
  }

  /* ---------- SVG charts ---------- */
  function lineChart(vals, dates) {
    const W = 320, H = 130, pad = 22, padT = 14, padB = 22;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max - min) || 1;
    const n = vals.length;
    const x = i => n === 1 ? W / 2 : pad + i * (W - pad * 2) / (n - 1);
    const y = v => padT + (1 - (v - min) / range) * (H - padT - padB);
    const pts = vals.map((v, i) => [x(i), y(v)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${H - padB} L ${pts[0][0].toFixed(1)} ${H - padB} Z`;
    const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#0fae9c" stroke="#fff" stroke-width="2"/>`).join('');
    const lastLbl = `<text x="${pts[n - 1][0]}" y="${(pts[n - 1][1] - 9).toFixed(1)}" font-size="12" font-weight="700" fill="#0a6b60" text-anchor="middle">${vals[n - 1]}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0fae9c" stop-opacity=".18"/><stop offset="1" stop-color="#0fae9c" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#wg)"/>
      <path d="${line}" fill="none" stroke="#0fae9c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${lastLbl}</svg>`;
  }

  function energyChart(days) {
    // 没有任何记录的天不画柱(否则每天都有一根纯 BMR 的消耗柱,全是噪声)
    const logged = days.map(k => mealsOn(k).length > 0 || workoutsOn(k).length > 0);
    const ins = days.map((k, i) => logged[i] ? intakeOn(k) : 0);
    const outs = days.map((k, i) => logged[i] ? outputOn(k) : 0);
    const max = Math.max(...ins, ...outs, 1);
    const W = 320, H = 140, padB = 20, padT = 8;
    const bw = 9, gap = 3;
    const slot = (W) / days.length;
    let bars = '';
    days.forEach((k, i) => {
      const cx = i * slot + slot / 2;
      const base = H - padB;
      if (logged[i]) {
        const hi = ins[i] / max * (H - padB - padT);
        const ho = outs[i] / max * (H - padB - padT);
        bars += `<rect x="${cx - bw - gap / 2}" y="${(base - hi).toFixed(1)}" width="${bw}" height="${hi.toFixed(1)}" rx="3" fill="#0fae9c"/>`;
        bars += `<rect x="${cx + gap / 2}" y="${(base - ho).toFixed(1)}" width="${bw}" height="${ho.toFixed(1)}" rx="3" fill="#ff6a45"/>`;
      } else {
        bars += `<rect x="${cx - 8}" y="${base - 2}" width="16" height="2.5" rx="1.2" fill="#e2e0d8"/>`;
      }
      const wd = WD[fromKey(k).getDay()];
      bars += `<text x="${cx}" y="${H - 6}" font-size="11" fill="#8b8f88" text-anchor="middle" font-weight="600">${k === todayKey ? '今' : wd}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}">${bars}</svg>`;
  }

  /* ---------- sheets ---------- */
  let openSheet = null;
  let lockY = 0;
  function lockBody() {
    lockY = window.scrollY || 0;
    const b = document.body.style;
    b.position = 'fixed'; b.top = -lockY + 'px'; b.left = '0'; b.right = '0';
  }
  function unlockBody() {
    const b = document.body.style;
    b.position = ''; b.top = ''; b.left = ''; b.right = '';
    window.scrollTo(0, lockY);
  }
  function open(name) {
    closeSheet();
    if (name === 'settings') fillSettings();
    if (name === 'workout') resetWorkoutSheet();
    if (name === 'meal') resetMealSheet();
    if (name === 'weight') $('#weight-input').value = '';
    if (name === 'debug') { const o = $('#dbg-out'); if (o) o.value = diagText(); }
    const s = $('#sheet-' + name);
    s.hidden = false; s.scrollTop = 0; $('#backdrop').hidden = false;
    openSheet = name; lockBody();
    const first = s.querySelector('input'); if (first && name !== 'settings') setTimeout(() => first.focus(), 250);
  }
  function closeSheet() {
    if (!openSheet) { $('#backdrop').hidden = true; return; }
    $('#sheet-' + openSheet).hidden = true;
    $('#backdrop').hidden = true; openSheet = null;
    unlockBody();
  }

  /* ---------- drag-down to close (native bottom-sheet feel) ---------- */
  let sheetDragT = 0; // 最近一次拖拽结束时间,防止拖完又触发 grip 的 click
  (function () {
    let el = null, startY = 0, dy = 0, dragging = false, fromGrip = false;
    document.addEventListener('touchstart', e => {
      const s = e.target.closest('.sheet'); if (!s || !openSheet) return;
      el = s; startY = e.touches[0].clientY; dy = 0; dragging = false;
      fromGrip = !!e.target.closest('.sheet-grip');
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!el) return;
      const d = e.touches[0].clientY - startY;
      if (!dragging) {
        // 只在「从灰条拖」或「内容已滚到顶且往下拉」时接管;往上滑交还给内部滚动
        if (d > 6 && (fromGrip || el.scrollTop <= 0)) { dragging = true; el.style.transition = 'none'; }
        else if (d < -6) { el = null; return; }
        else return;
      }
      dy = Math.max(0, d);
      el.style.transform = 'translateY(' + dy + 'px)';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', () => {
      if (!el) return;
      const s = el; el = null;
      if (!dragging) return;
      dragging = false; sheetDragT = Date.now();
      s.style.transition = 'transform .22s cubic-bezier(.2,.9,.2,1)';
      if (dy > 90) {
        s.style.transform = 'translateY(105%)';
        setTimeout(() => { closeSheet(); s.style.transition = ''; s.style.transform = ''; }, 230);
      } else {
        s.style.transform = '';
        setTimeout(() => { s.style.transition = ''; }, 240);
      }
      dy = 0;
    });
  })();

  /* ---------- diagnostics (debug sheet) ---------- */
  function fmtT(ms) { try { return new Date(ms).toLocaleString(); } catch (e) { return '-'; } }
  function daySummary(dk) {
    const rows = mealsOn(dk).map(m => {
      const mi = (m.nutrients && m.nutrients.micros) || null;
      return `  · ${(m.name || '').slice(0, 16)} ts=${m.ts || 0} micros=[${mi ? Object.keys(mi).join(',') : '无'}]`;
    });
    return rows.length ? rows.join('\n') : '  (无记录)';
  }
  function diagText() {
    const s = db.settings || {};
    const got = nutritionOn(sel.today);
    const ver = ($('#app-version') || {}).textContent || '?';
    const swCtrl = ('serviceWorker' in navigator) ? (navigator.serviceWorker.controller ? '受控' : '无控制器') : '不支持';
    return [
      '== 轻衡诊断 ==',
      '版本: ' + ver + ' · ' + fmtT(Date.now()),
      '在线: ' + navigator.onLine + ' · SW: ' + swCtrl,
      '同步Token: ' + (s.syncToken ? '已填(' + s.syncToken.length + '位)' : '未填') + ' · GistID: ' + (s.gistId || '(空)'),
      '上次同步: ' + (db.syncedAt ? fmtT(db.syncedAt) : '从未'),
      '数据量: meals=' + (db.meals || []).length + ' workouts=' + (db.workouts || []).length + ' weights=' + (db.weights || []).length,
      '选中日(' + sel.today + ')加总: 蛋白=' + Math.round(got.protein) + ' 维C=' + Math.round(got.vitC) + ' 维A=' + Math.round(got.vitA) + ' β胡萝卜素=' + (Math.round(got.betacarotene * 10) / 10) + ' 花青素=' + Math.round(got.anthocyanin),
      '今天(' + todayKey + ')的餐:',
      daySummary(todayKey),
      '昨天(' + shiftKey(todayKey, -1) + ')的餐:',
      daySummary(shiftKey(todayKey, -1)),
      'UA: ' + (navigator.userAgent || '').slice(0, 90),
      '--- 最近日志 ---',
      (logs.slice(-30).map(l => new Date(l.t).toLocaleTimeString() + ' [' + l.tag + '] ' + l.msg).join('\n')) || '(空)'
    ].join('\n');
  }
  { // wire debug sheet buttons (elements are static in index.html)
    const copyBtn = $('#dbg-copy'), refBtn = $('#dbg-refresh');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const ta = $('#dbg-out'); if (!ta) return;
      ta.value = diagText(); ta.removeAttribute('readonly'); ta.focus(); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.setAttribute('readonly', '');
      toast(ok ? '已复制诊断信息' : '复制失败,请长按全选再拷贝');
    });
    if (refBtn) refBtn.addEventListener('click', () => { const o = $('#dbg-out'); if (o) o.value = diagText(); });
  }

  /* ---------- editing state ---------- */
  const editing = { meal: null, workout: null };

  function startEdit(kind, id) {
    if (kind === 'meal') {
      const m = db.meals.find(x => x.id === id); if (!m) return;
      open('meal');
      editing.meal = id;
      applyMealToForm(m);
      const rm = $('#recent-meals'); if (rm) rm.hidden = true; // 编辑模式不显示常用餐,防误覆盖
      $('#sheet-meal .sheet-title').textContent = '编辑这一餐';
    } else {
      const w = db.workouts.find(x => x.id === id); if (!w) return;
      open('workout');
      editing.workout = id;
      woCat = w.cat;
      $$('#workout-cat button').forEach(b => b.classList.toggle('active', b.dataset.v === w.cat));
      $('#wo-name').value = w.name || '';
      if (w.cat === '有氧') {
        $('#wo-duration').value = w.duration || '';
        $('#wo-distance').value = w.distance || '';
        $('#wo-burn').value = w.burn || '';
      } else {
        setsData = (w.sets || []).map(s => ({ w: s.w || '', reps: s.reps || '' }));
        if (!setsData.length) setsData = [{ w: '', reps: '' }];
      }
      applyCat();
      if (w.cat !== '有氧' && w.burn) { woAiBurn = Number(w.burn); showWoAi(woAiBurn, '沿用上次估算'); }
      $('#sheet-workout .sheet-title').textContent = '编辑动作';
    }
  }

  /* ---------- meal sheet ---------- */
  let mealType = '早餐';

  /* ---------- meal draft:误触关闭不丢已填内容(仅本地,不同步) ---------- */
  const DRAFT_KEY = 'qingheng.mealdraft';
  let draftT = null;
  function collectMealDraft() {
    const box = $('#food-rows');
    const rows = box ? [...box.querySelectorAll('.food-row')].map(r => ({
      name: r.querySelector('.fr-name').value,
      amt: r.querySelector('.fr-amt').value,
      unit: r.querySelector('.fr-unit').dataset.unit || 'g'
    })) : [];
    return {
      type: mealType, rows,
      free: $('#meal-name').value,
      kcal: $('#meal-kcal').value,
      protein: $('#meal-protein').value,
      nutrients: aiNutrients, stale: aiStale,
      ts: Date.now()
    };
  }
  function draftHasContent(d) {
    return !!(d && ((d.rows || []).some(r => (r.name || '').trim()) || (d.free || '').trim() || d.kcal));
  }
  function saveMealDraft() {
    if (openSheet !== 'meal' || editing.meal) return; // 编辑已有餐不写草稿
    const d = collectMealDraft();
    try {
      if (draftHasContent(d)) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      else localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
  }
  function scheduleDraft() { clearTimeout(draftT); draftT = setTimeout(saveMealDraft, 300); }
  function clearMealDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function restoreMealDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {}
    if (!draftHasContent(d) || Date.now() - (d.ts || 0) > 86400000) { clearMealDraft(); return false; }
    mealType = d.type || mealType;
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === mealType));
    clearFoodRows();
    (d.rows && d.rows.length ? d.rows : [{ name: '', amt: '', unit: 'g' }]).forEach(r => addFoodRow(r.name, r.amt, r.unit, null));
    $('#meal-name').value = d.free || '';
    $('#meal-kcal').value = d.kcal || '';
    $('#meal-protein').value = d.protein || '';
    if (d.nutrients) {
      aiNutrients = d.nutrients; aiStale = false;
      showAiResult(aiNutrients);
      if (d.stale) markAiStale();
    }
    toast('已恢复未保存的草稿', { label: '清空', fn() { clearMealDraft(); resetMealSheet(); } });
    return true;
  }
  // 表单里任何输入都排队写草稿(sheet 没开/在编辑时 saveMealDraft 自己拦)
  document.addEventListener('input', e => {
    if (e.target.closest('#sheet-meal')) scheduleDraft();
  });
  // 把一条已有的餐记录带入表单(编辑 与 常用餐复制 共用)
  function applyMealToForm(m) {
    mealType = m.type;
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === m.type));
    $('#meal-name').value = '';
    renderFoodChips(); clearFoodRows();
    const items = m.nutrients && Array.isArray(m.nutrients.items) ? m.nutrients.items : null;
    if (items && items.length) {
      items.forEach(it => { const p = parseAmount(it.amount); addFoodRow(it.name || '', p.amt, p.unit, null); });
    } else {
      const parts = (m.name || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      if (parts.length) parts.forEach(p => { const s = splitNameAmount(p); addFoodRow(s.name, s.amt, s.unit, null); });
      else addFoodRow('', '', 'g', null);
    }
    $('#meal-kcal').value = m.kcal || '';
    $('#meal-protein').value = m.protein || '';
    if (m.nutrients) { aiNutrients = JSON.parse(JSON.stringify(m.nutrients)); aiStale = false; showAiResult(aiNutrients); }
  }

  /* ---------- 最近的餐:一键复制(含营养明细,不用重新估算) ---------- */
  function recentMeals(n) {
    const seen = {}, out = [];
    db.meals.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(m => {
      if (!m.kcal) return;
      const key = (m.name || '').trim() || m.type;
      if (seen[key]) return;
      seen[key] = 1; out.push(m);
    });
    return out.slice(0, n);
  }
  function renderRecentMeals() {
    const box = $('#recent-meals'); if (!box) return;
    const ms = recentMeals(6);
    if (!ms.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<p class="rm-cap">最近的餐 · 点一下整份带入</p><div class="food-chips">' +
      ms.map(m => {
        const names = mealFoods(m);
        const label = names.length ? names.slice(0, 2).join('、') + (names.length > 2 ? '…' : '') : (m.name || m.type).slice(0, 10);
        return `<button class="chip rm-chip" data-recent="${m.id}">${esc(label)}<small>${m.kcal}</small></button>`;
      }).join('') + '</div>';
  }
  document.addEventListener('click', e => {
    const rc = e.target.closest('[data-recent]'); if (!rc) return;
    const m = db.meals.find(x => x.id === rc.dataset.recent); if (!m) return;
    resetAi();
    applyMealToForm(m); // 不设 editing.meal:保存时新建记录
    scheduleDraft();
    toast('已带入,确认后直接保存');
  });
  /* ---------- food-row input builder ---------- */
  const FR_UNITS = ['g', '个', '碗', 'ml'];
  function addFoodRow(name, amt, unit, focusField) {
    const box = $('#food-rows'); if (!box) return;
    const u = FR_UNITS.indexOf(unit) >= 0 ? unit : 'g';
    const row = document.createElement('div');
    row.className = 'food-row';
    row.innerHTML =
      `<input class="fr-name" placeholder="食物名" value="${esc(name || '')}" autocomplete="off" />` +
      `<input class="fr-amt" type="number" inputmode="decimal" placeholder="量" value="${esc(amt || '')}" />` +
      `<button class="fr-unit" data-unit="${esc(u)}">${esc(u)}</button>` +
      '<button class="fr-del" aria-label="删除">' + I_X + '</button>';
    box.appendChild(row);
    if (focusField) setTimeout(() => { const f = row.querySelector(focusField === 'amt' ? '.fr-amt' : '.fr-name'); if (f) f.focus(); }, 60);
  }
  function clearFoodRows() { const b = $('#food-rows'); if (b) b.innerHTML = ''; }
  function cycleUnit(btn) {
    const next = FR_UNITS[(FR_UNITS.indexOf(btn.dataset.unit) + 1) % FR_UNITS.length];
    btn.dataset.unit = next; btn.textContent = next;
  }
  function readMealInput() {
    const box = $('#food-rows');
    const rows = box ? [...box.querySelectorAll('.food-row')].map(r => ({
      name: r.querySelector('.fr-name').value.trim(),
      amt: r.querySelector('.fr-amt').value.trim(),
      unit: r.querySelector('.fr-unit').dataset.unit || 'g'
    })).filter(r => r.name) : [];
    if (rows.length) return rows.map(r => r.name + (r.amt ? r.amt + r.unit : '')).join('、');
    return $('#meal-name') ? $('#meal-name').value.trim() : '';
  }
  function parseAmount(s) {
    s = String(s || '');
    const num = (s.match(/[\d.]+/) || [''])[0];
    let unit = 'g';
    if (/个/.test(s)) unit = '个'; else if (/碗/.test(s)) unit = '碗'; else if (/ml|毫升/i.test(s)) unit = 'ml';
    return { amt: num, unit };
  }
  function splitNameAmount(s) {
    s = String(s || '').trim();
    const m = s.match(/^(.*?)([\d.]+)\s*(g|克|个|碗|ml|毫升)?$/);
    if (m && m[1].trim()) return { name: m[1].trim(), amt: m[2], unit: parseAmount(m[2] + (m[3] || '')).unit };
    return { name: s, amt: '', unit: 'g' };
  }
  function frequentFoods(n) {
    const seen = [];
    const add = nm => { nm = (nm || '').trim(); if (nm && seen.indexOf(nm) < 0) seen.push(nm); };
    db.meals.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(m => {
      const items = m.nutrients && m.nutrients.items;
      if (items && items.length) items.forEach(it => add(it.name));
      else (m.name || '').split(/[、,，]/).forEach(p => add(splitNameAmount(p.trim()).name)); // 手动记的餐也进常用
    });
    return seen.slice(0, n);
  }
  function renderFoodChips() {
    const box = $('#food-chips'); if (!box) return;
    const foods = frequentFoods(10);
    if (foods.length < 5) ['水煮鸡胸肉', '鸡蛋', '米饭', '西兰花', '蒸紫薯', '牛奶', '菠菜'].forEach(f => { if (foods.indexOf(f) < 0) foods.push(f); });
    box.innerHTML = foods.slice(0, 10).map(f => `<button class="chip" data-food="${esc(f)}">${esc(f)}</button>`).join('');
  }
  document.addEventListener('click', e => {
    const chip = e.target.closest('#food-chips .chip'); if (chip) { addFoodRow(chip.dataset.food, '', 'g', 'amt'); markAiStale(); scheduleDraft(); return; }
    if (e.target.closest('#add-food')) { addFoodRow('', '', 'g', 'name'); return; }
    const u = e.target.closest('.fr-unit'); if (u) { cycleUnit(u); markAiStale(); scheduleDraft(); return; }
    const del = e.target.closest('.fr-del'); if (del) { const r = del.closest('.food-row'); if (r) r.remove(); markAiStale(); scheduleDraft(); return; }
  });

  function resetMealSheet() {
    editing.meal = null;
    resetAi();
    $('#sheet-meal .sheet-title').textContent = '记一餐';
    mealType = '早餐';
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === '早餐'));
    $('#meal-name').value = ''; $('#meal-kcal').value = ''; $('#meal-protein').value = '';
    clearFoodRows(); addFoodRow('', '', 'g', null); renderFoodChips(); renderRecentMeals();
    const ft = $('#sheet-meal .freetext'); if (ft) ft.open = false;
    // smart default by time
    const hr = new Date().getHours();
    const def = hr < 10 ? '早餐' : hr < 15 ? '午餐' : hr < 21 ? '晚餐' : '加餐';
    mealType = def;
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === def));
    restoreMealDraft(); // 有未保存草稿就恢复(覆盖上面的默认值)
  }
  $('#meal-type').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    mealType = b.dataset.v; $$('#meal-type button').forEach(x => x.classList.toggle('active', x === b));
    scheduleDraft();
  });
  $('#save-meal').addEventListener('click', () => {
    const name = readMealInput();
    const kcal = parseInt($('#meal-kcal').value, 10);
    if (!kcal || kcal <= 0) { toast('填一下热量吧'); return; }
    const payload = { type: mealType, name, kcal, protein: parseInt($('#meal-protein').value, 10) || 0, ts: Date.now() };
    if (aiNutrients && !aiStale) payload.nutrients = aiNutrients;
    if (editing.meal) {
      const m = db.meals.find(x => x.id === editing.meal);
      if (m) { if (aiStale) delete m.nutrients; Object.assign(m, payload); }
      editing.meal = null;
      save(); scheduleSync(); closeSheet(); toast('已更新'); renderAll();
    } else {
      db.meals.push(Object.assign({ id: uid(), date: sel.diet }, payload));
      clearMealDraft(); // 保存成功,草稿完成使命
      save(); scheduleSync(); closeSheet(); toast('已记录 ' + kcal + ' kcal'); renderAll();
      goto('diet');
    }
  });

  /* ---------- AI nutrition ---------- */
  let aiNutrients = null;
  let aiStale = false; // 估算后食物又被改动 → 明细不再可信,保存时丢弃
  const AI_BTN_LABEL = 'AI 估算营养';
  const AI_PROMPT = `你是营养估算助手。用户给出一餐吃的食物描述(中文,可能含模糊分量如"一碗""一份"),按中国常见份量与标准食物成分数据(USDA / 中国食物成分表)估算,输出 json,不要输出任何其他文字。格式:
{"items":[{"name":"食物名","amount":"估算的量,如 150g / 1碗(约200g)","kcal":0,"protein":0,"fat":0,"carbs":0,"fiber":0,"micros":{"vitC":0,"vitE":0,"vitA":0,"se":0,"zn":0,"cu":0,"mn":0,"ca":0,"fe":0,"k":0,"anthocyanin":0,"lycopene":0,"lutein":0,"betacarotene":0}}],
"total":{"kcal":0,"protein":0,"fat":0,"carbs":0,"fiber":0},
"micros":{"vitC":0,"vitE":0,"vitA":0,"se":0,"zn":0,"cu":0,"mn":0,"ca":0,"fe":0,"k":0,"anthocyanin":0,"lycopene":0,"lutein":0,"betacarotene":0},
"note":"一句话分量假设说明(可选)"}
每个 item 必须带自己的 micros(字段与单位同下方顶层 micros);顶层 total 与顶层 micros 为所有 item 对应字段之和。
单位:kcal 千卡;protein/fat/carbs/fiber 克。micros 为整餐合计纯数字:vitA、se 用微克(µg),其余用毫克(mg)。
估算方法:对每种食物,用「每 100g 含量 × 实际克数 ÷ 100」逐项计算再求和;力求准确,既不遗漏也不夸大。同义词按同一食物处理(紫甘蓝=紫包菜=红甘蓝)。
常见植物化合物参考含量(mg/100g):
- betacarotene β-胡萝卜素:胡萝卜≈8、橙心红薯≈9、南瓜≈3、菠菜≈5、羽衣甘蓝≈9、红甜椒≈1.5、芒果≈0.6、番茄≈0.45;紫薯/紫甘蓝及多数非橙黄非深绿食物<0.1。
- lycopene 番茄红素:生番茄≈2.6、番茄酱≈15、番茄膏≈30、西瓜≈4.5、粉红葡萄柚≈1.4;其余≈0。
- anthocyanin 花青素:蓝莓≈120、黑莓≈100、桑葚≈140、生紫甘蓝≈70、紫薯≈30、红/紫葡萄≈30、血橙≈20、黑枸杞很高;绿/白/橙色食物≈0。
- lutein 叶黄素(含玉米黄质):羽衣甘蓝≈18、菠菜≈12、西兰花≈1.4、蛋黄≈1.1、玉米≈0.6;其余≈0。
维生素与矿物质同样要如实估算、不要都填 0:蔬果富含维C(mg/100g:彩椒≈130、西兰花≈89、猕猴桃≈90、草莓≈59、紫甘蓝≈57、橙≈53、菠菜≈28、番茄≈14、紫薯≈20;肉蛋≈0)和钾;绿叶菜/奶/豆腐富含钙;红肉/贝类/动物肝富含锌、铁;坚果/全谷/海鲜富含铜、锰、硒。凡该食物常规含有的营养素都要给出正常数值。
合理性检查:一餐正常摄入通常 β-胡萝卜素 0–30mg、番茄红素 0–30mg、花青素 0–300mg、叶黄素 0–30mg;若算出远超此范围就是高估了,请核对。
该食物确实不含或无法估算才填 0。数值保留整数或一位小数。如果输入不是食物,返回 {"error":"无法识别为食物"}。`;

  function resetAi() {
    aiNutrients = null; aiStale = false;
    const r = $('#ai-result'); r.hidden = true; r.innerHTML = '';
    const b = $('#ai-estimate'); b.disabled = false; b.textContent = AI_BTN_LABEL;
  }

  function markAiStale() {
    if (!aiNutrients || aiStale) return;
    aiStale = true;
    const card = $('#ai-result .ai-card');
    if (card) {
      card.classList.add('stale');
      card.insertAdjacentHTML('beforeend', '<p class="ai-stale">⚠️ 食物已改动,以上明细已过期 — 重新点「AI 估算」才会保存营养明细</p>');
    }
  }
  // 食物行任何改动(打字/换单位/删行/点常用)都让旧估算失效
  document.addEventListener('input', e => {
    if (e.target.closest('#food-rows') || e.target.id === 'meal-name') markAiStale();
  });

  async function estimateNutrition(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + db.settings.dsKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          max_tokens: 3500,
          temperature: 0.3,
          messages: [
            { role: 'system', content: AI_PROMPT },
            { role: 'user', content: text }
          ]
        })
      });
      if (res.status === 401) throw new Error('API Key 无效,检查设置里的 Key');
      if (!res.ok) throw new Error('估算失败 (' + res.status + '),稍后再试');
      const json = await res.json();
      let data;
      try { data = JSON.parse(json.choices[0].message.content); }
      catch (e) { throw new Error('返回格式异常,再试一次'); }
      if (data.error) throw new Error(String(data.error));
      if (!Array.isArray(data.items) || !data.total || typeof data.total.kcal !== 'number') throw new Error('返回格式异常,再试一次');
      return data;
    } finally { clearTimeout(timer); }
  }

  function aiCard(d) {
    const num = v => { const n = Number(v) || 0; return n % 1 ? n.toFixed(1) : Math.round(n); };
    const items = (d.items || []).map(it =>
      `<div class="ai-row"><span class="ai-name">${esc(it.name)}<small>${esc(it.amount || '')}</small></span><span class="ai-kcal">${Math.round(Number(it.kcal) || 0)} kcal</span></div>`).join('');
    const t = d.total || {};
    const micros = d.micros && typeof d.micros === 'object'
      ? MICROS.filter(m => (Number(d.micros[m.k]) || 0) > 0).map(m => esc(m.n) + ' ' + fmtN(d.micros[m.k]) + esc(m.u)).join(' · ') : '';
    return `<div class="ai-card">${items}
      <div class="ai-total">合计 ${Math.round(Number(t.kcal) || 0)} kcal · 蛋白 ${num(t.protein)}g · 脂肪 ${num(t.fat)}g · 碳水 ${num(t.carbs)}g · 纤维 ${num(t.fiber)}g</div>
      ${micros ? `<p class="ai-micros">${micros}</p>` : ''}
      <p class="ai-note">AI 估算,仅供参考${d.note ? ' · ' + esc(d.note) : ''}</p>
    </div>`;
  }

  function showAiResult(data) {
    const r = $('#ai-result');
    r.innerHTML = aiCard(data); r.hidden = false;
  }

  $('#ai-estimate').addEventListener('click', async () => {
    const text = readMealInput();
    if (!text) { toast('先填一下吃了什么'); return; }
    if (!db.settings.dsKey) { toast('先在设置里填 DeepSeek API Key'); return; }
    if (!navigator.onLine) { toast('离线状态无法估算'); return; }
    const btn = $('#ai-estimate'), saveBtn = $('#save-meal');
    btn.disabled = true; btn.textContent = '估算中…';
    saveBtn.disabled = true; // 估算中不许保存,避免存下没有营养明细的餐
    try {
      const data = await estimateNutrition(text);
      aiNutrients = data; aiStale = false;
      showAiResult(data);
      $('#meal-kcal').value = Math.round(Number(data.total.kcal) || 0);
      if (data.total.protein != null) $('#meal-protein').value = Math.round(Number(data.total.protein) || 0);
      saveMealDraft(); // 估算结果也进草稿,误触关闭不用重新估
    } catch (err) {
      if (err.name === 'AbortError') toast('请求超时,稍后再试');
      else if (err instanceof TypeError) toast('网络错误(可能是 CORS 拦截)');
      else toast(err.message || '估算失败');
    } finally {
      btn.disabled = false; btn.textContent = AI_BTN_LABEL;
      saveBtn.disabled = false;
    }
  });

  /* ---------- AI weekly report ---------- */
  const RPT_KEY = 'qingheng.aireport'; // 单独存,不进 db(mergeDb/gist 都不用管它)
  const RPT_PROMPT = '你是一位务实的减脂健身教练。根据用户过去7天的记录数据(JSON),写一段中文周报点评,150-250字,口吻友好直接,称呼用"你"。必须覆盖:1) 热量缺口整体做得如何(对照 target_kcal 与每日 kcal_in/kcal_out);2) 蛋白质摄入够不够(对照 protein_target_g);3) micros_below_70pct 里明显的微量营养缺口,给 1-2 个具体食物建议;4) 训练频率与体重趋势各一句话。写成一到两段自然的话,不要列表,不要出现 JSON 字段名,不要编造数据里没有的内容。';

  function weekData() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const dk = shiftKey(todayKey, -i);
      const meals = mealsOn(dk), wos = workoutsOn(dk);
      if (!meals.length && !wos.length) continue;
      days.push({
        date: dk,
        kcal_in: intakeOn(dk), kcal_out: outputOn(dk), protein_g: Math.round(proteinOn(dk)),
        meals: meals.map(m => m.name || m.type).join(';').slice(0, 150),
        workouts: wos.map(w => (w.name || w.cat) + (w.sets ? ' ' + w.sets.length + '组' : '')).join(';').slice(0, 100)
      });
    }
    const avg = nutritionAvg7(todayKey);
    const gaps = MICROS
      .map(m => ({ name: m.n, pct: m.t > 0 ? Math.round((avg.got[m.k] || 0) / m.t * 100) : 0, sources: m.src }))
      .filter(x => x.pct < 70).slice(0, 6);
    return {
      target_kcal: Number(db.settings.target) || 1600,
      protein_target_g: macroTargets()[0].t,
      days,
      micros_below_70pct: gaps,
      weights_last14d: db.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(-14).map(w => ({ d: w.date, kg: w.kg }))
    };
  }

  async function genReport(data) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + db.settings.dsKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
          max_tokens: 700,
          temperature: 0.6,
          messages: [
            { role: 'system', content: RPT_PROMPT },
            { role: 'user', content: JSON.stringify(data) }
          ]
        })
      });
      if (res.status === 401) throw new Error('API Key 无效,检查设置里的 Key');
      if (!res.ok) throw new Error('生成失败 (' + res.status + '),稍后再试');
      const json = await res.json();
      const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!text || !text.trim()) throw new Error('返回为空,再试一次');
      return text.trim();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('请求超时,稍后再试');
      if (err instanceof TypeError) throw new Error('网络错误,稍后再试');
      throw err;
    } finally { clearTimeout(timer); }
  }

  function renderReport() {
    const box = $('#ai-report'); if (!box) return;
    let rpt = null;
    try { rpt = JSON.parse(localStorage.getItem(RPT_KEY) || 'null'); } catch (e) {}
    box.innerHTML = rpt && rpt.text
      ? `<p class="rpt-text">${esc(rpt.text)}</p><p class="ai-note">AI 生成,仅供参考 · ${new Date(rpt.ts).toLocaleDateString()}</p>`
      : `<p class="hint">点右上角「生成」,AI 会点评你最近 7 天的饮食、训练与体重(需 DeepSeek Key)。</p>`;
  }

  if ($('#ai-report-btn')) $('#ai-report-btn').addEventListener('click', async () => {
    if (!db.settings.dsKey) { toast('先在设置里填 DeepSeek API Key'); return; }
    if (!navigator.onLine) { toast('离线状态无法生成'); return; }
    const data = weekData();
    if (!data.days.length) { toast('最近 7 天没有记录,先记几天再来'); return; }
    const btn = $('#ai-report-btn');
    btn.disabled = true; btn.textContent = '生成中…';
    try {
      const text = await genReport(data);
      try { localStorage.setItem(RPT_KEY, JSON.stringify({ ts: Date.now(), text })); } catch (e) {}
      renderReport();
      celebrate(false);
    } catch (err) {
      toast(err.message || '生成失败');
    } finally {
      btn.disabled = false; btn.textContent = '生成';
    }
  });

  /* ---------- workout sheet ---------- */
  let woCat = '力量';
  function resetWorkoutSheet() {
    editing.workout = null;
    $('#sheet-workout .sheet-title').textContent = '加一个动作';
    woCat = '力量';
    $$('#workout-cat button').forEach(b => b.classList.toggle('active', b.dataset.v === '力量'));
    $('#wo-name').value = '';
    $('#wo-duration').value = ''; $('#wo-distance').value = ''; $('#wo-burn').value = '';
    setsData = [{ w: '', reps: '' }, { w: '', reps: '' }, { w: '', reps: '' }];
    renderSets(); applyCat(); resetWoAi();
  }
  let setsData = [];
  function renderSets() {
    $('#sets-col-w').textContent = woCat === '徒手' ? '(自重)' : '重量 kg';
    $('#sets-list').innerHTML = setsData.map((s, i) => `
      <div class="set-row" data-i="${i}">
        <span class="set-idx">${i + 1}</span>
        <input type="number" inputmode="decimal" class="s-w" placeholder="${woCat === '徒手' ? '—' : '0'}" value="${s.w}" ${woCat === '徒手' ? 'disabled' : ''}/>
        <input type="number" inputmode="numeric" class="s-r" placeholder="0" value="${s.reps}"/>
        <button class="set-del" data-si="${i}">${I_X}</button>
      </div>`).join('');
  }
  function applyCat() {
    const cardio = woCat === '有氧';
    $('#sets-block').hidden = cardio;
    $('#cardio-block').hidden = !cardio;
    if (!cardio) renderSets();
  }
  $('#workout-cat').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    woCat = b.dataset.v; $$('#workout-cat button').forEach(x => x.classList.toggle('active', x === b));
    applyCat();
  });
  $('#add-set').addEventListener('click', () => { syncSets(); setsData.push({ w: '', reps: '' }); renderSets(); });
  $('#sets-list').addEventListener('click', e => {
    const b = e.target.closest('.set-del'); if (!b) return;
    syncSets(); setsData.splice(+b.dataset.si, 1); if (!setsData.length) setsData.push({ w: '', reps: '' }); renderSets();
  });
  function syncSets() {
    $$('#sets-list .set-row').forEach(row => {
      const i = +row.dataset.i;
      setsData[i] = { w: row.querySelector('.s-w').value, reps: row.querySelector('.s-r').value };
    });
  }
  $('#save-workout').addEventListener('click', () => {
    const name = $('#wo-name').value.trim();
    if (!name) { toast('填一下动作名称'); return; }
    const wo = { cat: woCat, name, ts: Date.now() };
    if (woCat === '有氧') {
      wo.duration = parseInt($('#wo-duration').value, 10) || 0;
      wo.distance = parseFloat($('#wo-distance').value) || 0;
      wo.burn = parseInt($('#wo-burn').value, 10) || 0;
      if (!wo.duration && !wo.distance && !wo.burn) { toast('填点时长或距离吧'); return; }
    } else {
      syncSets();
      wo.sets = setsData
        .filter(s => (Number(s.reps) || 0) > 0 || (Number(s.w) || 0) > 0)
        .map(s => ({ w: Number(s.w) || 0, reps: Number(s.reps) || 0 }));
      if (!wo.sets.length) { toast('至少填一组次数'); return; }
      if (woAiBurn) wo.burn = woAiBurn; // 力量/徒手的 AI 估算消耗
    }
    if (woAiMuscles) wo.muscles = woAiMuscles; // 各类别通用:AI 给的发力肌群
    if (editing.workout) {
      const w = db.workouts.find(x => x.id === editing.workout);
      if (w) {
        delete w.sets; delete w.duration; delete w.distance; delete w.burn;
        Object.assign(w, wo);
      }
      editing.workout = null;
      save(); scheduleSync(); closeSheet(); toast('已更新'); renderAll();
    } else {
      db.workouts.push(Object.assign({ id: uid(), date: sel.training }, wo));
      save(); scheduleSync(); closeSheet(); toast('动作已记录'); renderAll();
      goto('training');
    }
  });

  /* ---------- workout AI burn estimate ---------- */
  // 通用 DeepSeek JSON 调用(json_object 模式)
  async function dsJson(system, user, maxTokens) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + db.settings.dsKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          max_tokens: maxTokens || 800,
          temperature: 0.3,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      });
      if (res.status === 401) throw new Error('API Key 无效,检查设置里的 Key');
      if (!res.ok) throw new Error('估算失败 (' + res.status + '),稍后再试');
      const json = await res.json();
      let data;
      try { data = JSON.parse(json.choices[0].message.content); }
      catch (e) { throw new Error('返回格式异常,再试一次'); }
      if (data.error) throw new Error(String(data.error));
      return data;
    } finally { clearTimeout(timer); }
  }

  let woAiBurn = null, woAiMuscles = null;
  function resetWoAi() {
    woAiBurn = null; woAiMuscles = null;
    const r = $('#wo-ai-result'); if (r) { r.hidden = true; r.textContent = ''; }
    const b = $('#wo-ai'); if (b) { b.disabled = false; b.textContent = 'AI 估算消耗'; }
  }
  function showWoAi(kcal, note) {
    const r = $('#wo-ai-result'); if (!r) return;
    r.textContent = `≈ ${kcal} kcal · AI 估算,保存后计入消耗` + (note ? ' · ' + note : '');
    r.hidden = false;
  }
  const MUSCLE_SLUGS = ['trapezius', 'upper-back', 'lower-back', 'chest', 'biceps', 'triceps', 'forearm', 'back-deltoids', 'front-deltoids', 'abs', 'obliques', 'adductor', 'abductors', 'hamstring', 'quadriceps', 'calves', 'gluteal', 'neck'];
  const MUSCLE_CN = { trapezius: '斜方肌', 'upper-back': '上背', 'lower-back': '下背', chest: '胸肌', biceps: '肱二头肌', triceps: '肱三头肌', forearm: '前臂', 'back-deltoids': '后束三角肌', 'front-deltoids': '前束三角肌', abs: '腹肌', obliques: '腹斜肌', adductor: '内收肌', abductors: '外展肌', hamstring: '腘绳肌', quadriceps: '股四头肌', calves: '小腿', gluteal: '臀肌', neck: '颈部', head: '头', knees: '膝', 'left-soleus': '比目鱼肌', 'right-soleus': '比目鱼肌' };
  // 没有 AI 估算的老记录:按动作名关键词兜底
  const MUSCLE_MAP = [
    ['卧推', ['chest', 'triceps', 'front-deltoids']], ['俯卧撑', ['chest', 'triceps', 'front-deltoids']],
    ['飞鸟', ['chest', 'front-deltoids']], ['夹胸', ['chest']],
    ['深蹲', ['quadriceps', 'gluteal']], ['弓步', ['quadriceps', 'gluteal', 'hamstring']], ['腿举', ['quadriceps', 'gluteal']],
    ['硬拉', ['lower-back', 'hamstring', 'gluteal']], ['臀桥', ['gluteal', 'hamstring']], ['臀推', ['gluteal', 'hamstring']],
    ['引体', ['upper-back', 'biceps']], ['划船', ['upper-back', 'back-deltoids', 'biceps']], ['下拉', ['upper-back', 'biceps']],
    ['推举', ['front-deltoids', 'triceps']], ['肩推', ['front-deltoids', 'triceps']], ['侧平举', ['front-deltoids']],
    ['弯举', ['biceps']], ['臂屈伸', ['triceps']], ['三头', ['triceps']],
    ['卷腹', ['abs']], ['平板', ['abs']], ['腹', ['abs', 'obliques']],
    ['提踵', ['calves']], ['跑', ['quadriceps', 'hamstring', 'calves']], ['骑行', ['quadriceps', 'calves']], ['单车', ['quadriceps', 'calves']],
    ['游泳', ['upper-back', 'front-deltoids', 'chest']], ['跳绳', ['calves', 'quadriceps']], ['爬', ['quadriceps', 'gluteal', 'calves']]
  ];
  function cleanMuscles(arr) {
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter(x => x && MUSCLE_SLUGS.indexOf(x.m) >= 0)
      .map(x => ({ m: x.m, i: Math.max(0.1, Math.min(1, Number(x.i) || 0.5)) }))
      .slice(0, 6);
    return out.length ? out : null;
  }
  const WO_PROMPT = '你是运动能量消耗估算助手。根据动作名称、类别、组数/次数/重量或时长/距离,以及体重(kg,0 表示未知按 70 算),用 MET 方法估算这一条训练记录的总消耗,并给出主要发力肌群(2-4 个),输出 json:{"kcal":0,"note":"一句话假设说明","muscles":[{"m":"肌群slug","i":0到1的发力占比}]},不要输出任何其他文字。m 只能取:trapezius,upper-back,lower-back,chest,biceps,triceps,forearm,back-deltoids,front-deltoids,abs,obliques,adductor,abductors,hamstring,quadriceps,calves,gluteal,neck。力量/徒手按「整个动作段」估算:每组约 40 秒做组(MET 按动作强度 3.5-6)加 60-90 秒组间恢复(MET≈2),即 组数×(做组+休息)全周期,不要只算做组秒数,也不要按整次训练时长高估。sets 里的 kg 是器械标示重量:哑铃/单手器械按单只算,若动作通常双手各持一只则总负重×2;杠铃/固定器械为总重;按动作名判断并在 note 里写明假设。kcal 取整数。无法识别为运动时返回 {"error":"原因"}。';
  if ($('#wo-ai')) $('#wo-ai').addEventListener('click', async () => {
    const name = $('#wo-name').value.trim();
    if (!name) { toast('先填动作名称'); return; }
    if (!db.settings.dsKey) { toast('先在设置里填 DeepSeek API Key'); return; }
    if (!navigator.onLine) { toast('离线状态无法估算'); return; }
    const data = { name, cat: woCat, weight_kg: latestWeight() || 0 };
    if (woCat === '有氧') {
      data.duration_min = parseInt($('#wo-duration').value, 10) || 0;
      data.distance_km = parseFloat($('#wo-distance').value) || 0;
      if (!data.duration_min && !data.distance_km) { toast('先填时长或距离'); return; }
    } else {
      syncSets();
      data.sets = setsData.filter(s => (Number(s.reps) || 0) > 0).map(s => ({ kg: Number(s.w) || 0, reps: Number(s.reps) || 0 }));
      if (!data.sets.length) { toast('先填几组次数'); return; }
    }
    const btn = $('#wo-ai'), saveBtn = $('#save-workout');
    btn.disabled = true; btn.textContent = '估算中…'; saveBtn.disabled = true;
    try {
      const res = await dsJson(WO_PROMPT, JSON.stringify(data), 500);
      const kcal = Math.round(Number(res.kcal) || 0);
      if (!kcal) throw new Error('返回格式异常,再试一次');
      woAiBurn = kcal;
      woAiMuscles = cleanMuscles(res.muscles);
      if (woCat === '有氧') $('#wo-burn').value = kcal;
      const mtxt = woAiMuscles ? woAiMuscles.map(x => MUSCLE_CN[x.m] || x.m).join('/') : '';
      showWoAi(kcal, (res.note || '') + (mtxt ? ' · 部位:' + mtxt : ''));
    } catch (err) {
      if (err.name === 'AbortError') toast('请求超时,稍后再试');
      else if (err instanceof TypeError) toast('网络错误,稍后再试');
      else toast(err.message || '估算失败');
    } finally {
      btn.disabled = false; btn.textContent = 'AI 估算消耗'; saveBtn.disabled = false;
    }
  });
  // 组数/次数一改,旧估算作废
  document.addEventListener('input', e => {
    if (e.target.closest('#sets-list') && woCat !== '有氧' && woAiBurn) resetWoAi();
  });

  /* ---------- muscle heat map (vendor/body-highlighter, MIT) ---------- */
  let bhFront = null, bhBack = null;
  function musclesFor(w) {
    if (w.muscles && w.muscles.length) return w.muscles;
    const name = w.name || '';
    for (let j = 0; j < MUSCLE_MAP.length; j++) {
      if (name.indexOf(MUSCLE_MAP[j][0]) >= 0) return MUSCLE_MAP[j][1].map(m => ({ m, i: 0.6 }));
    }
    return [];
  }
  function renderMuscleMap(k) {
    const card = $('#muscle-card'); if (!card) return;
    const BH = window.BodyHighlighter;
    const agg = {}; // slug -> { s: 强度累计, names: 贡献动作 }
    workoutsOn(k).forEach(w => {
      const setsN = w.cat === '有氧'
        ? Math.max(1, Math.round((Number(w.duration) || 10) / 10)) // 有氧每 10 分钟折 1 组
        : (w.sets || []).length || 1;
      musclesFor(w).forEach(x => {
        if (!agg[x.m]) agg[x.m] = { s: 0, names: [] };
        agg[x.m].s += setsN * x.i;
        const nm = w.name || w.cat;
        if (agg[x.m].names.indexOf(nm) < 0) agg[x.m].names.push(nm);
      });
    });
    const slugs = Object.keys(agg);
    if (!BH || !slugs.length) { card.hidden = true; return; }
    card.hidden = false;
    const max = Math.max.apply(null, slugs.map(m => agg[m].s));
    const data = slugs.map(m => ({
      name: agg[m].names.join('、'),
      muscles: [m],
      frequency: Math.max(1, Math.min(4, Math.round(agg[m].s / max * 4)))
    }));
    const opts = type => ({
      container: $(type === 'anterior' ? '#muscle-front' : '#muscle-back'),
      type, data,
      style: { width: '132px' },
      bodyColor: '#eeece5',
      highlightedColors: ['#ffd9cc', '#ffb49a', '#ff8a5c', '#ff6a45'], // 浅→深,4 档
      onClick: st => toast((MUSCLE_CN[st.muscle] || st.muscle) + ' · ' + (st.data.exercises || []).join('、'))
    });
    if (!bhFront) {
      bhFront = BH.createBodyHighlighter(opts('anterior'));
      bhBack = BH.createBodyHighlighter(opts('posterior'));
    } else {
      bhFront.update({ data });
      bhBack.update({ data });
    }
  }

  /* ---------- weight ---------- */
  $('#save-weight').addEventListener('click', () => {
    const kg = parseFloat($('#weight-input').value);
    if (!kg || kg <= 0) { toast('填一下体重'); return; }
    const prev = latestWeight(); // 记录前的最近体重,用于庆祝判断
    const existing = db.weights.find(w => w.date === todayKey);
    if (existing) { existing.kg = kg; existing.ts = Date.now(); }
    else db.weights.push({ date: todayKey, kg, ts: Date.now() });
    save(); scheduleSync(); closeSheet(); toast('体重已记录'); renderStats();
    if (prev > 0 && kg < prev) celebrate(true); // 比上次轻,来点彩带
  });

  /* ---------- settings ---------- */
  function fillSettings() {
    $('#set-name').value = db.settings.name || '';
    $('#set-target').value = db.settings.target || '';
    $('#set-bmr').value = db.settings.bmr || '';
    $('#set-dskey').value = db.settings.dsKey || '';
    $('#set-synctoken').value = db.settings.syncToken || '';
    $('#set-gistid').value = db.settings.gistId || '';
    updateSyncStatus();
    updateBackupHint();
  }
  $('#save-settings').addEventListener('click', () => {
    db.settings.name = $('#set-name').value.trim();
    db.settings.target = parseInt($('#set-target').value, 10) || 1600;
    db.settings.bmr = parseInt($('#set-bmr').value, 10) || 1400;
    db.settings.dsKey = $('#set-dskey').value.trim();
    db.settings.syncToken = $('#set-synctoken').value.trim();
    db.settings.gistId = $('#set-gistid').value.trim();
    db.settings.ts = Date.now();
    save(); scheduleSync(); closeSheet(); toast('已保存'); renderAll();
  });
  const EXPORT_KEY = 'qingheng.lastexport'; // 本地记录,不同步
  function updateBackupHint() {
    const el = $('#backup-hint'); if (!el) return;
    let ts = 0; try { ts = Number(localStorage.getItem(EXPORT_KEY)) || 0; } catch (e) {}
    const days = ts ? Math.floor((Date.now() - ts) / 86400000) : -1;
    if (days < 0) { el.textContent = '还没手动导出过备份'; el.classList.add('warn'); }
    else {
      el.textContent = '上次导出备份:' + (days === 0 ? '今天' : days + ' 天前');
      el.classList.toggle('warn', days > 30);
    }
  }
  $('#sync-now').addEventListener('click', () => syncNow(false));
  $('#export-data').addEventListener('click', () => {
    // Strip the sync token so shared/backed-up JSON never leaks credentials.
    const safe = Object.assign({}, db);
    safe.settings = Object.assign({}, safe.settings);
    safe.settings.syncToken = '';
    safe.settings.dsKey = '';
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `轻衡备份-${todayKey}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    try { localStorage.setItem(EXPORT_KEY, String(Date.now())); } catch (e) {}
    updateBackupHint();
  });

  /* ---------- data import (merge via mergeDb / replace) ---------- */
  // 注意:SW 升级间隙可能出现「旧 HTML + 新 JS」,这些元素可能不存在;
  // 顶层 addEventListener 必须判空,否则整个 IIFE 会挂掉(全页失效)。
  let importDb = null;
  if ($('#import-data')) {
  $('#import-data').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许再次选同一文件
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw 0;
        const hasData = ['meals', 'workouts', 'weights'].some(k => Array.isArray(d[k]) && d[k].length);
        if (!hasData) throw 0;
        ['meals', 'workouts'].forEach(k => {
          if (d[k] && !(Array.isArray(d[k]) && d[k].every(r => r && r.id && r.date))) throw 0;
        });
        importDb = d;
        $('#import-info').textContent = `已读取备份:${(d.meals || []).length} 餐 · ${(d.workouts || []).length} 动作 · ${(d.weights || []).length} 条体重。选择导入方式:`;
        $('#import-confirm').hidden = false;
      } catch (err) {
        importDb = null;
        toast('文件格式不对,需要「导出数据备份」生成的 JSON');
      }
    };
    rd.onerror = () => toast('读取文件失败');
    rd.readAsText(f);
  });
  function finishImport(newDb, msg) {
    importDb = null; $('#import-confirm').hidden = true;
    db = newDb; save(); renderAll(); fillSettings(); toast(msg);
    dlog('import', msg + ` meals=${db.meals.length} workouts=${db.workouts.length}`);
  }
  $('#import-merge').addEventListener('click', () => {
    if (!importDb) return;
    finishImport(mergeDb(db, importDb), '已合并导入');
    scheduleSync();
  });
  $('#import-replace').addEventListener('click', async () => {
    if (!importDb) return;
    const s = db.settings;
    const nd = Object.assign({}, JSON.parse(JSON.stringify(defaults)), importDb);
    nd.settings = Object.assign({}, defaults.settings, importDb.settings || {},
      { syncToken: s.syncToken, gistId: s.gistId, dsKey: s.dsKey }); // 本地密钥不被备份覆盖
    nd.tombstones = Object.assign({}, importDb.tombstones || {});
    nd.syncedAt = 0;
    finishImport(nd, '已覆盖导入');
    // 覆盖后直接推云端(不走合并,否则云端旧数据会被合并回来)
    if (db.settings.syncToken && db.settings.gistId) {
      try { await gistPush(db.settings.gistId, db); db.syncedAt = Date.now(); save(); updateSyncStatus(); }
      catch (err) { dlog('import', 'push-after-replace failed: ' + (err && err.message)); }
    }
  });
  $('#import-cancel').addEventListener('click', () => { importDb = null; $('#import-confirm').hidden = true; });
  } // end if #import-data

  /* ---------- multi-device sync (private GitHub Gist) ---------- */

  // pure — exposed on window for standalone testing (node --eval)
  function mergeDb(local, remote) {
    local = local || {}; remote = remote || {};

    // 1. merge tombstones: keep the larger (later) timestamp per id
    const tomb = {};
    Object.keys(local.tombstones || {}).forEach(id => { tomb[id] = local.tombstones[id]; });
    Object.keys(remote.tombstones || {}).forEach(id => {
      tomb[id] = Math.max(tomb[id] || 0, remote.tombstones[id]);
    });

    function mergeList(localArr, remoteArr) {
      const map = new Map();
      (remoteArr || []).forEach(r => map.set(r.id, r));
      (localArr || []).forEach(r => {
        const ex = map.get(r.id);
        if (!ex || (Number(r.ts) || 0) >= (Number(ex.ts) || 0)) map.set(r.id, r);
      });
      // apply tombstones: record newer than tombstone survives (and tombstone is dropped),
      // otherwise the record stays deleted.
      map.forEach((rec, id) => {
        if (tomb[id] != null) {
          if ((Number(rec.ts) || 0) > tomb[id]) delete tomb[id];
          else map.delete(id);
        }
      });
      return Array.from(map.values()).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    }

    const meals = mergeList(local.meals, remote.meals);
    const workouts = mergeList(local.workouts, remote.workouts);

    // weights: keyed by date, larger ts wins
    const wmap = new Map();
    (remote.weights || []).forEach(w => wmap.set(w.date, w));
    (local.weights || []).forEach(w => {
      const ex = wmap.get(w.date);
      if (!ex || (Number(w.ts) || 0) >= (Number(ex.ts) || 0)) wmap.set(w.date, w);
    });
    const weights = Array.from(wmap.values()).sort((a, b) => a.date < b.date ? -1 : 1);

    // settings: whole-object "newer wins" by ts, but secrets/local-only fields
    // (syncToken, gistId, dsKey) always stay local — they are never synced.
    const ls = local.settings || {}, rs = remote.settings || {};
    const settings = ((Number(ls.ts) || 0) >= (Number(rs.ts) || 0)) ? Object.assign({}, rs, ls) : Object.assign({}, ls, rs);
    settings.syncToken = ls.syncToken || '';
    settings.gistId = ls.gistId || '';
    settings.dsKey = ls.dsKey || '';

    // drop tombstones older than 90 days
    const cutoff = Date.now() - 90 * 86400000;
    Object.keys(tomb).forEach(id => { if (tomb[id] < cutoff) delete tomb[id]; });

    return { meals, workouts, weights, settings, tombstones: tomb, syncedAt: local.syncedAt || 0 };
  }

  async function gistRequest(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(url, Object.assign({}, opts, {
        signal: ctrl.signal,
        headers: Object.assign({
          'Authorization': 'Bearer ' + db.settings.syncToken,
          'Accept': 'application/vnd.github+json'
        }, (opts && opts.headers) || {})
      }));
      if (res.status === 401 || res.status === 403) throw new Error('Token 无效或权限不足');
      if (res.status === 404) throw new Error('Gist 不存在,检查 Gist ID');
      if (!res.ok) throw new Error('同步失败 (' + res.status + ')');
      return res;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('同步超时,稍后再试');
      if (err instanceof TypeError) throw new Error('网络错误,检查网络连接');
      throw err;
    } finally { clearTimeout(timer); }
  }

  function gistPayload(dbObj) {
    const copy = Object.assign({}, dbObj);
    delete copy.syncedAt;
    // Never upload local-only secrets into the gist. GitHub secret-scanning
    // auto-revokes any access token found in gist content, which used to kill
    // the token right after the first (create) sync. Strip them from the copy;
    // mergeDb already keeps syncToken/gistId local on the receiving device.
    copy.settings = Object.assign({}, copy.settings);
    copy.settings.syncToken = '';
    copy.settings.gistId = '';
    copy.settings.dsKey = '';   // DeepSeek API key stays local — never upload a secret to the gist
    return { description: 'qingheng-sync', public: false, files: { 'qingheng.json': { content: JSON.stringify(copy) } } };
  }

  async function gistCreate(dbObj) {
    const res = await gistRequest('https://api.github.com/gists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gistPayload(dbObj))
    });
    const json = await res.json();
    return json.id;
  }

  async function gistFetch(gistId) {
    const res = await gistRequest('https://api.github.com/gists/' + gistId);
    const json = await res.json();
    const f = json.files && json.files['qingheng.json'];
    if (!f) throw new Error('云端数据格式异常');
    if (f.truncated && f.raw_url) {
      const raw = await gistRequest(f.raw_url);
      return await raw.text();
    }
    return f.content;
  }

  async function gistPush(gistId, dbObj) {
    await gistRequest('https://api.github.com/gists/' + gistId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gistPayload(dbObj))
    });
  }

  function updateSyncStatus(msg) {
    const el = $('#sync-status');
    if (!el) return;
    if (msg) { el.textContent = msg; return; }
    if (!db.settings.syncToken) { el.textContent = '从未同步'; return; }
    if (!db.syncedAt) { el.textContent = '从未同步'; return; }
    const mins = Math.round((Date.now() - db.syncedAt) / 60000);
    el.textContent = mins < 1 ? '刚刚同步过' : mins < 60 ? `上次同步:${mins} 分钟前` : `上次同步:${Math.round(mins / 60)} 小时前`;
  }

  let syncing = false;
  let syncTimer = null;
  function scheduleSync() {
    if (!db.settings.syncToken) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(true), 30000);
  }

  async function syncNow(silent) {
    if (!db.settings.syncToken) { if (!silent) toast('先在设置里填同步 Token'); return; }
    if (!navigator.onLine) { if (!silent) toast('离线,无法同步'); return; }
    if (syncing) return;
    syncing = true;
    updateSyncStatus('同步中…');
    dlog('sync', `start silent=${silent} online=${navigator.onLine} gist=${db.settings.gistId ? 'yes' : 'new'} localMeals=${(db.meals || []).length}`);
    try {
      if (!db.settings.gistId) {
        const id = await gistCreate(db);
        db.settings.gistId = id;
        db.syncedAt = Date.now();
        save();
        if (openSheet === 'settings') $('#set-gistid').value = id;
        dlog('sync', 'created gist ' + id);
        if (!silent) toast('已同步(新建云端)');
      } else {
        const remoteText = await gistFetch(db.settings.gistId);
        let remoteDb;
        try { remoteDb = JSON.parse(remoteText); }
        catch (e) { throw new Error('云端数据损坏'); }
        const merged = mergeDb(db, remoteDb);
        await gistPush(db.settings.gistId, merged);
        db = merged;
        db.syncedAt = Date.now();
        save();
        renderAll();
        dlog('sync', `ok merged meals=${(merged.meals || []).length} workouts=${(merged.workouts || []).length}`);
        if (!silent) toast('已同步');
      }
    } catch (err) {
      dlog('sync', 'ERROR ' + (err && err.message || err));
      if (!silent) toast(err.message || '同步失败');
    } finally {
      syncing = false;
      updateSyncStatus();
    }
  }

  /* ---------- delete (event delegation, with undo) ---------- */
  document.addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (!del) return;
    const kind = del.dataset.del, id = del.dataset.id;
    const arr = kind === 'meal' ? db.meals : db.workouts;
    const rec = arr.find(x => x.id === id); if (!rec) return;
    if (kind === 'meal') db.meals = db.meals.filter(m => m.id !== id);
    else db.workouts = db.workouts.filter(w => w.id !== id);
    db.tombstones[id] = Date.now();
    save(); scheduleSync(); renderAll();
    toast('已删除', {
      label: '撤销',
      fn() {
        delete db.tombstones[id];
        rec.ts = Date.now(); // 比已同步出去的墓碑新,合并时会复活
        (kind === 'meal' ? db.meals : db.workouts).push(rec);
        save(); scheduleSync(); renderAll();
      }
    });
  });

  /* ---------- global click wiring ---------- */
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) { goto(g.dataset.goto); return; }
    const o = e.target.closest('[data-open]'); if (o) { open(o.dataset.open); return; }
    if (e.target.closest('#mg-toggle')) {
      mgOpen = !mgOpen;
      const box = $('#micro-guide'); if (box) box.hidden = !mgOpen;
      const btn = $('#mg-toggle'); if (btn) btn.textContent = mgOpen ? '收起 ▾' : '展开 ▸';
      return;
    }
    if (e.target.closest('#mg-toggle-d')) {
      mgOpenD = !mgOpenD;
      const box = $('#diet-micro'); if (box) box.hidden = !mgOpenD;
      const btn = $('#mg-toggle-d'); if (btn) btn.textContent = mgOpenD ? '收起 ▾' : '展开 ▸';
      return;
    }
    const mm = e.target.closest('[data-mgmode]');
    if (mm) { mgMode = mm.dataset.mgmode; renderNutritionProgress(); renderDietProgress(); return; }
    const gh = e.target.closest('[data-mggrp]');
    if (gh) { const gi = gh.dataset.mggrp; mgGrpOpen[gi] = !mgGrpOpen[gi]; renderNutritionProgress(); renderDietProgress(); return; }
    if (e.target.closest('[data-systips]')) { sysTipOpen = !sysTipOpen; renderNutritionProgress(); renderDietProgress(); return; }
    const sy = e.target.closest('[data-sys]');
    if (sy) {
      const dk = sy.closest('#diet-micro') ? sel.diet : sel.today;
      const got = mgMode === 'avg7' ? nutritionAvg7(dk).got : nutritionOn(dk);
      const s = SYSTEMS[+sy.dataset.sys];
      toast(s.n + ':' + s.nut.map(k =>
        (k === 'protein' ? '蛋白质' : (MICROS.find(x => x.k === k) || {}).n) + ' ' + Math.round(sysPct(got, k) * 100) + '%').join(' · '));
      return;
    }
    const nutItem = e.target.closest('.mg-item[data-nutrient]');
    if (nutItem) {
      const dk = nutItem.closest('#diet-micro') ? sel.diet : sel.today;
      const det = nutItem.querySelector('.mg-detail'); if (!det) return;
      if (det.dataset.open === '1') { det.hidden = true; det.dataset.open = '0'; return; }
      const list = nutrientBreakdown(dk, nutItem.dataset.nutrient);
      const unit = nutItem.dataset.unit || '';
      det.innerHTML = list.length
        ? list.map(x => `<div class="mg-detrow"><span>${esc(x.name)}</span><b>${fmtN(x.v)} ${esc(unit)}</b></div>`).join('')
        : `<div class="mg-detrow muted">这天没有含此项的记录(或该餐未用 AI 估算)</div>`;
      det.hidden = false; det.dataset.open = '1';
      return;
    }
    if (e.target.closest('#force-refresh')) { hardRefresh(); return; }
    if (e.target.id === 'backdrop' || e.target.closest('.sheet-grip')) {
      if (Date.now() - sheetDragT < 400) return; // 刚拖拽完,忽略残留 click
      closeSheet(); return;
    }
    if (e.target.closest('.sheet-cancel')) { closeSheet(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed && !e.target.closest('[data-del]')) { startEdit(ed.dataset.edit, ed.dataset.id); return; }
    const dn = e.target.closest('[data-date]');
    if (dn) {
      const scr = dn.dataset.date, dir = +dn.dataset.dir;
      const next = shiftKey(sel[scr], dir);
      if (dir > 0 && next > todayKey) return; // no future
      sel[scr] = next; render(scr);
    }
  });

  /* ---------- force refresh (nuke SW + caches, reload fresh) ---------- */
  async function hardRefresh() {
    toast('正在拿最新版…');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) { /* ignore */ }
    // reload with a cache-busting query so nothing comes from a stale cache
    location.replace(location.pathname + '?u=' + Date.now());
  }

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-act'; b.textContent = action.label;
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        clearTimeout(toastT); t.hidden = true;
        action.fn();
      });
      t.appendChild(b);
      const bar = document.createElement('i');
      bar.className = 'toast-timer'; // 5 秒倒计时进度条,与超时时长一致
      t.appendChild(bar);
    }
    t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, action ? 5000 : 1800);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- test hooks (纯函数暴露给 test.html,不影响运行) ---------- */
  window.__qh_test = { mergeDb, cleanMuscles, splitNameAmount, mealFoods };

  /* ---------- init ---------- */
  renderToday();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  syncNow(true);
})();
