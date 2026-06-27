import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(dir, 'index.html');

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(url);
await page.waitForTimeout(400);

function log(name, ok, extra='') { console.log((ok?'✓':'✗') + ' ' + name + (extra?'  '+extra:'')); if(!ok) errors.push('FAIL: '+name); }

// 1. home rendered
const heroH1 = await page.locator('.hero h1').count();
log('Главная отрисована (hero)', heroH1 === 1);

// 2. sidebar has modules
const mods = await page.locator('.nav-module').count();
log('Боковое меню: модули', mods === 10, `(${mods})`);

// 3. module cards
const cards = await page.locator('.modcard').count();
log('Карточки модулей на главной', cards === 10, `(${cards})`);

// 4. progress text
const progTxt = await page.locator('#progtext').textContent();
log('Прогресс показывает всего уроков', /\/ 43/.test(progTxt), `"${progTxt}"`);

// 5. open first lesson via start button
await page.locator('#startBtn').click();
await page.waitForTimeout(300);
const lessonTitle = await page.locator('.lesson-title').textContent();
log('Открыт первый урок', !!lessonTitle, `"${lessonTitle}"`);

// 6. quiz exists & answering works
const optCount = await page.locator('.quiz-opt').count();
log('Тест отрисован', optCount > 0, `(${optCount} вариантов)`);
if (optCount) {
  await page.locator('.quiz-q[data-qi="0"] .quiz-opt').first().click();
  await page.waitForTimeout(150);
  const whyShown = await page.locator('#why-0.show').count();
  log('Ответ на вопрос даёт объяснение', whyShown === 1);
  const lockedCorrect = await page.locator('.quiz-q[data-qi="0"] .quiz-opt.correct').count();
  log('Правильный вариант подсвечен', lockedCorrect === 1);
}

// 7. navigate to a lesson WITH a sim (pendulum is l1-4)
//    go through sidebar: expand & click. We'll just find a lesson button by text.
await page.locator('.nav-lesson', { hasText: 'Сохранение механической энергии' }).click();
await page.waitForTimeout(400);
const simCanvas = await page.locator('.sim-canvas').count();
log('Урок с симуляцией: canvas создан', simCanvas >= 1, `(${simCanvas})`);
const simCtl = await page.locator('.sim-controls input[type=range]').count();
log('У симуляции есть ползунки', simCtl >= 1, `(${simCtl})`);

// 8. mark done updates progress
await page.locator('#doneBtn').click();
await page.waitForTimeout(150);
const prog2 = await page.locator('#progtext').textContent();
log('Отметка "пройдено" двигает прогресс', /1 \/ 43/.test(prog2) || /[1-9]/.test(prog2.split('/')[0]), `"${prog2}"`);

// 9. next button advances
await page.locator('#nextBtn').click();
await page.waitForTimeout(250);
const t2 = await page.locator('.lesson-title').count();
log('Кнопка "Дальше" работает', t2 === 1);

// 10. mobile viewport: menu button visible
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);
const menuVisible = await page.locator('#menubtn').isVisible();
log('Мобайл: кнопка меню видна', menuVisible);
await page.locator('#menubtn').click();
await page.waitForTimeout(250);
const navOpen = await page.evaluate(() => document.body.classList.contains('nav-open'));
log('Мобайл: меню открывается', navOpen);

console.log('\n=== Ошибки консоли/страницы:', errors.length, '===');
errors.forEach(e => console.log('  ' + e));

await browser.close();
process.exit(errors.length ? 1 : 0);
