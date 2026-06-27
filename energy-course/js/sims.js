/* ============================================================================
   sims.js — интерактивные модели (canvas). Чистый JS, без зависимостей.

   Каждая модель: функция(container) → возвращает { destroy() }.
   container — пустой <div>, внутрь которого модель строит canvas и контролы.
   Все модели сами держат свой requestAnimationFrame и убираются по destroy().
============================================================================ */

const SIMS = {};

/* ── вспомогательные строители UI ─────────────────────────────────────── */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function slider(label, min, max, val, step, onInput) {
  const wrap = el('div', 'sim-ctl');
  const lab = el('label', null, label);
  const valSpan = el('span', 'sim-val', '');
  const inp = el('input');
  inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val; inp.step = step;
  const update = () => { valSpan.textContent = onInput(parseFloat(inp.value)); };
  inp.addEventListener('input', update);
  lab.appendChild(valSpan);
  wrap.appendChild(lab); wrap.appendChild(inp);
  setTimeout(update, 0);
  return wrap;
}
function toggle(label, val, onChange) {
  const wrap = el('label', 'sim-toggle');
  const inp = el('input'); inp.type = 'checkbox'; inp.checked = val;
  inp.addEventListener('change', () => onChange(inp.checked));
  wrap.appendChild(inp); wrap.appendChild(document.createTextNode(' ' + label));
  return wrap;
}
function makeCanvas(container, h) {
  const c = el('canvas', 'sim-canvas');
  container.appendChild(c);
  const ctx = c.getContext('2d');
  function resize() {
    const w = container.clientWidth || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  return { c, ctx, resize, ro, W: () => c.clientWidth, H: () => h };
}
function loop(fn) {
  let raf, alive = true;
  function tick(t) { if (!alive) return; fn(t); raf = requestAnimationFrame(tick); }
  raf = requestAnimationFrame(tick);
  return () => { alive = false; cancelAnimationFrame(raf); };
}

/* ── общая «панель энергии» (горизонтальные столбики) ─────────────────── */
function drawBars(ctx, x, y, w, bars) {
  // bars: [{label,val,max,color}]
  const bh = 16, gap = 26;
  bars.forEach((b, i) => {
    const yy = y + i * gap;
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(x, yy, w, bh);
    const frac = Math.max(0, Math.min(1, b.val / b.max));
    ctx.fillStyle = b.color;
    ctx.fillRect(x, yy, w * frac, bh);
    ctx.fillStyle = '#dfe9ff';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(b.label, x, yy - 4);
    ctx.textAlign = 'right';
    ctx.fillText(b.text != null ? b.text : Math.round(b.val) + ' Дж', x + w, yy - 4);
    ctx.textAlign = 'left';
  });
}

/* ════════════════════════ 1. МАЯТНИК ════════════════════════ */
SIMS.pendulum = function (container) {
  const view = makeCanvas(container, 300);
  const ctrls = el('div', 'sim-controls');
  let friction = false, gain = 1;
  ctrls.appendChild(toggle('Трение (потери в тепло)', false, v => friction = v));
  ctrls.appendChild(slider('Длина подвеса', 0.6, 2.4, 1.4, 0.05, v => { L = v; return v.toFixed(2) + ' м'; }));
  const resetBtn = el('button', 'sim-btn', 'Отпустить заново');
  ctrls.appendChild(resetBtn);
  container.appendChild(ctrls);

  let L = 1.4, g = 9.8, m = 1;
  let theta = 0.9, omega = 0, heat = 0, E0 = 0;
  function reset() { theta = 0.9; omega = 0; heat = 0; E0 = m * g * (L * (1 - Math.cos(theta))); }
  reset();
  resetBtn.addEventListener('click', reset);

  let last = performance.now();
  const stop = loop((t) => {
    let dt = Math.min((t - last) / 1000, 0.033); last = t;
    // физика маятника
    const a = -(g / L) * Math.sin(theta) - (friction ? 0.6 * omega : 0);
    omega += a * dt; theta += omega * dt;
    // энергии
    const h = L * (1 - Math.cos(theta));
    const Ep = m * g * h;
    const v = omega * L;
    const Ek = 0.5 * m * v * v;
    if (friction) { const total = Ek + Ep + heat; heat = Math.max(0, E0 - Ek - Ep); }
    const ctx = view.ctx, W = view.W(), H = view.H();
    ctx.clearRect(0, 0, W, H);
    // подвес
    const ox = W * 0.32, oy = 40, scale = 90;
    const bx = ox + Math.sin(theta) * L * scale, by = oy + Math.cos(theta) * L * scale;
    ctx.strokeStyle = 'rgba(150,180,255,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = '#9fc1ff'; ctx.beginPath(); ctx.arc(ox, oy, 4, 0, 7); ctx.fill();
    // груз
    const speed = Math.min(1, Math.abs(v) / 4);
    ctx.fillStyle = `rgb(${90 + speed * 160},${150 - speed * 60},255)`;
    ctx.beginPath(); ctx.arc(bx, by, 16, 0, 7); ctx.fill();
    // столбики энергии
    drawBars(ctx, W * 0.55, 50, W * 0.4 - 20, [
      { label: 'Кинетическая', val: Ek, max: E0 || 1, color: '#4f8cff' },
      { label: 'Потенциальная', val: Ep, max: E0 || 1, color: '#36d399' },
      { label: 'Тепло (потери)', val: heat, max: E0 || 1, color: '#f87272' },
    ]);
    // полная энергия
    const total = Ek + Ep + heat;
    ctx.fillStyle = '#e8eeff'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText('Полная энергия: ' + total.toFixed(1) + ' Дж', W * 0.55, 150);
    ctx.fillStyle = friction ? '#f8b272' : '#36d399';
    ctx.fillText(friction ? '(механическая убывает → уходит в тепло)' : '(сохраняется!)', W * 0.55, 168);
  });
  return { destroy() { stop(); view.ro.disconnect(); } };
};

/* ════════════════════════ 2. ЭНТРОПИЯ (газ) ════════════════════════ */
SIMS.entropy = function (container) {
  const view = makeCanvas(container, 280);
  const ctrls = el('div', 'sim-controls');
  const startBtn = el('button', 'sim-btn', 'Запустить (убрать перегородку)');
  const resetBtn = el('button', 'sim-btn', 'Собрать в угол');
  ctrls.appendChild(startBtn); ctrls.appendChild(resetBtn);
  container.appendChild(ctrls);

  const N = 220; let parts = [], released = false;
  function init() {
    released = false; parts = [];
    const W = view.W();
    for (let i = 0; i < N; i++) {
      parts.push({ x: 10 + Math.random() * (W * 0.28), y: 10 + Math.random() * 260,
        vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * 2 });
    }
  }
  init();
  startBtn.addEventListener('click', () => released = true);
  resetBtn.addEventListener('click', init);

  const stop = loop(() => {
    const ctx = view.ctx, W = view.W(), H = view.H();
    const wall = W * 0.30;
    ctx.clearRect(0, 0, W, H);
    // сосуд
    ctx.strokeStyle = 'rgba(150,180,255,.4)'; ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    if (!released) { ctx.strokeStyle = 'rgba(255,200,120,.6)'; ctx.beginPath();
      ctx.moveTo(wall, 4); ctx.lineTo(wall, H - 4); ctx.stroke(); }
    // частицы
    let leftCount = 0;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      const lim = released ? W - 6 : wall;
      if (p.x < 6) { p.x = 6; p.vx *= -1; }
      if (p.x > lim) { p.x = lim; p.vx *= -1; }
      if (p.y < 6) { p.y = 6; p.vy *= -1; }
      if (p.y > H - 6) { p.y = H - 6; p.vy *= -1; }
      if (p.x < W / 2) leftCount++;
      ctx.fillStyle = '#7fd0ff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 7); ctx.fill();
    }
    // показатель «беспорядка»
    const balance = leftCount / N; // 1 = всё слева (порядок), .5 = размазано
    const disorder = 1 - Math.abs(balance - 0.5) * 2;
    ctx.fillStyle = '#dfe9ff'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText('Слева: ' + Math.round(balance * 100) + '%  ·  Энтропия (беспорядок): ' +
      Math.round(disorder * 100) + '%', 10, H - 12);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(W - 130, H - 22, 110, 10);
    ctx.fillStyle = '#f0a85a'; ctx.fillRect(W - 130, H - 22, 110 * disorder, 10);
  });
  return { destroy() { stop(); view.ro.disconnect(); } };
};

