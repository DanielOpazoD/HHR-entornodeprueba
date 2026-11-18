/**
 * The exceptions book of `check:folder-dependencies`: its two sections, their validation and the
 * guarantee that the book only shrinks.
 *
 * Each section lists relations one by one (`from`, `to`, `kind`, `reason`). Inside a tree, the
 * check compares the code with the book: an unlisted relation fails, and a listed relation the
 * code no longer has fails until it is removed. Across trees, the book of a pull request may not
 * hold an entry its base does not hold, not even in exchange for one it removed: that is what
 * stops a change from listing its own new relation. The base is `FOLDER_BOOK_BASE` (CI passes
 * the pull request base) or `git merge-base HEAD origin/main`; without one the comparison is
 * skipped with a notice, and a base without the section is the creation of that section.
 */

import { execFileSync } from 'node:child_process';

export const BOOK_SECTIONS = [
  { id: 'direction', label: 'exceptions', read: policy => policy.exceptions },
  { id: 'data', label: 'dataAccess.exceptions', read: policy => policy.dataAccess?.exceptions },
];
const BOUND_KINDS = new Set(['value', 'deferred']);

export const relationKey = ({ from, to, kind }) => `${from}|${to}|${kind}`;

/** Problems of one section: an entry without from, to, a bound kind or a reason, or repeated. */
export const validateSection = (entries, label) => {
  const problems = [];
  const seen = new Set();
  for (const entry of entries) {
    if (
      typeof entry?.from !== 'string' ||
      typeof entry.to !== 'string' ||
      !BOUND_KINDS.has(entry.kind) ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim() === ''
    ) {
      problems.push(
        `Excepción inválida en "${label}" ${JSON.stringify(entry)}: necesita "from", "to", "kind" (value o deferred) y "reason".`
      );
      continue;
    }
    const key = relationKey(entry);
    if (seen.has(key))
      problems.push(
        `Excepción repetida en "${label}": ${entry.from} → ${entry.to} (${entry.kind}).`
      );
    seen.add(key);
  }
  return problems;
};

const git = (root, args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * The commit the book is compared with: `{ base }`, `{ base: null }` when this checkout has no
 * base (a local clone without `origin/main`), or `{ error }` when the requested one is missing.
 */
export const resolveBookBase = (root, env = process.env) => {
  const requested = env.FOLDER_BOOK_BASE?.trim();
  if (!requested) return { base: git(root, ['merge-base', 'HEAD', 'origin/main']) };
  const base = git(root, ['rev-parse', '--verify', '--quiet', `${requested}^{commit}`]);
  return base
    ? { base }
    : {
        error: `FOLDER_BOOK_BASE=${requested} no es un commit de este checkout: trae la base (fetch-depth) para comprobar que el libro solo baja.`,
      };
};

/**
 * Entries of the current book that the base book does not hold, per section, or a notice when
 * there is nothing to compare with.
 */
export const compareWithBase = (root, policyPath, policy, base) => {
  if (!base) {
    return {
      added: [],
      notice:
        'Aviso: no hay base para comprobar que el libro solo baja (falta origin/main o FOLDER_BOOK_BASE); CI la compara con la base de la PR.',
    };
  }
  const text = git(root, ['show', `${base}:${policyPath}`]);
  if (text === null)
    return { added: [], notice: `Aviso: ${policyPath} no existe en la base ${base.slice(0, 9)}.` };
  const basePolicy = JSON.parse(text);
  const added = [];
  for (const section of BOOK_SECTIONS) {
    const baseEntries = section.read(basePolicy);
    if (!Array.isArray(baseEntries)) continue; // The section is being created.
    const baseKeys = new Set(baseEntries.map(relationKey));
    for (const entry of section.read(policy) ?? []) {
      if (!baseKeys.has(relationKey(entry))) added.push({ ...entry, section: section.label });
    }
  }
  return { added, notice: null, base };
};
