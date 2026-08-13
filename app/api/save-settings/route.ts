import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { localWritesBlocked } from '@/lib/server/guard';
import { maskSecret } from '@/lib/server/upstream';

export const runtime = 'nodejs';

/**
 * Persists a tested provider as real Claude Code CLI configuration.
 *
 * Claude Code reads user config from ~/.claude/settings.json (documented keys
 * only — https://code.claude.com/docs/en/settings). What actually routes
 * traffic:
 *
 *   env.ANTHROPIC_BASE_URL               where requests are sent (no /v1 suffix)
 *   env.ANTHROPIC_API_KEY                sent as the `x-api-key` header
 *   env.ANTHROPIC_AUTH_TOKEN             sent as `Authorization: Bearer`
 *   env.ANTHROPIC_DEFAULT_<ALIAS>_MODEL  what opus/sonnet/haiku/fable resolve to
 *   model                                default model for new sessions
 *
 * A `customModels` object is NOT a recognized Claude Code setting — earlier
 * versions of this app wrote one and Claude Code silently ignored it, so saves
 * appeared to succeed while changing nothing. Worse, the old code also deleted
 * env.ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN — the keys
 * that DO work. This route now writes the documented keys and cleans up the
 * ignored ones (including in ~/.claude.json, which is Claude Code's internal
 * state file, not a settings file, and must never be treated as one).
 */

const ALIASES = ['opus', 'sonnet', 'haiku', 'fable'] as const;
type Alias = (typeof ALIASES)[number];

/** Alias preferred as the session default when several are mapped. */
const PRIMARY_ORDER: Alias[] = ['sonnet', 'opus', 'fable', 'haiku'];

interface SaveInput {
  endpoint: string;
  apiKey: string;
  authStyle: 'bearer' | 'x-api-key';
  mappings: Partial<Record<Alias, string>>;
}

class ValidationError extends Error {}

function normalizeBaseUrl(raw: unknown): string {
  let endpoint = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!endpoint) throw new ValidationError('Endpoint is required.');
  // Claude Code appends /v1/... itself; leaving /v1 on the base URL would
  // produce /v1/v1/messages upstream.
  endpoint = endpoint.replace(/\/v1$/i, '').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ValidationError(`"${endpoint}" is not a valid URL. Include the scheme, e.g. https://api.example.com`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`Unsupported scheme "${parsed.protocol}". Use http:// or https://`);
  }
  return endpoint;
}

function parseInput(body: Record<string, unknown>): { input: SaveInput; remark: string } {
  const config = body?.config as Record<string, unknown> | undefined;
  const rawMappings = body?.mappings as Record<string, unknown> | undefined;
  if (!config || typeof config !== 'object') throw new ValidationError('Missing config.');
  if (!rawMappings || typeof rawMappings !== 'object') throw new ValidationError('Missing mappings.');

  const endpoint = normalizeBaseUrl(config.endpoint);
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  const authStyle = config.authStyle === 'bearer' ? 'bearer' : 'x-api-key';

  const mappings: Partial<Record<Alias, string>> = {};
  for (const alias of ALIASES) {
    const v = rawMappings[alias];
    if (typeof v === 'string' && v.trim()) mappings[alias] = v.trim();
  }

  const remark = typeof body?.remark === 'string' ? body.remark.trim() : '';
  return { input: { endpoint, apiKey, authStyle, mappings }, remark };
}

/** Write JSON via a temp file + rename so a crash can't leave a torn file. */
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, body, 'utf-8');
  try {
    await fs.rename(tmp, filePath);
  } catch {
    // Windows can refuse a rename over a file another process holds open —
    // fall back to an in-place write rather than failing the save.
    await fs.writeFile(filePath, body, 'utf-8');
    await fs.unlink(tmp).catch(() => {});
  }
}

function maskEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const secret = k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN';
    out[k] = secret ? maskSecret(String(v)) : String(v);
  }
  return out;
}

