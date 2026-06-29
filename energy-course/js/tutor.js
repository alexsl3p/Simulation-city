/* ============================================================================
   tutor.js — встроенный ИИ-преподаватель (Claude).

   Статический сайт без сервера, поэтому используется поддерживаемый режим
   ПРЯМОГО вызова Anthropic API из браузера: заголовок
   'anthropic-dangerous-direct-browser-access: true'. Пользователь вводит
   СВОЙ ключ Anthropic API — он хранится только локально (localStorage) и
   уходит напрямую на api.anthropic.com, никуда больше.

   Запасной режим без ключа: кнопка открывает claude.ai с вопросом и
   контекстом текущего урока.
============================================================================ */
(function () {
  'use strict';

  const KEY_STORE = 'energy_tutor_apikey';
  const MODEL_STORE = 'energy_tutor_model';
  const DEFAULT_MODEL = 'claude-opus-4-8';
  const MODELS = [
    { id: 'claude-opus-4-8',  label: 'Opus 4.8 — самый умный' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — баланс' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — быстрый и дешёвый' },
  ];

  let convo = [];          // история диалога [{role, content}]
  let busy = false;

  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch (e) {} };
  const getModel = () => { try { return localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; } };
  const setModel = (m) => { try { localStorage.setItem(MODEL_STORE, m); } catch (e) {} };

  /* текущий урок — читаем прямо из DOM, без связи с app.js */
  function lessonContext() {
    const title = (document.querySelector('.lesson-title') || {}).textContent || '';
    const tldr = (document.querySelector('.lesson-tldr') || {}).textContent || '';
    let body = (document.querySelector('.lesson-body') || {}).textContent || '';
    body = body.replace(/\s+/g, ' ').trim().slice(0, 2500);
    if (!title) return 'Пользователь сейчас на главной странице курса (урок не открыт).';
    return `Пользователь сейчас изучает урок «${title.trim()}».\n` +
      (tldr ? tldr.trim() + '\n' : '') +
      (body ? `Содержание урока (для контекста): ${body}` : '');
  }

  /* ──────────────────────────────────────────────────────────────────────
     КОГНИТИВНЫЙ ПРОФИЛЬ УЧЕНИКА — единый источник для ОБОИХ режимов
     (system prompt при вызове API И преамбула для claude.ai). Правь здесь —
     меняется сразу везде. */
  const LEARNER_PROFILE = {
    // полная версия — для system prompt (API-режим)
    full: `Ученик думает от первых принципов и по аналогиям между областями (физика↔биология↔города↔ИИ); видит один механизм в разных процессах — это его сила и зона риска. Учится через «выдвинул гипотезу → проверил», не зубрит, переспрашивает «почему?» и «а как же закон сохранения?». Сам выводит сложное до того, как ему это назвали. Любит образы. Реагирует на честную прямую обратную связь, не на лесть.`,
    // сжатая преамбула — для claude.ai (важнее контекста урока, не обрезается)
    brief: `Контекст для преподавателя: я учусь физике энергии. Думаю от первых принципов и по аналогиям между областями. Мои типичные ошибки: (1) смешиваю этажи явлений (путаю уровни — кварки/ядра, заряд ядра/ядерная связь, потеря/добыча тепла); (2) принимаю одно слово за одно явление («порядок», «связь», «сжатие»); (3) путаю направление процесса (энергия→материя vs наоборот, рвать vs слипать, заряд vs разряд); (4) связываю по созвучию слов, а не по механизму; (5) думаю, что реакция создаёт энергию, а не высвобождает запасённую. Давай прямую обратную связь без лести, лови эти ошибки явно и называй их, объясняй через образы-аналогии, заканчивай «итогом в одну строку». Когда я связываю разные вещи — спрашивай «общий механизм или общее слово? где ломается?». Когда ухожу в красивую непроверяемую теорию — заземляй: «это на полку „красивое“ или „доказанное“? что идея запрещает? кто уже это считал?». Не потакай.`,
  };

  const SYSTEM = `Ты — преподаватель физики энергии в курсе «с нуля до PhD». По-русски, на «ты», casual, прямо. Без лести и воды.

КАК ОБЪЯСНЯТЬ:
• Каждую абстракцию — через образ-аналогию (связь = камень на скале / взведённая пружина; тепло = строй по команде «разойдись»; крепкая связь = глубокая яма; масса = пар в закрытой кастрюле).
• Заканчивай «Итогом в одну строку».
• Связывай новое с пройденным («помнишь яму притяжения? вот то же»).
• Неверно — скажи «Стоп, ловушка» и разбери. Верно — похвали конкретно и заслуженно, без подхалимажа.
• Краткость: 2–5 абзацев. Формулы — только если помогают, сразу расшифровывай буквы. Не выдумывай фактов.

С КЕМ ГОВОРИШЬ: ${LEARNER_PROFILE.full}

ЛОВИ 5 ОШИБОК и называй их явно, когда видишь в ответе ученика:
1. Смешал этажи (кварки↔ядра, заряд ядра↔ядерная связь, потеря↔добыча тепла) → «ты смешал этажи», покажи уровни.
2. Одно слово на разные вещи (порядок, связь, сжатие, сингулярность) → «это одно слово на два явления», разведи их.
3. Перепутал направление стрелки (энергия→материя vs наоборот, добыча vs потеря, рвать vs слипать) → «проверь направление стрелки».
4. Аналогия по созвучию → «это общий механизм или общее слово? где ломается?».
5. «Энергии стало больше» → поправь: энергия не создаётся, а высвобождается из запаса.

КАК ВЕСТИ ДИАЛОГ:
• Его режим — «сначала выведи сам, потом проверим»: на гипотезу не вываливай ответ сразу — спроси, как он пришёл, потом проверь.
• Связывает области — спрашивай «механизм или слово? где ломается?».
• Уходит в красивую непроверяемую теорию — заземляй мягко: «это на полку „красивое“ или „доказанное“? что идея запрещает? кто уже это считал?».
• Не потакай, не раздувай похвалу, верни на землю, когда мысль разгоняется слишком высоко.

Опирайся на контекст урока ниже; можешь выходить за рамки, если спрашивают.`;

  /* ── построение UI ─────────────────────────────────────────────────── */
  function el(t, c, h) { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  const fab = el('button', 'tutor-fab', '🎓 Спросить препода');
  const panel = el('div', 'tutor-panel');
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="tutor-head">
      <span>🎓 ИИ-преподаватель</span>
      <button class="tutor-x" title="Закрыть">✕</button>
    </div>
    <div class="tutor-msgs" id="tutor-msgs"></div>
    <div class="tutor-setup" id="tutor-setup"></div>
    <div class="tutor-input">
      <textarea id="tutor-q" rows="2" placeholder="Спросите что угодно про урок…"></textarea>
      <button id="tutor-send" title="Отправить">➤</button>
    </div>`;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const msgs = panel.querySelector('#tutor-msgs');
  const setup = panel.querySelector('#tutor-setup');
  const qBox = panel.querySelector('#tutor-q');
  const sendBtn = panel.querySelector('#tutor-send');

  function openPanel() {
    panel.style.display = 'flex';
    fab.style.display = 'none';
    renderSetup();
    if (!convo.length) greet();
  }
  function closePanel() { panel.style.display = 'none'; fab.style.display = ''; }

  fab.addEventListener('click', () => {
    if (panel.style.display === 'none') { openPanel(); qBox.focus(); } else { closePanel(); }
  });
  panel.querySelector('.tutor-x').addEventListener('click', closePanel);

  // публичный API: открыть препода и сразу задать вопрос (для кнопок «копнуть глубже»)
  window.EnergyTutor = {
    ask(text) {
      openPanel();
      qBox.value = text;
      ask();
      panel.scrollIntoView && msgs.scrollTo(0, msgs.scrollHeight);
    },
    open: openPanel,
  };

  function greet() {
    addMsg('assistant', 'Привет! Я ваш ИИ-препод по физике энергии. Спросите что угодно про текущий урок — объясню простыми словами. Например: «Объясни ещё проще» или «Зачем это нужно?»');
  }

  /* ── панель настроек (ключ / модель / без ключа) ───────────────────── */
  function renderSetup() {
    const hasKey = !!getKey();
    setup.innerHTML = `
      <details class="tutor-cfg" ${hasKey ? '' : 'open'}>
        <summary>${hasKey ? '🔑 Ключ подключён · настройки' : '🔑 Подключить (нужен ключ Anthropic API)'}</summary>
        <div class="tutor-cfg-body">
          <p class="tutor-note">Чат работает через ваш личный ключ Anthropic API. Ключ хранится <b>только в этом браузере</b> и уходит напрямую на api.anthropic.com. Получить ключ: <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
          <div class="tutor-row">
            <input id="tutor-key" type="password" placeholder="sk-ant-..." value="${getKey().replace(/"/g, '')}">
            <button id="tutor-key-save">Сохранить</button>
          </div>
          <div class="tutor-row">
            <label>Модель:</label>
            <select id="tutor-model">${MODELS.map(m => `<option value="${m.id}" ${m.id === getModel() ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
          </div>
          <div class="tutor-or">— или без ключа —</div>
          <button id="tutor-openclaude" class="tutor-alt">💬 Открыть вопрос в Claude.ai (бесплатно, нужен аккаунт)</button>
        </div>
      </details>`;

    setup.querySelector('#tutor-key-save').addEventListener('click', () => {
      setKey(setup.querySelector('#tutor-key').value.trim());
      renderSetup();
      addMsg('assistant', getKey() ? 'Ключ сохранён ✓ Теперь можно спрашивать прямо здесь.' : 'Ключ убран.');
    });
    setup.querySelector('#tutor-model').addEventListener('change', (e) => setModel(e.target.value));
    setup.querySelector('#tutor-openclaude').addEventListener('click', openInClaude);
  }

  function openInClaude() {
    const q = qBox.value.trim() || 'Объясни тему этого урока.';
    const LIMIT = 1500;                 // запас под лимит длины claude.ai/new?q=
    const tail = `\n\nМой вопрос: ${q}`;
    let ctx = lessonContext();
    // профиль и вопрос неприкосновенны; режем только контекст урока
    const fixed = LEARNER_PROFILE.brief.length + tail.length + 24;
    if (fixed + ctx.length > LIMIT) {
      const room = Math.max(0, LIMIT - fixed);
      ctx = room > 40 ? ctx.slice(0, room) + '…' : '';
    }
    const prompt = LEARNER_PROFILE.brief + (ctx ? `\n\nКонтекст урока: ${ctx}` : '') + tail;
    window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
  }

  /* ── сообщения ─────────────────────────────────────────────────────── */
  function addMsg(role, text) {
    const m = el('div', 'tutor-msg ' + role);
    m.textContent = text;            // textContent — защита от внедрения HTML
    msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight;
    return m;
  }

  async function ask() {
    const q = qBox.value.trim();
    if (!q || busy) return;
    if (!getKey()) {
      addMsg('user', q);
      addMsg('assistant', 'Чтобы я ответил прямо здесь, добавьте свой ключ Anthropic API в настройках выше (🔑) и снова нажмите вопрос. Либо нажмите «💬 Открыть вопрос в Claude.ai» — это работает без ключа, вопрос уйдёт туда вместе с контекстом урока.');
      renderSetup();
      const d = setup.querySelector('.tutor-cfg'); if (d) d.open = true;
      return;
    }
    qBox.value = '';
    addMsg('user', q);
    convo.push({ role: 'user', content: q });
    busy = true; sendBtn.disabled = true;
    const thinking = addMsg('assistant', '…думаю');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': getKey(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          system: SYSTEM + '\n\n--- Контекст ---\n' + lessonContext(),
          messages: convo.slice(-10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = (data && data.error && data.error.message) || ('Ошибка ' + res.status);
        thinking.textContent = '⚠️ ' + msg + (res.status === 401 ? ' (проверьте ключ API)' : '');
        convo.pop();
        return;
      }
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
        || '(пустой ответ)';
      thinking.textContent = text;
      convo.push({ role: 'assistant', content: text });
    } catch (e) {
      thinking.textContent = '⚠️ Не удалось связаться с API: ' + (e.message || e) +
        '. Проверьте интернет. Можно также нажать «Открыть в Claude.ai» без ключа.';
      convo.pop();
    } finally {
      busy = false; sendBtn.disabled = false;
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  sendBtn.addEventListener('click', ask);
  qBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });
})();
