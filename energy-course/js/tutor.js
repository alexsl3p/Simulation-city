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

  const SYSTEM = `Ты — дружелюбный преподаватель физики энергии внутри интерактивного курса «с нуля до PhD».
Твоя задача — объяснять ПРОСТО, как полному новичку, который раньше не знал физики.
Правила:
- Отвечай по-русски, тёплым и ободряющим тоном.
- Объясняй на бытовых аналогиях и примерах из жизни.
- Будь краток: 2–5 абзацев максимум, без воды. Если вопрос большой — дай суть и предложи копнуть глубже.
- Формулы давай только если они реально помогают, и сразу расшифровывай каждую букву.
- Не выдумывай фактов. Если не знаешь — честно скажи.
- Опирайся на контекст урока, который дан ниже, но можешь выходить за его рамки, если спрашивают.`;

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

  fab.addEventListener('click', () => {
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'flex' : 'none';
    fab.style.display = open ? 'none' : '';
    if (open) { renderSetup(); if (!convo.length) greet(); qBox.focus(); }
  });
  panel.querySelector('.tutor-x').addEventListener('click', () => { panel.style.display = 'none'; fab.style.display = ''; });

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
    const q = qBox.value.trim() || 'Объясни простыми словами тему этого урока.';
    const prompt = `Ты — преподаватель физики энергии, объясняй просто, как новичку, по-русски.\n\n${lessonContext()}\n\nВопрос: ${q}`;
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
      addMsg('assistant', 'Чтобы спрашивать прямо здесь, добавьте свой ключ Anthropic API в настройках выше (🔑). Либо нажмите «Открыть в Claude.ai» — это работает без ключа.');
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