async function updateSettingsFile(
  filePath: string,
  input: SaveInput,
  warnings: string[],
): Promise<{ model: string | null; env: Record<string, string> }> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      settings = parsed as Record<string, unknown>;
      // Rolling backup of the last good file before we touch it.
      await fs.copyFile(filePath, `${filePath}.bak`).catch(() => {});
    } else {
      warnings.push('Existing settings.json was not a JSON object; it was backed up and recreated.');
      await fs.copyFile(filePath, `${filePath}.backup-${Date.now()}`).catch(() => {});
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      warnings.push('Existing settings.json could not be parsed; it was backed up and recreated.');
      await fs.copyFile(filePath, `${filePath}.backup-${Date.now()}`).catch(() => {});
    }
  }

  const env: Record<string, unknown> =
    settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
      ? (settings.env as Record<string, unknown>)
      : {};
  settings.env = env;

  env.ANTHROPIC_BASE_URL = input.endpoint;

  // ANTHROPIC_MODEL would pin every session and shadow the `model` field;
  // the saved default belongs in `model` below.
  delete env.ANTHROPIC_MODEL;

  if (input.apiKey) {
    if (input.authStyle === 'bearer') {
      env.ANTHROPIC_AUTH_TOKEN = input.apiKey;
      delete env.ANTHROPIC_API_KEY;
    } else {
      env.ANTHROPIC_API_KEY = input.apiKey;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
  } else {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    warnings.push('No API key was provided, so auth env vars were removed — the endpoint must accept unauthenticated requests.');
  }

  for (const alias of ALIASES) {
    const envKey = `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`;
    const id = input.mappings[alias];
    if (id) env[envKey] = id;
    else delete env[envKey];
  }

  // Point `model` at the alias, which the env var above resolves to the
  // provider's model ID. Never clear an existing choice when nothing is mapped.
  const primary = PRIMARY_ORDER.find((a) => input.mappings[a]) ?? null;
  if (primary) settings.model = primary;

  // Keys earlier versions of this app wrote that Claude Code never recognized.
  delete settings.customModels;
  delete settings.remark;

  await writeJsonAtomic(filePath, settings);
  return {
    model: primary ?? (typeof settings.model === 'string' ? settings.model : null),
    env: maskEnv(env),
  };
}

/**
 * Best-effort removal of the ignored keys earlier versions wrote into
 * ~/.claude.json. That file is Claude Code's internal state — never create it,
 * never rewrite it when it can't be parsed, and treat failure as harmless.
 */
async function cleanupStateFile(filePath: string, warnings: string[]): Promise<boolean> {
  let state: unknown;
  try {
    state = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return false;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const obj = state as Record<string, unknown>;
  if (!('customModels' in obj) && !('remark' in obj)) return false;

  delete obj.customModels;
  delete obj.remark;
  try {
    await fs.copyFile(filePath, `${filePath}.bak`).catch(() => {});
    await writeJsonAtomic(filePath, obj);
    return true;
  } catch {
    warnings.push('Could not clean legacy keys from ~/.claude.json (file busy?). This is harmless.');
    return false;
  }
}

export async function POST(req: Request) {
  const blocked = localWritesBlocked();
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Request body was not valid JSON.' }, { status: 400 });
  }

  let input: SaveInput;
  let remark: string;
  try {
    ({ input, remark } = parseInput(body));
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const homeDir = os.homedir();
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  const statePath = path.join(homeDir, '.claude.json');
  const warnings: string[] = [];

  try {
    const applied = await updateSettingsFile(settingsPath, input, warnings);
    const cleanedStateFile = await cleanupStateFile(statePath, warnings);

    // App-owned metadata (remark, what was saved and when) lives in its own
    // file so settings.json holds only keys Claude Code recognizes.
    await writeJsonAtomic(path.join(homeDir, '.claude', 'claude-provider-tester.json'), {
      savedAt: new Date().toISOString(),
      endpoint: input.endpoint,
      authStyle: input.authStyle,
      mappings: input.mappings,
      ...(remark ? { remark } : {}),
    }).catch((err) => {
      console.warn('Failed to write metadata file:', err);
    });

    return NextResponse.json({
      success: true,
      settingsPath,
      applied,
      cleanedStateFile,
      warnings,
      note: 'Restart Claude Code (start a new session) to pick up the new settings.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error saving settings:', err);
    return NextResponse.json({ error: message || 'Failed to write settings file' }, { status: 500 });
  }
}
