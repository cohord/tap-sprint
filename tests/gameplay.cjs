// Run with Node.js and Playwright installed: node tests/gameplay.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});
let checks = 0;
async function check(name, fn) {
  await fn();
  console.log('PASS ' + name);
  checks++;
}
async function visible(page, selector) {
  assert.equal(await page.locator(selector).isVisible(), true, selector);
}
async function hidden(page, selector) {
  assert.equal(await page.locator(selector).isVisible(), false, selector);
}
async function active(page) {
  assert.equal(await page.locator('html').getAttribute('class'), 'in-play');
  for (const selector of ['.controls', '.legend', '#results', '#progress']) await hidden(page, selector);
  const bounds = await page.locator('.board-wrap').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, JSON.stringify(bounds));
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
  assert.ok(bounds.width >= 170, 'Board remains usable on a short screen');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
}
async function restored(page) {
  await page.locator('#play-pause').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('html').getAttribute('class'), '');
  await visible(page, '#progress');
  await hidden(page, '#play-pause');
}
async function results(page) {
  await restored(page);
  for (const selector of ['#results', '#again', '.breakdown', '#accuracy', '#reaction-chart']) await visible(page, selector);
  await page.locator('#progress').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => window.scrollY > 0), 'Results can scroll again');
}
async function swipe(page, session) {
  const bounds = await page.locator('#board').boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height * .8;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 5; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 20 }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.evaluate(() => window.scrollY), 0);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [width, height] of [[320, 480], [320, 568], [360, 640], [390, 844], [844, 390], [1280, 900]]) {
      if (process.env.TEST_WIDTH && width !== Number(process.env.TEST_WIDTH)) continue;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width < 1000 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-10-28T00:00:00Z') });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.clock.pauseAt(new Date('2026-10-28T00:00:10Z'));
      const session = await context.newCDPSession(page);
      await check(`${width}×${height}: home and full countdown`, async () => {
        await visible(page, '#progress');
        await page.locator('#play').tap();
        await active(page);
        assert.equal(await page.locator('#countdown-number').textContent(), '3');
        await swipe(page, session);
        assert.equal(await page.locator('#score').textContent(), '0');
        await page.clock.runFor(1000);
        assert.equal(await page.locator('#countdown-number').textContent(), '2');
        await page.clock.runFor(1000);
        assert.equal(await page.locator('#countdown-number').textContent(), '1');
        await page.clock.runFor(1000);
        await hidden(page, '#overlay');
        assert.equal(await page.locator('#time').textContent(), '20.0s');
      });
      await check(`${width}×${height}: fast taps, swipe lock, pause and resume`, async () => {
        await active(page);
        for (let i = 0; i < 6; i++) await page.locator('.tile.orb').tap();
        assert.ok(Number(await page.locator('#score').textContent()) >= 6);
        assert.equal(await page.locator('#streak').textContent(), '6', 'Each tap scores once');
        await swipe(page, session);
        // A movement fallback must cancel only during gameplay.
        assert.equal(await page.evaluate(() => document.dispatchEvent(new Event('touchmove', { cancelable: true }))), false);
        await page.locator('#play-pause').tap();
        await restored(page);
        await visible(page, '#resume');
        const time = await page.locator('#time').textContent();
        await page.clock.runFor(90000);
        assert.equal(await page.locator('#time').textContent(), time);
        assert.equal(await page.evaluate(() => document.dispatchEvent(new Event('touchmove', { cancelable: true }))), true);
        await page.locator('#resume').tap();
        await active(page);
      });
      await check(`${width}×${height}: natural finish, results and replay from scrolled content`, async () => {
        await page.clock.runFor(20000);
        await results(page);
        assert.match(await page.locator('#result-title').textContent(), /CLEARED/);
        await page.locator('#again').tap();
        await active(page);
        await page.locator('#play-pause').tap();
        await restored(page);
        await visible(page, '#restart-countdown');
        await page.clock.runFor(5000);
        await visible(page, '#restart-countdown');
        await page.locator('#restart-countdown').tap();
        await active(page);
        await page.clock.runFor(3000);
        // Keyboard activation remains available alongside pointerdown scoring.
        await page.locator('.tile.orb').focus();
        await page.keyboard.press('Enter');
        assert.ok(Number(await page.locator('#score').textContent()) > 0);
        await page.keyboard.press('Escape');
        await restored(page);
        await page.locator('#stop').click();
        await results(page);
        assert.equal(await page.locator('#result-title').textContent(), 'ROUND SAVED');
        await page.locator('#done').click();
        await restored(page);
        await visible(page, '#play');
      });
      if (width === 390) {
        await check('Three-round session restores content between every round', async () => {
          await page.locator('#session').tap();
          for (let round = 0; round < 3; round++) {
            await active(page);
            await page.clock.runFor(23000);
            await results(page);
            if (round < 2) {
              await visible(page, '#next');
              await page.locator('#next').tap();
            }
          }
          await hidden(page, '#next');
          assert.equal(await page.locator('#result-title').textContent(), 'SESSION CLEARED!');
          await page.reload();
          assert.match(await page.locator('#progress-count').textContent(), /5 rounds/);
        });
        await check('Background interruption unlocks countdown and active round', async () => {
          await page.locator('#play').tap();
          await page.evaluate(() => window.dispatchEvent(new Event('blur')));
          await restored(page);
          await page.locator('#restart-countdown').tap();
          await page.clock.runFor(3000);
          await page.evaluate(() => window.dispatchEvent(new Event('blur')));
          await restored(page);
          await visible(page, '#resume');
        });
        await page.locator('#resume').tap();
        await page.screenshot({ path: path.join(__dirname, '..', 'mobile-active.png') });
      }
      assert.deepEqual(errors, [], 'No browser errors');
      await context.close();
    }
    console.log(`${checks} browser checks passed.`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
