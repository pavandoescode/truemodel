/**
 * Identity verification types.
 *
 * The question is deliberately not "is this Claude?" but "is this the model the
 * provider sold?" — asked the same way for every vendor, since a reseller
 * substituting a cheap Llama behind a GPT-5 label and one substituting Haiku
 * behind an Opus label are the same fraud with different names.
 */

import type { ApiError, CheckStatus, Usage } from './index';

/**
 * Verdicts, ordered from best to worst.
 *
 * `wrong-tier` and `different-vendor` are kept apart because they are different
 * accusations. Wrong tier is usually a reseller quietly routing to a cheaper
 * model from the same family line — real, but the vendor is as advertised.
 * Different vendor means the id on the invoice has nothing to do with what
 * answered.
 */
export type IdentityVerdict =
  | 'matches-advertised'
  | 'likely-advertised'
  | 'wrong-tier'
  | 'different-vendor'
  | 'ambiguous'
  | 'likely-mismatch'
  | 'mismatch'
  | 'error';

export type IdentitySignalId =
  | 'puzzle-arithmetic'
  | 'puzzle-strawberry'
  | 'puzzle-python-sum'
  | 'puzzle-hard-arithmetic'
  | 'puzzle-nonce-count'
  | 'instruction-following'
  | 'format-constraint'
  | 'response-id-shape'
  | 'tokenizer-fingerprint'
  | 'consistency-check'
  | 'self-reported-vendor'
  /** Whether the endpoint routes on the model name at all. */
  | 'model-name-honored'
  /** Whether the model actually served matches the one requested. */
  | 'served-model-id'
  /** Measured output cap versus the advertised model's published cap. */
  | 'output-ceiling'
  /** Extra input tokens the endpoint billed beyond the request — a hidden preamble. */
  | 'system-prompt-injection'
  /** Divergence of the model's "random number" distribution from a baseline. */
  | 'random-number-fingerprint'
  /** Knowledge horizon versus the advertised family's training-cutoff window. */
  | 'knowledge-cutoff'
  /** Writing-style divergence from the cohort, measured on answers already collected. */
  | 'style-fingerprint';

/**
 * How much a signal is allowed to move the verdict.
 *
 * `hard` — a verifiable contradiction; one is enough to doubt the model, two
 * settle it. `soft` — counted in the ratio but never decisive on its own.
 * `context` — shown to the user, deliberately unscored, because it says
 * something about the provider rather than about this particular response.
 */
export type SignalWeight = 'hard' | 'soft' | 'context';

export interface IdentitySignal {
  id: IdentitySignalId;
  label: string;
  status: CheckStatus;
  weight: SignalWeight;
  detail: string;
  /** Raw evidence captured (token count, response id, puzzle answer, …). */
  evidence?: unknown;
}

export interface IdentityRun {
  index: number;
  text: string;
  messageId: string | null;
  /** The `model` the response reported, which need not match the id requested. */
  reportedModel: string | null;
  /** Response headers, scanned for upstream model names gateways forget to strip. */
  headers: Record<string, string> | null;
  stopReason: string | null;
  usage: Usage | null;
  latencyMs: number;
  error: ApiError | null;
}

/** How confident we are in a served-model name, and therefore how to present it. */
export type NameSource =
  | 'response-model' // the API's own `model` field — authoritative
  | 'error-message' // an id the endpoint named in a validation error — authoritative
  | 'response-header' // an upstream header a gateway forgot to strip — strong
  | 'ceiling' // narrowed by measured output cap — a set, not a name
  | 'self-report' // the model said so — weak
  | 'none';

/** What the requested id claims to be, from the registry. */
export interface AdvertisedModel {
  vendor: string;
  family: string;
  output: number;
  context: number;
  /** True when this vendor enforces its output cap, making a ceiling scorable. */
  capsExact: boolean;
}

/**
 * Which model is actually serving this request.
 *
 * Kept separate from the pass/fail signals because it answers a different
 * question. Behavioural checks can only ask "does this behave like the class of
 * model advertised"; every model in a vendor's line shares a tokenizer and
 * solves the same puzzles, so a cheaper sibling passes all of them. Only the
 * serving stack's own statements distinguish siblings.
 */
export interface Attribution {
  /** Best known real model id, whatever its source. Null when nothing leaked. */
  servedModelId: string | null;
  /** Family of `servedModelId`, when it maps to a known model. */
  servedFamily: string | null;
  /** Vendor of `servedModelId`, as a display label. */
  servedVendor: string | null;
  /** Where `servedModelId` came from, which sets how much it is worth. */
  nameSource: NameSource;

  /** The family the requested id implies. */
  requestedFamily: string | null;
  /** The vendor the requested id implies, as a display label. */
  requestedVendor: string | null;
  /** True when the served family is known and differs from the requested one. */
  familyMismatch: boolean;
  /** True when the served vendor is known and differs from the requested one. */
  vendorMismatch: boolean;

