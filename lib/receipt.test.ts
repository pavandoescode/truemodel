import { describe, expect, it } from 'vitest';
import type { IdentityReport } from '@/lib/types/identity';
import { buildReceiptJson, buildReceiptMarkdown, receiptFilename } from './receipt';

/** A clean pass: served model matches what was advertised, all signals green. */
function cleanReport(): IdentityReport {
  return {
    modelId: 'claude-opus-4-1',
    verdict: 'matches-advertised',
    confidence: 92,
    signals: [
      {
        id: 'served-model-id',
        label: 'Served model id',
        status: 'pass',
        weight: 'hard',
        detail: 'Response reported claude-opus-4-1, matching the request.',
      },
      {
        id: 'tokenizer-fingerprint',
        label: 'Tokenizer fingerprint',
        status: 'pass',
        weight: 'context',
        detail: 'Token count consistent with the Anthropic tokenizer.',
      },
    ],
    runs: [],
    tokenizerCount: 14,
    advertised: {
      vendor: 'Anthropic',
      family: 'Opus 4.1',
      output: 32000,
      context: 200000,
      capsExact: true,
    },
    attribution: {
      servedModelId: 'claude-opus-4-1',
      servedFamily: 'Opus 4.1',
      servedVendor: 'Anthropic',
      nameSource: 'response-model',
      requestedFamily: 'Opus 4.1',
      requestedVendor: 'Anthropic',
      familyMismatch: false,
      vendorMismatch: false,
      nameHonored: 'honored',
      probedFakeId: null,
      measuredCeiling: 32000,
      unvalidatedCeiling: false,
      candidateFamilies: ['Opus 4.1'],
      rankedCandidates: [],
      advertised: null,
      claimedVendor: 'Anthropic',
      vendorMentions: ['Anthropic'],
      quotes: [],
      summary: 'Served model matches the advertised Anthropic Opus 4.1.',
    },
    fingerprint: null,
    cutoff: null,
    stylometry: null,
    error: null,
    at: 1_700_000_000_000,
  };
}

/** A caught reseller: sold as Anthropic Opus, actually a Meta Llama. */
function mismatchReport(): IdentityReport {
  return {
    modelId: 'claude-opus-4-1',
    verdict: 'different-vendor',
    confidence: 88,
    signals: [
      {
        id: 'self-reported-vendor',
        label: 'Self-reported vendor',
        status: 'fail',
        weight: 'hard',
        detail: 'The model identified itself as Llama, trained by Meta, not Anthropic.',
      },
    ],
    runs: [],
    tokenizerCount: 22,
    advertised: {
      vendor: 'Anthropic',
      family: 'Opus 4.1',
      output: 32000,
      context: 200000,
      capsExact: true,
    },
    attribution: {
      servedModelId: 'llama-3.1-70b',
      servedFamily: 'Llama 3.1',
      servedVendor: 'Meta',
      nameSource: 'self-report',
      requestedFamily: 'Opus 4.1',
      requestedVendor: 'Anthropic',
      familyMismatch: true,
      vendorMismatch: true,
      nameHonored: 'ignored',
      probedFakeId: 'not-a-real-model-xyz',
      measuredCeiling: null,
      unvalidatedCeiling: true,
      candidateFamilies: [],
      rankedCandidates: [],
      advertised: null,
      claimedVendor: 'Meta',
      vendorMentions: ['Meta'],
      quotes: ['I am Llama, an AI assistant made by Meta.'],
      summary: 'Served model is Meta Llama 3.1, not the advertised Anthropic Opus 4.1.',
    },
    fingerprint: null,
    cutoff: null,
    stylometry: null,
    error: null,
    at: 1_700_000_000_000,
  };
}

describe('buildReceiptMarkdown', () => {
  const reports = [cleanReport(), mismatchReport()];
  const at = 1_700_000_000_000;

  it('includes the host, verdict labels, and a failing signal detail', () => {
    const md = buildReceiptMarkdown({ endpoint: 'https://api.example.com/v1', reports, at });
    expect(md).toContain('api.example.com');
    expect(md).toContain('Matches what was sold');
    expect(md).toContain('Different vendor entirely');
    expect(md).toContain('The model identified itself as Llama, trained by Meta, not Anthropic.');
  });

  it('tags context-weight signals and shows served-model attribution', () => {
    const md = buildReceiptMarkdown({ endpoint: 'https://api.example.com/v1', reports, at });
    expect(md).toContain('(context)');
    expect(md).toContain('llama-3.1-70b');
  });

  it('NEVER leaks an embedded credential — only the host survives', () => {
    const md = buildReceiptMarkdown({
      endpoint: 'https://user:SECRETKEY@api.example.com/v1',
      reports,
      at,
    });
    expect(md).not.toContain('SECRETKEY');
    expect(md).not.toContain('user:');
    expect(md).toContain('api.example.com');
  });

  it('produces a valid receipt when no models were tested', () => {
    const md = buildReceiptMarkdown({ endpoint: 'https://api.example.com/v1', reports: [], at });
    expect(md).toContain('# truemodel.tech — Evidence Receipt');
    expect(md).toContain('Models tested: 0');
    expect(md).toContain('No models were tested');
  });
});

describe('buildReceiptJson', () => {
  it('parses as valid JSON with tool, registry, and models fields', () => {
    const json = buildReceiptJson({
      endpoint: 'https://api.example.com/v1',
      reports: [cleanReport()],
      at: 1_700_000_000_000,
    });
    const parsed = JSON.parse(json);
    expect(parsed.tool).toBeTruthy();
    expect(parsed.registry).toBeTruthy();
    expect(Array.isArray(parsed.models)).toBe(true);
    expect(parsed.models[0].requested).toBe('claude-opus-4-1');
    expect(parsed.host).toBe('api.example.com');
  });

  it('does not embed a credential passed in the endpoint', () => {
    const json = buildReceiptJson({
      endpoint: 'https://user:SECRETKEY@api.example.com/v1',
      reports: [cleanReport()],
      at: 1_700_000_000_000,
    });
    expect(json).not.toContain('SECRETKEY');
    expect(json).not.toContain('user:');
    expect(JSON.parse(json).host).toBe('api.example.com');
  });
});

describe('receiptFilename', () => {
  it('ends in .md and contains the sanitized host', () => {
    const name = receiptFilename({
      endpoint: 'https://api.example.com/v1',
      reports: [],
      at: 1_700_000_000_000,
    });
    expect(name.endsWith('.md')).toBe(true);
    expect(name).toContain('api.example.com');
    expect(name.startsWith('provider-validator-')).toBe(true);
  });

  it('sanitizes hosts and never carries a credential', () => {
    const name = receiptFilename({
      endpoint: 'https://user:SECRETKEY@api.example.com:8443/v1',
      reports: [],
      at: 1_700_000_000_000,
    });
    expect(name).not.toContain('SECRETKEY');
    expect(name).not.toContain(':');
    expect(name).toMatch(/^[a-z0-9.\-]+$/);
  });
});
