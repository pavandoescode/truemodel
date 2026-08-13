'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Radar, FlaskConical, ShieldCheck, Lightbulb, ChevronRight } from 'lucide-react';
import styles from './GettingStarted.module.css';

const STEPS = [
  {
    Icon: KeyRound,
    title: 'Paste an endpoint and key',
    body: 'Any OpenAI- or Anthropic-compatible base URL. Your key is proxied server-side and never stored unless you ask it to be.',
  },
  {
    Icon: Radar,
    title: 'Connect and discover',
    body: 'The tool lists every model the endpoint actually offers — you don’t need to know the names up front.',
  },
  {
    Icon: FlaskConical,
    title: 'Test, then identify',
    body: 'Benchmark latency and throughput, then run the identity probe to fingerprint what each id really serves.',
  },
  {
    Icon: ShieldCheck,
    title: 'Read the verdict',
    body: 'Each model gets a plain-language verdict: as advertised, wrong tier, or a different model entirely.',
  },
];

/** Short, rotating lessons about why this check exists and how it works. */
const TIPS = [
  'A provider can advertise a premium model and quietly route your calls to a cheaper one. The reply still looks plausible, so you rarely notice it by eye.',
  'The strongest tell isn’t what a model says about itself — models happily hallucinate their own name. It’s what the serving stack can’t fake: the response’s model field, tokenizer counts, enforced output caps.',
  'Two models from the same family tokenize text identically. Send the same string to several endpoints and a mismatched token count becomes a fingerprint.',
  'A model sold with a 200K context window but truncating your input at 32K is a different tier than the one you paid for.',
  'Every check here scores only verifiable contradictions. What a model claims about itself is a lead — never proof.',
];

export function GettingStarted() {
  const [tip, setTip] = useState(0);

  // Rotate the lesson every few seconds, starting on a random one so the page
  // doesn't always open on the same fact. No aria-live: an auto-advancing
  // region would nag a screen reader every tick — the dots below are the
  // accessible control instead.
  useEffect(() => {
    setTip(Math.floor(Math.random() * TIPS.length));
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 7000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.wrap}>
      <div>
        <h3 className={styles.heading}>How it works</h3>
        <p className={styles.lede}>
          Point it at an endpoint you want to check and it tells you which model is really behind the
          id — and whether the provider is being honest about it.
        </p>
      </div>

      <ol className={styles.steps}>
        {STEPS.map(({ Icon, title, body }, i) => (
          <li key={title} className={styles.step}>
            <span className={styles.stepIcon} aria-hidden="true">
              <Icon size={18} />
            </span>
            <div className={styles.stepText}>
              <span className={styles.stepTitle}>
                <span className={styles.stepNum}>{i + 1}</span>
                {title}
              </span>
              <span className={styles.stepBody}>{body}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className={styles.tip}>
        <span className={styles.tipIcon} aria-hidden="true">
          <Lightbulb size={16} />
        </span>
        <div className={styles.tipText}>
          <span className={styles.tipLabel}>Did you know?</span>
          <p key={tip} className={`${styles.tipBody} anim-fade`}>
            {TIPS[tip]}
          </p>
        </div>
      </div>

      <div className={styles.dots} role="tablist" aria-label="Tips">
        {TIPS.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === tip}
            aria-label={`Tip ${i + 1}`}
            className={`${styles.dot} ${i === tip ? styles.dotActive : ''}`}
            onClick={() => setTip(i)}
          />
        ))}
      </div>

      <p className={styles.cta}>
        <ChevronRight size={14} aria-hidden="true" />
        Enter an endpoint and key in the panel, then <strong>Connect &amp; discover</strong> to begin.
      </p>
    </div>
  );
}
