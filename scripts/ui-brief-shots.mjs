/**
 * Screenshots for the dashboard-redesign brief (ui-brief/).
 *
 * Everything is mocked at the /api/proxy and /api/stream boundary, so the shots
 * are reproducible without a real provider key and — more importantly — so every
 * verdict the identity engine can reach appears at least once. A redesign brief
 * that only shows the happy path gets a redesign that only handles the happy path.
 *
 *   node scripts/ui-brief-shots.mjs            # expects a dev server on :3000
 *   PV_BASE=http://localhost:3111 node scripts/ui-brief-shots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.PV_BASE ?? 'http://localhost:3000';
const OUT = 'ui-brief/screenshots';
mkdirSync(OUT, { recursive: true });

/** Advertised catalogue of a fictional reseller. */
const CATALOGUE = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'gpt-5.2',
  'gemini-3-pro',
  'deepseek-r1',
  'glm-4.6',
  'kimi-k2',
  'qwen-max',
];

/**
 * Scripted behaviour per advertised id, one per reachable verdict.
 *
 *   verdict   — the state this row is engineered to reach, so a bad shot is easy
 *               to diagnose: if the pill disagrees, the mock drifted from the engine
 *   served    — model id the mocked endpoint reports on message_start
 *               (null = report nothing, so attribution has to fall back)
 *   leakHdr   — model id leaked through a response header instead
 *   tokens    — count_tokens result for the tokenizer probe (null = route 404s)
 *   billed    — input tokens the completion reports (a gap = injected preamble)
 *   cap       — stated output cap, 'unvalidated' = accepts an absurd max_tokens
 *   routes    — whether a nonexistent model id is rejected
 *   answers   — the five identity-probe answers, verbatim
 *   prose     — replies that ignore the format entirely, one per run
 */
/** The five identity-probe answers, in the `N: <answer>` shape extractAnswer parses. */
const fiveLine = (items) => items.map((v, i) => `${i + 1}: ${v}`).join('\n');

/** Same answers three times over — a stable backend at temperature 0. */
const repeat = (items) => [items, items, items];

const CORRECT = ['408', '3', 'sum(range(1, 101))', 'ORANGE'];

