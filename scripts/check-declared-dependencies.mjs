#!/usr/bin/env node

/**
 * Every package the code imports must be declared in package.json.
 *
 * A package that is imported but not declared ("phantom dependency") only works because another
 * package happens to install it. When that parent upgrades or drops it, the import breaks or
 * silently changes version. Covers the app, its tests, Netlify functions, e2e specs, scripts,
 * Storybook stories and root configs; `functions/` is a separate npm workspace with its own
 * package.json and is not covered here.
 */

import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const ROOT = process.cwd();
const AREAS = ['src', 'netlify', 'e2e', 'scripts', '.storybook'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// import/export statements, import(), require() and vi.mock(); a call preceded by a quote is
// test fixture text, not code.
const SPECIFIER =
  /(?:^|[\s;])(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|(?:^|[^'"`\w.])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^'"`\w.])require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^'"`\w.])vi\.mock\s*\(\s*['"]([^'"]+)['"]/g;

const toPosix = value => value.split(path.sep).join('/');

const walk = relativeDir => {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      (entry.name.startsWith('.') && entry.name !== '.storybook')
    )
      continue;
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...walk(relativePath));
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
};

const rootConfigs = fs
  .readdirSync(ROOT)
  .filter(name => /\.config\.(?:ts|js|mjs|cjs)$/.test(name) || name === 'eslint.config.js');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  manifest.name,
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

/** Package name of a bare specifier, or null for relative paths, aliases and virtual modules. */
const packageNameOf = specifier => {
  // `node:` names a built-in even when this Node's builtinModules omits it (node:test on Node 22).
  if (
    /^(?:\.|\/|@\/|~\/|node:|virtual:|data:|https?:)/.test(specifier) ||
    specifier.startsWith('\0')
  )
    return null;
  const [first, second] = specifier.split('/');
  const name = first.startsWith('@') ? `${first}/${second}` : first;
  return builtins.has(name) || builtins.has(specifier) ? null : name;
};

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

const violations = [];
for (const file of [...AREAS.flatMap(walk), ...rootConfigs]) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    const name = packageNameOf(specifier);
    if (name && !declared.has(name)) {
      const keywordIndex = match.index + match[0].search(/import|export|require|vi\.mock/);
      violations.push(`${file}:${lineOf(source, keywordIndex)} imports undeclared "${name}"`);
    }
  }
}

if (violations.length === 0) {
  console.log('Declared dependency check passed (every imported package is in package.json).');
  process.exit(0);
}

console.error('\nUndeclared dependencies (declare them in package.json at the installed version):');
for (const violation of violations) console.error(`- ${violation}`);
process.exit(1);
