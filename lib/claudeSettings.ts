/**
 * Builds ready-to-paste Claude Code `~/.claude/settings.json` content on the
 * client, so a user can copy the exact object and drop it into the file by hand
 * — no server write required (and no server write is even possible when the app
 * is hosted, e.g. on Vercel).
 *
 * This MUST stay in lock-step with app/api/save-settings/route.ts, which writes
 * the same shape server-side. Only the documented keys Claude Code actually
 * reads are emitted:
 *
 *   env.ANTHROPIC_BASE_URL               where requests go (no /v1 suffix)
 *   env.ANTHROPIC_API_KEY                sent as `x-api-key`
 *   env.ANTHROPIC_AUTH_TOKEN             sent as `Authorization: Bearer`
 *   env.ANTHROPIC_DEFAULT_<ALIAS>_MODEL  what opus/sonnet/haiku/fable resolve to
 *   model                                default alias for new sessions
 */

export type ClaudeAlias = 'opus' | 'sonnet' | 'haiku' | 'fable';
export type AuthStyle = 'bearer' | 'x-api-key';

const ALIASES: ClaudeAlias[] = ['opus', 'sonnet', 'haiku', 'fable'];

/** Alias preferred as the session default when several are mapped. */
const PRIMARY_ORDER: ClaudeAlias[] = ['sonnet', 'opus', 'fable', 'haiku'];

export interface BuildClaudeSettingsInput {
  /** Raw endpoint as the user entered it; a trailing /v1 is stripped because
   *  Claude Code appends /v1/... itself. */
  endpoint: string;
  apiKey: string;
  authStyle: AuthStyle;
  mappings: Partial<Record<ClaudeAlias, string>>;
}

/** Strip a trailing /v1 (and slashes) so we don't produce /v1/v1 upstream. */
export function baseUrlForClaude(endpoint: string): string {
  return String(endpoint ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');
}

/**
 * Returns the settings object. Callers that want a paste-able string should
 * pass it through `JSON.stringify(obj, null, 2)`.
 */
export function buildClaudeSettings(input: BuildClaudeSettingsInput): Record<string, unknown> {
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrlForClaude(input.endpoint),
  };

  const key = (input.apiKey ?? '').trim();
  if (key) {
    if (input.authStyle === 'bearer') env.ANTHROPIC_AUTH_TOKEN = key;
    else env.ANTHROPIC_API_KEY = key;
  }

  for (const alias of ALIASES) {
    const id = input.mappings[alias]?.trim();
    if (id) env[`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`] = id;
  }

  const settings: Record<string, unknown> = { env };

  const primary = PRIMARY_ORDER.find((a) => input.mappings[a]?.trim());
  if (primary) settings.model = primary;

  return settings;
}

/** Convenience: the paste-able, pretty-printed JSON string. */
export function buildClaudeSettingsJson(input: BuildClaudeSettingsInput): string {
  return `${JSON.stringify(buildClaudeSettings(input), null, 2)}\n`;
}