/* ════════════════════════ 3. ТЕПЛОВАЯ МАШИНА (Карно) ════════════════ */
SIMS.heatengine = function (container) {
  const view = makeCanvas(container, 240);
  const ctrls = el('div', 'sim-controls');
  let Th = 600, Tc = 30;
  ctrls.appendChild(slider('Горячий резервуар (нагрев)', 100, 1200, 600, 10, v => { Th = v; return v + ' °C'; }));
  ctrls.appendChild(slider('Холодный резервуар (охлаждение)', -20, 200, 30, 5, v => { Tc = v; return v + ' °C'; }));
  container.appendChild(ctrls);

  const stop = loop(() => {
    const ctx = view.ctx, W = view.W(), H = view.H();
    const ThK = Th + 273.15, TcK = Tc + 273.15;
    let eff = 1 - TcK / ThK; if (eff < 0) eff = 0;
    ctx.clearRect(0, 0, W, H);
    // горячий блок
    const hot = Math.min(1, Th / 1200);
    ctx.fillStyle = `rgb(${180 + hot * 70},${90 - hot * 60},${60 - hot * 50})`;
    ctx.fillRect(20, 40, 90, 160);
    ctx.fillStyle = '#fff'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('ГОРЯЧИЙ', 65, 30); ctx.fillText(Math.round(ThK) + ' К', 65, 120);
    // холодный блок
    const cold = Math.max(0, Math.min(1, (Tc + 20) / 220));
    ctx.fillStyle = `rgb(${60 + cold * 80},${120 + cold * 40},${200})`;
    ctx.fillRect(W - 110, 40, 90, 160);
    ctx.fillText('ХОЛОДНЫЙ', W - 65, 30); ctx.fillText(Math.round(TcK) + ' К', W - 65, 120);
    // машина в центре
    ctx.fillStyle = '#27406e'; ctx.fillRect(W / 2 - 50, 70, 100, 100);
    ctx.strokeStyle = '#7fa8ff'; ctx.strokeRect(W / 2 - 50, 70, 100, 100);
    // поток энергии: вход 100, работа eff*100, сброс остаток
    ctx.fillStyle = '#f8b272'; ctx.textAlign = 'center';
    ctx.fillText('тепло →', (110 + W / 2 - 50) / 2, 60);
    ctx.fillStyle = '#9bb9ff'; ctx.fillText('→ сброс', (W / 2 + 50 + W - 110) / 2, 60);
    // КПД крупно
    ctx.fillStyle = '#36d399'; ctx.font = 'bold 26px Segoe UI';
    ctx.fillText('КПД ' + Math.round(eff * 100) + '%', W / 2, 130);
    ctx.fillStyle = '#cdd9f5'; ctx.font = '12px Segoe UI';
    ctx.fillText('макс возможный (Карно)', W / 2, 150);
    // шкала работа/потери
    const bx = W / 2 - 90, by = 195, bw = 180;
    ctx.fillStyle = '#36d399'; ctx.fillRect(bx, by, bw * eff, 14);
    ctx.fillStyle = '#f87272'; ctx.fillRect(bx + bw * eff, by, bw * (1 - eff), 14);
    ctx.fillStyle = '#dfe9ff'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText('работа', bx, by - 4);
    ctx.textAlign = 'right'; ctx.fillText('потери (сброс тепла)', bx + bw, by - 4);
    ctx.textAlign = 'left';
  });
  return { destroy() { stop(); view.ro.disconnect(); } };
};

