import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Ban,
  Braces,
  CalendarClock,
  ChevronLeft,
  Dices,
  FileText,
  Hash,
  Layers,
  ListChecks,
  PenLine,
  Quote,
  Repeat,
  Route,
  Ruler,
  Scale,
  ScanSearch,
  ServerCog,
  Sigma,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { IdentityPill } from '@/components/IdentityPill';
import { VERDICT_BLURB } from '@/lib/identity';
import { REGISTRY_VERSION } from '@/lib/registry';
import type { IdentityVerdict, SignalWeight } from '@/lib/types';
import styles from './how-it-works.module.css';

export const metadata: Metadata = {
  title: 'How it works — truemodel.tech',
  description:
    'The method behind the verdicts: what counts as evidence, what each check measures, how the verdict is scored, and what this tool cannot prove.',
};

/* Everything on this page is written from the engine it describes, so the two
   cannot drift: the verdict labels and blurbs come from lib/identity, and the
   weights below are the same words the row-level evidence list prints. */

interface Tier {
  rank: 'proof' | 'conditional' | 'never';
  rankLabel: string;
  name: string;
  body: string;
}

const TIERS: readonly Tier[] = [
  {
    rank: 'proof',
    rankLabel: 'Near-proof',
    name: 'What the serving stack says about itself',
    body:
      'The model id on the response, an id named in a validation error, an upstream name in a header a gateway forgot to strip. A model cannot be prompted into faking these — they are written by the software that routed your request. Everything decisive here comes from this tier.',
  },
  {
    rank: 'conditional',
    rankLabel: 'Real but conditional',
    name: 'Measurable behaviour',
    body:
      'Tokenizer counts for a fixed string, the output cap the API actually enforces, whether the same prompt returns the same text at temperature 0, which dated facts it reliably knows, how it habitually formats a reply. Genuine evidence, but only where the published limits are exact and there is a reference to compare against.',
  },
  {
    rank: 'never',
    rankLabel: 'Never proof',
    name: 'What the model says about itself',
    body:
      'A reply of “I am Claude Opus 5” is one line of system prompt away for any model on earth. Self-reports are recorded verbatim as quotes for you to read, and scored only when they contradict the advertised vendor — the one direction a reseller would never prompt for.',
  },
];

