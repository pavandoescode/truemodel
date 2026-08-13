# Provider Setup Guide

This app answers one question: **does this endpoint serve the model it says it
serves?** You give it any endpoint that speaks the Anthropic `/v1/messages`
shape plus a key; it discovers the catalogue, tests each model, identifies what
is actually behind each id, and can write the passing ones into your Claude Code
or OpenCode config. Nothing on your system is modified except those config
files, and only when you ask.

The key is sent to the provider through this app's own server route, so it never
goes to a third party and provider CORS rules don't apply.

## Sidebar connect (the main flow)

1. Open the app.
2. In the sidebar, pick a preset (Anthropic, OpenRouter, LiteLLM, etc.) or
   enter a custom endpoint. **Add /v1** appends the version segment when the
   endpoint doesn't already carry one — the resolved request URL is echoed
   under the field, so there's no guessing.
3. Paste your API key.
4. Click **Connect & discover** to list models.
5. Select some, then **Test** for a live call, or **Identify models** to work
   out what each id really is.
6. Once models pass, **Save to Claude Code settings** writes them into
   `~/.claude/settings.json` (or `~/.opencode/config.json` for OpenCode).

It supports custom headers, saved provider profiles, and both Claude Code and
OpenCode as save targets.

## Identify models

Testing tells you an id responds. Identifying tells you *what responded*. The
probe never trusts what a model says about itself — "I am Opus" is one line of
system prompt away for any model on earth. It weighs evidence the serving stack
produces as a side effect instead:

- **The response's own `model` field**, and any id named in a validation error
  — near-proof, unless the value merely echoes what you asked for, which counts
  as no evidence at all.
- **The enforced output ceiling.** Only scored for vendors that *reject* an
  over-cap `max_tokens` instead of silently clamping it.
- **The tokenizer's count** for a fixed string, compared against the median of
  the other models on the same endpoint — not a hardcoded constant.
- **Fixed puzzles with checkable answers**, run three times. Weighted lightly
  for small/cheap tiers, which fail them legitimately.

Verdicts run from *matches advertised* through *wrong tier* and *different
vendor* to *mismatch*, with *ambiguous* when the endpoint gives nothing away.
Provider-level findings are marked as context and never counted against an
individual model. The **Not as advertised (N)** filter collapses the list to the
ids whose verdict says the served model wasn't the one sold.

<!-- SETUP_DOC_PART_2 -->

## Settings → save a key

The **Settings** page stores one endpoint + key + model so you don't have to
retype it:

1. Go to **Settings**.
2. Paste your provider's API key, pick an endpoint preset, pick a model.
3. Click **Validate & Save**.
4. The sidebar shows the saved key and pre-fills the endpoint/key fields.
   Click **Remove** in Settings to clear it and go back to editing the sidebar
   fields directly.

Use this if you always test against the same key. Use the sidebar directly if
you want custom headers or multiple saved profiles.

### Storage

Your API key is obfuscated (XOR + base64) before being written to
`localStorage`. This deters someone glancing at DevTools, but it is **not
encryption** — it does not protect the key from anyone with script execution or
file access on the same machine/browser profile. Treat it the same as any other
locally-stored plaintext secret: don't do this on a shared or untrusted
machine. Uncheck "Remember these settings" to keep it in memory for the session
only.

### Models

**Auto-detect** is the right pick for a resold endpoint: leaving the model
empty makes `/api/validate-key` ask the endpoint's own `/v1/models` (then
`/models`) what it sells and validate the key against a cheap current id from
that list. The response reports where the id came from — `requested`,
`discovered`, or `fallback`. The named quick picks (Claude Sonnet 5, Claude
Haiku 4.5, GPT-5, Gemini 3 Pro) are shortcuts for when you already know what
you're pointing at; any id the provider accepts can be typed into the sidebar
instead.

Every vendor's published context and output limits live in one registry
(`lib/registry.ts`). That is deliberately the only model table in the codebase:
the numbers shown next to an id are the same numbers the identity probe holds
the endpoint to, so the UI can't advertise a limit the probe would then
contradict.

## Save targets

**Claude Code** — writes `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and
`ANTHROPIC_DEFAULT_<ALIAS>_MODEL` entries into `~/.claude/settings.json`.
Existing keys in that file are preserved. Useful for any Anthropic-shaped
provider, not just Anthropic's own — that's the point of pointing the CLI at a
reseller.

**OpenCode** — writes an `@ai-sdk/openai-compatible` provider block into
`~/.config/opencode/opencode.jsonc` (or `.json`, or `~/.opencode/config.json`,
whichever already exists). JSONC comments in the existing file are stripped
before parsing, so a commented config is read correctly.

## Troubleshooting

**API key rejected:** check it's a real, non-expired key for the endpoint you
pointed at, and that the endpoint is reachable. The **Test connection** /
**Test only** button calls `/api/validate-key`, which makes a real request and
returns the provider's actual error. It tries `x-api-key` first and retries with
`Authorization: Bearer` on a 401/403, so gateways using either scheme work — one
at a time, since some gateways reject a request carrying both.

**Models list is empty after connecting:** the endpoint might not expose
`/v1/models` or `/models`. The app falls back to a small built-in lineup of ids
that such endpoints almost always accept, so you're not blocked — the
**No model list — probing a standard lineup** badge under the connection status
tells you when that fallback is in use.

**Every verdict comes back "ambiguous":** the endpoint is revealing nothing —
no catalogue, an echoed `model` field, and clamped rather than rejected output
caps. That is itself worth knowing, and it's what a proxy trying to hide its
routing looks like.

**Settings not saved:** confirm "Remember these settings" is checked in
Settings (or the "Remember key in this browser" checkbox in the sidebar), and
that your browser isn't in private/incognito mode, which can disable
persistent storage.

## Deploying this publicly

Running it locally, the app is trusted with your own machine. Hosted for other
people, three things change behaviour automatically when `NODE_ENV=production`:

**Private endpoints are refused.** `/api/proxy`, `/api/stream`, `/api/ping` and
`/api/validate-key` fetch a URL you supply, which on a server also means
anything *that server* can reach and you can't — `169.254.169.254` for cloud
credentials, an admin panel on the same VPC. Hostnames are resolved and every
answer checked, so a public name pointing at `127.0.0.1` is caught too. Set
`ALLOW_PRIVATE_ENDPOINTS=1` to allow them anyway (only sane on a machine you
own, where you want the LiteLLM/Local presets).

**Requests are rate limited** per client IP: 60/minute on the proxy, ping and
validate routes, 30/minute on streaming, since each call makes an outbound
request that costs the host bandwidth. The counter is in memory, so behind
several instances the real ceiling is that times the instance count — put a
shared limiter in front if you scale out. `DISABLE_RATE_LIMIT=1` turns it off.

**The config writers are off.** `/api/save-settings`, `/api/save-opencode` and
`/api/test-cli` write to `~/.claude`, `~/.config/opencode` and run
`claude doctor` — on a shared host that's a visitor rewriting the *server's*
CLI config, so they return 403. `ENABLE_LOCAL_WRITES=1` re-enables them for a
production build you run on your own machine (`npm run build && npm start`).

Note what is *not* protected: a hosted instance sees every key pasted into it
in plaintext, in server memory, for the life of the request. Nothing logs or
stores them, but "trust the operator" is the security model. Say so on the page
if you host this for strangers, and expect careful users to run it locally.


