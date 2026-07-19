/* ================= 轻衡 · app logic ================= */
(function () {
  'use strict';

  /* ---------- storage ---------- */
  const KEY = 'qingheng.v1';
  const defaults = {
    meals: [],      // {id,date,type,name,kcal,protein,ts}
    workouts: [],   // {id,date,cat,name,sets:[{w,reps}],duration,distance,burn,ts}
    weights: [],    // {date,kg,ts}
    templates: [],  // {id,name,items:[{cat,name,sets|duration/distance,burn?,muscles?}],ts}
    supps: [],      // 补剂定义 {id,name,kcal,protein,micros?,ts} — 全部选填;micros 照产品标签录入(MICROS 的 key),勾选当天计入摄入与营养进度
    suppLogs: [],   // 补剂打卡 {id,date,suppId,ts} — 取消勾选=删记录+墓碑,与餐同一套语义
    settings: { name: '', target: 1600, bmr: 1400, targetWeight: 0, height: 0, age: 0, sex: 'm', dsKey: '', syncToken: '', gistId: '', ts: 0 },
    tombstones: {}, // { <记录id>: <删除时间戳ms> }
    syncedAt: 0      // 上次成功同步时间戳,仅本地展示
  };
  let db;
  try {
    db = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}'));
    db.settings = Object.assign({}, defaults.settings, db.settings || {});
    db.tombstones = Object.assign({}, db.tombstones || {});
    db.templates = (Array.isArray(db.templates) ? db.templates : []).slice(); // 复制,避免与 defaults 共享引用
    db.supps = (Array.isArray(db.supps) ? db.supps : []).slice();
    db.suppLogs = (Array.isArray(db.suppLogs) ? db.suppLogs : []).slice();
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

  // 某天已勾选的补剂(join 定义表;定义被删则打卡自然失效)
  const suppsOn = k => db.suppLogs.filter(l => l.date === k)
    .map(l => db.supps.find(s => s.id === l.suppId)).filter(Boolean);

  function intakeOn(k) { return sum(mealsOn(k), m => m.kcal) + sum(suppsOn(k), s => s.kcal); }
  function proteinOn(k) { return sum(mealsOn(k), m => m.protein) + sum(suppsOn(k), s => s.protein); }

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
    const oc = $('#sum-out-cap'); // 消耗拆分:训练部分珊瑚色标出,只在当天有训练时出现
    if (oc) {
      const tb = trainingBurnOn(k);
      oc.innerHTML = tb ? `消耗 <span class="cap-train">含训练 +${tb}</span>` : '消耗';
    }
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
      : `<div class="empty">${isToday ? '还没记今天的餐' : '这天没有饮食记录'}</div>`;
    const wos = workoutsOn(k);
    $('#today-workouts').innerHTML = wos.length
      ? wos.map(w => rowWorkout(w, false)).join('')
      : `<div class="empty">${isToday ? '还没记今天的训练' : '这天没有训练记录'}</div>`;
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
    const sp = suppNutritionOn(dk); // 补剂:蛋白 + 照标签录入的成分(标签值,非估算)
    acc.protein += sp.protein;
    MICROS.forEach(m => { acc[m.k] += sp[m.k]; });
    return acc;
  }

  // 补剂当天营养(纯函数进 __qh_test):蛋白 + MICROS 各 key。数据来自用户照标签录入,不做任何估算。
  function suppNutrition(supps, suppLogs, dk) {
    const acc = { protein: 0 };
    MICROS.forEach(m => acc[m.k] = 0);
    (suppLogs || []).filter(l => l.date === dk).forEach(l => {
      const s = (supps || []).find(x => x.id === l.suppId); if (!s) return;
      acc.protein += Number(s.protein) || 0;
      const mi = s.micros || {};
      MICROS.forEach(m => { acc[m.k] += Number(mi[m.k]) || 0; });
    });
    return acc;
  }
  const suppNutritionOn = dk => suppNutrition(db.supps, db.suppLogs, dk);
  // 与 nutritionAvg7 用同一套「有饮食记录的天」做分母,两边数字才可比
  function suppNutritionAvg7(dk) {
    const acc = {}; let n = 0;
    for (let i = 0; i < 7; i++) {
      const day = shiftKey(dk, -i);
      if (!mealsOn(day).length) continue;
      n++;
      const g = suppNutritionOn(day);
      Object.keys(g).forEach(k => acc[k] = (acc[k] || 0) + g[k]);
    }
    if (n) Object.keys(acc).forEach(k => acc[k] /= n);
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
  function progRow(item, got, suppV) {
    const tgt = Number(item.t) || 0;
    suppV = Math.min(Number(suppV) || 0, got); // 防御:补剂份额不可能超过总量
    const pct = tgt > 0 ? Math.round(got / tgt * 100) : 0;
    const over = pct >= 100;
    // 双色条:实心=食物,斜纹=补剂——一眼看出这条杠是吃出来的还是吞出来的
    const foodW = tgt > 0 ? Math.min((got - suppV) / tgt * 100, 100) : 0;
    const suppW = tgt > 0 ? Math.min(suppV / tgt * 100, 100 - foodW) : 0;
    return `<div class="mg-item${item.star ? ' star' : ''}" data-nutrient="${esc(item.k)}" data-unit="${esc(item.u)}">
      <div class="mg-row1"><span class="mg-n">${esc(item.n)} <span class="mg-en">${esc(item.en)}</span>${item.soft ? '<span class="mg-tag">AI粗估</span>' : ''}</span>
        <span class="mg-amt${over ? ' done' : ''}">${fmtN(got)} / ${fmtN(tgt)} ${esc(item.u)}<b>${pct}%</b></span></div>
      <div class="mg-bar"><div class="mg-fill${over ? ' over' : ''}" style="width:${foodW}%"></div>${suppW > 0 ? `<div class="mg-fill-supp" style="left:${foodW}%;width:${suppW}%"></div>` : ''}</div>
      <p class="mg-src">来源:${esc(item.src)}${item.soft ? ' · 软参考目标' : ''}${suppV > 0 ? ` · 其中补剂 ${fmtN(suppV)}${esc(item.u)}` : ''}</p>
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
    suppsOn(dk).forEach(s => { // 补剂也进来源明细,标注区分
      const v = isMacro ? (key === 'protein' ? Number(s.protein) || 0 : 0) : Number((s.micros || {})[key]) || 0;
      if (v > 0) out.push({ name: s.name + '(补剂)', v });
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
  // 六系统点亮语义:实亮=食物吃够;虚亮(带「补」角标)=靠补剂凑够。
  // 「补什么」推荐永远按食物算——药片补齐不该让推荐闭嘴,卡的意义是引导吃真食物。
  function sysRowHtml(got, suppGot) {
    suppGot = suppGot || {};
    const foodGot = {};
    Object.keys(got).forEach(k => foodGot[k] = Math.max((got[k] || 0) - (suppGot[k] || 0), 0));
    let anySupp = false;
    const items = SYSTEMS.map((s, si) => {
      const lit = sysAvg(foodGot, s) >= 0.7;
      const suppLit = !lit && sysAvg(got, s) >= 0.7;
      if (suppLit) anySupp = true;
      return `<button class="sys-it${lit ? ' lit' : suppLit ? ' supplit' : ''}" data-sys="${si}">${SYS_ICONS[s.icon]}<span>${s.n}${suppLit ? '<i class="sys-supp-tag">补</i>' : ''}</span></button>`;
    }).join('');
    const tips = sysTipsHtml(foodGot) || { btn: '', box: '' };
    return `<div class="sys-row">${items}</div>
      <div class="sys-note">吃够对应营养素就点亮${anySupp ? ' · 虚框=靠补剂' : ''} · 趣味参考${tips.btn}</div>${tips.box}`;
  }
  function progressHtml(dk) {
    const avg = mgMode === 'avg7' ? nutritionAvg7(dk) : null;
    const got = avg ? avg.got : nutritionOn(dk);
    const suppGot = mgMode === 'avg7' ? suppNutritionAvg7(dk) : suppNutritionOn(dk);
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
    return toggle + sysRowHtml(got, suppGot) + groups.map((g, gi) => {
      const doneN = g.items.filter(it => Number(it.t) > 0 && (got[it.k] || 0) >= Number(it.t)).length;
      const openG = !!mgGrpOpen[gi];
      return `<div class="mg-group">
        <button class="mg-ghead" data-mggrp="${gi}">
          <span class="mg-gtitle">${esc(g.title)}</span>
          <span class="mg-gsum${doneN === g.items.length ? ' done' : ''}">${doneN}/${g.items.length} 达标<i>${openG ? '▾' : '▸'}</i></span>
        </button>
        ${openG ? `<p class="mg-gnote">${esc(g.note)}</p>` + g.items.map(it => progRow(it, got[it.k] || 0, suppGot[it.k] || 0)).join('') : ''}
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
  const I_CHART = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>';
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
      <div class="r-icon i-teal">${mealIcon(m.type)}</div>
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
      <div class="r-icon i-coral">${catIcon(w.cat)}</div>
      <div class="r-body"><p class="r-title">${esc(w.name || w.cat)}</p><p class="r-sub">${w.cat} · ${sub}</p></div>
      <p class="r-val">${val}</p>
      <button class="r-del r-hist" data-hist="${esc(w.name || '')}" aria-label="历史走势">${I_CHART}</button>
      ${del ? `<button class="r-del" data-del="workout" data-id="${w.id}">${I_TRASH}</button>` : ''}
    </div>`;
  }
  // 自绘线性图标(24 grid, stroke 2, currentColor),替代 emoji —— 视觉资产自有化
  const _ic = inner => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const MEAL_ICONS = {
    '早餐': _ic('<path d="M12 3v3"/><path d="M5.2 7.2l2 2"/><path d="M18.8 7.2l-2 2"/><path d="M6.5 16a5.5 5.5 0 0 1 11 0"/><path d="M3 16h18"/><path d="M7 20h10"/>'),  // 日出
    '午餐': _ic('<path d="M4 12h16"/><path d="M5 12a7 7 0 0 0 14 0"/><path d="M9.5 20h5"/><path d="M8 8.5 20 4"/><path d="M9.5 10.5 21 6.5"/>'),   // 饭碗+筷子
    '晚餐': _ic('<path d="M4 13h16"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M9.5 21h5"/><path d="M12 9.5C12 6 14 4 17.5 3.5c0 3.5-2 5.7-5.5 6z"/><path d="M12 9.5C11 7.5 9.5 6.8 8 6.8"/>'), // 蔬菜碗
    '加餐': _ic('<path d="M12 7.2c-1.6-1.6-4.1-1.6-5.6 0-1.9 2-1.9 5.4-.4 8.3C7.2 18 9 20 12 20s4.8-2 6-4.5c1.5-2.9 1.5-6.3-.4-8.3-1.5-1.6-4-1.6-5.6 0z"/><path d="M12 7.2c0-2 1-3.4 2.8-4"/>'), // 苹果
    def: _ic('<path d="M4 13h16"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M9.5 21h5"/><path d="M10 9c0-1.5 1-2 1-3.5"/><path d="M14 9c0-1.5 1-2 1-3.5"/>')             // 热气碗
  };
  const CAT_ICONS = {
    '力量': _ic('<path d="M7 7.5v9M4 9.5v5M17 7.5v9M20 9.5v5M7 12h10"/>'),                                                                            // 哑铃
    '有氧': _ic('<path d="M12 20s-7.2-4.6-9-9c-1.1-2.7.5-6 3.6-6C8.6 5 10 6 12 8c2-2 3.4-3 5.4-3 3.1 0 4.7 3.3 3.6 6-1.8 4.4-9 9-9 9z"/><path d="M7 11.5h2.2l1.3-2.2 2 4.4 1.3-2.2H17"/>'),   // 心率
    '徒手': _ic('<circle cx="12" cy="4.8" r="2.2"/><path d="M12 7.5v5.5"/><path d="M12 9.5 6 6"/><path d="m12 9.5 6-3.5"/><path d="M12 13l-4.5 6.5"/><path d="m12 13 4.5 6.5"/>'),             // 开合跳小人
    def: _ic('<path d="M3 12h4l3-8 4 16 3-8h4"/>')                                                                                                     // 心电折线
  };
  const mealIcon = t => MEAL_ICONS[t] || MEAL_ICONS.def;
  const catIcon = c => CAT_ICONS[c] || CAT_ICONS.def;

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
    renderSuppCard();
    renderDietProgress();
  }

  /* ---------- 补剂:每日打卡清单(定义走 db.supps,打卡走 db.suppLogs,都同 mergeDb) ---------- */
  function renderSuppCard() {
    const box = $('#supp-list'); if (!box) return;
    const k = sel.diet;
    if (!db.supps.length) {
      box.innerHTML = '<p class="rm-cap">还没有清单,点「管理 ›」添加(如 肌酸、鱼油、维生素D)</p>';
      return;
    }
    const logs = db.suppLogs.filter(l => l.date === k);
    box.innerHTML = '<div class="food-chips supp-chips">' + db.supps.map(s => {
      const on = logs.some(l => l.suppId === s.id);
      const extra = [Number(s.kcal) ? s.kcal + 'kcal' : '', Number(s.protein) ? s.protein + 'g蛋白' : ''].filter(Boolean).join('·');
      return `<button class="chip supp-chip${on ? ' on' : ''}" data-supp="${esc(s.id)}">${esc(s.name)}${extra ? `<small>${esc(extra)}</small>` : ''}</button>`;
    }).join('') + '</div>';
  }
  let editingSupp = null; // 正在编辑的补剂 id(点行进入编辑,保留 id 不丢打卡历史)
  function renderSuppSheet() {
    const list = $('#supp-def-list'); if (!list) return;
    list.innerHTML = db.supps.length
      ? db.supps.map(s => {
        const mn = Object.keys(s.micros || {}).length;
        const extra = [Number(s.kcal) ? s.kcal + ' kcal' : '', Number(s.protein) ? '蛋白 ' + s.protein + 'g' : '', mn ? '成分 ' + mn + ' 项' : ''].filter(Boolean).join(' · ');
        return `<div class="supp-row" data-supp-edit="${esc(s.id)}"><div><p class="supp-nm">${esc(s.name)}</p><p class="supp-sub">${extra ? esc(extra) + ' · ' : ''}点击编辑</p></div>
          <button class="icon-btn" data-supp-del="${esc(s.id)}" aria-label="删除">${I_TRASH}</button></div>`;
      }).join('')
      : '<p class="rm-cap">还没有补剂。在下面添加后,每天在饮食页点一下即完成打卡;有热量的(如蛋白粉)会计入当天摄入。</p>';
    // 成分输入区只建一次(照标签录入,单位与营养进度一致)
    const mbox = $('#supp-micros');
    if (mbox && !mbox.children.length) mbox.innerHTML = MICROS.map(m =>
      `<label class="field"><span>${esc(m.n)} (${esc(m.u)})</span><input type="number" inputmode="decimal" data-mk="${esc(m.k)}" placeholder="0" /></label>`).join('');
  }
  function readSuppMicros() {
    const out = {}; let any = false;
    $$('#supp-micros [data-mk]').forEach(i => { const v = parseFloat(i.value); if (v > 0) { out[i.dataset.mk] = v; any = true; } });
    return any ? out : null;
  }
  function clearSuppForm() {
    editingSupp = null;
    ['#supp-name', '#supp-kcal', '#supp-protein'].forEach(sl => { const el = $(sl); if (el) el.value = ''; });
    $$('#supp-micros [data-mk]').forEach(i => i.value = '');
    const b = $('#supp-add'); if (b) b.textContent = '添加';
    const d = $('#supp-micros-box'); if (d) d.open = false;
  }
  document.addEventListener('click', e => {
    const sc = e.target.closest('[data-supp]');
    if (sc) { // 打卡/取消:与餐同一套 id+ts+墓碑语义,多设备同步安全
      const id = sc.dataset.supp, k = sel.diet;
      const ex = db.suppLogs.find(l => l.date === k && l.suppId === id);
      if (ex) { db.suppLogs = db.suppLogs.filter(l => l !== ex); db.tombstones[ex.id] = Date.now(); }
      else db.suppLogs.push({ id: uid(), date: k, suppId: id, ts: Date.now() });
      save(); scheduleSync(); renderDiet(); renderToday();
      return;
    }
    if (e.target.closest('#supp-add')) {
      const nameEl = $('#supp-name'), kcalEl = $('#supp-kcal'), protEl = $('#supp-protein');
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) { toast('填一下补剂名称'); return; }
      if (db.supps.some(s => s.name === name && s.id !== editingSupp)) { toast('已经有同名补剂了'); return; }
      const fields = { name, kcal: parseInt(kcalEl && kcalEl.value, 10) || 0, protein: parseInt(protEl && protEl.value, 10) || 0, ts: Date.now() };
      const micros = readSuppMicros();
      if (editingSupp) {
        const s = db.supps.find(x => x.id === editingSupp);
        if (s) { Object.assign(s, fields); if (micros) s.micros = micros; else delete s.micros; }
        toast('已更新');
      } else {
        const rec = Object.assign({ id: uid() }, fields);
        if (micros) rec.micros = micros;
        db.supps.push(rec);
      }
      clearSuppForm();
      save(); scheduleSync(); renderSuppSheet(); renderDiet();
      return;
    }
    const sd = e.target.closest('[data-supp-del]');
    if (sd) {
      const id = sd.dataset.suppDel;
      const s = db.supps.find(x => x.id === id); if (!s) return;
      db.supps = db.supps.filter(x => x.id !== id);
      db.tombstones[id] = Date.now(); // 打卡记录留着,定义没了自然不显示不计数
      if (editingSupp === id) clearSuppForm();
      save(); scheduleSync(); renderSuppSheet(); renderDiet();
      toast(`已删除「${s.name}」`, {
        label: '撤销', fn() {
          delete db.tombstones[id]; s.ts = Date.now(); db.supps.push(s);
          save(); scheduleSync(); renderSuppSheet(); renderDiet();
        }
      });
      return;
    }
    const se = e.target.closest('[data-supp-edit]');
    if (se) { // 点行编辑:保留 id,打卡历史和同步关联都不丢
      const s = db.supps.find(x => x.id === se.dataset.suppEdit); if (!s) return;
      editingSupp = s.id;
      const nameEl = $('#supp-name'), kcalEl = $('#supp-kcal'), protEl = $('#supp-protein');
      if (nameEl) nameEl.value = s.name || '';
      if (kcalEl) kcalEl.value = Number(s.kcal) || '';
      if (protEl) protEl.value = Number(s.protein) || '';
      const mi = s.micros || {};
      $$('#supp-micros [data-mk]').forEach(i => { i.value = mi[i.dataset.mk] != null ? mi[i.dataset.mk] : ''; });
      const b = $('#supp-add'); if (b) b.textContent = `更新「${s.name}」`;
      const d = $('#supp-micros-box'); if (d) d.open = !!Object.keys(mi).length;
    }
  });

  /* ---------- TRAINING ---------- */
  /* 当日动作按大部位分组(照抄饮食页早/午/晚餐的分组样式)。
     不新增 AI 调用:分类信息来自每条动作已有的肌群(AI 优先,关键词兜底),纯本地。 */
  const WO_REGIONS = [
    ['胸', ['chest']],
    ['背', ['trapezius', 'upper-back', 'lower-back', 'neck']],
    ['肩', ['front-deltoids', 'back-deltoids']],
    ['手臂', ['biceps', 'triceps', 'forearm']],
    ['腿臀', ['quadriceps', 'hamstring', 'calves', 'gluteal', 'adductor', 'abductors']],
    ['核心', ['abs', 'obliques']]
  ];
  // 纯函数:动作列表 → [{name,items,sets,vol,mins}];主部位=肌群占比合计最高的区,按容量降序,有氧固定最后
  function groupWorkouts(wos, musclesOf) {
    const regionOf = w => {
      if (w.cat === '有氧') return '有氧';
      const mus = musclesOf(w) || [];
      let best = '其他', bestS = 0;
      WO_REGIONS.forEach(pair => {
        const s = mus.reduce((a, x) => a + (pair[1].indexOf(x.m) >= 0 ? (Number(x.i) || 0) : 0), 0);
        if (s > bestS) { bestS = s; best = pair[0]; }
      });
      return best;
    };
    const map = {};
    (wos || []).forEach(w => {
      const r = regionOf(w);
      const g = map[r] = map[r] || { name: r, items: [], sets: 0, vol: 0, mins: 0 };
      g.items.push(w);
      g.sets += (w.sets || []).length;
      g.vol += (w.sets || []).reduce((a, s) => a + (Number(s.w) || 0) * (Number(s.reps) || 0), 0);
      g.mins += Number(w.duration) || 0;
    });
    return Object.keys(map).map(r => map[r]).sort((a, b) => {
      if (a.name === '有氧') return 1;
      if (b.name === '有氧') return -1;
      return b.vol - a.vol || b.sets - a.sets;
    });
  }
  // 行副标题(纯函数):同重同次折叠「30kg ×10 ×4」;变重写区间「72→52kg · 5 组」;纯自重「自重 ×10 ×4」
  function setsSummary(sets, cat) {
    const arr = sets || [];
    if (!arr.length) return '';
    const ws = arr.map(s => Number(s.w) || 0), rs = arr.map(s => Number(s.reps) || 0);
    const sameW = ws.every(w => w === ws[0]), sameR = rs.every(r => r === rs[0]);
    if (cat === '徒手' && !ws.some(w => w > 0)) return sameR ? `自重 ×${rs[0]} ×${arr.length}` : `自重 · ${arr.length} 组`;
    if (sameW && sameR) return `${ws[0]}kg ×${rs[0]} ×${arr.length}`;
    if (sameW) return `${ws[0]}kg · ${arr.length} 组`;
    return `${ws[0]}→${ws[ws.length - 1]}kg · ${arr.length} 组`;
  }
  // 组条图:一组一根竖条,力量按重量、徒手按次数归一(当组内最大=满高 26px),强度分 3 档深浅。
  // 装饰即数据:递减组/金字塔组直接显形,不画任何无意义元素。
  function setBarsHtml(sets, cat) {
    const arr = (sets || []).slice(0, 10);
    if (arr.length < 2) return '';
    const vals = arr.map(s => cat === '徒手' && !(Number(s.w) > 0) ? (Number(s.reps) || 0) : (Number(s.w) || 0));
    const max = Math.max.apply(null, vals);
    if (!(max > 0)) return '';
    return '<div class="set-bars" aria-hidden="true">' + vals.map(v => {
      const r = v / max;
      return `<i class="sb${r >= 0.9 ? '' : r >= 0.6 ? ' o2' : ' o1'}" style="height:${Math.round(8 + r * 18)}px"></i>`;
    }).join('') + '</div>';
  }
  function rowWoGrouped(w) {
    let sub, val, bars = '';
    if (w.cat === '有氧') {
      sub = [w.duration ? w.duration + ' 分钟' : '', w.distance ? w.distance + ' km' : ''].filter(Boolean).join(' · ') || '有氧';
      val = `${w.burn || Math.round((Number(w.duration) || 0) * 8)}<small>kcal</small>`;
    } else {
      const sets = w.sets || [];
      sub = setsSummary(sets, w.cat);
      bars = setBarsHtml(sets, w.cat);
      const vol = sets.reduce((a, s) => a + (Number(s.w) || 0) * (Number(s.reps) || 0), 0);
      val = vol ? `${vol}<small>kg·量</small>` : `${sets.reduce((a, s) => a + (Number(s.reps) || 0), 0)}<small>次</small>`;
    }
    return `<div class="wg-row" data-edit="workout" data-id="${w.id}">
      <div class="wg-main"><p class="wg-name">${esc(w.name || w.cat)}</p><p class="wg-sub">${esc(sub)}</p></div>
      ${bars}
      <p class="r-val">${val}</p>
      <button class="r-del r-hist" data-hist="${esc(w.name || '')}" aria-label="历史走势">${I_CHART}</button>
      <button class="r-del" data-del="workout" data-id="${w.id}" aria-label="删除">${I_TRASH}</button>
    </div>`;
  }
  function renderTraining() {
    const k = sel.training;
    $('#training-date').textContent = labelForKey(k);
    const wos = workoutsOn(k);
    $('#train-vol').textContent = volumeOn(k);
    $('#train-count').textContent = wos.length;
    $('#train-burn').textContent = trainingBurnOn(k);
    $('#training-list').innerHTML = wos.length
      ? groupWorkouts(wos, musclesFor).map(g => {
          const sub = g.name === '有氧'
            ? (g.mins ? g.mins + ' 分钟' : g.items.length + ' 项')
            : g.sets + ' 组' + (g.vol ? ' · ' + g.vol + ' kg容量' : '');
          return `<div class="wo-group">
            <div class="wg-head"><span>${g.name}</span><span class="wg-sum">${sub}</span></div>
            ${g.items.map(rowWoGrouped).join('')}
          </div>`;
        }).join('')
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
    renderWeightGoal(); // 无论有没有体重记录都要刷新目标行(自己会判断隐藏)

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
    renderTdee();
    renderReport();
  }

  /* ---------- 自校准 TDEE(v2 愿景 1:把「缺口」从估计变成测量) ---------- */
  // 原理:两次称重之间,体重变化 ≈ (Σ摄入 − Σ训练消耗 − 天数×日常消耗) / 7700
  // 反解出「日常消耗」(= 基础代谢 + 日常活动 + 食物热效应,不含训练)。
  // 纯函数。weights: [{date,kg}];daysMap: {date: {in: 摄入kcal|null(没记), train: 训练消耗kcal}}
  // 规则(数字要经得起追问,假设全写在这):
  //  · 只用间隔 3–21 天的相邻称重段:太近被水分波动淹没,太远遗忘/漏记多
  //  · 段内饮食记录覆盖率 ≥85% 才可信;缺的天按该段已记录天的平均摄入补
  //  · 没记训练的天按没训练算(train=0)
  //  · 反推结果在 800–4500 之外视为坏数据(称重误差/漏记),整段丢弃
  //  · 多段按天数加权平均,结果取整到 10
  function tdeeFromLogs(weights, daysMap) {
    const ws = (weights || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const segs = [];
    for (let i = 1; i < ws.length; i++) {
      const a = ws[i - 1], b = ws[i];
      const gap = Math.round((fromKey(b.date) - fromKey(a.date)) / 86400000);
      if (gap < 3 || gap > 21) continue;
      let logged = 0, sumIn = 0, sumTrain = 0;
      const d = fromKey(a.date);
      for (let n = 0; n < gap; n++, d.setDate(d.getDate() + 1)) {
        const rec = daysMap[key(d)] || { in: null, train: 0 };
        if (rec.in != null) { logged++; sumIn += rec.in; }
        sumTrain += rec.train || 0;
      }
      if (!logged || logged / gap < 0.85) continue;
      const estIn = sumIn / logged * gap;
      const dW = (Number(b.kg) || 0) - (Number(a.kg) || 0);
      const base = (estIn - sumTrain - dW * 7700) / gap;
      if (base < 800 || base > 4500) continue;
      segs.push({ gap, base, cover: logged / gap });
    }
    if (!segs.length) return null;
    const totalGap = segs.reduce((s, x) => s + x.gap, 0);
    return {
      v: Math.round(segs.reduce((s, x) => s + x.base * x.gap, 0) / totalGap / 10) * 10,
      segs: segs.length,
      days: totalGap,
      cover: Math.round(segs.reduce((s, x) => s + x.cover * x.gap, 0) / totalGap * 100)
    };
  }
  // 从 db 取近 42 天数据喂给 tdeeFromLogs
  function computeTdee() {
    const cutoff = key(new Date(Date.now() - 42 * 86400000));
    const ws = db.weights.filter(w => w.date >= cutoff).sort((a, b) => a.date < b.date ? -1 : 1);
    if (ws.length < 2) return null;
    const daysMap = {};
    const d = fromKey(ws[0].date);
    for (; key(d) < ws[ws.length - 1].date; d.setDate(d.getDate() + 1)) {
      const dk = key(d);
      daysMap[dk] = { in: mealsOn(dk).length ? intakeOn(dk) : null, train: trainingBurnOn(dk) };
    }
    return tdeeFromLogs(ws, daysMap);
  }
  function renderTdee() {
    const box = $('#tdee-box'); if (!box) return;
    const t = computeTdee();
    if (!t) {
      box.innerHTML = '<p class="hint">数据还不够,测不出来。需要:近 42 天里至少两次间隔 3–21 天的体重记录,且两次称重之间 85% 以上的天数记了饮食。按现在的习惯多记几天就有了。</p>';
      return;
    }
    const bmr = Number(db.settings.bmr) || 0;
    const diff = t.v - bmr;
    const verdict = Math.abs(diff) < 100
      ? `与当前设置(${bmr})相当接近,可以不改。`
      : `当前设置的 ${bmr} 可能${diff > 0 ? '低' : '高'}了约 ${Math.abs(diff)} kcal,建议改用实测值,净缺口会更准。`;
    box.innerHTML = `
      <div class="pr-line"><span class="pr-cap">实测日常消耗(不含训练)</span>
        <span class="pr-val">${t.v}<small> kcal/天</small></span></div>
      <p class="hint">依据近 42 天内 ${t.segs} 段称重区间、共 ${t.days} 天(饮食覆盖 ${t.cover}%),由「摄入 − 体重变化×7700」反推;训练消耗按逐日记录扣除,没记训练的天按没练算。${verdict}</p>
      ${Math.abs(diff) >= 30 ? `<button class="ai-btn" id="tdee-apply" data-v="${t.v}" style="margin-bottom:0">把设置里的 ${bmr} 更新为 ${t.v}</button>` : ''}`;
  }
  document.addEventListener('click', e => {
    const btn = e.target.closest('#tdee-apply'); if (!btn) return;
    const v = parseInt(btn.dataset.v, 10); if (!v) return;
    const old = db.settings.bmr;
    db.settings.bmr = v; db.settings.ts = Date.now();
    save(); scheduleSync(); renderAll();
    toast('日常消耗已更新为 ' + v, {
      label: '撤销',
      fn() { db.settings.bmr = old; db.settings.ts = Date.now(); save(); scheduleSync(); renderAll(); }
    });
  });

  /* ---------- 体重目标 + 达标日期预测 ---------- */
  // 纯函数:还差 kgLeft 公斤、平均日缺口 avgDef(kcal)→ 预计天数;7700 kcal ≈ 1kg 脂肪
  function forecastDays(kgLeft, avgDef) {
    if (!(kgLeft > 0) || !(avgDef > 0)) return null;
    return Math.ceil(kgLeft * 7700 / avgDef);
  }
  // 近 14 天平均日缺口:只算记了饮食的天(没记≠没吃,算进去会虚高)
  function avgDeficit14() {
    let sum = 0, n = 0;
    for (let i = 0; i < 14; i++) {
      const dk = shiftKey(todayKey, -i);
      if (!mealsOn(dk).length) continue;
      sum += deficitOn(dk); n++;
    }
    return { avg: n ? sum / n : 0, n };
  }
  function renderWeightGoal() {
    const el = $('#weight-goal'); if (!el) return;
    const tgt = Number(db.settings.targetWeight) || 0;
    const cur = latestWeight();
    if (!tgt || !cur) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const left = +(cur - tgt).toFixed(1);
    if (left <= 0) {
      el.innerHTML = `已达到目标体重 <b>${tgt} kg</b>,保持住!`;
      el.classList.add('done');
      return;
    }
    el.classList.remove('done');
    const d14 = avgDeficit14();
    let fc = '';
    if (d14.n >= 5) {
      const days = forecastDays(left, d14.avg);
      if (days) {
        const eta = new Date(); eta.setDate(eta.getDate() + days);
        fc = `<br><span class="goal-fc">按近14天有记录的 ${d14.n} 天平均缺口 ${Math.round(d14.avg)} kcal/天(7700 kcal≈1kg):约 ${days} 天后达标,${eta.getFullYear() !== new Date().getFullYear() ? eta.getFullYear() + '年' : ''}${eta.getMonth() + 1}月${eta.getDate()}日</span>`;
      } else {
        fc = `<br><span class="goal-fc">近14天平均缺口 ≤ 0(${Math.round(d14.avg)} kcal/天),按当前节奏暂无法预测达标日</span>`;
      }
    } else if (d14.n > 0) {
      fc = `<br><span class="goal-fc">近14天只有 ${d14.n} 天饮食记录,多记几天才能预测达标日</span>`;
    }
    el.innerHTML = `目标 <b>${tgt} kg</b> · 还差 <b>${left} kg</b>${fc}`;
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
    if (name === 'supp') { renderSuppSheet(); clearSuppForm(); }
    if (name === 'template') renderTemplateSheet();
    if (name === 'paste') resetPasteSheet();
    if (name === 'weight') $('#weight-input').value = '';
    if (name === 'debug') { const o = $('#dbg-out'); if (o) o.value = diagText(); }
    const s = $('#sheet-' + name);
    s.hidden = false; s.scrollTop = 0; $('#backdrop').hidden = false;
    openSheet = name; lockBody();
    // 空表单才自动聚焦;恢复了草稿/带入了内容就不抢光标(模板页多数时候是来「套用」的,也不抢)
    const first = s.querySelector('input');
    if (first && name !== 'settings' && name !== 'template' && name !== 'supp' && name !== 'paste') setTimeout(() => { if (!first.value) first.focus(); }, 250);
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
      editDate.meal = m.date; updateEditDate('meal'); // 编辑态可改记录日期(记错天的解药)
      const rm = $('#recent-meals'); if (rm) rm.hidden = true; // 编辑模式不显示常用餐,防误覆盖
      $('#sheet-meal .sheet-title').textContent = '编辑这一餐';
    } else {
      const w = db.workouts.find(x => x.id === id); if (!w) return;
      open('workout');
      editing.workout = id;
      applyWorkoutToForm(w);
      editDate.workout = w.date; updateEditDate('workout');
      const rw = $('#recent-workouts'); if (rw) rw.hidden = true; // 编辑模式不显示常用动作,防误覆盖
      $('#sheet-workout .sheet-title').textContent = '编辑动作';
    }
  }

  /* ---------- 编辑态改记录日期:记错天的记录整条挪走(餐/动作共用) ---------- */
  const editDate = { meal: null, workout: null };
  function updateEditDate(kind) {
    const row = $(kind === 'meal' ? '#meal-date-row' : '#wo-date-row');
    const chip = $(kind === 'meal' ? '#meal-date-chip' : '#wo-date-chip');
    if (!row || !chip) return;
    row.hidden = !editDate[kind];
    if (editDate[kind]) chip.textContent = labelForKey(editDate[kind]);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-edate]'); if (!b) return;
    const kind = b.dataset.edate, dir = +b.dataset.dir;
    if (!editDate[kind]) return;
    const next = shiftKey(editDate[kind], dir);
    if (dir > 0 && next > todayKey) return; // 与主日期导航同规矩:不给记到未来
    editDate[kind] = next; updateEditDate(kind);
  });

  // 把一条已有的训练记录带入表单(编辑 与 常用动作复制 共用)
  function applyWorkoutToForm(w) {
    woCat = w.cat;
    $$('#workout-cat button').forEach(b => b.classList.toggle('active', b.dataset.v === w.cat));
    $('#wo-name').value = w.name || '';
    resetWoAi();
    if (w.cat === '有氧') {
      $('#wo-duration').value = w.duration || '';
      $('#wo-distance').value = w.distance || '';
      $('#wo-burn').value = w.burn || '';
    } else {
      setsData = (w.sets || []).map(s => ({ w: s.w || '', reps: s.reps || '' }));
      if (!setsData.length) setsData = [{ w: '', reps: '' }];
    }
    woAiMuscles = cleanMuscles(w.muscles); // 沿用发力肌群,热力图不用重新估算
    applyCat();
    if (w.cat !== '有氧' && w.burn) { woAiBurn = Number(w.burn); showWoAi(woAiBurn, '沿用上次估算,改了组数会作废'); }
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
  // 全量食物索引:扫所有餐记录,按食物名聚合 次数 + 最近一次的时间/量/单位。
  // 纯函数(meals 从参数进)进 __qh_test;上周吃过的东西永远在索引里,不会被最近记录挤掉。
  function foodIndex(meals) {
    const map = Object.create(null);
    (meals || []).forEach(m => {
      const ts = Number(m.ts) || 0;
      const hit = (nm, amt, unit) => {
        nm = (nm || '').trim(); if (!nm) return;
        const e = map[nm] || (map[nm] = { name: nm, count: 0, lastTs: 0, amt: '', unit: 'g' });
        e.count++;
        if (ts >= e.lastTs) { e.lastTs = ts; if (amt) { e.amt = String(amt); e.unit = unit || 'g'; } }
      };
      const items = m.nutrients && Array.isArray(m.nutrients.items) ? m.nutrients.items : null;
      if (items && items.length) items.forEach(it => { const p = parseAmount(it.amount); hit(it.name, p.amt, p.unit); });
      else (m.name || '').split(/[、,，]/).forEach(part => { const s = splitNameAmount(part.trim()); hit(s.name, s.amt, s.unit); }); // 手动记的餐也进索引
    });
    return Object.keys(map).map(k => map[k]);
  }
  // 常用 chips:3 个最近吃过 + 按历史次数补满。
  // 规则要经得起追问:纯最近会把上周高频挤掉(本次要修的 bug),纯频次又看不到刚开始吃的新食物,所以两头各取。
  function frequentFoods(n) {
    const idx = foodIndex(db.meals);
    const byRecent = idx.slice().sort((a, b) => b.lastTs - a.lastTs);
    const byCount = idx.slice().sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
    const out = [];
    byRecent.slice(0, 3).forEach(f => out.push(f.name));
    byCount.forEach(f => { if (out.length < n && out.indexOf(f.name) < 0) out.push(f.name); });
    return out;
  }
  /* ---------- 食物名联想:打字即搜全部历史,点选带入上次的量(解决「上周吃过还得重打」) ---------- */
  function hideFoodSuggest() { $$('.fr-suggest').forEach(x => x.remove()); }
  function showFoodSuggest(inp) {
    hideFoodSuggest();
    const q = inp.value.trim(); if (!q) return;
    const hits = foodIndex(db.meals)
      .filter(f => f.name.indexOf(q) >= 0 && f.name !== q)
      .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, 6);
    if (!hits.length) return;
    const row = inp.closest('.food-row'); if (!row) return;
    const box = document.createElement('div');
    box.className = 'food-chips fr-suggest';
    box.innerHTML = hits.map(f =>
      `<button class="chip" data-sug="${esc(f.name)}" data-amt="${esc(f.amt)}" data-unit="${esc(f.unit)}">${esc(f.name)}<small>${f.count}次</small></button>`).join('');
    row.after(box); // 在 #food-rows 内,clearFoodRows 会一并清掉
  }
  document.addEventListener('input', e => {
    const inp = e.target.closest('#food-rows .fr-name'); if (inp) showFoodSuggest(inp);
  });
  function fillFoodRow(row, name, amt, unit) {
    row.querySelector('.fr-name').value = name;
    const amtEl = row.querySelector('.fr-amt');
    if (!amtEl.value && amt) amtEl.value = amt;
    const uBtn = row.querySelector('.fr-unit');
    if (unit && FR_UNITS.indexOf(unit) >= 0) { uBtn.dataset.unit = unit; uBtn.textContent = unit; }
  }
  document.addEventListener('click', e => {
    const sug = e.target.closest('[data-sug]');
    if (sug) {
      const box = sug.closest('.fr-suggest');
      const row = box && box.previousElementSibling;
      if (row && row.classList.contains('food-row')) {
        fillFoodRow(row, sug.dataset.sug, sug.dataset.amt, sug.dataset.unit);
        markAiStale(); scheduleDraft();
      }
      hideFoodSuggest();
      return;
    }
    if (!e.target.closest('#food-rows .fr-name')) hideFoodSuggest(); // 点别处收起联想
  });
  /* ---------- 全部吃过的食物:折叠浏览区,点一下加进这餐 ---------- */
  function renderAllFoods() {
    const box = $('#all-foods'); if (!box) return;
    const idx = foodIndex(db.meals).sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, 120);
    box.innerHTML = idx.length
      ? '<div class="food-chips all-food-chips">' + idx.map(f =>
        `<button class="chip" data-allfood="${esc(f.name)}" data-amt="${esc(f.amt)}" data-unit="${esc(f.unit)}">${esc(f.name)}<small>${f.count}次</small></button>`).join('') + '</div>'
      : '<p class="rm-cap">还没有记录过食物</p>';
  }
  document.addEventListener('click', e => {
    const af = e.target.closest('[data-allfood]'); if (!af) return;
    const rows = $$('#food-rows .food-row');
    const last = rows[rows.length - 1];
    if (last && !last.querySelector('.fr-name').value.trim()) fillFoodRow(last, af.dataset.allfood, af.dataset.amt, af.dataset.unit); // 有空行先填空行,别堆行
    else addFoodRow(af.dataset.allfood, af.dataset.amt, af.dataset.unit, null);
    markAiStale(); scheduleDraft();
  });
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
    editDate.meal = null; updateEditDate('meal');
    resetAi();
    $('#sheet-meal .sheet-title').textContent = '记一餐';
    mealType = '早餐';
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === '早餐'));
    $('#meal-name').value = ''; $('#meal-kcal').value = ''; $('#meal-protein').value = '';
    clearFoodRows(); renderFoodChips(); renderRecentMeals(); renderAllFoods(); // 行稍后一次性构建,避免闪烁
    $$('#sheet-meal details').forEach(d => d.open = false); // 整段输入 + 全部食物 都收起
    // smart default by time
    const hr = new Date().getHours();
    const def = hr < 10 ? '早餐' : hr < 15 ? '午餐' : hr < 21 ? '晚餐' : '加餐';
    mealType = def;
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === def));
    if (!restoreMealDraft()) addFoodRow('', '', 'g', null); // 有草稿恢复草稿,没有才建空行——只建一次
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
      let moved = false;
      if (m) {
        if (aiStale) delete m.nutrients;
        Object.assign(m, payload);
        if (editDate.meal && editDate.meal !== m.date) { m.date = editDate.meal; sel.diet = m.date; moved = true; }
      }
      editing.meal = null; editDate.meal = null;
      save(); scheduleSync(); closeSheet(); toast(moved ? '已挪到「' + labelForKey(sel.diet) + '」' : '已更新'); renderAll();
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
    editDate.workout = null; updateEditDate('workout');
    woCat = '力量';
    $$('#workout-cat button').forEach(b => b.classList.toggle('active', b.dataset.v === '力量'));
    $('#wo-name').value = '';
    $('#wo-duration').value = ''; $('#wo-distance').value = ''; $('#wo-burn').value = '';
    setsData = [{ w: '', reps: '' }, { w: '', reps: '' }, { w: '', reps: '' }];
    renderSets(); applyCat(); resetWoAi();
    renderRecentWorkouts(); renderRest();
  }

  /* ---------- 最近的动作:一键带入上次的组数/重量(常用项快捷添加) ---------- */
  function recentWorkouts(n) {
    const seen = {}, out = [];
    db.workouts.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(w => {
      const key = (w.name || '').trim();
      if (!key || seen[key]) return;
      seen[key] = 1; out.push(w);
    });
    return out.slice(0, n);
  }
  function renderRecentWorkouts() {
    const box = $('#recent-workouts'); if (!box) return;
    const ws = recentWorkouts(8);
    if (!ws.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<p class="rm-cap">最近的动作 · 点一下带入上次的组数</p><div class="food-chips wo-chips">' +
      ws.map(w => {
        const sub = w.cat === '有氧'
          ? (w.duration ? w.duration + '分' : '有氧')
          : ((w.sets || []).length + '组');
        return `<button class="chip" data-recentwo="${esc(w.id)}">${esc(w.name)}<small>${esc(sub)}</small></button>`;
      }).join('') + '</div>';
  }
  document.addEventListener('click', e => {
    const rc = e.target.closest('[data-recentwo]'); if (!rc) return;
    const w = db.workouts.find(x => x.id === rc.dataset.recentwo); if (!w) return;
    applyWorkoutToForm(w); // 不设 editing.workout:保存时新建记录
    toast('已带入上次的记录,改改重量/次数就能存');
  });
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
      let moved = false;
      if (w) {
        delete w.sets; delete w.duration; delete w.distance; delete w.burn;
        Object.assign(w, wo);
        if (editDate.workout && editDate.workout !== w.date) { w.date = editDate.workout; sel.training = w.date; moved = true; }
      }
      editing.workout = null; editDate.workout = null;
      save(); scheduleSync(); closeSheet(); toast(moved ? '已挪到「' + labelForKey(sel.training) + '」' : '已更新'); renderAll();
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

  /* ---------- 组间休息计时器 ---------- */
  // 页面内倒计时 + 结束时提示音/震动/toast。不用 Notification API:iOS PWA 的本地通知
  // 不可靠(需要推送服务),做一半不如不做;锁屏/切后台时 iOS 会暂停 JS 定时器,
  // 回到 app 的瞬间会立即补发结束提醒。计时全局存活,关掉弹层不中断。
  let restEnd = 0, restDur = 0, restTimer = null, restCtx = null;
  function restBeep() {
    try {
      restCtx = restCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (restCtx.state === 'suspended') restCtx.resume();
      [0, 0.25].forEach(t0 => { // 两声短哔
        const o = restCtx.createOscillator(), g = restCtx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        const t = restCtx.currentTime + t0;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(restCtx.destination);
        o.start(t); o.stop(t + 0.2);
      });
    } catch (e) { /* 没声就没声,还有震动和 toast */ }
  }
  function renderRest() {
    const el = $('#rest-left'); if (!el) return;
    const left = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
    el.hidden = !restEnd;
    if (restEnd) el.innerHTML = left + 's <small>点我取消</small>';
    $$('#rest-row .rest-btn').forEach(b => b.classList.toggle('on', restEnd > 0 && +b.dataset.rest === restDur));
  }
  function stopRest() {
    clearInterval(restTimer); restTimer = null; restEnd = 0; restDur = 0;
    renderRest();
  }
  function startRest(sec) {
    if (!(sec > 0)) { stopRest(); return; }
    clearInterval(restTimer);
    restDur = sec; restEnd = Date.now() + sec * 1000;
    // 用户手势里先解锁 AudioContext,结束时才放得出声(iOS 要求)
    try {
      restCtx = restCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (restCtx.state === 'suspended') restCtx.resume();
    } catch (e) {}
    renderRest();
    restTimer = setInterval(() => {
      if (Date.now() >= restEnd) {
        stopRest();
        restBeep();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        toast('休息结束,下一组!');
      } else renderRest();
    }, 250);
  }
  document.addEventListener('click', e => {
    const rb = e.target.closest('.rest-btn[data-rest]');
    if (rb) { startRest(+rb.dataset.rest); return; }
    if (e.target.closest('#rest-left')) { stopRest(); toast('已取消休息计时'); }
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

  /* ---------- 动作历史 / PR ---------- */
  // 纯函数:同名动作的记录数组 → 走势序列与 PR。
  // 力量=每天最大重量(kg);徒手=每天总次数;有氧=每天时长(分钟)。类别以最近一次为准。
  function histSeries(list) {
    const recs = (list || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    if (!recs.length) return null;
    const cat = recs[recs.length - 1].cat;
    const byDate = {};
    recs.forEach(w => {
      let v = 0;
      if (cat === '有氧') v = Number(w.duration) || 0;
      else if (cat === '徒手') v = (w.sets || []).reduce((a, s) => a + (Number(s.reps) || 0), 0);
      else v = (w.sets || []).reduce((a, s) => Math.max(a, Number(s.w) || 0), 0);
      if (cat === '力量') byDate[w.date] = Math.max(byDate[w.date] || 0, v); // 同天多条取最大
      else byDate[w.date] = (byDate[w.date] || 0) + v;                       // 次数/时长同天累加
    });
    const points = Object.keys(byDate).sort().map(d => ({ date: d, v: byDate[d] })).filter(p => p.v > 0);
    if (!points.length) return null;
    let pr = points[0];
    points.forEach(p => { if (p.v >= pr.v) pr = p; }); // 平纪录取最近一次
    return {
      cat, points, pr,
      metric: cat === '有氧' ? '最长时长' : cat === '徒手' ? '单日最多次数' : '最大重量',
      unit: cat === '有氧' ? '分钟' : cat === '徒手' ? '次' : 'kg'
    };
  }
  function openHistory(name) {
    name = (name || '').trim(); if (!name) return;
    const recs = db.workouts.filter(w => (w.name || '').trim() === name);
    const title = $('#hist-title'), box = $('#hist-body');
    if (!title || !box) return;
    title.textContent = name;
    const h = histSeries(recs);
    if (!h) {
      box.innerHTML = '<p class="hint">这个动作还没有可统计的记录。</p>';
    } else {
      const pts = h.points.slice(-20); // 图最多画近 20 个训练日
      const chart = pts.length >= 2
        ? `<div class="chart">${lineChart(pts.map(p => p.v), pts.map(p => p.date))}</div>`
        : '<p class="hint">再练一次就有走势图了(目前只有 1 天记录)。</p>';
      const prD = fromKey(h.pr.date);
      const recent = recs.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 5).map(w => {
        let d;
        if (w.cat === '有氧') d = [w.duration ? w.duration + ' 分钟' : '', w.distance ? w.distance + ' km' : ''].filter(Boolean).join(' · ');
        else d = (w.sets || []).map(s => (Number(s.w) ? s.w + 'kg×' : '×') + (s.reps || 0)).join('  ');
        return `<div class="mg-detrow"><span>${esc(labelForKey(w.date))}</span><b>${esc(d || '—')}</b></div>`;
      }).join('');
      box.innerHTML = `
        <div class="pr-line"><span class="pr-cap">PR · ${esc(h.metric)}</span>
          <span class="pr-val">${h.pr.v}<small> ${esc(h.unit)}</small></span>
          <span class="pr-date">${prD.getMonth() + 1}月${prD.getDate()}日</span></div>
        ${chart}
        <p class="rm-cap" style="margin-top:12px">最近 ${Math.min(recs.length, 5)} 次</p>
        ${recent}
        <p class="hint">${h.cat === '力量' ? '曲线为每天的最大重量。' : h.cat === '徒手' ? '曲线为每天总次数。' : '曲线为每天时长。'}共 ${h.points.length} 个训练日。</p>`;
    }
    open('history');
  }

  /* ---------- 训练模板:把某天的动作组存为模板,一键套用 ---------- */
  function renderTemplateSheet() {
    const list = $('#tpl-list'); if (!list) return;
    const tpls = db.templates || [];
    list.innerHTML = tpls.length
      ? tpls.map(t => {
          const names = (t.items || []).map(i => i.name).filter(Boolean);
          return `<div class="tpl-row">
            <div class="r-body"><p class="r-title">${esc(t.name)}</p>
              <p class="r-sub">${esc(names.slice(0, 4).join('、') + (names.length > 4 ? ' 等' : ''))} · ${(t.items || []).length} 个动作</p></div>
            <button class="pill-btn pill-sm" data-tpl-apply="${esc(t.id)}">套用</button>
            <button class="r-del" data-tpl-del="${esc(t.id)}" aria-label="删除模板">${I_TRASH}</button>
          </div>`;
        }).join('')
      : '<p class="hint">还没有模板。先记一天训练,再回这里把那天存成模板(如 推日 / 拉日 / 腿日)。</p>';
    const box = $('#tpl-save-box'), cap = $('#tpl-save-cap');
    if (box) {
      const wos = workoutsOn(sel.training);
      box.hidden = !wos.length;
      if (cap && wos.length) cap.textContent = `把「${labelForKey(sel.training)}」的 ${wos.length} 个动作存为模板`;
    }
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#tpl-save')) {
      const nameEl = $('#tpl-name');
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) { toast('给模板起个名吧,如 推日'); return; }
      const wos = workoutsOn(sel.training);
      if (!wos.length) { toast('这天没有动作'); return; }
      const items = wos.map(w => {
        const it = { cat: w.cat, name: w.name };
        if (w.cat === '有氧') { it.duration = w.duration || 0; it.distance = w.distance || 0; }
        else it.sets = (w.sets || []).map(s => ({ w: s.w, reps: s.reps }));
        if (w.burn) it.burn = w.burn;         // 沿用消耗估算(组数相同时数值可信)
        if (w.muscles) it.muscles = w.muscles; // 沿用发力肌群
        return it;
      });
      db.templates.push({ id: uid(), name, items, ts: Date.now() });
      if (nameEl) nameEl.value = '';
      save(); scheduleSync(); renderTemplateSheet();
      toast('已存为模板「' + name + '」');
      return;
    }
    const ta = e.target.closest('[data-tpl-apply]');
    if (ta) {
      const t = (db.templates || []).find(x => x.id === ta.dataset.tplApply); if (!t) return;
      (t.items || []).forEach(it => {
        db.workouts.push(Object.assign({ id: uid(), date: sel.training, ts: Date.now() }, JSON.parse(JSON.stringify(it))));
      });
      save(); scheduleSync(); closeSheet(); renderAll(); goto('training');
      toast(`已套用「${t.name}」· ${(t.items || []).length} 个动作,点条目可改重量`);
      return;
    }
    const td = e.target.closest('[data-tpl-del]');
    if (td) {
      const id = td.dataset.tplDel;
      const t = (db.templates || []).find(x => x.id === id); if (!t) return;
      db.templates = db.templates.filter(x => x.id !== id);
      db.tombstones[id] = Date.now(); // 与餐/动作同一套墓碑,同步后其他设备也会删掉
      save(); scheduleSync(); renderTemplateSheet();
      toast('已删除模板', {
        label: '撤销',
        fn() {
          delete db.tombstones[id];
          t.ts = Date.now();
          db.templates.push(t);
          save(); scheduleSync(); renderTemplateSheet();
        }
      });
    }
  });

  /* ---------- weight ---------- */
  $('#save-weight').addEventListener('click', () => {
    const kg = parseFloat($('#weight-input').value);
    if (!kg || kg <= 0) { toast('填一下体重'); return; }
    const prev = latestWeight(); // 记录前的最近体重,用于庆祝判断
    const existing = db.weights.find(w => w.date === todayKey);
    if (existing) { existing.kg = kg; existing.ts = Date.now(); }
    else db.weights.push({ date: todayKey, kg, ts: Date.now() });
    save(); scheduleSync(); closeSheet(); renderStats();
    const tgt = Number(db.settings.targetWeight) || 0;
    if (tgt > 0 && kg <= tgt && (prev <= 0 || prev > tgt)) { // 这一次跨过了目标线
      toast('到达目标体重 ' + tgt + ' kg,了不起!');
      celebrate(true);
    } else {
      toast('体重已记录');
      if (prev > 0 && kg < prev) celebrate(true); // 比上次轻,来点彩带
    }
  });

  /* ---------- settings ---------- */
  /* Mifflin-St Jeor(1990)纯函数:BMR = 10kg + 6.25cm − 5age + (男+5/女−161)。
     日常消耗 = BMR×1.2(久坐系数)——app 里训练消耗是单独加的,所以这里不能用运动系数,否则重复计算。
     建议摄入 = 日常消耗 − 500(≈0.45kg/周),下限 1200 防极端节食。公式个体差异 ±10%,自校准 TDEE 后以实测为准。 */
  function mifflinCalc(kg, cm, age, sex) {
    if (!(kg > 0) || !(cm > 0) || !(age > 0)) return null;
    const bmr = Math.round(10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5));
    const daily = Math.round(bmr * 1.2);
    return { bmr, daily, intake: Math.max(daily - 500, 1200) };
  }
  if ($('#calc-bmr')) $('#calc-bmr').addEventListener('click', () => {
    const kg = latestWeight();
    if (!kg) { toast('先在数据页记一次体重'); return; }
    const r = mifflinCalc(kg,
      parseFloat($('#set-height').value) || 0,
      parseInt($('#set-age').value, 10) || 0,
      ($('#set-sex') || {}).value === 'f' ? 'f' : 'm');
    if (!r) { toast('身高和年龄填一下'); return; }
    $('#set-bmr').value = r.daily;
    $('#set-target').value = r.intake;
    const def = r.daily - r.intake;
    const el = $('#calc-bmr-result');
    if (el) {
      el.innerHTML = `按 ${kg}kg:BMR ${r.bmr} → 日常消耗 ≈ <b>${r.daily}</b>(×1.2 久坐,训练另算)· 建议摄入 ≈ <b>${r.intake}</b>(缺口 ${def},不练日约 ${(def * 7 / 7700).toFixed(2)} kg/周)。两个数已填入上方,可手改,记得点保存。公式有 ±10% 个体差异,记录攒两周后用数据页「自校准消耗」校正。`;
      el.hidden = false;
    }
  });
  function fillSettings() {
    $('#set-name').value = db.settings.name || '';
    $('#set-target').value = db.settings.target || '';
    $('#set-bmr').value = db.settings.bmr || '';
    const sh = $('#set-height'); if (sh) sh.value = db.settings.height || '';
    const sa = $('#set-age'); if (sa) sa.value = db.settings.age || '';
    const sx = $('#set-sex'); if (sx) sx.value = db.settings.sex === 'f' ? 'f' : 'm';
    const cr = $('#calc-bmr-result'); if (cr) cr.hidden = true;
    const tw = $('#set-tgtw'); if (tw) tw.value = db.settings.targetWeight || ''; // 判空:SW 升级间隙可能是旧 HTML
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
    db.settings.targetWeight = parseFloat(($('#set-tgtw') || {}).value) || 0;
    db.settings.height = parseFloat(($('#set-height') || {}).value) || 0;
    db.settings.age = parseInt(($('#set-age') || {}).value, 10) || 0;
    db.settings.sex = ($('#set-sex') || {}).value === 'f' ? 'f' : 'm';
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

  /* ---------- 粘贴导入:整段训练笔记 → AI 批量解析(消耗+肌群一次全包) → 预览确认 → 入库 ----------
     入库后热力图/历史/PR/容量/周报全部自动生效(都从 db.workouts 取数,零改动)。
     拆组口径(2026-07-19 用户拍板):同一重量大次数是总次数,按 10 次/组拆;逐段写的每段各一组。 */
  const PASTE_DRAFT_KEY = 'qingheng.pastedraft';
  const PARSE_PROMPT = '你是训练笔记解析助手。用户会粘贴一整段自由格式的训练笔记(中英混写、通常每行一个动作、可能带日期和备注),输入为 json {"note":"笔记原文","weight_kg":用户体重(0 表示未知按 70 算)}。把笔记拆成一条条动作记录,并逐条用 MET 方法估算总消耗(kcal)与主要发力肌群(2-4 个),输出 json:{"date":"笔记里写的日期,格式 MM-DD,没写则 null","items":[{"cat":"力量|有氧|徒手","name":"动作名,保留用户原文叫法","sets":[{"kg":0,"reps":0}],"duration_min":0,"distance_km":0,"kcal":0,"note":"一句话假设说明","muscles":[{"m":"肌群slug","i":0到1的发力占比}]}]},不要输出任何其他文字。规则:1) 组数拆法:「80kg x40」这种同一重量的大次数是总次数,按每组 10 次拆(x40→4 组×10);「72kg x10 68kg x10」这种逐段写的,每段各是一组;单段次数≤15 按原样一组。2) sets 里的 kg 照笔记原样填器械标示重量(assist/助力器械的配重也照填);但估算 kcal 时:哑铃/单手器械按单只、动作通常双手各持一只则总负重×2,杠铃/固定器械为总重,assist/助力器械的实际负重≈体重−配重,用户备注(如「重量不包括单杠」)必须采纳;所有假设写进该条 note。3) 力量/徒手按整个动作段估算:每组约 40 秒做组(MET 按强度 3.5-6)+ 60-90 秒组间恢复(MET≈2),即 组数×(做组+休息)全周期,不要只算做组秒数,也不要按整次训练时长高估。4) 有氧填 duration_min/distance_km,sets 给空数组。5) m 只能取:trapezius,upper-back,lower-back,chest,biceps,triceps,forearm,back-deltoids,front-deltoids,abs,obliques,adductor,abductors,hamstring,quadriceps,calves,gluteal,neck。6) kcal 取整数;认不出的行跳过;整段都认不出返回 {"error":"原因"}。';
  let pasteItems = null, pasteDate = todayKey, pasteDraftT = null;

  // 大次数拆组(纯函数):>15 视为总次数 → N 组×10 + 余数一组;≤15 原样一组
  function splitBigReps(kg, reps) {
    reps = Math.round(Number(reps) || 0);
    if (reps <= 0) return [];
    if (reps <= 15) return [{ w: kg, reps }];
    const out = [];
    for (let n = Math.floor(reps / 10); n > 0; n--) out.push({ w: kg, reps: 10 });
    if (reps % 10) out.push({ w: kg, reps: reps % 10 });
    return out;
  }
  // AI 返回 → 规范化(纯函数):日期补年/回退、类别白名单、拆组兜底、肌群 slug 过滤、废条目剔除
  function normalizeParsed(data, fallbackDate) {
    const CATS = ['力量', '有氧', '徒手'];
    let date = fallbackDate, m;
    const ds = data && typeof data.date === 'string' ? data.date.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) date = ds;
    else if ((m = ds.match(/^(\d{1,2})-(\d{1,2})$/))) date = fallbackDate.slice(0, 4) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    const items = (data && Array.isArray(data.items) ? data.items : []).map(it => {
      if (!it || typeof it !== 'object') return null;
      const name = String(it.name || '').trim().slice(0, 60);
      if (!name) return null;
      const cat = CATS.indexOf(it.cat) >= 0 ? it.cat : '力量';
      const o = {
        cat, name,
        kcal: Math.max(0, Math.round(Number(it.kcal) || 0)),
        note: String(it.note || '').slice(0, 120),
        muscles: cleanMuscles(it.muscles)
      };
      if (cat === '有氧') {
        o.duration = Math.max(0, Math.round(Number(it.duration_min) || 0));
        const dist = Number(it.distance_km) || 0;
        if (dist > 0) o.distance = dist;
        if (!o.duration) return null;
      } else {
        o.sets = (Array.isArray(it.sets) ? it.sets : [])
          .reduce((a, s) => a.concat(splitBigReps(Number(s && s.kg) || 0, s && s.reps)), [])
          .slice(0, 30);
        if (!o.sets.length) return null;
      }
      return o;
    }).filter(Boolean).slice(0, 40);
    return { date, items };
  }
  // 预览里手改组数:「80×10 70x8 ×12」→ sets(纯函数,和 setsText 互逆)
  function parseSetsText(t) {
    const out = [];
    String(t || '').split(/[,;，；\s]+/).forEach(seg => {
      const m = seg.match(/^(?:(\d+(?:\.\d+)?)(?:kg)?)?[x×*](\d+)$/i);
      if (m) { const reps = Math.round(Number(m[2])); if (reps > 0) out.push({ w: m[1] ? Number(m[1]) : 0, reps }); }
    });
    return out;
  }
  function setsText(sets) { return (sets || []).map(s => (Number(s.w) ? s.w + '×' + s.reps : '×' + s.reps)).join(' '); }

  /* 草稿:文本 + 已解析结果都缓存,误触关掉不丢、不用重花一次 AI 调用(仅本地,不同步) */
  function savePasteDraft() {
    if (openSheet !== 'paste') return;
    const d = { text: $('#paste-text') ? $('#paste-text').value : '', ts: Date.now() };
    if (pasteItems && pasteItems.length) { d.items = pasteItems; d.date = pasteDate; }
    try {
      if ((d.text || '').trim() || d.items) localStorage.setItem(PASTE_DRAFT_KEY, JSON.stringify(d));
      else localStorage.removeItem(PASTE_DRAFT_KEY);
    } catch (e) {}
  }
  function schedulePasteDraft() { clearTimeout(pasteDraftT); pasteDraftT = setTimeout(savePasteDraft, 300); }
  function clearPasteDraft() { try { localStorage.removeItem(PASTE_DRAFT_KEY); } catch (e) {} }
  document.addEventListener('input', e => { if (e.target.closest('#sheet-paste')) schedulePasteDraft(); });

  function showPasteInput() {
    const i = $('#paste-in-box'), p = $('#paste-preview');
    if (i) i.hidden = false; if (p) p.hidden = true;
  }
  function resetPasteSheet() {
    pasteItems = null; pasteDate = sel.training;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(PASTE_DRAFT_KEY) || 'null'); } catch (e) {}
    if (d && Date.now() - (d.ts || 0) > 86400000) { clearPasteDraft(); d = null; }
    if ($('#paste-text')) $('#paste-text').value = (d && d.text) || '';
    const b = $('#paste-parse'); if (b) { b.disabled = false; b.textContent = 'AI 解析'; }
    if (d && Array.isArray(d.items) && d.items.length) {
      pasteItems = d.items; pasteDate = d.date || sel.training;
      renderPastePreview();
      toast('已恢复上次解析结果', { label: '清空', fn() { pasteItems = null; clearPasteDraft(); if ($('#paste-text')) $('#paste-text').value = ''; showPasteInput(); } });
    } else showPasteInput();
  }
  function renderPastePreview() {
    const p = $('#paste-preview'); if (!p || !pasteItems) return;
    const i = $('#paste-in-box'); if (i) i.hidden = true; p.hidden = false;
    const di = $('#paste-date'); if (di) di.value = pasteDate;
    const ex = $('#paste-exist');
    if (ex) {
      const n = workoutsOn(pasteDate).length;
      ex.hidden = !n;
      if (n) ex.textContent = '「' + labelForKey(pasteDate) + '」已有 ' + n + ' 个动作,导入会追加,不会覆盖。';
    }
    const CATS = ['力量', '有氧', '徒手'];
    $('#paste-list').innerHTML = pasteItems.map((it, idx) => {
      const mus = (it.muscles || []).map(x => MUSCLE_CN[x.m] || x.m).join(' · ');
      const foot = [mus, it.kcal ? it.note : ''].filter(Boolean).join(' · ');
      const mid = it.cat === '有氧'
        ? `<label class="pi-f"><span>分钟</span><input class="pi-dur" data-pi="${idx}" type="number" inputmode="numeric" value="${it.duration || ''}"></label>
           <label class="pi-f"><span>km</span><input class="pi-dist" data-pi="${idx}" type="number" inputmode="decimal" value="${it.distance || ''}"></label>`
        : `<label class="pi-f grow"><span>组(kg×次)</span><input class="pi-sets" data-pi="${idx}" autocomplete="off" value="${esc(setsText(it.sets))}"></label>`;
      return `<div class="pi">
        <div class="pi-row">
          <input class="pi-name" data-pi="${idx}" autocomplete="off" value="${esc(it.name)}">
          <select class="pi-cat" data-pi="${idx}">${CATS.map(c => `<option${c === it.cat ? ' selected' : ''}>${c}</option>`).join('')}</select>
          <button class="r-del" data-pi-del="${idx}" aria-label="删除">${I_TRASH}</button>
        </div>
        <div class="pi-row">
          ${mid}
          <label class="pi-f"><span>kcal</span><input class="pi-kcal" data-pi="${idx}" type="number" inputmode="numeric" value="${it.kcal || ''}"></label>
        </div>
        ${foot ? `<p class="pi-mus">${esc(foot)}</p>` : ''}
      </div>`;
    }).join('');
    const sv = $('#paste-save');
    if (sv) sv.textContent = pasteItems.length ? '确认导入 ' + pasteItems.length + ' 个动作' : '没有可导入的动作';
  }

  if ($('#paste-parse')) $('#paste-parse').addEventListener('click', async () => {
    const text = ($('#paste-text').value || '').trim();
    if (!text) { toast('先粘贴训练笔记'); return; }
    if (!db.settings.dsKey) { toast('先在设置里填 DeepSeek API Key'); return; }
    if (!navigator.onLine) { toast('离线状态无法解析'); return; }
    const btn = $('#paste-parse');
    btn.disabled = true; btn.textContent = '解析中…(整段一起,约十几秒)';
    try {
      const res = await dsJson(PARSE_PROMPT, JSON.stringify({ note: text, weight_kg: latestWeight() || 0 }), 4000);
      const norm = normalizeParsed(res, sel.training);
      if (!norm.items.length) throw new Error('没解析出任何动作,检查一下文本?');
      pasteItems = norm.items; pasteDate = norm.date;
      renderPastePreview(); savePasteDraft();
      dlog('paste', '解析出 ' + norm.items.length + ' 条 → ' + norm.date);
    } catch (e) { toast(String(e.message || e)); dlog('paste', '解析失败: ' + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = 'AI 解析'; }
  });
  if ($('#paste-list')) {
    $('#paste-list').addEventListener('input', e => {
      const it = pasteItems && pasteItems[+e.target.dataset.pi]; if (!it) return;
      if (e.target.classList.contains('pi-name')) it.name = e.target.value.trim();
      else if (e.target.classList.contains('pi-sets')) it.sets = parseSetsText(e.target.value);
      else if (e.target.classList.contains('pi-kcal')) it.kcal = Math.max(0, Math.round(Number(e.target.value) || 0));
      else if (e.target.classList.contains('pi-dur')) it.duration = Math.max(0, Math.round(Number(e.target.value) || 0));
      else if (e.target.classList.contains('pi-dist')) it.distance = Number(e.target.value) || 0;
    });
    $('#paste-list').addEventListener('change', e => {
      if (!e.target.classList.contains('pi-cat')) return;
      const it = pasteItems && pasteItems[+e.target.dataset.pi]; if (!it) return;
      const cat = e.target.value;
      if (it.cat === cat) return;
      if (cat === '有氧') { it.duration = it.duration || 0; delete it.sets; }
      else if (it.cat === '有氧') { it.sets = it.sets && it.sets.length ? it.sets : [{ w: 0, reps: 10 }]; delete it.duration; delete it.distance; }
      it.cat = cat;
      renderPastePreview(); schedulePasteDraft();
    });
    $('#paste-list').addEventListener('click', e => {
      const del = e.target.closest('[data-pi-del]'); if (!del || !pasteItems) return;
      pasteItems.splice(+del.dataset.piDel, 1);
      renderPastePreview(); schedulePasteDraft();
    });
  }
  if ($('#paste-date')) $('#paste-date').addEventListener('change', e => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
    pasteDate = e.target.value; renderPastePreview(); schedulePasteDraft();
  });
  if ($('#paste-back')) $('#paste-back').addEventListener('click', showPasteInput);
  if ($('#paste-save')) $('#paste-save').addEventListener('click', () => {
    if (!pasteItems || !pasteItems.length) { toast('没有可导入的动作'); return; }
    const bad = pasteItems.find(it => !it.name || (it.cat === '有氧' ? !(it.duration > 0) : !(it.sets && it.sets.length)));
    if (bad) { toast('「' + (bad.name || '未命名') + '」还缺组数/时长,补一下或删掉它'); return; }
    const now = Date.now();
    pasteItems.forEach((it, i) => {
      const w = { id: uid(), date: pasteDate, cat: it.cat, name: it.name, ts: now + i };
      if (it.cat === '有氧') { w.duration = it.duration; if (it.distance) w.distance = it.distance; }
      else w.sets = it.sets.map(s => ({ w: s.w || '', reps: s.reps }));
      if (it.kcal) w.burn = it.kcal;      // AI 估算的消耗,口径同单条「AI 估算消耗」
      if (it.muscles) w.muscles = it.muscles; // 没给的走 musclesFor 关键词兜底
      db.workouts.push(w);
    });
    const n = pasteItems.length;
    pasteItems = null; clearPasteDraft();
    if ($('#paste-text')) $('#paste-text').value = '';
    sel.training = pasteDate; // 直接跳到导入的那天,所见即所得
    save(); scheduleSync(); closeSheet(); renderAll(); goto('training');
    toast('已导入 ' + n + ' 个动作');
  });

  /* ---------- CSV 导出(meals/workouts/weights,进 Excel 用;不含任何密钥) ---------- */
  function csvEsc(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(rows) { return rows.map(r => r.map(csvEsc).join(',')).join('\n'); }
  function dlText(name, text) {
    // \ufeff BOM:让 Excel 正确识别 UTF-8 中文
    const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function csvExport() {
    const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    const files = [];
    if (db.meals.length) {
      const tt = m => (m.nutrients && m.nutrients.total) || {};
      files.push(['轻衡-饮食-' + todayKey + '.csv', toCsv(
        [['日期', '餐型', '内容', '热量kcal', '蛋白g', '脂肪g', '碳水g', '纤维g']].concat(
          db.meals.slice().sort(byDate).map(m => {
            const t = tt(m);
            return [m.date, m.type, m.name || '', m.kcal || 0, m.protein || 0,
              t.fat != null ? t.fat : '', t.carbs != null ? t.carbs : '', t.fiber != null ? t.fiber : ''];
          })))]);
    }
    if (db.workouts.length) {
      files.push(['轻衡-训练-' + todayKey + '.csv', toCsv(
        [['日期', '类别', '动作', '组数', '明细', '容量kg', '时长min', '距离km', '消耗kcal']].concat(
          db.workouts.slice().sort(byDate).map(w => {
            const sets = w.sets || [];
            const detail = w.cat === '有氧' ? '' : sets.map(s => (Number(s.w) ? s.w + 'kg×' : '×') + (s.reps || 0)).join(';');
            const vol = sets.reduce((a, s) => a + (Number(s.w) || 0) * (Number(s.reps) || 0), 0);
            return [w.date, w.cat, w.name || '', sets.length || '', detail, vol || '', w.duration || '', w.distance || '', w.burn || ''];
          })))]);
    }
    if (db.weights.length) {
      files.push(['轻衡-体重-' + todayKey + '.csv', toCsv(
        [['日期', '体重kg']].concat(db.weights.slice().sort(byDate).map(w => [w.date, w.kg])))]);
    }
    if (!files.length) { toast('还没有可导出的记录'); return; }
    files.forEach((f, i) => setTimeout(() => dlText(f[0], f[1]), i * 400)); // 间隔触发,避免浏览器拦多文件下载
    toast('已导出 ' + files.length + ' 个 CSV');
  }
  if ($('#export-csv')) $('#export-csv').addEventListener('click', csvExport);

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
    const templates = mergeList(local.templates, remote.templates); // 训练模板同样走 id+ts+墓碑
    const supps = mergeList(local.supps, remote.supps);             // 补剂定义与打卡同样走 id+ts+墓碑
    const suppLogs = mergeList(local.suppLogs, remote.suppLogs);

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

    return { meals, workouts, weights, templates, supps, suppLogs, settings, tombstones: tomb, syncedAt: local.syncedAt || 0 };
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
    const hb = e.target.closest('[data-hist]');
    if (hb) { openHistory(hb.dataset.hist); return; } // 行尾走势按钮,不进编辑
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
  window.__qh_test = { mergeDb, cleanMuscles, splitNameAmount, mealFoods, toCsv, forecastDays, histSeries, tdeeFromLogs, foodIndex, suppNutrition, normalizeParsed, parseSetsText, mifflinCalc, groupWorkouts, setsSummary, setBarsHtml };

  /* ---------- init ---------- */
  renderToday();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  syncNow(true);
})();