const RUN_STEPS: readonly { title: string; body: ReactNode }[] = [
  {
    title: 'Three identical runs at temperature 0',
    body:
      'The same eight-item probe is sent three times with temperature 0 and a 512-token cap. Fixing the prompt makes the runs comparable to each other and to every other model on the same endpoint; three of them separate a stable backend from a load balancer spreading requests across different models.',
  },
  {
    title: 'The tokenizer is measured against its own cohort',
    body: (
      <>
        A fixed string mixing scripts, contractions and rare substrings is sent to{' '}
        <code>count_tokens</code> for each selected model. The score is the median of the cohort measured on
        this same endpoint — never a hardcoded number, because an absolute token count means nothing without a
        reference taken through the same gateway. Select at least two models to make this check scorable.
      </>
    ),
  },
  {
    title: 'The output ceiling is probed, not assumed',
    body: (
      <>
        One request asks for an absurd <code>max_tokens</code> (9,000,000). Anything that validates rejects it
        and usually states both the real cap and the resolved model id outright. When the error is terser, the
        ceiling is found by binary search over the caps real models publish.
      </>
    ),
  },
  {
    title: 'A model id that does not exist is requested',
    body: (
      <>
        Any honest API returns 404 or a validation error for an id it does not serve. A provider that answers{' '}
        <code>not-a-real-model-9v9-20991231</code> with a normal completion is not routing on the model field
        at all — every id it advertises lands on the same backend.
      </>
    ),
  },
  {
    title: 'The billed request is compared against the counted one',
    body: (
      <>
        <code>count_tokens</code> tokenizes exactly the messages you send; the completion bills what the
        backend actually processed. A gateway that prepends a persona (“you are Opus 5, never say otherwise”)
        makes the second number larger, and the gap is the size of the injection.
      </>
    ),
  },
  {
    title: 'The identity question is asked again, sideways',
    body: (
      <>
        A second request asks which company trained it, what its family and version number are, and asks it to
        complete “the underlying model serving this request is ___”. Phrasings a spoofing system prompt tends not
        to anticipate. Whatever comes back is quoted for you verbatim and never converted into a claim — if the
        answers name more than one vendor across runs, that inconsistency is itself reported as a finding.
        Everything measured — the enforced cap, the vendor evidence, the capability profile, the knowledge
        horizon — is then pooled into a ranked <strong>“closest registry families”</strong> shortlist, which
        answers the follow-up question every mismatch raises: if this is not the model sold, what is the closest
        thing it could be? Those scores are relative within the ranking, not probabilities.
      </>
    ),
  },
  {
    title: 'Its knowledge horizon is bracketed with dated trivia',
    body: (
      <>
        One extra request asks six questions whose answers became knowable on known dates between 2023 and 2025.
        A model cannot know events from after its training data was collected — no system prompt can install the
        winner of an election the weights never saw — so which facts it reliably knows brackets when it was
        trained, and that bracket is compared against the advertised family’s window in the model registry. Two
        items must point the same way before this scores at all.
      </>
    ),
  },
  {
    title: 'Its writing style is compared against its siblings, for free',
    body: (
      <>
        After every model has been probed, the answers already collected are reduced to a style vector — sentence
        length, markdown density, dash and ellipsis rates. Families have stable writing habits, and a substituted
        backend still writes like itself, so each model’s vector is compared against the median of its cohort on
        the same endpoint, with the “too different” bar learned from the cohort’s own spread. Zero extra requests:
        the text was already on its way back from the identity runs.
      </>
    ),
  },
  {
    title: 'Optionally, its “random” numbers are sampled and compared',
    body: (
      <>
        When <strong>Deep fingerprint</strong> is switched on, each model is asked to “pick a random integer
        between 1 and 100” roughly forty times. LLMs are biased, model-specific random generators — a bias baked
        into the weights that a system prompt cannot rewrite. Each model’s distribution is compared, using
        Jensen–Shannon divergence, against the median of the cohort on this same endpoint. The cutoff is not a
        fixed number: it is learned from how much the cohort’s own members scatter, so a small sample cannot
        trip a false accusation.
      </>
    ),
  },
  {
    title: 'Only contradictions are scored',
    body:
      'Each check becomes a signal with a weight, skipped rather than guessed whenever the endpoint gave away too little. The verdict is then aggregated from the weights — a named substitution overrides everything, because a working model that is not the one sold is still not the one sold.',
  },
];

interface SignalDoc {
  Icon: typeof Hash;
  name: string;
  weight: SignalWeight;
  body: ReactNode;
}

