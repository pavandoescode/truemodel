/**
 * Vendor-neutral model registry.
 *
 * The tool used to ask one question — "is this really Claude?" — which is the
 * wrong question for a resold endpoint. What a buyer needs to know is whether
 * the model answering is the model on the invoice, whoever trained it. That
 * requires knowing, for any advertised id, which vendor and family it belongs
 * to and what limits that family actually enforces.
 *
 * `caps` records how much the numbers can be trusted. Anthropic rejects a
 * `max_tokens` above the model's cap instead of clamping it, so an Anthropic
 * ceiling is a measurable fact and a mismatch is evidence. Most other vendors
 * clamp, version their caps quietly, or differ per deployment, so those numbers
 * are reported to the user but never scored against a model.
 */

/** Bump when MODEL_SPECS changes, so an evidence receipt records which model table produced its verdicts. */
export const REGISTRY_VERSION = '2026.08.12';

export type VendorId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'meta'
  | 'mistral'
  | 'deepseek'
  | 'xai'
  | 'alibaba'
  | 'cohere'
  | 'amazon'
  | 'microsoft'
  | 'moonshot'
  | 'zhipu';

export const VENDOR_LABEL: Record<VendorId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  meta: 'Meta',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  alibaba: 'Alibaba',
  cohere: 'Cohere',
  amazon: 'Amazon',
  microsoft: 'Microsoft',
  moonshot: 'Moonshot',
  zhipu: 'Zhipu',
};

/** `exact` = the vendor enforces this cap and a mismatch is evidence. */
export type CapsConfidence = 'exact' | 'approx';

export interface ModelSpec {
  match: RegExp;
  vendor: VendorId;
  /** Human-readable family, e.g. "Opus 5". Substitution is judged per family. */
  family: string;
  context: number;
  output: number;
  caps: CapsConfidence;
  /**
   * Set on small/cheap models that are not expected to ace reasoning puzzles.
   * Their puzzle failures are recorded but never treated as proof of
   * substitution — a genuine Haiku or mini really does miscount letters, and
   * failing one for it would be a false accusation.
   */
  small?: true;
  deprecated?: boolean;
}

/**
 * Ordered, first-match-wins. More specific ids must precede their prefixes:
 * `opus-4-5` has to be tested before `opus-4`, or the shorter pattern would
 * swallow it and report the wrong family.
 */