/* ════════════════════════ 4. ЦЕПЬ (закон Ома) ════════════════════════ */
SIMS.circuit = function (container) {
  const view = makeCanvas(container, 220);
  const ctrls = el('div', 'sim-controls');
  let U = 12, R = 6;
  ctrls.appendChild(slider('Напряжение U', 1, 50, 12, 1, v => { U = v; return v + ' В'; }));
  ctrls.appendChild(slider('Сопротивление R', 1, 50, 6, 1, v => { R = v; return v + ' Ом'; }));
  container.appendChild(ctrls);

  let phase = 0;
  const stop = loop(() => {
    const ctx = view.ctx, W = view.W(), H = view.H();
    const I = U / R, P = U * I;
    ctx.clearRect(0, 0, W, H);
    // прямоугольный контур
    const x0 = 40, y0 = 40, x1 = W - 40, y1 = H - 50;
    ctx.strokeStyle = '#7fa8ff'; ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // батарея слева
    ctx.fillStyle = '#0a1226'; ctx.fillRect(x0 - 6, (y0 + y1) / 2 - 18, 12, 36);
    ctx.fillStyle = '#36d399'; ctx.font = '12px Segoe UI'; ctx.textAlign = 'right';
    ctx.fillText(U + ' В', x0 - 10, (y0 + y1) / 2);
    // резистор справа (нагрев тем сильнее, чем больше мощность)
    const heat = Math.min(1, P / 200);
    ctx.fillStyle = `rgb(${120 + heat * 135},${120 - heat * 60},${120 - heat * 80})`;
    ctx.fillRect(x1 - 8, (y0 + y1) / 2 - 22, 16, 44);
    ctx.fillStyle = '#dfe9ff'; ctx.textAlign = 'left';
    ctx.fillText(R + ' Ом', x1 + 12, (y0 + y1) / 2);
    // движущиеся электроны (скорость ∝ току)
    phase += I * 0.4;
    const per = 4 * (x1 - x0 + y1 - y0); // приближённый периметр
    const n = 24;
    ctx.fillStyle = '#ffe07a';
    for (let i = 0; i < n; i++) {
      let d = ((phase * 6 + i / n * per) % per + per) % per;
      const pt = perimeterPoint(x0, y0, x1, y1, d);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.2, 0, 7); ctx.fill();
    }
    // показания
    ctx.fillStyle = '#e8eeff'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('I = ' + I.toFixed(2) + ' А      P = ' + P.toFixed(1) + ' Вт', W / 2, H - 14);
  });
  function perimeterPoint(x0, y0, x1, y1, d) {
    const top = x1 - x0, right = y1 - y0, bottom = x1 - x0, left = y1 - y0;
    if (d < top) return { x: x0 + d, y: y0 };
    d -= top; if (d < right) return { x: x1, y: y0 + d };
    d -= right; if (d < bottom) return { x: x1 - d, y: y1 };
    d -= bottom; return { x: x0, y: y1 - d };
  }
  return { destroy() { stop(); view.ro.disconnect(); } };
};

