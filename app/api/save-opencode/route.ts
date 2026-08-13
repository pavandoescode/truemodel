import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { localWritesBlocked } from '@/lib/server/guard';
import { stripJsonc } from './stripJsonc';

export const runtime = 'nodejs';

/**
 * Saves provider configuration to OpenCode's config files:
 * - ~/.config/opencode/opencode.jsonc
 * - ~/.config/opencode/opencode.json
 * - ~/.opencode/config.json
 */

class ValidationError extends Error {}

function normalizeBaseUrl(raw: unknown): string {
  let endpoint = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!endpoint) throw new ValidationError('Endpoint is required.');
  
  // Ensure endpoint has /v1 if missing for openai-compatible providers
  if (!/\/v1$/i.test(endpoint)) {
    endpoint = `${endpoint}/v1`;
  }
  
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ValidationError(`"${endpoint}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`Unsupported scheme "${parsed.protocol}". Use http:// or https://`);
  }
  return endpoint;
}

/** Write JSON via a temp file + rename for atomicity. */
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, body, 'utf-8');
  try {
    await fs.rename(tmp, filePath);
  } catch {
    await fs.writeFile(filePath, body, 'utf-8');
    await fs.unlink(tmp).catch(() => {});
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

  const config = body?.config as Record<string, unknown> | undefined;
  const rawMappings = body?.mappings as Record<string, unknown> | undefined;
  if (!config || typeof config !== 'object') {
    return NextResponse.json({ error: 'Missing config.' }, { status: 400 });
  }
  if (!rawMappings || typeof rawMappings !== 'object') {
    return NextResponse.json({ error: 'Missing mappings.' }, { status: 400 });
  }

  let endpoint: string;
  try {
    endpoint = normalizeBaseUrl(config.endpoint);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  const remark = typeof body?.remark === 'string' ? body.remark.trim() : '';

  // Extract selected models. Order matters — `primaryModel` below is the first
  // entry — so walk known slots in an explicit preference order instead of
  // relying on `Object.entries` key order, which follows whatever order the
  // client happened to build the mappings object in.
  const SLOT_ORDER = ['model', 'sonnet', 'opus', 'fable', 'haiku'];
  const selectedModels: string[] = [];
  const pushModel = (val: unknown) => {
    if (typeof val !== 'string') return;
    const trimmed = val.trim();
    if (trimmed && !selectedModels.includes(trimmed)) selectedModels.push(trimmed);
  };
  for (const slot of SLOT_ORDER) pushModel(rawMappings[slot]);
  for (const [key, val] of Object.entries(rawMappings)) {
    if (!SLOT_ORDER.includes(key)) pushModel(val);
  }

  if (selectedModels.length === 0) {
    return NextResponse.json({ error: 'Please drag a model into the slot before saving.' }, { status: 400 });
  }

  const primaryModel = selectedModels[0];

  const homeDir = os.homedir();
  const targetPaths = [
    path.join(homeDir, '.config', 'opencode', 'opencode.jsonc'),
    path.join(homeDir, '.config', 'opencode', 'opencode.json'),
    path.join(homeDir, '.opencode', 'config.json'),
  ];

  const warnings: string[] = [];

  const hostName = (() => {
    try { return new URL(endpoint).hostname.replace(/[^a-zA-Z0-9_-]/g, '-'); } catch { return 'custom-provider'; }
  })();
  const providerId = hostName || 'custom-provider';
  const providerName = remark || hostName || 'Custom Provider';

  for (const configPath of targetPaths) {
    try {
      let existing: Record<string, unknown> = {};
      try {
        const fileContent = await fs.readFile(configPath, 'utf-8');
        // Clean JSONC comments if needed
        const cleaned = stripJsonc(fileContent);
        const parsed: unknown = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
          await fs.copyFile(configPath, `${configPath}.bak`).catch(() => {});
        }
      } catch (err) {
        // file might not exist yet, that's fine
      }

      // Remove non-standard keys that violate OpenCode's strict schema validator
      delete existing.savedAt;
      delete existing.defaultModel;
      delete existing.defaultProvider;
      delete existing.providers;

      existing['$schema'] = 'https://opencode.ai/config.json';
      existing['model'] = `${providerId}/${primaryModel}`;
      existing['small_model'] = `${providerId}/${primaryModel}`;

      const modelsObj: Record<string, { name: string }> = {};
      for (const mId of selectedModels) {
        modelsObj[mId] = { name: mId };
      }

      const providerObj: Record<string, unknown> = 
        existing.provider && typeof existing.provider === 'object' && !Array.isArray(existing.provider)
          ? (existing.provider as Record<string, unknown>)
          : {};

      providerObj[providerId] = {
        npm: '@ai-sdk/openai-compatible',
        name: providerName,
        options: {
          baseURL: endpoint,
          apiKey: apiKey || undefined,
        },
        models: modelsObj,
      };

      existing.provider = providerObj;

      await writeJsonAtomic(configPath, existing);
    } catch (err) {
      warnings.push(`Could not update ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    success: true,
    provider: providerId,
    model: `${providerId}/${primaryModel}`,
    warnings,
    note: 'Saved to ~/.config/opencode/opencode.jsonc — restart OpenCode to apply.',
  });
}