export const MODEL_SPECS: readonly ModelSpec[] = [
  /* ---------------- Anthropic ---------------- */
  { match: /fable-5|fable5/i, vendor: 'anthropic', family: 'Fable 5', context: 1_000_000, output: 128_000, caps: 'exact' },
  { match: /mythos/i, vendor: 'anthropic', family: 'Mythos 5', context: 1_000_000, output: 128_000, caps: 'exact' },
  { match: /opus-5|opus5/i, vendor: 'anthropic', family: 'Opus 5', context: 1_000_000, output: 128_000, caps: 'exact' },
  { match: /sonnet-5|sonnet5/i, vendor: 'anthropic', family: 'Sonnet 5', context: 1_000_000, output: 128_000, caps: 'exact' },
  { match: /haiku-4-5|haiku4-5|haiku-4\.5/i, vendor: 'anthropic', family: 'Haiku 4.5', context: 200_000, output: 64_000, caps: 'exact', small: true },
  { match: /opus-4-8|opus4-8/i, vendor: 'anthropic', family: 'Opus 4.8', context: 1_000_000, output: 128_000, caps: 'exact', deprecated: true },
  { match: /opus-4-7|opus4-7/i, vendor: 'anthropic', family: 'Opus 4.7', context: 1_000_000, output: 128_000, caps: 'exact', deprecated: true },
  { match: /opus-4-6|opus4-6/i, vendor: 'anthropic', family: 'Opus 4.6', context: 1_000_000, output: 128_000, caps: 'exact', deprecated: true },
  { match: /sonnet-4-6|sonnet4-6/i, vendor: 'anthropic', family: 'Sonnet 4.6', context: 1_000_000, output: 128_000, caps: 'exact', deprecated: true },
  { match: /sonnet-4-5|sonnet4-5/i, vendor: 'anthropic', family: 'Sonnet 4.5', context: 200_000, output: 64_000, caps: 'exact', deprecated: true },
  { match: /opus-4-5|opus4-5/i, vendor: 'anthropic', family: 'Opus 4.5', context: 200_000, output: 64_000, caps: 'exact', deprecated: true },
  { match: /opus-4|opus4/i, vendor: 'anthropic', family: 'Opus 4', context: 200_000, output: 32_000, caps: 'exact', deprecated: true },
  { match: /sonnet-4|sonnet4/i, vendor: 'anthropic', family: 'Sonnet 4', context: 200_000, output: 64_000, caps: 'exact', deprecated: true },
  { match: /haiku-4|haiku4/i, vendor: 'anthropic', family: 'Haiku 4', context: 200_000, output: 64_000, caps: 'exact', small: true, deprecated: true },
  { match: /3-7-sonnet/i, vendor: 'anthropic', family: 'Sonnet 3.7', context: 200_000, output: 64_000, caps: 'exact', deprecated: true },
  { match: /3-5-sonnet/i, vendor: 'anthropic', family: 'Sonnet 3.5', context: 200_000, output: 8_192, caps: 'exact', deprecated: true },
  { match: /3-5-haiku/i, vendor: 'anthropic', family: 'Haiku 3.5', context: 200_000, output: 8_192, caps: 'exact', small: true, deprecated: true },
  { match: /3-opus/i, vendor: 'anthropic', family: 'Opus 3', context: 200_000, output: 4_096, caps: 'exact', deprecated: true },
  { match: /3-sonnet/i, vendor: 'anthropic', family: 'Sonnet 3', context: 200_000, output: 4_096, caps: 'exact', deprecated: true },
  { match: /3-haiku/i, vendor: 'anthropic', family: 'Haiku 3', context: 200_000, output: 4_096, caps: 'exact', small: true, deprecated: true },
  { match: /claude-2|claude-instant/i, vendor: 'anthropic', family: 'Claude Legacy', context: 100_000, output: 4_096, caps: 'exact', small: true, deprecated: true },
  /* ---------------- OpenAI ---------------- */
  { match: /^(openai\/)?gpt-5[.-]?2/i, vendor: 'openai', family: 'GPT-5.2', context: 400_000, output: 128_000, caps: 'approx' },
  { match: /^(openai\/)?gpt-5[.-]?1/i, vendor: 'openai', family: 'GPT-5.1', context: 400_000, output: 128_000, caps: 'approx' },
  { match: /gpt-5.*(mini|nano)/i, vendor: 'openai', family: 'GPT-5 mini', context: 400_000, output: 128_000, caps: 'approx', small: true },
  { match: /gpt-5/i, vendor: 'openai', family: 'GPT-5', context: 400_000, output: 128_000, caps: 'approx' },
  { match: /gpt-4\.1/i, vendor: 'openai', family: 'GPT-4.1', context: 1_047_576, output: 32_768, caps: 'approx' },
  { match: /gpt-4o-mini/i, vendor: 'openai', family: 'GPT-4o mini', context: 128_000, output: 16_384, caps: 'approx', small: true, deprecated: true },
  { match: /gpt-4o/i, vendor: 'openai', family: 'GPT-4o', context: 128_000, output: 16_384, caps: 'approx', deprecated: true },
  { match: /gpt-4-turbo/i, vendor: 'openai', family: 'GPT-4 Turbo', context: 128_000, output: 4_096, caps: 'approx', deprecated: true },
  { match: /gpt-3\.5/i, vendor: 'openai', family: 'GPT-3.5', context: 16_385, output: 4_096, caps: 'approx', small: true, deprecated: true },
  { match: /\bo4-mini/i, vendor: 'openai', family: 'o4-mini', context: 200_000, output: 100_000, caps: 'approx', small: true },
  { match: /\bo3-mini/i, vendor: 'openai', family: 'o3-mini', context: 200_000, output: 100_000, caps: 'approx', small: true },
  { match: /\bo3\b/i, vendor: 'openai', family: 'o3', context: 200_000, output: 100_000, caps: 'approx' },
  { match: /\bo1\b/i, vendor: 'openai', family: 'o1', context: 200_000, output: 100_000, caps: 'approx', deprecated: true },

  /* ---------------- Google ---------------- */
  { match: /gemini-3.*(flash|lite)/i, vendor: 'google', family: 'Gemini 3 Flash', context: 1_048_576, output: 65_536, caps: 'approx', small: true },
  { match: /gemini-3/i, vendor: 'google', family: 'Gemini 3 Pro', context: 1_048_576, output: 65_536, caps: 'approx' },
  { match: /gemini-2\.5.*flash/i, vendor: 'google', family: 'Gemini 2.5 Flash', context: 1_048_576, output: 65_536, caps: 'approx', small: true },
  { match: /gemini-2\.5/i, vendor: 'google', family: 'Gemini 2.5 Pro', context: 1_048_576, output: 65_536, caps: 'approx' },
  { match: /gemini-2\.0/i, vendor: 'google', family: 'Gemini 2.0', context: 1_048_576, output: 8_192, caps: 'approx', small: true, deprecated: true },
  { match: /gemini-1\.5-pro/i, vendor: 'google', family: 'Gemini 1.5 Pro', context: 2_097_152, output: 8_192, caps: 'approx', deprecated: true },
  { match: /gemini-1\.5/i, vendor: 'google', family: 'Gemini 1.5 Flash', context: 1_048_576, output: 8_192, caps: 'approx', small: true, deprecated: true },
  { match: /gemma-?3/i, vendor: 'google', family: 'Gemma 3', context: 128_000, output: 8_192, caps: 'approx', small: true },

  /* ---------------- Meta ---------------- */
  { match: /llama-?4.*maverick/i, vendor: 'meta', family: 'Llama 4 Maverick', context: 1_000_000, output: 8_192, caps: 'approx' },
  { match: /llama-?4/i, vendor: 'meta', family: 'Llama 4 Scout', context: 1_000_000, output: 8_192, caps: 'approx' },
  { match: /llama-?3[.-]?3/i, vendor: 'meta', family: 'Llama 3.3', context: 128_000, output: 8_192, caps: 'approx' },
  { match: /llama-?3/i, vendor: 'meta', family: 'Llama 3', context: 128_000, output: 4_096, caps: 'approx', small: true, deprecated: true },
  { match: /llama/i, vendor: 'meta', family: 'Llama', context: 8_192, output: 4_096, caps: 'approx', small: true, deprecated: true },

  /* ---------------- Others ---------------- */
  { match: /magistral/i, vendor: 'mistral', family: 'Magistral', context: 128_000, output: 40_000, caps: 'approx' },
  { match: /mistral-large/i, vendor: 'mistral', family: 'Mistral Large', context: 128_000, output: 8_192, caps: 'approx' },
  { match: /mixtral/i, vendor: 'mistral', family: 'Mixtral', context: 32_768, output: 8_192, caps: 'approx', small: true, deprecated: true },
  { match: /mistral|ministral|devstral|codestral/i, vendor: 'mistral', family: 'Mistral', context: 32_768, output: 8_192, caps: 'approx', small: true },
  { match: /deepseek.*(r1|reason)/i, vendor: 'deepseek', family: 'DeepSeek R1', context: 128_000, output: 32_768, caps: 'approx' },
  { match: /deepseek/i, vendor: 'deepseek', family: 'DeepSeek V3', context: 128_000, output: 8_192, caps: 'approx' },
  { match: /grok-?4/i, vendor: 'xai', family: 'Grok 4', context: 256_000, output: 64_000, caps: 'approx' },
  { match: /grok/i, vendor: 'xai', family: 'Grok', context: 131_072, output: 32_768, caps: 'approx' },
  { match: /qwen-?3|qwen3/i, vendor: 'alibaba', family: 'Qwen 3', context: 128_000, output: 32_768, caps: 'approx' },
  { match: /qwen|tongyi/i, vendor: 'alibaba', family: 'Qwen', context: 128_000, output: 8_192, caps: 'approx' },
  { match: /command-a|command-r/i, vendor: 'cohere', family: 'Command', context: 256_000, output: 8_192, caps: 'approx' },
  { match: /nova-(pro|lite|micro|premier)/i, vendor: 'amazon', family: 'Nova', context: 300_000, output: 10_000, caps: 'approx', small: true },
  { match: /titan/i, vendor: 'amazon', family: 'Titan', context: 32_000, output: 4_096, caps: 'approx', small: true, deprecated: true },
  { match: /phi-?[45]/i, vendor: 'microsoft', family: 'Phi', context: 16_384, output: 4_096, caps: 'approx', small: true },
  { match: /kimi|moonshot/i, vendor: 'moonshot', family: 'Kimi', context: 256_000, output: 32_768, caps: 'approx' },
  { match: /glm-?4|zhipu/i, vendor: 'zhipu', family: 'GLM-4', context: 200_000, output: 128_000, caps: 'approx' },
];

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

