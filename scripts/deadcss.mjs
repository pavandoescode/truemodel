/**
 * Report CSS-module classes that no consumer references.
 *
 * The component split moved whole blocks of rules out of page.module.css; this
 * is how we find what stayed behind:
 *
 *   node scripts/deadcss.mjs app/page.module.css
 *
 * Only files that actually import the module count as consumers — several
 * modules use the same class names, so a repo-wide grep for `styles.foo`
 * reports a class as live when it is another module's class that is live.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const cssPath = process.argv[2];
if (!cssPath) {
  console.error('usage: node scripts/deadcss.mjs <module.css>');
  process.exit(2);
}

const SKIP = new Set(['node_modules', '.next', '.git', '_removed', 'shots']);

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Class selectors only: a leading dot followed by an identifier, and not part
// of a filename or a decimal.
const declared = [...new Set([...css.matchAll(/(?<![\w.-])\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]))];

const moduleName = basename(cssPath);
const used = new Set();
const importers = [];
for (const file of sources('.')) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(moduleName)) continue;
  importers.push(file);
  // styles.foo, styles['foo'], and `${styles.foo}` all read the same to us.
  for (const m of text.matchAll(/styles(?:\.|\[['"])([a-zA-Z_][\w-]*)/g)) used.add(m[1]);
}

const dead = declared.filter((c) => !used.has(c)).sort();
console.log(`${cssPath}: ${declared.length} declared, ${dead.length} unreferenced`);
console.log(`consumers: ${importers.join(', ') || '(none)'}`);
if (dead.length) console.log(dead.join('\n'));
