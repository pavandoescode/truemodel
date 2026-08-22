import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyError } from '@/lib/errors';
import type { ProviderConfig } from '@/lib/types';

vi.mock('@/lib/apiClient', () => ({
  proxy: vi.fn(),
  streamMessages: vi.fn(),
}));

const { proxy } = await import('@/lib/apiClient');
const { probeModelResolution } = await import('@/lib/attribution');
const { countTokens } = await import('@/lib/identity');

const mockProxy = vi.mocked(proxy);

const config = (endpoint: string): ProviderConfig => ({
  presetId: 'custom',
  endpoint,
  apiKey: 'k',
  headers: [],
  authStyle: 'x-api-key',
  anthropicVersion: '2023-06-01',
});

describe('classifyError', () => {
  it('does not call a 403 an authentication failure', () => {
    const err = classifyError({ status: 403, message: 'blocked' });
    expect(err.category).toBe('forbidden');
    expect(err.title).toBe('403 — Request forbidden');
    expect(err.suggestions.join(' ')).not.toMatch(/re-copy the key/i);
  });

  it('still calls a 401 an authentication failure', () => {
    const err = classifyError({ status: 401, message: 'bad key' });
    expect(err.category).toBe('auth');
    expect(err.title).toBe('401 — Authentication failed');
  });

  it('reports an HTML 403 as a proxy answering, not the API', () => {
    const err = classifyError({ status: 403, rawText: '<html><body>openresty</body></html>' });
    expect(err.category).toBe('forbidden');
    expect(err.message).toMatch(/HTML/i);
  });
});

describe('probeModelResolution', () => {
  beforeEach(() => mockProxy.mockReset());

  it('counts a 403 for a nonexistent model id as validation, not inconclusive', async () => {
    mockProxy.mockResolvedValue({ ok: false, status: 403, data: null } as never);
    const out = await probeModelResolution({ config: config('https://gw.example'), model: 'claude-sonnet-4-5' });
    expect(out.status).toBe('honored');
  });

  it('counts a 200 for a nonexistent model id as ignored', async () => {
    mockProxy.mockResolvedValue({ ok: true, status: 200, data: {} } as never);
    const out = await probeModelResolution({ config: config('https://gw.example'), model: 'claude-sonnet-4-5' });
    expect(out.status).toBe('ignored');
  });
});

describe('countTokens', () => {
  it('asks an endpoint that 404s only once', async () => {
    mockProxy.mockReset();
    mockProxy.mockResolvedValue({ ok: false, status: 404, data: null } as never);
    const cfg = config(`https://memo-${Math.random()}.example`);

    const first = await countTokens({ config: cfg, model: 'a' });
    const second = await countTokens({ config: cfg, model: 'b' });

    expect(first.available).toBe(false);
    expect(second).toEqual(first);
    expect(mockProxy).toHaveBeenCalledTimes(1);
  });
});