const PLAN = {
  /* Substitution named by the endpoint itself: Haiku answering for Opus. */
  'claude-opus-5': {
    verdict: 'wrong-tier',
    basic: { latency: 940, out: 39 },
    served: 'claude-haiku-4-5-20251001',
    idPrefix: 'msg_',
    tokens: 250,
    probeTokens: 120,
    billed: 120,
    cap: 64000,
    capFor: 'claude-haiku-4-5-20251001',
    routes: true,
    runs: repeat([...CORRECT, 'Claude Opus 5']),
    vendorText:
      '1. Anthropic\n2. Claude Haiku 4.5\n3. The underlying model serving this request is claude-haiku-4-5-20251001',
  },

  /* The honest row. Every scored signal passes, so the verdict is the strongest
     the engine will issue — worth having in the brief as the visual baseline. */
  'claude-sonnet-5': {
    verdict: 'matches-advertised',
    basic: { latency: 610, out: 32 },
    served: 'claude-sonnet-5-20260514',
    idPrefix: 'msg_',
    tokens: 250,
    probeTokens: 120,
    billed: 120,
    cap: 128000,
    capFor: 'claude-sonnet-5-20260514',
    routes: true,
    runs: repeat([...CORRECT, 'Claude Sonnet 5']),
    vendorText: '1. Anthropic\n2. Claude Sonnet 5\n3. The underlying model serving this request is claude-sonnet-5',
  },
  /* One soft fail (it paraphrases item 4) on an otherwise clean small model:
     the "likely, not certainly" state the brief needs a swatch for. */
  'claude-haiku-4-5-20251001': {
    verdict: 'likely-advertised',
    basic: { latency: 380, out: 28 },
    served: 'claude-haiku-4-5-20251001',
    idPrefix: 'msg_',
    tokens: 250,
    probeTokens: 120,
    billed: 120,
    cap: 64000,
    capFor: 'claude-haiku-4-5-20251001',
    routes: true,
    runs: repeat(['408', '3', 'sum(range(1, 101))', 'The word is ORANGE', 'Claude Haiku 4.5']),
    vendorText: '1. Anthropic\n2. Claude Haiku 4.5\n3. The underlying model serving this request is claude-haiku-4-5',
  },

  /* Different vendor entirely, and the name only leaks through a header —
     so the caveat line has to explain a weaker source than the response body. */
  'gpt-5.2': {
    verdict: 'different-vendor',
    basic: { latency: 1450, out: 44 },
    served: null,
    leakHdr: 'deepseek-r1',
    idPrefix: 'chatcmpl-',
    tokens: 318,
    probeTokens: 120,
    billed: 120,
    cap: 'unvalidated',
    routes: false,
    runs: repeat(['408', '3', 'sum(range(1, 101))', 'ORANGE', 'DeepSeek-R1']),
    vendorText:
      '1. DeepSeek\n2. DeepSeek-R1\n3. The underlying model serving this request is deepseek-r1',
  },

  /* Two or more hard fails: verifiable wrong answers from a model whose real
     tier would not miss them. The strongest negative verdict. */
  'gemini-3-pro': {
    verdict: 'mismatch',
    basic: { latency: 2140, out: 51 },
    served: 'gemini-3-pro',
    tokens: 250,
    probeTokens: 120,
    billed: 190,
    cap: 8192,
    routes: true,
    runs: repeat(['391', '2', 'for i in range(100): total += i', 'ORANGE', 'Gemini 3 Pro']),
    vendorText: '1. Google\n2. Gemini 3 Pro\n3. The underlying model serving this request is gemini-3-pro',
  },
  /* Nothing hard fails, but half the soft evidence does — including three
     different answers to the same prompt at temperature 0. The honest
     "we cannot tell" state, which is the one a redesign usually forgets. */
  'deepseek-r1': {
    verdict: 'ambiguous',
    basic: { latency: 3120, out: 47 },
    served: 'deepseek-r1',
    tokens: null,
    probeTokens: null,
    billed: 120,
    cap: 32768,
    routes: true,
    runs: [
      ['408', '3', 'sum(range(1, 101))', 'Orange!', 'Qwen2.5-Max'],
      ['408', '3', 'sum(range(1,101))', 'ORANGE.', 'DeepSeek R1'],
      ['408', '3', '5050', 'The answer is orange', 'Qwen2.5-Max'],
    ],
    vendorText: '1. Alibaba Cloud\n2. Qwen2.5-Max\n3. The underlying model serving this request is qwen-max',
  },

  /* Exactly one hard fail — the tokenizer count is nowhere near its cohort.
     Everything else looks right, which is precisely why the verdict hedges. */
  'glm-4.6': {
    verdict: 'likely-mismatch',
    basic: { latency: 505, out: 30 },
    served: 'glm-4.6',
    tokens: 431,
    probeTokens: 120,
    billed: 120,
    cap: 128000,
    routes: true,
    runs: repeat([...CORRECT, 'GLM-4.6']),
    vendorText: '1. Zhipu AI\n2. GLM-4.6\n3. The underlying model serving this request is glm-4.6',
  },

  /* Every run fails, so there is nothing to verify. Also the row the brief
     needs for a red failed test with a provider error in the accordion. */
  'kimi-k2': {
    verdict: 'error',
    basic: { error: { status: 429, message: 'Rate limit exceeded. Please retry after 60s.' } },
    runs: [
      { error: { status: 429, message: 'Rate limit exceeded. Please retry after 60s.' } },
      { error: { status: 429, message: 'Rate limit exceeded. Please retry after 60s.' } },
      { error: { status: 429, message: 'Rate limit exceeded. Please retry after 60s.' } },
    ],
  },

  /* Nothing at all could be scored: one usable run in prose, no count_tokens,
     an echoed model name — and an endpoint that answers ids no vendor
     publishes. That last one is a serious finding about the *provider*, so it
     shows as context, tinted warning, and never touches the verdict. */
  'qwen-max': {
    verdict: 'ambiguous',
    basic: { latency: 8200, out: 61 },
    served: 'qwen-max',
    tokens: null,
    probeTokens: null,
    billed: 120,
    cap: 'unvalidated',
    routes: false,
    runs: [
      "Sure! 17 * 24 is 408, strawberry has three r's, and you'd write sum(range(1, 101)). Orange. I'm a large language model.",
      { error: { status: 502, message: 'Bad gateway: upstream closed the connection.' } },
      { error: { status: 502, message: 'Bad gateway: upstream closed the connection.' } },
    ],
    vendorText: '',
  },
};

