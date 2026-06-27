import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(dir, 'index.html');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const issues = [];
page.on('console', m => { if (m.type() === 'error') issues.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => issues.push('PAGEERROR: ' + e.message));

await page.goto(url);
await page.waitForTimeout(300);

// pull course structure into the page context
const plan = await page.evaluate(() => COURSE.modules.map(m => ({
  title: m.title,
  lessons: m.lessons.map(l => ({ id: l.id, title: l.title,
    sims: (l.blocks||[]).filter(b=>b.t==='sim').map(b=>b.sim),
    quiz: (l.quiz||[]).length }))
})));

let totalSims = 0, mountedSims = 0, lessonCount = 0, emptyQuiz = 0;
const flat = [];
plan.forEach((m, mi) => m.lessons.forEach((l, li) => flat.push({ mi, li, ...l })));

for (const f of flat) {
  lessonCount++;
  // navigate by clicking the lesson in sidebar (by exact title)
  const before = issues.length;
  const clicked = await page.evaluate((title) => {
    const btns = [...document.querySelectorAll('.nav-lesson .nav-ltitle')];
    const t = btns.find(b => b.textContent === title);
    if (t) { t.closest('.nav-lesson').click(); return true; }
    return false;
  }, f.title);
  if (!clicked) { issues.push('NAV: не нашёл в меню урок "' + f.title + '"'); continue; }
  await page.waitForTimeout(250);

  // title rendered?
  const ttl = await page.locator('.lesson-title').textContent().catch(()=>null);
  if (ttl !== f.title) issues.push('TITLE mismatch: ждали "'+f.title+'" получили "'+ttl+'"');

  // sims mounted (canvas present)?
  for (const s of f.sims) {
    totalSims++;
    const canv = await page.locator('.b-sim .sim-canvas').count();
    if (canv >= 1) mountedSims++; else issues.push('SIM "'+s+'" не смонтирован в "'+f.title+'"');
  }
  // quiz options present if quiz defined?
  if (f.quiz > 0) {
    const opts = await page.locator('.quiz-opt').count();
    if (opts === 0) { emptyQuiz++; issues.push('QUIZ пуст в "'+f.title+'"'); }
  }
}

console.log('Уроков пройдено:', lessonCount, '/ 43');
console.log('Симуляций смонтировано:', mountedSims, '/', totalSims);
console.log('Пустых тестов:', emptyQuiz);
console.log('\n=== Проблемы:', issues.length, '===');
issues.slice(0, 40).forEach(i => console.log('  ' + i));

await browser.close();
process.exit(issues.length ? 1 : 0);
