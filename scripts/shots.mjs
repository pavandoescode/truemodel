import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3111';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('shot:', name);
}

/** Read the resolved theme the way the CSS does. */
const readTheme = (page) =>
  page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    font: getComputedStyle(document.body).fontFamily,
  }));

// --- 1. One fixed theme, whatever the OS asks for --------------------------
// Lumosel is the only theme and app/layout.tsx pins it on <html>, so there is
// no toggle, no pre-paint resolution, and nothing to flash. The suffixes below
// name the OS preference the context was opened with, not an app theme: both
// must land on the same painted result.
{
  for (const [osScheme, name] of [['dark', '01-desktop-dark'], ['light', '02-desktop-light']]) {
    const ctx = await browser.newContext({
      colorScheme: osScheme,
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const theme = await readTheme(page);
    console.log(`OS=${osScheme.padEnd(5)} ->`, JSON.stringify(theme));
    await shot(page, name);

    if (theme.attr !== 'lumosel') throw new Error(`FAIL: data-theme is ${theme.attr}, expected lumosel (OS=${osScheme})`);
    if (theme.bg !== 'rgb(0, 0, 0)') throw new Error(`FAIL: body is painted ${theme.bg}, expected the true-black surface (OS=${osScheme})`);
    if (theme.colorScheme !== 'dark') throw new Error(`FAIL: color-scheme is ${theme.colorScheme}, expected dark (OS=${osScheme})`);
    console.log(`PASS: lumosel applied over an OS ${osScheme} preference`);

    // --- 2. A stale mode from the old toggle must not resurrect a theme ---
    // Anyone who used the app before the single-theme change still has this
    // key. It has no reader now, so the only thing worth asserting is that it
    // changes nothing.
    await page.evaluate(() => localStorage.setItem('theme-mode', 'terminal'));
    await page.reload({ waitUntil: 'networkidle' });
    const after = await readTheme(page);
    if (after.attr !== 'lumosel' || after.bg !== theme.bg) {
      throw new Error(`FAIL: a stored theme-mode changed the paint (${JSON.stringify(after)})`);
    }
    console.log('PASS: a stale stored theme-mode is inert');

    await ctx.close();
  }
}

// --- 3. Populated model list, at both OS colour preferences ----------------
// `theme` here is the OS preference the context declares, not an app theme —
// the app has one. Both passes are kept because a declared preference still
// reaches form controls and scrollbars through color-scheme.
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  // Serve a model list and per-model results without a real provider.
  // Everything the client sends goes through POST /api/proxy, so that is the
  // route to intercept — /api/models is never called from the browser.
  const MODELS = [
    'glm-4.6', 'glm-4.5-air', 'glm-4.5v', 'deepseek-r1',
    'qwen-max', 'kimi-k2', 'minimax-m2', 'ernie-4.5',
  ];
  // Per-model latency, so the spread has something real to plot: one fast
  // cluster, a couple of mid readings, and one slow outlier. deepseek-r1 has
  // no entry and is answered with a 429, to exercise the fail path too.
  const LATENCY = {
    'glm-4.6': 412, 'glm-4.5-air': 380, 'glm-4.5v': 2140,
    'qwen-max': 890, 'kimi-k2': 505, 'minimax-m2': 8200, 'ernie-4.5': 460,
  };
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/proxy')) {
      const body = route.request().postDataJSON() ?? {};
      if (String(body.path || '').includes('models')) {
        const payload = { data: MODELS.map((id) => ({ id, display_name: id })) };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true, status: 200, statusText: 'OK', latencyMs: 120,
            headers: {}, data: payload, rawText: JSON.stringify(payload),
            error: null, url, sentHeaders: {},
          }),
        });
      }

      const model = body?.body?.model ?? '';
      const latencyMs = LATENCY[model];
      if (!latencyMs) {
        const payload = { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded.' } };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false, status: 429, statusText: 'Too Many Requests', latencyMs: 140,
            headers: {}, data: payload, rawText: JSON.stringify(payload),
            error: { category: 'rate-limit', title: 'Rate limited', message: 'Rate limit exceeded.', suggestions: [] },
            url, sentHeaders: {},
          }),
        });
      }

      const payload = {
        id: 'msg_1',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: Math.round(latencyMs / 12) },
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true, status: 200, statusText: 'OK', latencyMs,
          headers: {}, data: payload, rawText: JSON.stringify(payload),
          error: null, url, sentHeaders: {},
        }),
      });
    }
    return route.continue();
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  const endpoint = page.locator('#endpoint');
  if (await endpoint.count()) {
    await endpoint.fill('https://api.z.ai/api/anthropic');
    const key = page.locator('input[type="password"]').first();
    if (await key.count()) await key.fill('sk-test-key-0000000000');
    const connect = page.getByRole('button', { name: /connect/i }).first();
    if (await connect.count()) {
      await connect.click();
      await page.waitForTimeout(2500);
    }
  }
  await shot(page, `03-models-${theme}`);

  // The app falls back to a built-in Claude list when discovery returns
  // nothing, so assert the mocked ids actually rendered — otherwise this
  // screenshot silently documents the fallback instead of the mock.
  const shown = await page.locator('text=glm-4.5-air').count();
  if (!shown) throw new Error(`FAIL: mocked model list did not render (${theme})`);
  console.log(`PASS: mocked model list rendered (${theme})`);

  // --- Prompt preset ------------------------------------------------------
  // One preset now. The button writes the whole textarea, so assert on its
  // value rather than on the button's own state — a pressed button with an
  // unchanged box is the failure that matters. The identity preset was
  // removed deliberately: asking a model what it is proves nothing, so that
  // question belongs to "Identify models" and its unfakeable checks.
  if (theme === 'dark') {
    const box = page.locator('#prompt');
    const reachability = await box.inputValue();
    if (await page.getByRole('button', { name: /^model identity$/i }).count()) {
      throw new Error('FAIL: the Model identity preset is still present');
    }
    await box.fill('edited by the shot script');
    await page.getByRole('button', { name: /^reachability$/i }).click();
    if ((await box.inputValue()) !== reachability) {
      throw new Error('FAIL: Reachability preset did not restore the default prompt');
    }
    console.log('PASS: the sole prompt preset restores the default');
  }

  // --- Run the tests so the latency spread has readings to plot -----------
  await page.getByRole('button', { name: /^select all$/i }).first().click();
  await page.getByRole('button', { name: /test \d+ selected/i }).first().click();
  await page.waitForTimeout(4000);

  const spread = page.locator('figure', { hasText: 'Latency spread' });
  if (!(await spread.count())) throw new Error(`FAIL: latency spread did not render (${theme})`);
  const ticks = await page.locator('figure svg line').count();
  console.log(`PASS: latency spread rendered with ${ticks} lines (${theme})`);

  // Latency is a magnitude, so the ticks must actually walk the sequential
  // ramp — if every tick resolves to one step, the encoding carries nothing.
  const strokes = await page.evaluate(() => {
    const svg = document.querySelector('figure svg');
    return [...new Set([...svg.querySelectorAll('line')].map((l) => getComputedStyle(l).stroke))];
  });
  if (strokes.length < 3) {
    throw new Error(`FAIL: ticks used ${strokes.length} distinct colors: ${strokes.join(', ')}`);
  }
  console.log(`PASS: ramp spans ${strokes.length} distinct steps (${theme})`);
  await shot(page, `07-tested-${theme}`);

  // The save modal is only reachable once models exist, so it is captured here
  // rather than in the modal-behaviour block below, which runs disconnected.
  if (theme === 'dark') {
    await page.getByRole('button', { name: /save to claude code settings/i }).first().click();
    await page.waitForTimeout(500);
    const saveDialog = page.locator('[role="dialog"]');
    if (!(await saveDialog.count())) throw new Error('FAIL: save-config dialog did not open');
    console.log('PASS: save-config dialog opened');
    await shot(page, '08-modal-save-config');
  }

  await ctx.close();
}

