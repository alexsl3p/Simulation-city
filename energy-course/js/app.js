/* ============================================================================
   app.js — логика курса: навигация, рендер уроков, тесты, прогресс.
   Состояние прогресса хранится в localStorage. Зависит от content.js и sims.js.
============================================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'energy_course_progress_v1';
  let progress = load();        // { doneLessons:{id:true}, quizPassed:{id:true} }
  let activeSims = [];          // запущенные модели и схемы (для destroy)
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

    const exam = el('button', 'nav-gloss nav-exam', '🎯 Экзамен');
    exam.addEventListener('click', () => { showExamHome(); closeNav(); });
    sidebar.appendChild(exam);

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
            <button class="btn-ghost" id="examHomeBtn">🎯 Сдать экзамен</button>
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
    document.getElementById('examHomeBtn').addEventListener('click', showExamHome);
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

  /* ── экзамен / тесты ──────────────────────────────────────────────── */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function moduleQuestions(m) {
    const out = []; m.lessons.forEach(l => (l.quiz || []).forEach(q => out.push(q)));
    return out;
  }
  function allQuestions() {
    const out = []; COURSE.modules.forEach(m => out.push(...moduleQuestions(m)));
    return out;
  }
  function countQ(m) { return moduleQuestions(m).length; }

  function showExamHome() {
    killSim(); current = null; highlightActive(); main.scrollTop = 0;
    const best = progress.exam || {};
    const totalQ = allQuestions().length;
    main.innerHTML = `<div class="exam">
      <h1 class="gloss-h">🎯 Экзамен</h1>
      <p class="gloss-sub">Проверьте, что усвоили. Ответьте на вопросы, получите оценку и разбор ошибок. Лучший результат сохраняется.</p>
      <div class="exam-grid">
        <button class="exam-card exam-final" data-scope="final">
          <div class="exam-card-lvl">Итоговый</div>
          <div class="exam-card-t">Финальный экзамен</div>
          <div class="exam-card-d">20 случайных вопросов со всего курса (банк из ${totalQ})</div>
          <div class="exam-best">${best.final != null ? ('🏅 Лучший результат: ' + best.final + '%') : 'ещё не сдавался'}</div>
        </button>
        ${COURSE.modules.map(m => `<button class="exam-card" data-scope="${m.id}">
          <div class="exam-card-lvl">${m.level}</div>
          <div class="exam-card-t">${m.title}</div>
          <div class="exam-card-d">${countQ(m)} вопросов по модулю</div>
          <div class="exam-best">${best[m.id] != null ? ('🏅 Лучший: ' + best[m.id] + '%') : 'не сдавался'}</div>
        </button>`).join('')}
      </div>
    </div>`;
    main.querySelectorAll('.exam-card').forEach(c => c.addEventListener('click', () => startExamByScope(c.dataset.scope)));
  }

  function startExamByScope(scope) {
    if (scope === 'final') startExam(shuffle(allQuestions()).slice(0, 20), 'Финальный экзамен', 'final');
    else { const m = COURSE.modules.find(x => x.id === scope); if (m) startExam(shuffle(moduleQuestions(m)), 'Экзамен: ' + m.title, scope); }
  }

  function startExam(pool, title, key) {
    killSim(); current = null; highlightActive(); main.scrollTop = 0;
    const answers = new Array(pool.length).fill(null);
    main.innerHTML = `<div class="exam-run">
      <div class="lesson-top">
        <div class="lesson-crumbs">🎯 Экзамен</div>
        <h1 class="lesson-title">${title}</h1>
        <div class="lesson-meta">${pool.length} вопросов · выберите ответ на каждый и нажмите «Завершить тест»</div>
      </div>
      <div class="exam-qs">
        ${pool.map((q, qi) => `<div class="exam-q" data-qi="${qi}">
          <div class="quiz-text">${qi + 1}. ${q.q}</div>
          <div class="quiz-opts">${q.a.map((o, oi) => `<button class="quiz-opt exam-opt" data-qi="${qi}" data-oi="${oi}">${o}</button>`).join('')}</div>
        </div>`).join('')}
      </div>
      <div class="lesson-nav">
        <button class="btn-ghost" id="examBack">← К выбору</button>
        <span id="examCount" class="exam-count">Отвечено: 0 / ${pool.length}</span>
        <button class="btn-primary" id="examFinish">Завершить тест</button>
      </div>
      <div id="examResult"></div>
    </div>`;

    main.querySelectorAll('.exam-opt').forEach(b => b.addEventListener('click', () => {
      const qi = +b.dataset.qi, oi = +b.dataset.oi;
      const box = main.querySelector(`.exam-q[data-qi="${qi}"]`);
      if (box.classList.contains('locked')) return;
      answers[qi] = oi;
      box.querySelectorAll('.exam-opt').forEach(x => x.classList.remove('chosen'));
      b.classList.add('chosen');
      const answered = answers.filter(a => a != null).length;
      document.getElementById('examCount').textContent = `Отвечено: ${answered} / ${pool.length}`;
    }));
    document.getElementById('examBack').addEventListener('click', showExamHome);
    document.getElementById('examFinish').addEventListener('click', () => finishExam(pool, answers, key));
  }

  function finishExam(pool, answers, key) {
    let correct = 0;
    pool.forEach((q, qi) => {
      const box = main.querySelector(`.exam-q[data-qi="${qi}"]`);
      box.classList.add('locked');
      box.querySelectorAll('.exam-opt').forEach((b, bi) => {
        b.disabled = true;
        if (bi === q.correct) b.classList.add('correct');
        else if (bi === answers[qi]) b.classList.add('wrong');
      });
      const ok = answers[qi] === q.correct;
      if (ok) correct++;
      const why = document.createElement('div');
      why.className = 'quiz-why show ' + (ok ? 'ok' : 'no');
      why.innerHTML = `<b>${ok ? '✓ Верно.' : (answers[qi] == null ? '— Без ответа.' : '✗ Неверно.')}</b> ${q.why}`;
      box.appendChild(why);
    });
    const pct = Math.round(correct / pool.length * 100);
    progress.exam = progress.exam || {};
    const isBest = progress.exam[key] == null || pct > progress.exam[key];
    if (isBest) progress.exam[key] = pct;
    save();
    const grade = pct >= 90 ? 'Отлично! 🏆' : pct >= 70 ? 'Хорошо 👍' : pct >= 50 ? 'Неплохо — но стоит повторить' : 'Стоит вернуться к урокам';
    const res = document.getElementById('examResult');
    res.innerHTML = `<div class="exam-score-box">
      <div class="exam-score-n">${correct} / ${pool.length} · ${pct}%</div>
      <div class="exam-grade">${grade}${isBest ? ' · новый рекорд!' : ''}</div>
      <div class="exam-score-actions">
        <button class="btn-primary" id="examRetry">Пройти заново</button>
        <button class="btn-ghost" id="examHome2">К выбору экзамена</button>
      </div>
    </div>`;
    document.getElementById('examRetry').addEventListener('click', () => startExamByScope(key));
    document.getElementById('examHome2').addEventListener('click', showExamHome);
    res.scrollIntoView({ behavior: 'smooth' });
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
        <div id="followups"></div>
        <div class="lesson-nav">
          <button class="btn-ghost" id="prevBtn">← Назад</button>
          <button class="btn-done" id="doneBtn">${progress.done[l.id] ? '✓ Пройдено' : 'Отметить пройденным'}</button>
          <button class="btn-primary" id="nextBtn">Дальше →</button>
        </div>
      </article>`;

    // монтируем интерактивные модели и анимированные схемы
    l.blocks.forEach((b, i) => {
      if (b.t === 'sim' && SIMS[b.sim]) {
        const host = document.getElementById('sim-' + i);
        if (host) activeSims.push(SIMS[b.sim](host));
      }
      if (b.t === 'device' && b.diagram && typeof DIAGRAMS !== 'undefined' && DIAGRAMS[b.diagram]) {
        const host = document.getElementById('diag-' + i);
        if (host) activeSims.push(DIAGRAMS[b.diagram](host));
      }
    });

    renderQuiz(l);
    renderFollowups(l);

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
        ${b.diagram ? `<div class="dev-diag-h">▶ Поток энергии (анимация):</div><div class="dev-diag" id="diag-${i}"></div>` : ''}
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

  /* ── «копнуть глубже»: наводящие вопросы → ИИ-преподаватель ─────────── */
  function renderFollowups(l) {
    const host = document.getElementById('followups');
    if (!host) return;
    const list = l.followups || (typeof FOLLOWUPS !== 'undefined' && FOLLOWUPS[l.id]) || [];
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="followups">
      <h3 class="fu-title">💬 Копнуть глубже</h3>
      <p class="fu-sub">Что можно спросить дальше. Нажмите вопрос — ИИ-преподаватель объяснит с учётом этого урока, и можно продолжить беседу ветвлениями, как в живом чате.</p>
      <div class="fu-chips"></div>
    </div>`;
    const wrap = host.querySelector('.fu-chips');
    list.forEach(q => {
      const b = el('button', 'fu-chip'); b.textContent = q;
      b.addEventListener('click', () => {
        if (window.EnergyTutor) window.EnergyTutor.ask(q);
        else alert('ИИ-преподаватель недоступен.');
      });
      wrap.appendChild(b);
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

  function killSim() { activeSims.forEach(s => { try { s.destroy(); } catch (e) {} }); activeSims = []; }

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
