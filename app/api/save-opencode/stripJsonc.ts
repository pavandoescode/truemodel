/**
 * Strips JSONC comments — `// to end of line` and block comments — while
 * leaving the contents of double-quoted strings byte-for-byte intact.
 *
 * A single regex cannot do this: `//` and block-comment syntax are perfectly
 * legal inside JSON string values (`"https://api.example.com/v1"`, `"a // b"`),
 * so this walks the text once and tracks whether it is inside a string,
 * honoring backslash escapes. Slashes are only treated as comment openers
 * outside a string.
 */
export function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (ch === '\\') {
        // Copy the backslash plus whatever it escapes, so an escaped quote
        // cannot be mistaken for the end of the string.
        out += ch;
        if (i + 1 < text.length) out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1; // keep the newline itself
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2; // unterminated block runs to EOF
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