/* ════════════════════════ 5. ГЕНЕРАТОР ════════════════════════ */
SIMS.generator = function (container) {
  const view = makeCanvas(container, 260);
  const ctrls = el('div', 'sim-controls');
  let rpm = 1.4, B = 1;
  ctrls.appendChild(slider('Скорость вращения', 0.2, 3.5, 1.4, 0.1, v => { rpm = v; return v.toFixed(1) + '×'; }));
  ctrls.appendChild(slider('Сила поля B', 0.3, 1.6, 1, 0.05, v => { B = v; return v.toFixed(2) + ' Тл'; }));
  container.appendChild(ctrls);

  let ang = 0; const hist = [];
  const stop = loop(() => {
    ang += rpm * 0.05;
    const emf = B * Math.sin(ang) * rpm; // ЭДС ∝ B·ω·sin
    hist.push(emf); if (hist.length > 120) hist.shift();
    const ctx = view.ctx, W = view.W(), H = view.H();
    ctx.clearRect(0, 0, W, H);
    // левая часть — магнит и рамка
    const cx = W * 0.24, cy = H / 2, r = 70;
    // полюса
    ctx.fillStyle = 'rgba(248,114,114,.25)'; ctx.fillRect(cx - r - 24, cy - r, 20, 2 * r);
    ctx.fillStyle = 'rgba(120,160,255,.25)'; ctx.fillRect(cx + r + 4, cy - r, 20, 2 * r);
    ctx.fillStyle = '#f87272'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('N', cx - r - 14, cy + 5);
    ctx.fillStyle = '#7fa8ff'; ctx.fillText('S', cx + r + 14, cy + 5);
    // вращающаяся рамка (видим как эллипс)
    const w = Math.cos(ang) * r;
    ctx.strokeStyle = '#ffe07a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(w) + 6, r, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,224,122,.12)';
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(w) + 6, r, 0, 0, 7); ctx.fill();
    // правая часть — график синусоиды ЭДС
    const gx = W * 0.5, gw = W * 0.45, gy = H / 2, gh = 70;
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + gw, gy); ctx.stroke();
    ctx.strokeStyle = '#36d399'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = gx + (i / 120) * gw, y = gy - hist[i] * gh;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#cdd9f5'; ctx.font = '12px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText('Наведённое напряжение (ЭДС) — переменный ток', gx, gy - gh - 8);
    ctx.fillStyle = '#e8eeff';
    ctx.fillText('ЭДС ' + (emf >= 0 ? '+' : '') + emf.toFixed(2) + ' В', gx, gy + gh + 22);
  });
  return { destroy() { stop(); view.ro.disconnect(); } };
};