/** Drop a gateway namespace (`anthropic/claude-opus-5`) and any `:tag` suffix. */
export function bareId(modelId: string): string {
  const noTag = modelId.trim().split(':')[0] ?? '';
  const parts = noTag.split('/');
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/** The namespace a gateway prefixed onto an id, when it used one. */
export function namespaceOf(modelId: string): string | null {
  const idx = modelId.lastIndexOf('/');
  return idx > 0 ? modelId.slice(0, idx + 1) : null;
}

/** First matching spec, or null when the id is not one we recognise. */
export function specFor(modelId: string): ModelSpec | null {
  if (!modelId) return null;
  const id = bareId(modelId);
  if (!id) return null;
  return MODEL_SPECS.find((s) => s.match.test(id)) ?? null;
}

export function vendorOf(modelId: string): VendorId | null {
  return specFor(modelId)?.vendor ?? null;
}

/** Vendor as displayed, e.g. "Anthropic". */
export function vendorLabelOf(modelId: string): string | null {
  const vendor = vendorOf(modelId);
  return vendor ? VENDOR_LABEL[vendor] : null;
}

/** The family an id belongs to, which is the unit substitution is judged in. */
export function familyOf(modelId: string): string | null {
  return specFor(modelId)?.family ?? null;
}

/**
 * True for cheap/small tiers that genuinely fail reasoning puzzles.
 *
 * Used to stop the puzzle signals from being scored against a model that is
 * behaving exactly as its real family does. Unknown ids are treated as small,
 * on the same principle: without knowing the tier, a wrong answer is not
 * evidence of anything.
 */
export function isSmallModel(modelId: string): boolean {
  const spec = specFor(modelId);
  return spec ? spec.small === true : true;
}

/**
 * The advertised id's own expected limits.
 *
 * `caps` travels with the numbers so callers can tell a hard fact from a
 * documented figure: only `exact` may be used to fail a model.
 */
export function expectedLimits(
  modelId: string,
): { vendor: VendorId; family: string; output: number; context: number; caps: CapsConfidence } | null {
  const spec = specFor(modelId);
  if (!spec) return null;
  return { vendor: spec.vendor, family: spec.family, output: spec.output, context: spec.context, caps: spec.caps };
}

/** Families whose published output cap equals a measured ceiling. */
export function familiesWithCeiling(ceiling: number, vendor?: VendorId | null): string[] {
  return MODEL_SPECS.filter(
    (s) => s.output === ceiling && !s.deprecated && (!vendor || s.vendor === vendor),
  ).map((s) => s.family);
}

/** Distinct output caps across every known model, ascending. Derived, so it can't drift. */
export const OUTPUT_BANDS: readonly number[] = Array.from(
  new Set(MODEL_SPECS.map((s) => s.output)),
).sort((a, b) => a - b);

/* ------------------------------------------------------------------ */
/* Model ids in free text                                              */
/* ------------------------------------------------------------------ */

/** Anything shaped like a model id: letters, digits, and id punctuation. */
const ID_TOKEN_RE = /[a-z0-9][a-z0-9._/-]{2,}/gi;

/**
 * An id from a vendor the registry does not know.
 *
 * Worth keeping — a gateway leaking `someco/wizard-13b-v2` has told us the
 * request was not served by what was advertised, even though we cannot say
 * whose model it is. Kept deliberately narrow so URLs and header values in an
 * error message are not mistaken for model names.
 */
function looksLikeUnknownId(token: string): boolean {
  const slashes = token.split('/').length - 1;
  if (slashes !== 1) return false;
  const tail = token.split('/')[1] ?? '';
  return tail.length >= 6 && /\d/.test(tail) && /[.-]/.test(tail);
}

/**
 * Every distinct model id mentioned in a string.
 *
 * The provider's own validation errors routinely name the model they resolved,
 * which is the most direct statement of what actually served a request that an
 * API ever volunteers.
 */
export function extractModelIds(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const raw of text.match(ID_TOKEN_RE) ?? []) {
    const token = raw.replace(/[.,;:)\]]+$/, '').toLowerCase();
    if (!token || /^https?$/.test(token)) continue;
    if (!/[a-z]/.test(token) || !/\d/.test(token)) continue;
    if (specFor(token) || looksLikeUnknownId(token)) out.push(token);
  }
  return [...new Set(out)];
}