const SIGNALS: readonly SignalDoc[] = [
  {
    Icon: ServerCog,
    name: 'Model the endpoint served',
    weight: 'hard',
    body: (
      <>
        The id the serving stack itself reported, taken from the response <code>model</code> field, a
        validation error, or a header — in that order of trust. This is the closest thing to proof the tool can
        get. An endpoint that simply echoes back the id you requested is treated as having said nothing at all,
        not as a pass.
      </>
    ),
  },
  {
    Icon: Hash,
    name: 'Tokenizer fingerprint',
    weight: 'hard',
    body:
      'Models from one vendor generation share a tokenizer, so genuine siblings return the same count for the same text. More than 5% away from the cohort median on this endpoint means a different tokenizer, and so a different model family.',
  },
  {
    Icon: Ruler,
    name: 'Enforced output ceiling',
    weight: 'hard',
    body: (
      <>
        Scored only where the vendor rejects an over-cap <code>max_tokens</code> instead of clamping it —
        Anthropic today. Everywhere else the measured number is shown but never counted, because a clamping API
        returns the same answer whatever model is behind it.
      </>
    ),
  },
  {
    Icon: Sigma,
    name: 'Arithmetic, letter counting, code generation',
    weight: 'hard',
    body: (
      <>
        Five questions with exactly one right answer each (17 × 24, the r’s in “strawberry”, the one-line Python
        sum of 1–100, 847 × 36, and the r’s in “retrospectrometer”), chosen because they can be graded without a
        reference model. The class of 2026 was specifically tuned on the famous items — strawberry counts and
        small products now appear in training data — so the nonce word and the larger product restore the tier
        separation the original three have started to lose. Each is graded per run and downgraded to soft for
        small tiers and ids not in the registry: a genuine Haiku really does miscount letters, and failing one
        for that would be a false accusation.
      </>
    ),
  },
  {
    Icon: CalendarClock,
    name: 'Knowledge horizon',
    weight: 'soft',
    body: (
      <>
        Six dated-trivia questions, one request. A model correctly answering two or more facts dated{' '}
        <em>after</em> the advertised family’s training window knows things that family cannot know — no system
        prompt can install a fact the weights never saw. Missing two or more facts comfortably <em>inside</em>{' '}
        the window suggests an earlier generation. Soft because cutoffs are announced loosely and revised
        quietly, and one item off in either direction is recorded but never scored.
      </>
    ),
  },
  {
    Icon: PenLine,
    name: 'Writing style vs siblings',
    weight: 'soft',
    body:
      'A style vector — sentence length, markdown density, dash and ellipsis rates — computed from answers the runs already collected, so it costs no extra requests. Compared against the cohort median with a threshold learned from the cohort’s own spread, exactly like the random-number fingerprint. The probe’s rigid numbered format mutes individual style, which is why this is deliberately weak-but-cheap corroborating evidence.',
  },
  {
    Icon: ListChecks,
    name: 'Exact instruction following',
    weight: 'soft',
    body: (
      <>
        Two constraints, both graded per run: reply with exactly <code>ORANGE</code> where the probe demanded
        that single word, and reply with exactly seven words where it demanded a length. Counting one’s own
        output is a stricter instruction-following test than echoing a fixed word — it trips models that
        pattern-match the prompt instead of obeying it.
      </>
    ),
  },
  {
    Icon: Braces,
    name: 'Response id shape',
    weight: 'soft',
    body: (
      <>
        Scored only where the vendor publishes a shape its own API emits — Anthropic’s <code>msg_</code>{' '}
        prefix. A gateway that mints its own ids is not evidence either way, which is why this is weighed
        lightly.
      </>
    ),
  },
  {
    Icon: Repeat,
    name: 'Run-to-run consistency',
    weight: 'soft',
    body:
      'Three different answers to the same prompt at temperature 0 means the requests are not all reaching the same backend.',
  },
  {
    Icon: Dices,
    name: 'Random-number distribution',
    weight: 'soft',
    body: (
      <>
        Opt-in, and off by default because it costs about forty extra requests per model. A model’s bias when
        picking a “random” 1–100 lives in its weights, so it survives any system prompt. The sampled
        distribution is scored by Jensen–Shannon divergence against the cohort median, using a threshold learned
        from the cohort’s own spread. Soft on purpose — a distribution is suggestive, not a named substitution,
        and it needs 30+ parsed samples and a two-model cohort before it scores at all.
      </>
    ),
  },
  {
    Icon: Quote,
    name: 'Vendor it names for itself',
    weight: 'soft',
    body:
      'Recorded always, scored in one direction only. Naming the advertised vendor proves nothing — that is exactly what a reseller’s system prompt guarantees. Naming a different one is a real lead.',
  },
  {
    Icon: Route,
    name: 'Endpoint routes on the model name',
    weight: 'context',
    body:
      'A serious finding about the provider, and deliberately never scored against an individual model: an endpoint that ignores model names may still have answered this particular request with the right one.',
  },
  {
    Icon: ScanSearch,
    name: 'Hidden system prompt',
    weight: 'context',
    body: (
      <>
        The gap between billed input tokens and counted input tokens. A benign safety preamble has the same
        shape as a spoofing one, so this is shown, not scored — and a clean result is not proof either, since a
        gateway that padded its <code>count_tokens</code> by the same amount it injected would hide the gap
        entirely.
      </>
    ),
  },
];

/* The label and the one-line meaning are read straight from the engine via
   IdentityPill and VERDICT_BLURB; only the scoring rule is written here. */
const VERDICT_RULE: readonly { verdict: IdentityVerdict; when: string }[] = [
  {
    verdict: 'matches-advertised',
    when: 'Every scored check passed and none partially failed. Confidence rises with how many checks the endpoint allowed.',
  },
  { verdict: 'likely-advertised', when: 'At least 70% of the scored checks passed, with something left unexplained.' },
  {
    verdict: 'ambiguous',
    when: 'Nothing could be scored at all, or the pass ratio landed between 40% and 70%. Not a clean bill of health — the endpoint simply revealed too little.',
  },
  {
    verdict: 'likely-mismatch',
    when: 'One hard check failed, or fewer than 40% of the scored checks passed. One verifiable contradiction is enough to doubt the label.',
  },
  { verdict: 'mismatch', when: 'Two or more hard checks failed.' },
  {
    verdict: 'wrong-tier',
    when: 'The endpoint named a model from the advertised vendor but a different family. This overrides the pass ratio — passing behaviour cannot average away a named substitution.',
  },
  {
    verdict: 'different-vendor',
    when: 'The endpoint named a model belonging to another company. The highest-confidence verdict the tool issues, and the only one ranked above a wrong tier.',
  },
  { verdict: 'error', when: 'No run returned any text, so nothing was established either way.' },
];