/* ════════════════════════ 6. E = mc² ════════════════════════ */
SIMS.emc2 = function (container) {
  const view = makeCanvas(container, 170);
  const ctrls = el('div', 'sim-controls');
  let mass = 1; // граммы
  ctrls.appendChild(slider('Масса', 0.001, 1000, 1, 0.001, v => { mass = v; return fmtMass(v); }));
  container.appendChild(ctrls);

  function fmtMass(g) {
    if (g < 1) return (g * 1000).toFixed(1) + ' мг';
    if (g < 1000) return g.toFixed(1) + ' г';
    return (g / 1000).toFixed(2) + ' кг';
  }
  function human(j) {
    const kwh = j / 3.6e6;
    if (kwh < 1) return (kwh * 1000).toFixed(1) + ' Вт·ч';
    if (kwh < 1e6) return Math.round(kwh).toLocaleString('ru') + ' кВт·ч';
    return (kwh / 1e6).toFixed(2) + ' млн кВт·ч';
  }
  const stop = loop(() => {
    const ctx = view.ctx, W = view.W(), H = view.H();
    const c = 299792458, E = (mass / 1000) * c * c;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fc1ff'; ctx.font = '15px Segoe UI';
    ctx.fillText('Масса ' + fmtMass(mass) + '  →  энергия:', W / 2, 36);
    ctx.fillStyle = '#ffe07a'; ctx.font = 'bold 30px Segoe UI';
    ctx.fillText(E.toExponential(2) + ' Дж', W / 2, 78);
    ctx.fillStyle = '#36d399'; ctx.font = '18px Segoe UI';
    ctx.fillText('≈ ' + human(E), W / 2, 110);
    const days = (E / 3.6e6) / 30; // дом ~30 кВт·ч/день
    ctx.fillStyle = '#cdd9f5'; ctx.font = '13px Segoe UI';
    ctx.fillText('хватит дому (~30 кВт·ч/день) на ' +
      (days < 365 ? Math.round(days) + ' дней' : (days / 365).toFixed(1) + ' лет'), W / 2, 140);
  });
  return { destroy() { stop(); view.ro.disconnect(); } };
};

/* ════════════════════════ 7. СОЛНЕЧНАЯ ПАНЕЛЬ ════════════════════════ */
SIMS.solarpv = function (container) {
  const view = makeCanvas(container, 280);
  const ctrls = el('div', 'sim-controls');
  let sun = 1000, angle = 0; // intensity W/m², панель наклон
  ctrls.appendChild(slider('Освещённость', 100, 1200, 1000, 10, v => { sun = v; return v + ' Вт/м²'; }));
  ctrls.appendChild(slider('Угол к солнцу', -80, 80, 0, 1, v => { angle = v; return v + '°'; }));
  container.appendChild(ctrls);

  const photons = [];
  const stop = loop(() => {
    const ctx = view.ctx, W = view.W(), H = view.H();
    ctx.clearRect(0, 0, W, H);
    // солнце вверху
    ctx.fillStyle = '#ffd35a';
    ctx.beginPath(); ctx.arc(W / 2, 36, 22, 0, 7); ctx.fill();
    // панель внизу под наклоном angle
    const px = W / 2, py = H - 70, pl = 90;
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad) * pl, dy = Math.sin(rad) * pl * 0.4;
    ctx.strokeStyle = '#27406e'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px + dx, py + dy); ctx.stroke();
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    // эффективная доля = cos угла наклона × освещённость
    const cosEff = Math.max(0, Math.cos(rad));
    const power = sun * cosEff * 0.22; // КПД ~22%
    // фотоны падают сверху
    if (Math.random() < sun / 1400) photons.push({ x: W / 2 + (Math.random() - .5) * 120, y: 60, v: 3 + Math.random() * 2 });
    ctx.fillStyle = '#ffe07a';
    for (let i = photons.length - 1; i >= 0; i--) {
      const p = photons[i]; p.y += p.v;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 7); ctx.fill();
      if (p.y > py - 20) {
        // у панели: «выбивает электрон», если близко к центру
        photons.splice(i, 1);
      }
    }
    // электроны/ток у панели
    const flow = Math.round(power);
    ctx.fillStyle = '#36d399'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('Освещённость на панель: ' + Math.round(sun * cosEff) + ' Вт/м²', W / 2, H - 36);
    ctx.fillStyle = '#ffe07a'; ctx.font = 'bold 18px Segoe UI';
    ctx.fillText('Выработка ≈ ' + flow + ' Вт/м²', W / 2, H - 14);
    // подсказка про максимум
    ctx.fillStyle = cosEff > 0.99 ? '#36d399' : '#9bb9ff'; ctx.font = '12px Segoe UI';
    ctx.fillText(cosEff > 0.99 ? '☀ панель перпендикулярна лучам — максимум!' :
      'наклоните панель к лучам (угол → 0°) для максимума', W / 2, 20);
  });
  return { destroy() { stop(); view.ro.disconnect(); } };
};

if (typeof module !== 'undefined') module.exports = SIMS;