/**
 * A well-formed id that no vendor publishes, for testing whether an endpoint
 * routes on the model name at all.
 *
 * Deliberately not a near-miss of a real id: a gateway that prefix-matches
 * `claude-opus-5-20991231` onto Opus 5 is still routing on the name, so using
 * one would report honest gateways as broken. Nothing can prefix-match this.
 * The namespace is carried over so a gateway that validates vendor prefixes
 * rejects the model rather than the namespace.
 */
export function nonexistentIdFor(modelId: string): string {
  return `${namespaceOf(modelId) ?? ''}not-a-real-model-9v9-20991231`;
}

/* ------------------------------------------------------------------ */
/* Vendor names in prose                                               */
/* ------------------------------------------------------------------ */

/**
 * Vendor name patterns for scanning what a model says about itself.
 *
 * Only the leading boundary is anchored. Model names are routinely written with
 * a version glued on ("qwen2.5", "llama3"), and a trailing \b would not match
 * there because a letter-to-digit transition is not a word boundary.
 */
export const VENDOR_PATTERNS: readonly { vendor: VendorId; patterns: RegExp }[] = [
  { vendor: 'anthropic', patterns: /\b(claude|anthropic)/i },
  { vendor: 'openai', patterns: /\b(gpt|openai|chatgpt|davinci|o[134]-(mini|preview))/i },
  { vendor: 'google', patterns: /\b(gemini|gemma|bard|palm-|google\s?deepmind)/i },
  { vendor: 'meta', patterns: /\b(llama|meta\s?ai)/i },
  { vendor: 'mistral', patterns: /\b(mistral|mixtral|magistral|ministral)/i },
  { vendor: 'alibaba', patterns: /\b(qwen|tongyi)/i },
  { vendor: 'deepseek', patterns: /\bdeepseek/i },
  { vendor: 'xai', patterns: /\b(grok|xai)\b/i },
  { vendor: 'cohere', patterns: /\b(cohere|command-r|command-a)/i },
  { vendor: 'microsoft', patterns: /\b(phi-?\d|copilot)/i },
  { vendor: 'amazon', patterns: /\b(nova-?(lite|pro|micro|premier)|titan)/i },
  { vendor: 'moonshot', patterns: /\b(kimi|moonshot)/i },
  { vendor: 'zhipu', patterns: /\b(glm-?\d|zhipu|chatglm)/i },
];