const LIMITS: readonly { title: string; body: ReactNode }[] = [
  {
    title: 'A well-built proxy produces “inconclusive”, not “mismatch”',
    body: (
      <>
        A gateway that rewrites the response <code>model</code> field to the id you asked for, mints its own
        message ids, pads its <code>count_tokens</code> response, and forwards to a same-vendor sibling defeats
        every hard check at once. The result is <strong>Inconclusive</strong>, which is the honest answer — but
        read it as “nothing was proved”, never as “verified genuine”.
      </>
    ),
  },
  {
    title: 'Two checks need the endpoint to implement count_tokens',
    body: (
      <>
        When <code>/v1/messages/count_tokens</code> returns 404, both the tokenizer fingerprint and the
        hidden-prompt comparison are skipped. The tokenizer check also needs at least two models selected on
        the same endpoint, since the baseline is that cohort’s median.
      </>
    ),
  },
  {
    title: 'The output ceiling is only scorable for exact-cap vendors',
    body: (
      <>
        Anthropic rejects a <code>max_tokens</code> above the model’s cap; most other vendors clamp it, version
        their caps quietly, or differ per deployment. For those the measured number is reported and left
        unscored, so a ceiling mismatch cannot be used against them.
      </>
    ),
  },
  {
    title: 'The puzzles separate capability tiers, not vendors',
    body:
      'Any current flagship answers all three correctly, so passing them does not identify a vendor — a substituted sibling of comparable strength passes exactly as the advertised model does. They catch a cheap model behind an expensive label, not a same-tier swap.',
  },
  {
    title: 'The random-number fingerprint is statistical, and only relative',
    body:
      'It compares each model against its cohort on the same endpoint, so it needs two or more models selected and 30+ parsed samples before it scores; a lone model, or a provider that serves one backend for every id, leaves it with nothing to contrast against. Because roughly forty samples is a small sample, it is scored softly against a threshold learned from the cohort’s own scatter rather than a fixed cutoff — it can corroborate a substitution but never establish one by itself.',
  },
  {
    title: 'A pass is a statement about one moment',
    body:
      'Every verdict describes the requests that were actually sent, from one IP, at one time. A provider can route a percentage of traffic, or route differently under load or by customer. Re-run the check periodically rather than treating one clean result as permanent.',
  },
  {
    title: 'The model table is hand-maintained',
    body: `Advertised context windows, output caps, approximate training-cutoff windows and vendor mappings come from a registry in this repository (version ${REGISTRY_VERSION}). A model released after that date can be reported as an unrecognised id, which downgrades the puzzles to unscored and leaves nothing to compare a ceiling or a knowledge horizon against.`,
  },
  {
    title: 'Cutoff windows are windows, not dates',
    body:
      'Vendors announce training cutoffs loosely and revise them quietly, so the registry stores each family’s cutoff as a month range and the knowledge-horizon check requires two items to agree before it scores. A single dated fact either side of the window is recorded as evidence and never scored — one trivia answer can be guessed, and one knowledge hole is Tuesday for a real model.',
  },
];

const WEIGHT_LABEL: Record<SignalWeight, string> = {
  hard: 'Hard',
  soft: 'Soft',
  context: 'Context',
};

