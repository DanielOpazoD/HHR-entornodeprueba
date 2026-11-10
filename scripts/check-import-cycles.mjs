#!/usr/bin/env node

/**
 * Blocks runtime import cycles in the app's production code (`src/`, tests excluded).
 *
 * In a cycle of static value imports, module evaluation order depends on which file loads
 * first, so a module can read another one's exports before they exist (`undefined`, or a TDZ
 * error). That only shows up at runtime, and only from some entry points. Type-only imports
 * (`import type`, `export type`, or every named specifier marked `type`) are erased when
 * compiling, and dynamic `import()` loads lazily, so neither creates that hazard and neither
 * counts as an edge here.
 *
 * The baseline is zero with no allowlist. The last such cycle (the sync runtime and the
 * session cleanup service) was broken when this check was added.
 */

import fs from 'node:fs';
import path from 'node:path';
import { listProductionSources, resolveSpecifier } from './lib/sourceModules.mjs';

const ROOT = process.cwd();
const STATEMENT =
  /^[ \t]*(?:import|export)[ \t]+([^;]*?)[ \t]*\bfrom[ \t]*['"]([^'"]+)['"]|^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;

/** True when the import or export clause only names types, so nothing remains at runtime. */
const isTypeOnly = clause => {
  if (/^type\b/.test(clause)) return true;
  const named = clause.match(/^\{([\s\S]*)\}$/);
  if (!named) return false;
  const specifiers = named[1]
    .split(',')
    .map(specifier => specifier.trim())
    .filter(Boolean);
  return specifiers.length > 0 && specifiers.every(specifier => /^type\b/.test(specifier));
};

/** Runtime import graph: file → files it imports by value at module evaluation. */
const buildRuntimeImportGraph = files => {
  const fileSet = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const targets = new Set();
    for (const match of source.matchAll(STATEMENT)) {
      const clause = (match[1] ?? '').trim();
      const specifier = match[2] ?? match[3];
      if (match[2] && isTypeOnly(clause)) continue;
      const target = resolveSpecifier(file, specifier, fileSet);
      if (target) targets.add(target);
    }
    graph.set(file, targets);
  }
  return graph;
};

/** Strongly connected components with more than one file, or a file importing itself. */
const findCycles = graph => {
  let index = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  const visit = node => {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(target)));
      }
    }
    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) cycles.push(component.sort());
  };

  for (const node of graph.keys()) if (!indexes.has(node)) visit(node);
  return cycles;
};

const files = listProductionSources(ROOT, 'src');
const graph = buildRuntimeImportGraph(files);
const cycles = findCycles(graph);

if (cycles.length === 0) {
  const edges = [...graph.values()].reduce((total, targets) => total + targets.size, 0);
  console.log(
    `Import cycle check passed (${files.length} files, ${edges} runtime imports, 0 cycles).`
  );
  process.exit(0);
}

console.error('\nRuntime import cycles (static value imports):');
for (const cycle of cycles) console.error(`- [${cycle.length} files] ${cycle.join(' ↔ ')}`);
console.error(
  '\nBreak each cycle by moving the shared piece into a leaf module, or import it lazily with import().'
);
process.exit(1);