// --- 4. Mobile at 375px ----------------------------------------------------
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    viewport: { width: 375, height: 812 },
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 90));
  });
  console.log(`375px ${theme} horizontal overflow:`, overflow.length ? overflow : 'none');
  await shot(page, `04-mobile-${theme}`);
  await ctx.close();
}

// --- 5. Modal keyboard behaviour ------------------------------------------
{
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const trigger = page.getByRole('button', { name: /manage saved providers/i }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const dialog = page.locator('[role="dialog"]');
  if (!(await dialog.count())) throw new Error('FAIL: providers dialog did not open');
  await shot(page, '05-modal-providers');

  // Tab must stay inside the dialog.
  let escaped = false;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    if (!inside) { escaped = true; break; }
  }
  if (escaped) throw new Error('FAIL: Tab escaped the dialog');
  console.log('PASS: focus trapped inside the dialog');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('[role="dialog"]').count()) throw new Error('FAIL: Escape did not close the dialog');
  console.log('PASS: Escape closes the dialog');

  const restored = await page.evaluate(() =>
    (document.activeElement?.textContent || '').toLowerCase().includes('manage saved providers'));
  console.log(restored ? 'PASS: focus returned to the trigger' : 'WARN: focus did not return to the trigger');

  await ctx.close();
}

// --- 6. Failed connection --------------------------------------------------
{
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid x-api-key' }) }));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const endpoint = page.locator('#endpoint');
  if (await endpoint.count()) {
    await endpoint.fill('https://api.z.ai/api/anthropic');
    const key = page.locator('input[type="password"]').first();
    if (await key.count()) await key.fill('sk-bad');
    const connect = page.getByRole('button', { name: /connect/i }).first();
    if (await connect.count()) { await connect.click(); await page.waitForTimeout(2500); }
  }
  await shot(page, '06-connect-failed');
  await ctx.close();
}

await browser.close();
console.log('\nAll checks passed.');