export default function HowItWorksPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Back to validator</span>
        </Link>
        <h1 className={styles.title}>
          <Zap size={22} aria-hidden="true" /> How it works
        </h1>
        <p className={styles.lede}>
          A reseller can advertise a premium model and quietly route your calls to a cheaper one. The reply
          still reads plausibly, so you rarely catch it by eye. This page is the whole method: what counts as
          evidence, what each check measures, how a verdict is scored — and, at the end, what none of it can
          prove.
        </p>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <Scale size={18} aria-hidden="true" /> The one rule everything follows
            </h2>
          </div>
          <p className={styles.prose}>
            Nothing here trusts what a model says about itself. What cannot be faked cheaply is the serving
            stack&apos;s own bookkeeping: the model id on the response, the id named in a validation error, the
            tokenizer&apos;s count for a fixed string, the output cap the API enforces. And one thing the model
            itself cannot fake in the other direction: knowledge of events from after its training data was
            collected. Those decide the verdicts. A model&apos;s claims about itself are kept as quotes for you
            to read, and are scored in exactly one case — when they contradict the vendor being advertised.
          </p>
          <ul className={styles.tiers}>
            {TIERS.map((tier) => (
              <li key={tier.name} className={styles.tier} data-rank={tier.rank}>
                <div className={styles.tierHead}>
                  <span className={styles.tierName}>{tier.name}</span>
                  <span className={styles.tierRank}>{tier.rankLabel}</span>
                </div>
                <p className={styles.tierBody}>{tier.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <Layers size={18} aria-hidden="true" /> What happens when you press Identify
            </h2>
            <p className={styles.prose}>
              Up to ten things, per selected model. The random-number sampling is opt-in; any of the rest can
              come back skipped — an endpoint that refuses a probe leaves that check unscored rather than
              counted against the model.
            </p>
          </div>
          <ol className={styles.steps}>
            {RUN_STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={`${styles.stepNum} tnum`} aria-hidden="true">
                  {i + 1}
                </span>
                <div className={styles.stepText}>
                  <span className={styles.stepTitle}>{step.title}</span>
                  <span className={styles.stepBody}>{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <ListChecks size={18} aria-hidden="true" /> The checks, and what each one is worth
            </h2>
            <p className={styles.prose}>
              <strong>Hard</strong> means a verifiable contradiction: one is enough to doubt the label, two
              settle it. <strong>Soft</strong> counts toward the pass ratio but is never decisive alone.{' '}
              <strong>Context</strong> is shown and deliberately never scored — it says something about the
              provider rather than about which model answered this request.
            </p>
          </div>
          <ul className={styles.signals}>
            {SIGNALS.map(({ Icon, name, weight, body }) => (
              <li key={name} className={styles.signal}>
                <span className={styles.signalName}>
                  <Icon size={15} aria-hidden="true" />
                  {name}
                </span>
                <span className={styles.signalWeight} data-weight={weight}>
                  {WEIGHT_LABEL[weight]}
                </span>
                <p className={styles.signalBody}>{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <FileText size={18} aria-hidden="true" /> How the verdict is decided
            </h2>
            <p className={styles.prose}>
              Skipped checks are ignored rather than counted against the model, and context findings can never
              fail one. What remains is the scored set, and these are the exact rules applied to it.
            </p>
          </div>
          <ul className={styles.verdicts}>
            {VERDICT_RULE.map(({ verdict, when }) => (
              <li key={verdict} className={styles.verdict}>
                <IdentityPill verdict={verdict} />
                <p className={styles.verdictBody}>{VERDICT_BLURB[verdict]}</p>
                <p className={styles.verdictWhen}>{when}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <Ban size={18} aria-hidden="true" /> What this cannot prove
            </h2>
            <p className={styles.prose}>
              The tool is built to avoid false accusations, which means it fails silent rather than loud. Read
              these before you act on a verdict.
            </p>
          </div>
          <ul className={styles.limits}>
            {LIMITS.map(({ title, body }) => (
              <li key={title} className={styles.limit}>
                <span className={styles.limitTitle}>{title}</span>
                <p className={styles.limitBody}>{body}</p>
              </li>
            ))}
          </ul>
          <div className={styles.callout}>
            <TriangleAlert size={18} aria-hidden="true" />
            <p className={styles.calloutText}>
              <strong>A mismatch is strong; a pass is weaker than it looks.</strong> When this tool says a
              different model answered, it is because the endpoint said so itself, and that is worth raising
              with a provider or a chargeback. When it says everything matched, it means nothing contradicted
              the label across the checks the endpoint permitted — which is a much smaller claim.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <FileText size={18} aria-hidden="true" /> Evidence you can hand to someone else
            </h2>
          </div>
          <p className={styles.prose}>
            Every run can be exported as a receipt: the verdict with its confidence, every signal with its
            status and weight, the raw evidence behind it — tokenizer counts, the measured ceiling, the
            knowledge horizon, the writing-style deviation — the closest-families shortlist when attribution
            ran, and the model-table version that produced it, in Markdown with embedded
            JSON. It records the endpoint&apos;s host only — never your API key — so it can be attached to a
            support ticket or a dispute as-is. Your key is proxied server-side and is written to disk only if
            you explicitly ask this tool to generate a CLI config for you.
          </p>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/" className={styles.back}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Back to validator</span>
        </Link>
        <p className={styles.footerNote}>Model table version {REGISTRY_VERSION}</p>
      </footer>
    </div>
  );
}