/** Ids whose scripted verdict must appear, asserted after the run. */
const EXPECTED = Object.fromEntries(Object.entries(PLAN).map(([id, p]) => [id, p.verdict]));
/* ------------------------------------------------------------------ */
/* Mock router                                                         */
/* ------------------------------------------------------------------ */

/** A ProxyResponse envelope — the exact shape lib/apiClient.ts parses. */
function envelope(url, { ok, status, statusText, data, latencyMs = 120, headers = {}, error = null }) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok,
      status,
      statusText,
      latencyMs,
      headers,
      data,
      rawText: data === null ? '' : JSON.stringify(data),
      error,
      url,
      sentHeaders: {},
    }),
  };
}

/** Provider-style error payload plus the classified ApiError the UI renders. */
function errorEnvelope(url, { status, statusText, message, category = 'invalid-request', title = 'Request rejected', suggestions = [] }) {
  return envelope(url, {
    ok: false,
    status,
    statusText,
    latencyMs: 90,
    data: { type: 'error', error: { type: 'invalid_request_error', message } },
    error: { category, title, message, httpStatus: status, suggestions },
  });
}

const text = (t) => [{ type: 'text', text: t }];

/** The model-name-routing probe id, mirrored from lib/registry.ts. */
const FAKE_ID = 'not-a-real-model-9v9-20991231';
/**
 * One NDJSON line stream for a single identity run.
 *
 * The `open` line is not optional: apiClient computes
 * `ok = !error && status > 0 && status < 400`, so a stream without it scores
 * every run as a failure and every verdict collapses to `error`.
 */
