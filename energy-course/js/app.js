/* ============================================================================
   app.js — логика курса: навигация, рендер уроков, тесты, прогресс.
   Состояние прогресса хранится в localStorage. Зависит от content.js и sims.js.
============================================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'energy_course_progress_v1';
  let progress = load();        // { doneLessons:{id:true}, quizPassed:{id:true} }
  let activeSim = null;         // текущая запущенная модель (для destroy)
  let current = null;           // {mi, li} — индексы модуля/урока

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || mk(); }
    catch (e) { return mk(); }
    function mk() { return { done: {}, quiz: {} }; }
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {} }

  /* ── плоский список уроков для «след/пред» и подсчётов ──────────────── */
  const flat = [];
  COURSE.modules.forEach((m, mi) => m.lessons.forEach((l, li) => flat.push({ mi, li, m, l })));
  const totalLessons = flat.length;

  function lessonsDone() { return Object.keys(progress.done).length; }
  function pct() { return Math.round(lessonsDone() / totalLessons * 100); }

  /* ── элементы DOM ──────────────────────────────────────────────────── */
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main');
  const progBar = document.getElementById('progbar');
  const progText = document.getElementById('progtext');
  const menuBtn = document.getElementById('menubtn');

  menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));

  /* ── построение бокового меню ──────────────────────────────────────── */
  function buildSidebar() {
    sidebar.innerHTML = '';
    const home = el('button', 'nav-home', '⚡ Главная');
    home.addEventListener('click', () => { showHome(); closeNav(); });
    sidebar.appendChild(home);

    const gloss = el('button', 'nav-gloss', '📖 Словарь терминов');
    gloss.addEventListener('click', () => { showGlossary(); closeNav(); });
    sidebar.appendChild(gloss);

    COURSE.modules.forEach((m, mi) => {
      const modBox = el('div', 'nav-module');
      const head = el('div', 'nav-modhead');
      const doneInMod = m.lessons.filter(l => progress.done[l.id]).length;
      head.innerHTML = `<span class="nav-modlevel">${m.level}</span>
        <span class="nav-modtitle">${m.title}</span>
        <span class="nav-modcount">${doneInMod}/${m.lessons.length}</span>`;
      modBox.appendChild(head);
      const list = el('div', 'nav-lessons');
      m.lessons.forEach((l, li) => {
        const a = el('button', 'nav-lesson');
        const done = progress.done[l.id];
        a.innerHTML = `<span class="nav-check ${done ? 'on' : ''}">${done ? '✓' : ''}</span>
          <span class="nav-ltitle">${l.title}</span>`;
        a.addEventListener('click', () => { openLesson(mi, li); closeNav(); });
        a.dataset.id = l.id;
        list.appendChild(a);
      });
      head.addEventListener('click', () => modBox.classList.toggle('collapsed'));
      modBox.appendChild(list);
      sidebar.appendChild(modBox);
    });
    refreshProgress();
  }

  function highlightActive() {
    document.querySelectorAll('.nav-lesson').forEach(a => a.classList.remove('active'));
    if (current) {
      const id = COURSE.modules[current.mi].lessons[current.li].id;
      const a = sidebar.querySelector(`.nav-lesson[data-id="${id}"]`);
      if (a) a.classList.add('active');
    }
  }

  function refreshProgress() {
    progBar.style.width = pct() + '%';
    progText.textContent = `${lessonsDone()} / ${totalLessons} уроков · ${pct()}%`;
  }

  function closeNav() { document.body.classList.remove('nav-open'); }

  /* ── главная страница ──────────────────────────────────────────────── */
  function showHome() {
    killSim();
    current = null;
    highlightActive();
    main.scrollTop = 0;
    const continueTarget = firstUndone();
    main.innerHTML = `
      <div class="home">
        <div class="hero">
          <div class="hero-badge">Интерактивный курс</div>
          <h1>Энергия: <span>с нуля до PhD</span></h1>
          <p class="hero-sub">Как работает энергия, как она получается и передаётся — и как
          придумывать способы получать её эффективнее. Без подготовки: начинаем с самых основ
          и доходим до переднего края физики.</p>
          <div class="hero-row">
            <button class="btn-primary" id="startBtn">
              ${lessonsDone() ? 'Продолжить обучение' : 'Начать с нуля'}
            </button>
            <div class="hero-prog">
              <div class="hero-prog-bar"><div style="width:${pct()}%"></div></div>
              <span>${pct()}% пройдено</span>
            </div>
          </div>
        </div>

        <div class="home-grid">
          ${COURSE.modules.map((m, mi) => {
            const dn = m.lessons.filter(l => progress.done[l.id]).length;
            return `<button class="modcard" data-mi="${mi}">
              <div class="modcard-level">${m.level}</div>
              <div class="modcard-title">${m.title}</div>
              <div class="modcard-intro">${m.intro}</div>
              <div class="modcard-foot">
                <div class="modcard-bar"><div style="width:${Math.round(dn / m.lessons.length * 100)}%"></div></div>
                <span>${dn}/${m.lessons.length}</span>
              </div>
            </button>`;
          }).join('')}
        </div>

        <div class="home-foot">
          <h3>Как устроен курс</h3>
          <ul>
            <li><b>10 модулей, ${totalLessons} уроков</b> — от «что такое энергия» до термояда и методологии изобретательства.</li>
            <li><b>Интерактивные модели</b> — маятник, тепловая машина, генератор, солнечная панель и др. Крутите ползунки и смотрите физику вживую.</li>
            <li><b>Тест после каждого урока</b> — закрепляет главное. Прогресс сохраняется в браузере.</li>
            <li><b>Сквозная линия</b> — каждый модуль ведёт к ответу на ваш вопрос: как получать энергию эффективнее и по-новому.</li>
          </ul>
        </div>
      </div>`;
    document.getElementById('startBtn').addEventListener('click', () => openFlat(continueTarget));
    main.querySelectorAll('.modcard').forEach(c =>
      c.addEventListener('click', () => openLesson(+c.dataset.mi, 0)));
  }

  /* ── словарь терминов с поиском ────────────────────────────────────── */
  function showGlossary() {
    killSim(); current = null; highlightActive(); main.scrollTop = 0;
    const terms = (typeof GLOSSARY !== 'undefined') ? GLOSSARY : [];
    main.innerHTML = `<div class="gloss">
      <h1 class="gloss-h">📖 Словарь терминов</h1>
      <p class="gloss-sub">Короткие объяснения «человеческим языком». Застряли на слове — ищите здесь.</p>
      <input id="gloss-search" class="gloss-search" type="text" placeholder="Поиск термина… (например: энтропия, КПД, фотон)">
      <div class="gloss-list" id="gloss-list">
        ${terms.map(g => `<div class="gloss-item" data-k="${(g.t + ' ' + g.d).toLowerCase()}">
          <div class="gloss-term">${g.t}</div><div class="gloss-def">${g.d}</div></div>`).join('')}
      </div>
      <div class="gloss-none" id="gloss-none" style="display:none">Ничего не нашлось — попробуйте другое слово.</div>
    </div>`;
    const inp = document.getElementById('gloss-search');
    const items = [...document.querySelectorAll('.gloss-item')];
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      let shown = 0;
      items.forEach(it => {
        const ok = !q || it.dataset.k.includes(q);
        it.style.display = ok ? '' : 'none'; if (ok) shown++;
      });
      document.getElementById('gloss-none').style.display = shown ? 'none' : '';
    });
    inp.focus();
  }

  function firstUndone() {
    for (let i = 0; i < flat.length; i++) if (!progress.done[flat[i].l.id]) return i;
    return 0;
  }
  function openFlat(i) { openLesson(flat[i].mi, flat[i].li); }

  /* ── рендер урока ──────────────────────────────────────────────────── */
  function openLesson(mi, li) {
    killSim();
    current = { mi, li };
    const m = COURSE.modules[mi], l = m.lessons[li];
    main.scrollTop = 0;
    highlightActive();

    const blocksHtml = l.blocks.map((b, i) => renderBlock(b, i)).join('');
    main.innerHTML = `
      <article class="lesson">
        <div class="lesson-top">
          <div class="lesson-crumbs">${m.level} · ${m.title}</div>
          <h1 class="lesson-title">${l.title}</h1>
          <div class="lesson-meta">⏱ ~${l.min} мин чтения</div>
        </div>
        ${(l.tldr || (typeof TLDR !== 'undefined' && TLDR[l.id])) ?
          `<div class="lesson-tldr"><div class="tldr-head">⚡ Главное простыми словами</div>
           <div>${l.tldr || TLDR[l.id]}</div></div>` : ''}
        <div class="lesson-body">${blocksHtml}</div>
        <div id="quiz"></div>
        <div class="lesson-nav">
          <button class="btn-ghost" id="prevBtn">← Назад</button>
          <button class="btn-done" id="doneBtn">${progress.done[l.id] ? '✓ Пройдено' : 'Отметить пройденным'}</button>
          <button class="btn-primary" id="nextBtn">Дальше →</button>
        </div>
      </article>`;

    // монтируем интерактивные модели
    l.blocks.forEach((b, i) => {
      if (b.t === 'sim' && SIMS[b.sim]) {
        const host = document.getElementById('sim-' + i);
        if (host) activeSim = SIMS[b.sim](host); // последняя модель — для destroy
      }
    });

    renderQuiz(l);

    const idx = flat.findIndex(f => f.mi === mi && f.li === li);
    document.getElementById('prevBtn').addEventListener('click', () => idx > 0 ? openFlat(idx - 1) : showHome());
    document.getElementById('nextBtn').addEventListener('click', () => {
      markDone(l.id);
      if (idx < flat.length - 1) openFlat(idx + 1); else showFinish();
    });
    document.getElementById('doneBtn').addEventListener('click', () => {
      markDone(l.id);
      document.getElementById('doneBtn').textContent = '✓ Пройдено';
    });
  }

  // X_y → X<sub>y</sub> (поддержка кириллицы и {многобукв}); экранируем спецзнаки внутри
  function fmtFormula(s) {
    return s.replace(/_(\{[^}]+\}|[A-Za-zА-Яа-яёЁ0-9]+)/g,
      (_, g) => '<sub>' + g.replace(/^\{|\}$/g, '') + '</sub>');
  }

  function renderBlock(b, i) {
    switch (b.t) {
      case 'text': return `<div class="b-text">${b.html}</div>`;
      case 'formula': return `<div class="b-formula"><div class="f-eq">${fmtFormula(b.f)}</div>${b.cap ? `<div class="f-cap">${b.cap}</div>` : ''}</div>`;
      case 'callout': {
        const icon = { idea: '💡', warn: '⚠️', key: '🔑' }[b.kind] || '•';
        const name = { idea: 'Идея', warn: 'Важно', key: 'Ключевое' }[b.kind] || '';
        return `<div class="b-callout c-${b.kind}"><div class="c-head">${icon} ${name}</div><div>${b.html}</div></div>`;
      }
      case 'try': return `<div class="b-try"><div class="try-head">✍️ Разбор примера</div><div>${b.html}</div></div>`;
      case 'device': return `<div class="b-device">
        <div class="dev-title">🔧 Как это устроено: ${b.title}</div>
        <div class="dev-parts-h">Из чего состоит:</div>
        <div class="dev-parts">${b.parts.map(p => `<div class="dev-part"><b>${p.n}</b><span>${p.d}</span></div>`).join('')}</div>
        <div class="dev-steps-h">Как это работает по шагам:</div>
        <ol class="dev-steps">${b.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      </div>`;
      case 'sim': return `<div class="b-sim"><div class="sim-host" id="sim-${i}"></div>${b.cap ? `<div class="sim-cap">${b.cap}</div>` : ''}</div>`;
      default: return '';
    }
  }

  /* ── тест ──────────────────────────────────────────────────────────── */
  function renderQuiz(l) {
    const host = document.getElementById('quiz');
    if (!l.quiz || !l.quiz.length) { host.innerHTML = ''; return; }
    const answered = new Array(l.quiz.length).fill(false);

    host.innerHTML = `<div class="quiz">
      <h3 class="quiz-title">Проверь себя</h3>
      ${l.quiz.map((q, qi) => `
        <div class="quiz-q" data-qi="${qi}">
          <div class="quiz-text">${qi + 1}. ${q.q}</div>
          <div class="quiz-opts">
            ${q.a.map((opt, oi) => `<button class="quiz-opt" data-qi="${qi}" data-oi="${oi}">${opt}</button>`).join('')}
          </div>
          <div class="quiz-why" id="why-${qi}"></div>
        </div>`).join('')}
      <div class="quiz-score" id="quiz-score"></div>
    </div>`;

    host.querySelectorAll('.quiz-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const qi = +btn.dataset.qi, oi = +btn.dataset.oi, q = l.quiz[qi];
        const qBox = host.querySelector(`.quiz-q[data-qi="${qi}"]`);
        if (qBox.classList.contains('locked')) return;
        qBox.classList.add('locked');
        answered[qi] = true;
        qBox.querySelectorAll('.quiz-opt').forEach((b, bi) => {
          if (bi === q.correct) b.classList.add('correct');
          else if (bi === oi) b.classList.add('wrong');
          b.disabled = true;
        });
        const why = document.getElementById('why-' + qi);
        const ok = oi === q.correct;
        why.innerHTML = `<b>${ok ? '✓ Верно.' : '✗ Не совсем.'}</b> ${q.why}`;
        why.classList.add('show', ok ? 'ok' : 'no');
        if (answered.every(Boolean)) {
          progress.quiz[l.id] = true; save();
          document.getElementById('quiz-score').textContent = 'Тест пройден ✓ — отличная работа!';
        }
      });
    });
  }

  /* ── финал курса ───────────────────────────────────────────────────── */
  function showFinish() {
    killSim(); current = null; highlightActive(); main.scrollTop = 0;
    main.innerHTML = `<div class="finish">
      <div class="finish-badge">🎓</div>
      <h1>Курс пройден!</h1>
      <p>Вы прошли путь от «что такое энергия» до переднего края физики энергетики.
      Теперь у вас есть карта и язык, чтобы думать о том, как получать энергию эффективнее и по-новому.</p>
      <p class="finish-tip">Дальше — глубже в ту область, что зажгла сильнее всего: учебники, задачи, эксперименты.
      Этот курс дал каркас, на который ляжет любой следующий шаг. ⚡</p>
      <button class="btn-primary" id="homeBtn">На главную</button>
    </div>`;
    document.getElementById('homeBtn').addEventListener('click', showHome);
  }

  function markDone(id) {
    if (!progress.done[id]) {
      progress.done[id] = true; save();
      buildSidebar(); highlightActive();
    }
    refreshProgress();
  }

  function killSim() { if (activeSim) { try { activeSim.destroy(); } catch (e) {} activeSim = null; } }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e;
  }

  /* ── навигация стрелками ←/→ между уроками ─────────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (!current) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const idx = flat.findIndex(f => f.mi === current.mi && f.li === current.li);
    if (e.key === 'ArrowRight') { e.preventDefault(); if (idx < flat.length - 1) openFlat(idx + 1); else showFinish(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); idx > 0 ? openFlat(idx - 1) : showHome(); }
  });

  /* ── старт ─────────────────────────────────────────────────────────── */
  buildSidebar();
  showHome();
})();
