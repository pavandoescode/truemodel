# truemodel.tech

**Detect what's really behind a model ID.**

truemodel.tech answers one question that model marketplaces and proxies rarely let you verify: **does this endpoint actually serve the model it claims to serve?**

Point it at any endpoint that speaks the Anthropic `/v1/messages` shape, paste a key, and truemodel.tech discovers the catalogue, tests each model with a live call, and probes what is *actually* running behind each id — without ever trusting what a model says about itself.

---

## Why

"I am Claude Opus" is one line of system prompt away for any model on earth. Providers relabel, downgrade, and reroute models all the time. TrueModel ignores self-reported claims and instead weighs evidence the serving stack leaks as a side effect — response `model` fields, validation errors, enforced output ceilings, and other fingerprints — to tell you what you're really paying for.

## Features

- **Connect & discover** — list every model an endpoint exposes.
- **Live testing** — real `/v1/messages` calls confirm an id actually responds.
- **Model identification** — evidence-based probing to reveal the true model behind an id:
  - **Serving-stack leaks** (hard evidence): response `model` fields, ids named in validation errors, enforced output ceilings, tokenizer fingerprints scored against the endpoint's own cohort.
  - **Capability probes** (tier separation): a five-puzzle battery graded per run — including a nonce word and a harder product the class of 2026 wasn't tuned on — plus strict instruction-following constraints.
  - **Knowledge horizon** (generational evidence): dated-trivia bracketing compared against the advertised family's training-cutoff window; knowing facts from after the window is a contradiction no system prompt can paper over. One extra request.
  - **Writing-style fingerprint** (zero extra requests): style vectors from the probe answers, scored cohort-relative like the tokenizer and random-number signals.
  - **Closest-registry-families ranking**: when the label is doubted, a scored shortlist of which known families the measured evidence actually fits.
- **Visible confidence** — every verdict carries its confidence percentage, per-signal evidence with raw-measurement meters, and a key-free Markdown evidence receipt you can share.
- **Provider presets** — Anthropic, OpenRouter, LiteLLM, and custom endpoints, with `/v1` auto-append and the resolved URL echoed so there's no guessing.
- **Custom headers & saved profiles** — reuse provider configs across sessions.
- **Live request trace** — a console showing every provider call's two hops as they happen: browser → this app's route → the exact provider URL the route resolved, with each leg's timing, the status that came back, masked request/response headers, usage, and the full domain-to-domain redirect trail when a provider bounces the request. Credential headers never follow a redirect to another host. Nothing persisted; clear it any time.
- **Write-back to your tools** — save passing models into Claude Code (`~/.claude/settings.json`) or OpenCode (`~/.opencode/config.json`), only when you ask.

Your key is proxied through truemodel.tech's own server route, so it never goes to a third party and provider CORS rules don't apply. Nothing on your system is modified except the config files you explicitly choose to write. No database, no server-side storage: everything happens in your browser session.

## Tech Stack

Next.js 16 · React 19 · TypeScript · Vitest

## Getting Started

```bash
# install dependencies
npm install

# run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect an endpoint from the sidebar.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm start` | Run the production build |
| `npm run typecheck` | Type-check with `tsc` |
| `npm test` | Run the test suite (Vitest) |

## Usage

1. Open the app.
2. In the sidebar, pick a preset or enter a custom endpoint.
3. Paste your API key.
4. **Connect & discover** to list models.
5. **Test** for a live call, or **Identify models** to reveal what each id really is.
6. Optionally **Save** the passing models into your Claude Code / OpenCode config.

See [PROVIDER_SETUP.md](./PROVIDER_SETUP.md) for the full walkthrough of presets, headers, and the identification methodology.

## Contributing

Issues and PRs are welcome. Please open an issue to discuss significant changes before submitting a PR.

## License

MIT