function streamBody(url, { status = 200, headers = {}, id, model, body, billed = 120, out = 96, latencyMs = 700, error }) {
  const lines = [{ type: 'open', status, headers, url, sentHeaders: {} }];
  const message = { id };
  // Omitting `model` is meaningful: it forces attribution onto a weaker source.
  if (model) message.model = model;
  message.usage = { input_tokens: billed, output_tokens: 0 };
  lines.push({ type: 'event', event: 'message_start', data: { message } });

  if (error) {
    lines.push({ type: 'error', error });
    lines.push({ type: 'done', usage: null, stopReason: null, latencyMs, eventCount: 2 });
  } else {
    lines.push({ type: 'delta', text: body });
    lines.push({
      type: 'done',
      usage: { input_tokens: billed, output_tokens: out },
      stopReason: 'end_turn',
      latencyMs,
      eventCount: 4,
    });
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** Per-model run counter, so run 2 can differ from run 1 at temperature 0. */
const runIndex = new Map();

function nextRun(model) {
  const n = runIndex.get(model) ?? 0;
  runIndex.set(model, n + 1);
  return n;
}
/**
 * Intercept every /api/** call the browser makes.
 *
 * Must keep a `route.continue()` fallthrough: /api/validate-key and
 * /api/test-cli are real routes this harness has no business answering.
 */
async function mockApi(page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const req = route.request().postDataJSON() ?? {};
    const path = String(req.path ?? '');
    const body = req.body ?? {};
    const model = String(body.model ?? '');
    const plan = PLAN[model];
    const prompt = String(body.messages?.[0]?.content ?? '');

    /* ---------- streamed identity runs ---------- */
    if (url.includes('/api/stream')) {
      const n = nextRun(model);
      const spec = plan?.runs?.[n % (plan?.runs?.length ?? 1)];
      const headers = plan?.leakHdr ? { 'x-upstream-model': plan.leakHdr } : {};
      const id = `${plan?.idPrefix ?? 'msg_'}${model.replace(/[^a-z0-9]/gi, '')}${n}`;

      if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.error) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: streamBody(url, {
            status: spec.error.status,
            headers,
            id,
            model: plan.served ?? undefined,
            error: {
              category: spec.error.status === 429 ? 'rate-limit' : 'server',
              title: spec.error.status === 429 ? 'Rate limited' : 'Upstream error',
              message: spec.error.message,
              httpStatus: spec.error.status,
              suggestions: [],
            },
          }),
        });
      }

      const answer = Array.isArray(spec) ? fiveLine(spec) : (spec ?? 'OK');
      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: streamBody(url, {
          headers,
          id,
          model: plan?.served ?? undefined,
          body: answer,
          billed: plan?.billed ?? 120,
          latencyMs: 700 + n * 40,
        }),
      });
    }
    if (url.includes('/api/proxy')) {
      /* ---------- discovery ---------- */
      if (path.includes('models')) {
        const data = { data: CATALOGUE.map((id) => ({ id, display_name: id })) };
        return route.fulfill(envelope(url, { ok: true, status: 200, statusText: 'OK', data }));
      }

      /* ---------- tokenizer fingerprint ---------- */
      if (path.includes('count_tokens')) {
        // The probe text is the long fixed string; the identity probe is counted
        // separately and is what the injection check compares against.
        const isProbe = prompt.includes('Answer all five items');
        const count = isProbe ? plan?.probeTokens : plan?.tokens;
        if (count == null) {
          return route.fulfill(
            errorEnvelope(url, {
              status: 404,
              statusText: 'Not Found',
              message: 'Unknown endpoint: /v1/messages/count_tokens',
              category: 'not-found',
              title: 'Endpoint not found',
            }),
          );
        }
        return route.fulfill(
          envelope(url, { ok: true, status: 200, statusText: 'OK', latencyMs: 60, data: { input_tokens: count } }),
        );
      }

      /* ---------- name-routing probe ---------- */
      if (model.includes(FAKE_ID)) {
        if (plan?.routes === false) {
          return route.fulfill(
            envelope(url, {
              ok: true,
              status: 200,
              statusText: 'OK',
              latencyMs: 210,
              data: { id: 'msg_fake', model, content: text('OK'), stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 1 } },
            }),
          );
        }
        return route.fulfill(
          errorEnvelope(url, {
            status: 404,
            statusText: 'Not Found',
            message: `model: ${FAKE_ID} — not_found_error: the model does not exist`,
            category: 'invalid-model',
            title: 'Unknown model',
          }),
        );
      }
      /* ---------- output-ceiling probe ---------- */
      // Recognised by its fixed prompt: `accepts()` in lib/attribution.ts always
      // sends "Reply with: OK". Only 400/422 counts as a rejection there, and
      // parseLimitError prefers the `N > M` comparison form, so the message is
      // written in exactly that shape — one request answers the whole question.
      if (prompt === 'Reply with: OK' && typeof body.max_tokens === 'number' && body.max_tokens > 64) {
        const cap = plan?.cap;
        if (cap === 'unvalidated' || cap == null) {
          return route.fulfill(
            envelope(url, {
              ok: true,
              status: 200,
              statusText: 'OK',
              latencyMs: 300,
              data: { id: 'msg_ceiling', model, content: text('OK'), stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 1 } },
            }),
          );
        }
        if (body.max_tokens > cap) {
          return route.fulfill(
            errorEnvelope(url, {
              status: 400,
              statusText: 'Bad Request',
              message: `max_tokens: ${body.max_tokens} > ${cap}, which is the maximum allowed number of output tokens for ${plan.capFor ?? model}`,
            }),
          );
        }
        return route.fulfill(
          envelope(url, {
            ok: true,
            status: 200,
            statusText: 'OK',
            latencyMs: 300,
            data: { id: 'msg_ceiling', model, content: text('OK'), stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 1 } },
          }),
        );
      }

      /* ---------- indirect vendor question ---------- */
      if (prompt.includes('Which company trained you?')) {
        if (!plan?.vendorText) {
          return route.fulfill(
            errorEnvelope(url, { status: 429, statusText: 'Too Many Requests', message: 'Rate limit exceeded.', category: 'rate-limit', title: 'Rate limited' }),
          );
        }
        return route.fulfill(
          envelope(url, {
            ok: true,
            status: 200,
            statusText: 'OK',
            latencyMs: 480,
            data: { id: 'msg_vendor', model, content: text(plan.vendorText), stop_reason: 'end_turn', usage: { input_tokens: 42, output_tokens: 38 } },
          }),
        );
      }
      /* ---------- the dashboard's own Test button (non-streamed) ---------- */
      const basic = plan?.basic;
      if (basic?.error) {
        return route.fulfill(
          errorEnvelope(url, {
            status: basic.error.status,
            statusText: basic.error.status === 429 ? 'Too Many Requests' : 'Bad Gateway',
            message: basic.error.message,
            category: basic.error.status === 429 ? 'rate-limit' : 'server',
            title: basic.error.status === 429 ? 'Rate limited' : 'Upstream error',
          }),
        );
      }
      if (basic) {
        // testModel derives t/s from latencyMs and usage.output_tokens alone, so
        // these two numbers fully determine the metric cards and the spread.
        return route.fulfill(
          envelope(url, {
            ok: true,
            status: 200,
            statusText: 'OK',
            latencyMs: basic.latency,
            data: {
              id: `${plan.idPrefix ?? 'msg_'}basic`,
              model: plan.served ?? model,
              content: text('Yes — this endpoint is reachable and responding normally.'),
              stop_reason: 'end_turn',
              usage: { input_tokens: 14, output_tokens: basic.out },
            },
          }),
        );
      }

      // An id with no plan at all: answer honestly rather than inventing a pass.
      return route.fulfill(
        errorEnvelope(url, {
          status: 404,
          statusText: 'Not Found',
          message: `model: ${model} is not served by this endpoint`,
          category: 'invalid-model',
          title: 'Unknown model',
        }),
      );
    }

    return route.continue();
  });
}
/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

