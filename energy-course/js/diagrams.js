/* ============================================================================
   diagrams.js — анимированные схемы устройств с подсветкой потока энергии.

   Каждая схема — узлы (компоненты) и рёбра (потоки энергии). По рёбрам бегут
   «пакеты энергии», меняя цвет при каждом превращении формы. По цепочке
   прокатывается волна подсветки, показывая, как энергия передаётся дальше.

   DIAGRAMS[name](container) → { destroy() } — как и SIMS.
============================================================================ */

const DIAGRAMS = {};

(function () {
  // цвета форм энергии
  const C = {
    chemical:  '#f0a85a',
    nuclear:   '#c792ff',
    thermal:   '#f8704f',
    mechanical:'#6aa0ff',
    kinetic:   '#6aa0ff',
    potential: '#36d399',
    light:     '#ffd35a',
    electrical:'#ffe07a',
    ion:       '#7fd0ff',
    water:     '#4f8cff',
  };
  const FORM_RU = {
    chemical:'химическая', nuclear:'ядерная', thermal:'тепловая',
    mechanical:'механическая', kinetic:'кинетическая', potential:'потенциальная',
    light:'свет', electrical:'электрическая', ion:'ионы', water:'вода',
  };

  function mkCanvas(container, h) {
    const c = document.createElement('canvas');
    c.className = 'sim-canvas';
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
    return { c, ctx, W: () => c.clientWidth, H: () => h, ro };
  }
  function rafLoop(fn) {
    let raf, alive = true;
    (function tick(t) { if (!alive) return; fn(t); raf = requestAnimationFrame(tick); })(0);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // точка на границе прямоугольника узла в направлении (dx,dy)
  function edgePoint(n, dx, dy) {
    const hw = n._w / 2, hh = n._h / 2;
    const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: n._cx + dx * s, y: n._cy + dy * s };
  }

  function build(spec) {
    return function (container) {
      const H = spec.h || 220;
      const view = mkCanvas(container, H);

      const stop = rafLoop((t) => {
        const ctx = view.ctx, W = view.W();
        ctx.clearRect(0, 0, W, H);
        const padX = 18, padY = 16, legendH = 24;
        const drawW = W - padX * 2, drawH = H - padY * 2 - legendH;

        // разметка узлов (пересчитываем — адаптив по ширине)
        ctx.font = '600 13px Segoe UI, sans-serif';
        spec.nodes.forEach(n => {
          const tw = ctx.measureText(n.label).width;
          n._w = Math.min(Math.max(tw + 24, 64), 150);
          n._h = 40;
          n._cx = padX + n.x * drawW;
          n._cy = padY + n.y * drawH;
        });
        const node = id => spec.nodes.find(n => n.id === id);

        // волна подсветки прокатывается по узлам
        const N = spec.nodes.length;
        const wave = (t / 1700) % N;

        // ── рёбра + пакеты ──
        spec.edges.forEach((e) => {
          const a = node(e.from), b = node(e.to);
          let dx = b._cx - a._cx, dy = b._cy - a._cy;
          const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
          const p0 = edgePoint(a, dx, dy);
          const p1 = edgePoint(b, -dx, -dy);
          const col = C[e.form] || '#9bb9ff';

          // линия
          ctx.strokeStyle = 'rgba(120,150,210,.35)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
          // стрелка
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          ctx.fillStyle = 'rgba(120,150,210,.5)';
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p1.x - 9 * Math.cos(ang - 0.4), p1.y - 9 * Math.sin(ang - 0.4));
          ctx.lineTo(p1.x - 9 * Math.cos(ang + 0.4), p1.y - 9 * Math.sin(ang + 0.4));
          ctx.closePath(); ctx.fill();

          // пакеты энергии
          for (let i = 0; i < 3; i++) {
            const f = (((t / 1400) * (e.speed || 1) + i / 3) % 1 + 1) % 1;
            const px = p0.x + (p1.x - p0.x) * f, py = p0.y + (p1.y - p0.y) * f;
            ctx.fillStyle = col;
            ctx.shadowColor = col; ctx.shadowBlur = 8;
            ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
            ctx.shadowBlur = 0;
          }
          // подпись формы у середины ребра
          if (e.label) {
            const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
            ctx.fillStyle = col; ctx.font = '11px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText(e.label, mx, my - 7);
          }
        });

        // ── узлы ──
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        spec.nodes.forEach((n, i) => {
          let d = Math.abs(i - wave); d = Math.min(d, N - d);
          const glow = Math.max(0, 1 - d);
          const accent = n.color ? C[n.color] : '#7fa8ff';
          ctx.fillStyle = '#0c1530';
          roundRect(ctx, n._cx - n._w / 2, n._cy - n._h / 2, n._w, n._h, 9);
          ctx.fill();
          ctx.lineWidth = 1.5 + glow * 2;
          ctx.strokeStyle = glow > 0.05
            ? accent
            : 'rgba(120,150,210,.4)';
          if (glow > 0.05) { ctx.shadowColor = accent; ctx.shadowBlur = 12 * glow; }
          ctx.stroke(); ctx.shadowBlur = 0;
          ctx.fillStyle = glow > 0.4 ? '#fff' : '#dfe9ff';
          ctx.font = '600 13px Segoe UI';
          ctx.fillText(n.label, n._cx, n._cy);
        });
        ctx.textBaseline = 'alphabetic';

        // ── легенда форм энергии ──
        const forms = [...new Set(spec.edges.map(e => e.form))];
        let lx = padX;
        const ly = H - 8;
        ctx.font = '11px Segoe UI'; ctx.textAlign = 'left';
        forms.forEach(f => {
          ctx.fillStyle = C[f] || '#9bb9ff';
          ctx.beginPath(); ctx.arc(lx + 5, ly - 4, 5, 0, 7); ctx.fill();
          ctx.fillStyle = '#9bb9ff';
          const label = FORM_RU[f] || f;
          ctx.fillText(label, lx + 14, ly);
          lx += 16 + ctx.measureText(label).width + 14;
        });
      });

      return { destroy() { stop(); view.ro.disconnect(); } };
    };
  }

  /* ════════════ описания схем ════════════ */

  DIAGRAMS.tes = build({
    nodes: [
      { id: 'fuel', label: 'Топливо', x: 0.06, y: 0.30, color: 'chemical' },
      { id: 'boiler', label: 'Котёл', x: 0.28, y: 0.30 },
      { id: 'turb', label: 'Турбина', x: 0.52, y: 0.30 },
      { id: 'gen', label: 'Генератор', x: 0.76, y: 0.30 },
      { id: 'grid', label: 'Сеть', x: 0.95, y: 0.30, color: 'electrical' },
      { id: 'cond', label: 'Конденсатор', x: 0.40, y: 0.92 },
    ],
    edges: [
      { from: 'fuel', to: 'boiler', form: 'chemical' },
      { from: 'boiler', to: 'turb', form: 'thermal', label: 'пар' },
      { from: 'turb', to: 'gen', form: 'mechanical' },
      { from: 'gen', to: 'grid', form: 'electrical' },
      { from: 'turb', to: 'cond', form: 'thermal', label: 'сброс', speed: .7 },
      { from: 'cond', to: 'boiler', form: 'water', label: 'вода', speed: .7 },
    ],
  });

  DIAGRAMS.solar = build({
    nodes: [
      { id: 'sun', label: '☀ Солнце', x: 0.5, y: 0.06, color: 'light' },
      { id: 'panel', label: 'Панель (p-n)', x: 0.5, y: 0.5 },
      { id: 'load', label: 'Прибор', x: 0.85, y: 0.92, color: 'electrical' },
    ],
    edges: [
      { from: 'sun', to: 'panel', form: 'light', label: 'фотоны', speed: 1.3 },
      { from: 'panel', to: 'load', form: 'electrical', label: 'ток' },
      { from: 'load', to: 'panel', form: 'electrical', speed: .8 },
    ],
  });

  DIAGRAMS.reactor = build({
    nodes: [
      { id: 'fis', label: 'Деление U-235', x: 0.10, y: 0.5, color: 'nuclear' },
      { id: 'steam', label: 'Парогенератор', x: 0.36, y: 0.5 },
      { id: 'turb', label: 'Турбина', x: 0.60, y: 0.5 },
      { id: 'gen', label: 'Генератор', x: 0.82, y: 0.5 },
      { id: 'grid', label: 'Сеть', x: 0.96, y: 0.5, color: 'electrical' },
    ],
    edges: [
      { from: 'fis', to: 'steam', form: 'nuclear', label: 'тепло' },
      { from: 'steam', to: 'turb', form: 'thermal', label: 'пар' },
      { from: 'turb', to: 'gen', form: 'mechanical' },
      { from: 'gen', to: 'grid', form: 'electrical' },
    ],
  });

  DIAGRAMS.wind = build({
    nodes: [
      { id: 'wind', label: '💨 Ветер', x: 0.07, y: 0.5, color: 'kinetic' },
      { id: 'rotor', label: 'Лопасти', x: 0.32, y: 0.5 },
      { id: 'gear', label: 'Редуктор', x: 0.56, y: 0.5 },
      { id: 'gen', label: 'Генератор', x: 0.79, y: 0.5 },
      { id: 'grid', label: 'Сеть', x: 0.95, y: 0.5, color: 'electrical' },
    ],
    edges: [
      { from: 'wind', to: 'rotor', form: 'kinetic' },
      { from: 'rotor', to: 'gear', form: 'mechanical' },
      { from: 'gear', to: 'gen', form: 'mechanical' },
      { from: 'gen', to: 'grid', form: 'electrical' },
    ],
  });

  DIAGRAMS.hydro = build({
    nodes: [
      { id: 'res', label: 'Водохранилище', x: 0.14, y: 0.12, color: 'potential' },
      { id: 'turb', label: 'Турбина', x: 0.5, y: 0.7 },
      { id: 'gen', label: 'Генератор', x: 0.78, y: 0.7 },
      { id: 'grid', label: 'Сеть', x: 0.95, y: 0.7, color: 'electrical' },
    ],
    edges: [
      { from: 'res', to: 'turb', form: 'potential', label: 'вода падает' },
      { from: 'turb', to: 'gen', form: 'mechanical' },
      { from: 'gen', to: 'grid', form: 'electrical' },
    ],
  });

  DIAGRAMS.battery = build({
    nodes: [
      { id: 'anode', label: 'Анод (−)', x: 0.12, y: 0.5 },
      { id: 'load', label: 'Прибор', x: 0.5, y: 0.12, color: 'electrical' },
      { id: 'cath', label: 'Катод (+)', x: 0.88, y: 0.5 },
    ],
    edges: [
      { from: 'anode', to: 'load', form: 'electrical', label: 'электроны' },
      { from: 'load', to: 'cath', form: 'electrical' },
      { from: 'anode', to: 'cath', form: 'ion', label: 'ионы Li⁺ (электролит)', speed: .7 },
    ],
  });

  DIAGRAMS.tokamak = build({
    nodes: [
      { id: 'plasma', label: 'Плазма (синтез)', x: 0.12, y: 0.5, color: 'nuclear' },
      { id: 'blanket', label: 'Бланкет', x: 0.40, y: 0.5 },
      { id: 'turb', label: 'Турбина', x: 0.63, y: 0.5 },
      { id: 'gen', label: 'Генератор', x: 0.83, y: 0.5 },
      { id: 'grid', label: 'Сеть', x: 0.96, y: 0.5, color: 'electrical' },
    ],
    edges: [
      { from: 'plasma', to: 'blanket', form: 'nuclear', label: 'нейтроны', speed: 1.3 },
      { from: 'blanket', to: 'turb', form: 'thermal', label: 'пар' },
      { from: 'turb', to: 'gen', form: 'mechanical' },
      { from: 'gen', to: 'grid', form: 'electrical' },
    ],
  });

})();

if (typeof module !== 'undefined') module.exports = DIAGRAMS;
