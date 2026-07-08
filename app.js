/* ================= 轻衡 · app logic ================= */
(function () {
  'use strict';

  /* ---------- storage ---------- */
  const KEY = 'qingheng.v1';
  const defaults = {
    meals: [],      // {id,date,type,name,kcal,protein}
    workouts: [],   // {id,date,cat,name,sets:[{w,reps}],duration,distance,burn}
    weights: [],    // {date,kg}
    settings: { name: '', target: 1600, bmr: 1400 }
  };
  let db;
  try {
    db = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}'));
    db.settings = Object.assign({}, defaults.settings, db.settings || {});
  } catch (e) { db = JSON.parse(JSON.stringify(defaults)); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('保存失败,存储空间可能已满'); }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
  const sel = { diet: todayKey, training: todayKey };

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
      if (w.cat === '有氧') {
        if (w.burn) return a + Number(w.burn);
        return a + Math.round((Number(w.duration) || 0) * 8);
      }
      const sets = (w.sets || []).length;
      return a + sets * 6; // rough estimate for strength/bodyweight
    }, 0);
  }
  function outputOn(k) { return (Number(db.settings.bmr) || 0) + trainingBurnOn(k); }
  function deficitOn(k) { return outputOn(k) - intakeOn(k); }

  /* ---------- DOM ---------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------- navigation ---------- */
  function goto(name) {
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
    const d = new Date();
    $('#today-date').textContent = `${d.getMonth() + 1}月${d.getDate()}日 · 周${WD[d.getDay()]}`;
    const hr = d.getHours();
    const hello = hr < 5 ? '夜深了' : hr < 11 ? '早上好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
    $('#greeting').textContent = db.settings.name ? `${hello},${db.settings.name}` : hello;

    const inK = intakeOn(todayKey), outK = outputOn(todayKey), net = outK - inK;
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

    // today meals / workouts (read-only compact)
    const meals = mealsOn(todayKey);
    $('#today-meals').innerHTML = meals.length
      ? meals.map(m => rowMeal(m, false)).join('')
      : `<div class="empty">还没记今天的餐 🥗</div>`;
    const wos = workoutsOn(todayKey);
    $('#today-workouts').innerHTML = wos.length
      ? wos.map(w => rowWorkout(w, false)).join('')
      : `<div class="empty">还没记今天的训练 💪</div>`;
  }

  /* ---------- row templates ---------- */
  function rowMeal(m, del) {
    return `<div class="row">
      <div class="r-icon i-teal">${mealEmoji(m.type)}</div>
      <div class="r-body"><p class="r-title">${esc(m.name || m.type)}</p>
        <p class="r-sub">${m.type}${m.protein ? ' · 蛋白 ' + m.protein + 'g' : ''}</p></div>
      <p class="r-val">${m.kcal || 0}<small>kcal</small></p>
      ${del ? `<button class="r-del" data-del="meal" data-id="${m.id}">✕</button>` : ''}
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
    return `<div class="row">
      <div class="r-icon i-coral">${catEmoji(w.cat)}</div>
      <div class="r-body"><p class="r-title">${esc(w.name || w.cat)}</p><p class="r-sub">${w.cat} · ${sub}</p></div>
      <p class="r-val">${val}</p>
      ${del ? `<button class="r-del" data-del="workout" data-id="${w.id}">✕</button>` : ''}
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
    $('#diet-list').innerHTML = groups || `<div class="empty">这天还没有饮食记录<br>点下面「记一餐」开始</div>`;
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
      : `<div class="empty">这天还没有训练记录<br>点下面「加动作」开始</div>`;
  }

  /* ---------- STATS ---------- */
  function renderStats() {
    // weight chart
    const ws = db.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(-14);
    const wc = $('#weight-chart'), we = $('#weight-empty');
    if (ws.length < 1) { wc.innerHTML = ''; we.style.display = 'block'; $('#weight-trend').textContent = '—'; }
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
    const ins = days.map(intakeOn), outs = days.map(outputOn);
    const max = Math.max(...ins, ...outs, 1);
    const W = 320, H = 140, padB = 20, padT = 8;
    const bw = 9, gap = 3;
    const slot = (W) / days.length;
    let bars = '';
    days.forEach((k, i) => {
      const cx = i * slot + slot / 2;
      const hi = ins[i] / max * (H - padB - padT);
      const ho = outs[i] / max * (H - padB - padT);
      const base = H - padB;
      bars += `<rect x="${cx - bw - gap / 2}" y="${(base - hi).toFixed(1)}" width="${bw}" height="${hi.toFixed(1)}" rx="3" fill="#0fae9c"/>`;
      bars += `<rect x="${cx + gap / 2}" y="${(base - ho).toFixed(1)}" width="${bw}" height="${ho.toFixed(1)}" rx="3" fill="#ff6a45"/>`;
      const wd = WD[fromKey(k).getDay()];
      bars += `<text x="${cx}" y="${H - 6}" font-size="11" fill="#8b8f88" text-anchor="middle" font-weight="600">${k === todayKey ? '今' : wd}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}">${bars}</svg>`;
  }

  /* ---------- sheets ---------- */
  let openSheet = null;
  function open(name) {
    closeSheet();
    if (name === 'settings') fillSettings();
    if (name === 'workout') resetWorkoutSheet();
    if (name === 'meal') resetMealSheet();
    if (name === 'weight') $('#weight-input').value = '';
    const s = $('#sheet-' + name);
    s.hidden = false; $('#backdrop').hidden = false; openSheet = name;
    const first = s.querySelector('input'); if (first && name !== 'settings') setTimeout(() => first.focus(), 250);
  }
  function closeSheet() {
    if (openSheet) $('#sheet-' + openSheet).hidden = true;
    $('#backdrop').hidden = true; openSheet = null;
  }

  /* ---------- meal sheet ---------- */
  let mealType = '早餐';
  function resetMealSheet() {
    mealType = '早餐';
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === '早餐'));
    $('#meal-name').value = ''; $('#meal-kcal').value = ''; $('#meal-protein').value = '';
    // smart default by time
    const hr = new Date().getHours();
    const def = hr < 10 ? '早餐' : hr < 15 ? '午餐' : hr < 21 ? '晚餐' : '加餐';
    mealType = def;
    $$('#meal-type button').forEach(b => b.classList.toggle('active', b.dataset.v === def));
  }
  $('#meal-type').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    mealType = b.dataset.v; $$('#meal-type button').forEach(x => x.classList.toggle('active', x === b));
  });
  $('#save-meal').addEventListener('click', () => {
    const name = $('#meal-name').value.trim();
    const kcal = parseInt($('#meal-kcal').value, 10);
    if (!kcal || kcal <= 0) { toast('填一下热量吧'); return; }
    db.meals.push({ id: uid(), date: sel.diet, type: mealType, name, kcal, protein: parseInt($('#meal-protein').value, 10) || 0 });
    save(); closeSheet(); toast('已记录 ' + kcal + ' kcal'); renderAll();
    goto('diet');
  });

  /* ---------- workout sheet ---------- */
  let woCat = '力量';
  function resetWorkoutSheet() {
    woCat = '力量';
    $$('#workout-cat button').forEach(b => b.classList.toggle('active', b.dataset.v === '力量'));
    $('#wo-name').value = '';
    $('#wo-duration').value = ''; $('#wo-distance').value = ''; $('#wo-burn').value = '';
    setsData = [{ w: '', reps: '' }, { w: '', reps: '' }, { w: '', reps: '' }];
    renderSets(); applyCat();
  }
  let setsData = [];
  function renderSets() {
    $('#sets-col-w').textContent = woCat === '徒手' ? '(自重)' : '重量 kg';
    $('#sets-list').innerHTML = setsData.map((s, i) => `
      <div class="set-row" data-i="${i}">
        <span class="set-idx">${i + 1}</span>
        <input type="number" inputmode="decimal" class="s-w" placeholder="${woCat === '徒手' ? '—' : '0'}" value="${s.w}" ${woCat === '徒手' ? 'disabled' : ''}/>
        <input type="number" inputmode="numeric" class="s-r" placeholder="0" value="${s.reps}"/>
        <button class="set-del" data-si="${i}">✕</button>
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
    const wo = { id: uid(), date: sel.training, cat: woCat, name };
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
    }
    db.workouts.push(wo);
    save(); closeSheet(); toast('动作已记录 💪'); renderAll();
    goto('training');
  });

  /* ---------- weight ---------- */
  $('#save-weight').addEventListener('click', () => {
    const kg = parseFloat($('#weight-input').value);
    if (!kg || kg <= 0) { toast('填一下体重'); return; }
    const existing = db.weights.find(w => w.date === todayKey);
    if (existing) existing.kg = kg; else db.weights.push({ date: todayKey, kg });
    save(); closeSheet(); toast('体重已记录'); renderStats();
  });

  /* ---------- settings ---------- */
  function fillSettings() {
    $('#set-name').value = db.settings.name || '';
    $('#set-target').value = db.settings.target || '';
    $('#set-bmr').value = db.settings.bmr || '';
  }
  $('#save-settings').addEventListener('click', () => {
    db.settings.name = $('#set-name').value.trim();
    db.settings.target = parseInt($('#set-target').value, 10) || 1600;
    db.settings.bmr = parseInt($('#set-bmr').value, 10) || 1400;
    save(); closeSheet(); toast('已保存'); renderAll();
  });
  $('#export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `轻衡备份-${todayKey}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  });

  /* ---------- delete (event delegation) ---------- */
  document.addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (!del) return;
    const kind = del.dataset.del, id = del.dataset.id;
    if (kind === 'meal') db.meals = db.meals.filter(m => m.id !== id);
    if (kind === 'workout') db.workouts = db.workouts.filter(w => w.id !== id);
    save(); toast('已删除'); renderAll();
  });

  /* ---------- global click wiring ---------- */
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) { goto(g.dataset.goto); return; }
    const o = e.target.closest('[data-open]'); if (o) { open(o.dataset.open); return; }
    if (e.target.id === 'backdrop') { closeSheet(); return; }
    const dn = e.target.closest('[data-date]');
    if (dn) {
      const scr = dn.dataset.date, dir = +dn.dataset.dir;
      const next = shiftKey(sel[scr], dir);
      if (dir > 0 && next > todayKey) return; // no future
      sel[scr] = next; render(scr);
    }
  });

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 1800);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- init ---------- */
  renderToday();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
