import { describe, it, expect } from 'vitest';
import { stripJsonc } from './stripJsonc';

/** Strip, then assert the result parses and yields exactly `expected`. */
function parseStripped(text: string): unknown {
  const cleaned = stripJsonc(text);
  return JSON.parse(cleaned) as unknown;
}

describe('stripJsonc — string values are left alone', () => {
  it('preserves a URL whose // is not a comment', () => {
    const src = '{"baseURL": "https://api.example.com/v1/messages"}';
    expect(parseStripped(src)).toEqual({ baseURL: 'https://api.example.com/v1/messages' });
  });

  it('preserves a bare // inside a string value', () => {
    const src = '{"name": "a // b"}';
    expect(parseStripped(src)).toEqual({ name: 'a // b' });
  });

  it('preserves block-comment syntax inside a string value', () => {
    const src = '{"pattern": "/* not a comment */"}';
    expect(parseStripped(src)).toEqual({ pattern: '/* not a comment */' });
  });

  it('preserves // after an escaped quote inside a string', () => {
    const src = '{"note": "say \\"hi\\" // no"}';
    expect(parseStripped(src)).toEqual({ note: 'say "hi" // no' });
  });

  it('does not eat the character preceding a // (the old colon-hack bug)', () => {
    // The previous regex consumed one char before `//` via its `([^\\:]|^)` group.
    const src = '{"a": "x", "b": "https://h/p"}';
    expect(parseStripped(src)).toEqual({ a: 'x', b: 'https://h/p' });
    expect(stripJsonc(src)).toBe(src);
  });

  it('preserves an escaped backslash at the end of a string', () => {
    const src = '{"dir": "C:\\\\tmp\\\\", "keep": 1}';
    expect(parseStripped(src)).toEqual({ dir: 'C:\\tmp\\', keep: 1 });
  });

  it('leaves comment-free input byte-for-byte unchanged', () => {
    const src = '{\n  "model": "x",\n  "url": "https://a.b/c"\n}\n';
    expect(stripJsonc(src)).toBe(src);
  });
});

describe('stripJsonc — real comments are removed', () => {
  it('removes a trailing line comment', () => {
    const src = '{"model": "x"} // pick this';
    expect(parseStripped(src)).toEqual({ model: 'x' });
  });

  it('removes a full-line comment between properties', () => {
    const src = '{\n  // the provider\n  "model": "x"\n}';
    expect(parseStripped(src)).toEqual({ model: 'x' });
  });

  it('removes a multi-line block comment', () => {
    const src = '{\n  /* multi\n     line */\n  "model": "x"\n}';
    expect(parseStripped(src)).toEqual({ model: 'x' });
  });

  it('removes an inline block comment mid-object', () => {
    const src = '{"a": 1, /* skip */ "b": 2}';
    expect(parseStripped(src)).toEqual({ a: 1, b: 2 });
  });

  it('keeps the newline that ends a line comment so following lines survive', () => {
    const src = '{\n  "a": 1, // first\n  "b": 2\n}';
    expect(stripJsonc(src)).toContain('\n');
    expect(parseStripped(src)).toEqual({ a: 1, b: 2 });
  });

  it('drops an unterminated block comment through end of input', () => {
    expect(stripJsonc('{"a": 1} /* dangling').trimEnd()).toBe('{"a": 1}');
  });
});

describe('stripJsonc — mixed realistic config', () => {
  it('handles comments and comment-like string values together', () => {
    const src = [
      '{',
      '  // OpenCode config',
      '  "$schema": "https://opencode.ai/config.json",',
      '  /* provider block */',
      '  "provider": {',
      '    "api-example-com": {',
      '      "options": { "baseURL": "https://api.example.com/v1" }, // endpoint',
      '      "note": "matches /* anything */ and // everything"',
      '    }',
      '  }',
      '}',
    ].join('\n');

    const parsed = parseStripped(src) as {
      $schema: string;
      provider: Record<string, { options: { baseURL: string }; note: string }>;
    };
    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.provider['api-example-com'].options.baseURL).toBe('https://api.example.com/v1');
    expect(parsed.provider['api-example-com'].note).toBe('matches /* anything */ and // everything');
  });

  it('returns empty output for empty input', () => {
    expect(stripJsonc('')).toBe('');
  });
});
