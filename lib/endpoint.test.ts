import { describe, it, expect } from 'vitest';
import { getEffectiveEndpoint } from './endpoint';

describe('getEffectiveEndpoint', () => {
  it('returns an empty string for empty input', () => {
    expect(getEffectiveEndpoint('', true)).toBe('');
    expect(getEffectiveEndpoint('   ', false)).toBe('');
  });

  it('trims whitespace and trailing slashes', () => {
    expect(getEffectiveEndpoint('  https://api.anthropic.com/  ', false)).toBe('https://api.anthropic.com');
    expect(getEffectiveEndpoint('https://api.anthropic.com///', false)).toBe('https://api.anthropic.com');
  });

  it('appends /v1 when requested and not already present', () => {
    expect(getEffectiveEndpoint('https://api.anthropic.com', true)).toBe('https://api.anthropic.com/v1');
  });

  it('does not double up /v1 when it is already present', () => {
    expect(getEffectiveEndpoint('https://api.anthropic.com/v1', true)).toBe('https://api.anthropic.com/v1');
    expect(getEffectiveEndpoint('https://api.anthropic.com/v1/', true)).toBe('https://api.anthropic.com/v1');
  });

  it('does not append /v1 when appendV1 is false', () => {
    expect(getEffectiveEndpoint('https://api.anthropic.com', false)).toBe('https://api.anthropic.com');
  });

  it('is case-insensitive when detecting an existing /v1 suffix', () => {
    expect(getEffectiveEndpoint('https://gateway.example.com/V1', true)).toBe('https://gateway.example.com/V1');
  });
});
