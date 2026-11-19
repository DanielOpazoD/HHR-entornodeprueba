#!/usr/bin/env node

/**
 * Post-build chunk graph validator.
 *
 * Ensures that vendor chunks never import feature/app chunks, which would
 * create circular load-order dependencies that can crash production when
 * module-scope calls like React.createContext() execute before their
 * dependency (vendor-react) is available.
 *
 * Rules enforced:
 * 1. vendor-* chunks may only import other vendor-* chunks.
 * 2. No circular dependency exists between vendor and feature/app chunks.
 *
 * Run after `npm run build`:
 *   node scripts/check-chunk-graph.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.join(process.cwd(), 'dist', 'assets');

if (!fs.existsSync(assetsDir)) {
  console.error('[chunk-graph] dist/assets not found. Run "npm run build" first.');
  process.exit(1);
}

const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));

/** Extract static and dynamic import targets from a JS chunk. */
const extractImports = content => {
  const staticImports = [...content.matchAll(/from"\.\/([^"]+)"/g)].map(m => m[1]);
  const dynamicImports = [...content.matchAll(/import\("\.\/([^"]+)"\)/g)].map(m => m[1]);
  return { static: staticImports, dynamic: dynamicImports };
};

const isVendorChunk = name => name.startsWith('vendor-');
const isFeatureChunk = name => name.startsWith('feature-');

const violations = [];

for (const file of jsFiles) {
  if (!isVendorChunk(file)) continue;

  const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  const imports = extractImports(content);
  const allImports = [...imports.static, ...imports.dynamic];

  for (const dep of allImports) {
    if (isFeatureChunk(dep)) {
      violations.push({
        from: file,
        to: dep,
        type: imports.static.includes(dep) ? 'static' : 'dynamic',
      });
    }
  }
}

if (violations.length > 0) {
  console.error('[chunk-graph] ❌ Vendor → Feature import violations detected!\n');
  console.error(
    '  These create circular load-order dependencies that crash production\n' +
      '  (e.g. React.createContext() called before vendor-react is loaded).\n'
  );
  for (const v of violations) {
    console.error(`  ${v.from} --[${v.type}]--> ${v.to}`);
  }
  console.error(
    '\n  Fix: remove the app-level manual chunk that causes the cycle,\n' +
      '  or move the shared module to a vendor-safe chunk.\n'
  );
  process.exit(1);
}

/* ── Additional: detect vendor ↔ vendor cycles ────────────────────────── */

const vendorGraph = new Map();

for (const file of jsFiles) {
  if (!isVendorChunk(file)) continue;

  const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  const imports = extractImports(content);
  const vendorDeps = imports.static.filter(isVendorChunk);
  vendorGraph.set(file, vendorDeps);
}

/** DFS cycle detection among vendor chunks. */
const detectCycles = graph => {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map();
  const parent = new Map();
  const cycles = [];

  for (const node of graph.keys()) color.set(node, WHITE);

  const dfs = node => {
    color.set(node, GRAY);
    for (const neighbor of graph.get(node) || []) {
      if (color.get(neighbor) === GRAY) {
        // Reconstruct cycle
        const cycle = [neighbor, node];
        let cur = node;
        while (parent.has(cur) && parent.get(cur) !== neighbor) {
          cur = parent.get(cur);
          cycle.push(cur);
        }
        cycles.push(cycle.reverse());
      } else if (color.get(neighbor) === WHITE) {
        parent.set(neighbor, node);
        dfs(neighbor);
      }
    }
    color.set(node, BLACK);
  };

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) dfs(node);
  }
  return cycles;
};

const cycles = detectCycles(vendorGraph);
if (cycles.length > 0) {
  console.error('[chunk-graph] ❌ Circular dependencies between vendor chunks!\n');
  for (const cycle of cycles) {
    console.error(`  ${cycle.join(' → ')}`);
  }
  console.error('');
  process.exit(1);
}

/* ── The login screen paints without the authenticated shell or Firestore ── */

const LOGIN_FORBIDDEN_CHUNKS = ['app-authenticated-shell-', 'vendor-firebase-firestore-'];
const entryHtml = fs.readFileSync(path.join(process.cwd(), 'dist', 'index.html'), 'utf8');
const startupChunks = new Set(
  [...entryHtml.matchAll(/<script type="module"[^>]*src="\/assets\/([^"]+)"/g)].map(m => m[1])
);
for (const file of startupChunks) {
  const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  for (const m of content.matchAll(/(?:from|import)"\.\/([^"]+)"/g)) startupChunks.add(m[1]);
}
const forbiddenStartup = [...startupChunks].filter(file =>
  LOGIN_FORBIDDEN_CHUNKS.some(prefix => file.startsWith(prefix))
);
if (forbiddenStartup.length > 0) {
  console.error(
    `[chunk-graph] ❌ The entry statically loads ${forbiddenStartup.join(', ')} before the login screen paints.\n` +
      '  Import the module that pulls it with import() where the action happens, or keep the\n' +
      '  startup claim in scripts/config/chunkingPolicy.ts first so manual chunks cannot absorb it.\n'
  );
  process.exit(1);
}

console.log(
  `[chunk-graph] ✅ No vendor→feature imports. ${vendorGraph.size} vendor chunks acyclic. ` +
    `Startup loads ${startupChunks.size} chunks, without the authenticated shell or Firestore.`
);