  /** Whether the endpoint routes on the model name at all. */
  nameHonored: 'honored' | 'ignored' | 'unknown';
  /** The fake id used to test name routing, shown as evidence. */
  probedFakeId: string | null;

  /** Largest max_tokens the endpoint accepted, or null when unprobed. */
  measuredCeiling: number | null;
  /** True when the endpoint enforces no output limit, making the ceiling useless. */
  unvalidatedCeiling: boolean;
  /** Families whose published cap matches the measured ceiling. */
  candidateFamilies: string[];
  /**
   * Registry families ranked by how well everything measured — ceiling, vendor
   * evidence, capability profile, knowledge horizon — fits them. Answers "if
   * this is not the model sold, what is the closest thing it could be?".
   * Scores are relative within the ranking, not absolute probabilities.
   */
  rankedCandidates: FamilyCandidate[];
  /** What the advertised id claims, when the id is recognised. */
  advertised: AdvertisedModel | null;

  /** Vendor named in the model's own answers. Inference, not proof. */
  claimedVendor: string | null;
  /** All vendor names mentioned, when answers disagree. */
  vendorMentions: string[];
  /** Verbatim lines behind the vendor guess, so the user can judge it. */
  quotes: string[];

  /** Plain-language conclusion, always naming the served model when known. */
  summary: string;
}

/** One registry family in the ranked "closest match" list. */
export interface FamilyCandidate {
  family: string;
  /** Display vendor label, e.g. "Anthropic". */
  vendor: string;
  /** 0–100, relative within this ranking (top candidate is 100). */
  score: number;
  /** Short human-readable reasons this family scored as it did. */
  why: string[];
}

/**
 * Result of the knowledge-cutoff probe: one batched request of dated trivia.
 *
 * A model cannot know events from after its training data was collected, so
 * which dated facts it reliably knows brackets when its weights were trained.
 * Compared against the advertised family's registry window, that bracket is
 * soft generational evidence — newer, older, or consistent.
 */
export interface KnowledgeCutoffResult {
  /** Answers extracted per question, '' where the model skipped the item. */
  answers: string[];
  /** How many questions were answered correctly. */
  correct: number;
  /** Latest-dated question answered correctly, as an absolute month number. */
  knownThrough: number | null;
  /** Questions answered correctly that are dated after the family window. */
  lateCorrect: number;
  /** Questions answered wrongly that are dated well before the family window. */
  earlyWrong: number;
  /** The advertised family's window, when both edges are known. */
  window: { from: number; to: number } | null;
}

/**
 * Result of the random-number distributional probe.
 *
 * LLMs bias their "random" choices in stable, model-specific ways; comparing the
 * sampled histogram against a baseline via Jensen–Shannon divergence catches a
 * substitution the model can't hide, because the bias is in the weights, not in
 * anything a gateway system prompt controls.
 */
export interface RandomNumberFingerprint {
  /** Normalized 100-bin distribution over [1,100]. */
  distribution: number[];
  /** How many requests were attempted and how many parsed to an integer. */
  attempted: number;
  parsed: number;
  /** Jensen–Shannon divergence [0,1] versus the baseline, or null when unscored. */
  divergence: number | null;
  /**
   * Data-driven divergence cutoff learned from the cohort's own spread. A model
   * scores as divergent only above this. Null when no cohort was available.
   */
  threshold: number | null;
  /** Where the comparison baseline came from. */
  baselineSource: 'cohort-median' | 'none';
}

/**
 * Result of the stylometry pass, computed from text the identity runs already
 * collected — no extra requests. Writing habits (sentence length, markdown
 * density, dash and ellipsis rates) are stable per model family and differ
 * between them, so a model that writes unlike its siblings on the same
 * endpoint is softly suspicious.
 */
export interface StyleFingerprint {
  /** Mean relative per-feature deviation from the cohort median, [0, 3]. */
  divergence: number | null;
  /** Cohort-learned cutoff; null when no cohort was available. */
  threshold: number | null;
  /** Characters of run text the features were extracted from. */
  chars: number;
  baselineSource: 'cohort-median' | 'none';
}

export interface IdentityReport {
  modelId: string;
  verdict: IdentityVerdict;
  /** 0–100, higher is more confident in the verdict. */
  confidence: number;
  signals: IdentitySignal[];
  runs: IdentityRun[];
  /** When count_tokens was called, the returned count. */
  tokenizerCount: number | null;
  /** What the requested id claims to be. Null when the id is unrecognised. */
  advertised: AdvertisedModel | null;
  /** Present when the deeper attribution probe was run. */
  attribution: Attribution | null;
  /** Present when the random-number fingerprint probe was run. */
  fingerprint: RandomNumberFingerprint | null;
  /** Present when the knowledge-cutoff probe ran and got answers. */
  cutoff: KnowledgeCutoffResult | null;
  /** Present when the cohort stylometry pass scored this model. */
  stylometry: StyleFingerprint | null;
  error: ApiError | null;
  at: number;
}