const browser = await chromium.launch();
const shots = [];

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  shots.push(name);
  console.log('shot:', name);
}

/** Fill the connection form and wait for discovery to land. */
async function connect(page, { endpoint = 'https://api.example-reseller.test/v1', key = 'sk-brief-0000000000' } = {}) {
  await page.locator('#endpoint').fill(endpoint);
  await page.locator('#apikey').fill(key);
  await page.getByRole('button', { name: /connect & discover/i }).click();
  await page.waitForTimeout(2000);
}

const desktop = { width: 1600, height: 1000 };
/* --- 1. Empty state, before anything is connected ------------------------ */
{
  const ctx = await browser.newContext({ viewport: desktop });
  const page = await ctx.newPage();
  await mockApi(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, '01-empty-disconnected');
  await ctx.close();
}

/* --- 2. Discovered, tested, verified ------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: desktop });
  const page = await ctx.newPage();
  await mockApi(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await connect(page);
  await shot(page, '02-connected-discovered');

  // listModels() silently substitutes FALLBACK_MODELS with isFallback: true, so
  // without this the shots could quietly document the fallback lineup instead.
  if (!(await page.locator('text=glm-4.6').count())) {
    throw new Error('FAIL: mocked catalogue did not render — the fallback list is showing instead');
  }
  console.log('PASS: mocked catalogue rendered');

  await page.getByRole('button', { name: /^select all$/i }).click();
  await page.waitForTimeout(300);
  const selected = await page.locator('input[type="checkbox"]:checked').count();
  if (selected < CATALOGUE.length) {
    throw new Error(`FAIL: selected ${selected} of ${CATALOGUE.length} models`);
  }
  await shot(page, '03-all-selected');
  /* --- reachability pass: metric cards, status pills, latency spread ----- */
  await page.getByRole('button', { name: /test \d+ selected/i }).click();
  await page.waitForTimeout(6000);

  const spread = page.locator('figure', { hasText: 'Latency spread' });
  if (!(await spread.count())) throw new Error('FAIL: latency spread did not render');

  // Latency is a magnitude on a sequential ramp; if every tick resolves to one
  // step the encoding is carrying nothing, and the brief would document a bug.
  const strokes = await page.evaluate(() => {
    const svg = document.querySelector('figure svg');
    return [...new Set([...svg.querySelectorAll('line')].map((l) => getComputedStyle(l).stroke))];
  });
  if (strokes.length < 3) throw new Error(`FAIL: ticks used only ${strokes.length} distinct colours`);
  console.log(`PASS: latency ramp spans ${strokes.length} distinct steps`);
  await shot(page, '04-tested-reachability');

  const statuses = await page.locator('[data-status]').evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute('data-status')))],
  );
  console.log('status tones present:', statuses.join(', '));

  /* --- identity pass ---------------------------------------------------- */
  await page.getByRole('button', { name: /^identify models$/i }).click();
  // Nine models × (3 streamed runs + 2 count_tokens + 3 probes), sequential —
  // "Run concurrently" is left unchecked, which is the default.
  //
  // Sampled rather than slept through: each row is marked "Probing" by its own
  // task as that task starts, so a sequential run must never show two rows
  // probing at once. Flagging the whole cohort up front would spin nine rows
  // while one request is in flight, and the brief's shots would document a
  // busier machine than the one actually running.
  let peakProbing = 0;
  for (let i = 0; i < 300; i += 1) {
    await page.waitForTimeout(100);
    const n = await page.locator('span[data-status="running"]', { hasText: 'Probing' }).count();
    if (n > peakProbing) peakProbing = n;
  }
  if (peakProbing > 1) {
    throw new Error(`FAIL: ${peakProbing} rows showed "Probing" at once in a sequential run`);
  }
  console.log(`PASS: sequential identity run peaked at ${peakProbing} row(s) probing`);
  await shot(page, '05-identity-verdicts');
  /* --- assert every scripted verdict actually landed --------------------- */
  // The whole point of the mock is that each row reaches a *known* state. If the
  // engine and the mock ever disagree, the brief would ship a screenshot that
  // misrepresents the tool — so this fails loudly rather than quietly.
  const VERDICT_LABEL = {
    'matches-advertised': 'Matches what was sold',
    'likely-advertised': 'Likely as advertised',
    'wrong-tier': 'Wrong model tier',
    'different-vendor': 'Different vendor entirely',
    ambiguous: 'Inconclusive',
    'likely-mismatch': 'Likely not as advertised',
    mismatch: 'Not the advertised model',
    error: 'Could not verify',
  };
  const seen = await page.evaluate((ids) => {
    const out = {};
    for (const li of document.querySelectorAll('li')) {
      const label = [...li.querySelectorAll('span')].find((s) => ids.includes(s.textContent?.trim()));
      if (!label) continue;
      const id = label.textContent.trim();
      const pill = [...li.querySelectorAll('span[data-status]')].pop();
      if (pill) out[id] = pill.textContent.trim();
    }
    return out;
  }, CATALOGUE);

  const wrong = Object.entries(EXPECTED).filter(([id, v]) => seen[id] !== VERDICT_LABEL[v]);
  for (const [id, v] of Object.entries(EXPECTED)) {
    console.log(`  ${seen[id] === VERDICT_LABEL[v] ? 'ok  ' : 'BAD '} ${id} → ${seen[id] ?? '(none)'} (want ${VERDICT_LABEL[v]})`);
  }
  if (wrong.length) {
    throw new Error(`FAIL: ${wrong.length} row(s) did not reach the scripted verdict: ${wrong.map(([id]) => id).join(', ')}`);
  }
  console.log(`PASS: all ${Object.keys(EXPECTED).length} scripted verdicts reached`);
  /* --- the substitution chip, close up ----------------------------------- */
  const substituted = page.locator('li', { hasText: 'claude-opus-5' }).first();
  await substituted.scrollIntoViewIfNeeded();
  if (!(await page.locator('text=claude-haiku-4-5-20251001').count())) {
    throw new Error('FAIL: the served-as chip never rendered for the substituted row');
  }
  await substituted.screenshot({ path: `${OUT}/06-row-substitution.png` });
  shots.push('06-row-substitution');
  console.log('shot: 06-row-substitution');

  /* --- evidence open: signals + attribution ------------------------------ */
  const evidence = page.locator('details', { hasText: 'Identity evidence' });
  const openCount = Math.min(3, await evidence.count());
  for (let i = 0; i < openCount; i += 1) {
    await evidence.nth(i).locator('summary').click();
  }
  await page.waitForTimeout(500);
  await shot(page, '07-evidence-expanded');

  // The three-signal attribution block is the densest thing in the app and the
  // part a redesign is most likely to flatten, so it gets its own close-up.
  const attributed = page.locator('details', { hasText: 'Identity evidence' }).first();
  await attributed.scrollIntoViewIfNeeded();
  await attributed.screenshot({ path: `${OUT}/08-attribution-block.png` });
  shots.push('08-attribution-block');
  console.log('shot: 08-attribution-block');

  /* --- filters, search, tabs -------------------------------------------- */
  await page.locator(`input[placeholder^="Search models"]`).fill('claude');
  await page.waitForTimeout(400);
  await shot(page, '09-search-filtered');
  await page.locator(`input[placeholder^="Search models"]`).fill('');
  await page.waitForTimeout(300);
  await ctx.close();
}
/* --- 3. Mobile, 375px ---------------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await mockApi(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await connect(page);
  await page.getByRole('button', { name: /^select all$/i }).click();
  await page.getByRole('button', { name: /test \d+ selected/i }).click();
  await page.waitForTimeout(6000);
  await shot(page, '10-mobile-375');

  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
  });
  console.log('375px horizontal overflow:', overflow.length ? overflow : 'none');
  await ctx.close();
}

/* --- 4. No /v1/models: the built-in lineup stands in ---------------------- */
// A 404 on discovery is the common case for a resold endpoint and says nothing
// about the key, so listModels() substitutes FALLBACK_MODELS and the run goes
// ahead under a "No model list — probing a standard lineup" badge. Worth its own
// shot: it is a *connected* state with four rows the user did not choose.
{
  const ctx = await browser.newContext({ viewport: desktop });
  const page = await ctx.newPage();
  await page.route('**/api/proxy', (route) => {
    const url = route.request().url();
    return route.fulfill(
      errorEnvelope(url, {
        status: 404,
        statusText: 'Not Found',
        message: 'Unknown endpoint: /v1/models',
        category: 'not-found',
        title: 'Endpoint not found',
      }),
    );
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await connect(page);

  const badge = await page.locator('text=probing a standard lineup').count();
  if (!badge) throw new Error('FAIL: fallback lineup did not announce itself in the connection badge');
  const fallbackRows = await page.locator('text=claude-fable-5').count();
  if (!fallbackRows) throw new Error('FAIL: fallback lineup did not render');
  console.log('PASS: fallback lineup labelled as a substitution');
  await shot(page, '11-fallback-lineup');
  await ctx.close();
}

/* --- 5. Failed connection ------------------------------------------------ */
// A rejected key is *not* a benign discovery failure: probing the fallback
// lineup would return four identical auth errors dressed up as model readings.
// isHardDiscoveryFailure() sends this to conn='failed' instead, and the shot
// has to prove the error surface (title, provider message, fix list) rendered.
{
  const ctx = await browser.newContext({ viewport: desktop });
  const page = await ctx.newPage();
  await page.route('**/api/proxy', (route) => {
    const url = route.request().url();
    return route.fulfill(
      errorEnvelope(url, {
        status: 401,
        statusText: 'Unauthorized',
        message: 'invalid x-api-key',
        category: 'auth',
        title: '401 — Authentication failed',
        // Verbatim GENERIC_FIXES.auth from lib/errors.ts — the mock builds the
        // ApiError itself, so without these the shot would show an error box
        // missing the remediation list a real 401 always carries.
        suggestions: [
          'Re-copy the key — trailing whitespace and newlines are a common cause.',
          'Confirm the key belongs to this endpoint; keys are not portable between providers.',
          'Check the auth style: Anthropic uses x-api-key, most gateways use Authorization: Bearer.',
        ],
      }),
    );
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await connect(page, { key: 'sk-wrong' });

  const alert = page.locator('[role="alert"]');
  if (!(await alert.count())) {
    throw new Error('FAIL: 401 produced no error surface — the fallback lineup is showing instead');
  }
  const alertText = await alert.first().innerText();
  if (!/invalid x-api-key/.test(alertText)) {
    throw new Error(`FAIL: error surface omitted the provider message — got: ${alertText.slice(0, 160)}`);
  }
  if (!(await page.locator('text=Connection failed').count())) {
    throw new Error('FAIL: connection badge did not report the failure');
  }
  if (!/Re-copy the key/.test(alertText)) {
    throw new Error('FAIL: error surface rendered without its remediation list');
  }
  // The lineup must not appear alongside a failure; that was the original bug.
  if (await page.locator('text=claude-fable-5').count()) {
    throw new Error('FAIL: fallback lineup rendered under a failed connection');
  }
  console.log('PASS: 401 reaches a real error state, with no fallback lineup');
  await shot(page, '12-connect-failed');
  await ctx.close();
}

/* --- 6. The concurrency toggle actually changes the runner ---------------- */
// Check-only, no shot: the sequential run above proves one row probes at a time,
// which is only meaningful if the toggle is what makes that true. With "Run
// concurrently" checked, Identify must put every selected model in flight at
// once — same switch the plain Test run uses, so this covers both.
{
  const ctx = await browser.newContext({ viewport: desktop });
  const page = await ctx.newPage();
  await mockApi(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await connect(page);
  await page.getByRole('button', { name: /^select all$/i }).click();

  const toggle = page.getByLabel(/run concurrently/i);
  await toggle.check();
  if (!(await toggle.isChecked())) throw new Error('FAIL: "Run concurrently" would not check');

  await page.getByRole('button', { name: /^identify models$/i }).click();
  const probing = page.locator('span[data-status="running"]', { hasText: 'Probing' });
  let peak = 0;
  for (let i = 0; i < 100 && peak < CATALOGUE.length; i += 1) {
    await page.waitForTimeout(100);
    peak = Math.max(peak, await probing.count());
  }
  // Threshold rather than the full nine: a model whose count_tokens route 404s
  // (kimi-k2) can land inside one 100ms sample, so the observed peak is
  // typically 8. Anything above one row already disproves sequential.
  const want = Math.ceil(CATALOGUE.length / 2);
  if (peak < want) {
    throw new Error(`FAIL: concurrent Identify peaked at ${peak} row(s) probing, wanted at least ${want}`);
  }
  console.log(`PASS: concurrent identity run peaked at ${peak} of ${CATALOGUE.length} rows probing`);
  // Closing the context aborts the in-flight probes; nothing here is captured.
  await ctx.close();
}

await browser.close();
console.log(`\n${shots.length} shots written to ${OUT}/`);
console.log('All checks passed.');

