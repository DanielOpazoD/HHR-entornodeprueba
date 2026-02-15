#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'architecture-allowlist.json');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IMPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath =>
  SOURCE_EXTENSIONS.includes(path.extname(filePath)) && !filePath.endsWith('.d.ts');

const walkFiles = dirPath => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && isSourceFile(absolutePath)) {
      result.push(absolutePath);
    }
  }

  return result;
};

const resolveImport = (importerFilePath, importPath) => {
  if (!importPath.startsWith('@/') && !importPath.startsWith('.')) {
    return null;
  }

  const basePath = importPath.startsWith('@/')
    ? path.join(SRC_ROOT, importPath.slice(2))
    : path.resolve(path.dirname(importerFilePath), importPath);

  const candidates = [];

  if (path.extname(basePath)) {
    candidates.push(basePath);
  } else {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(path.join(basePath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return null;
};

const collectGraph = files => {
  const graph = new Map();
  const layerViolations = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const edges = new Set();
    let match;

    while ((match = IMPORT_REGEX.exec(source)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) {
        continue;
      }
      const resolved = resolveImport(filePath, importPath);
      if (!resolved) {
        continue;
      }
      edges.add(resolved);

      const importer = toPosix(path.relative(ROOT, filePath));
      const imported = toPosix(path.relative(ROOT, resolved));
      const importedExt = path.extname(imported);

      const importerIsController = importer.includes('/controllers/');
      const importerIsHook = importer.includes('/hooks/');
      const importedIsComponentImplementation =
        imported.includes('/components/') && (importedExt === '.tsx' || importedExt === '.jsx');

      if (importerIsController && importedIsComponentImplementation) {
        layerViolations.push({
          rule: 'controllers-must-not-import-component-implementation',
          importer,
          imported,
        });
      }

      if (importerIsHook && importedIsComponentImplementation) {
        layerViolations.push({
          rule: 'hooks-must-not-import-component-implementation',
          importer,
          imported,
        });
      }
    }

    graph.set(filePath, [...edges]);
  }

  return { graph, layerViolations };
};

const findCycles = graph => {
  const visited = new Set();
  const activeStack = [];
  const activeSet = new Set();
  const cycles = new Set();

  const visit = node => {
    if (activeSet.has(node)) {
      const cycleStart = activeStack.indexOf(node);
      if (cycleStart >= 0) {
        const cyclePath = activeStack.slice(cycleStart).concat(node);
        const normalized = cyclePath.map(cycleNode => toPosix(path.relative(ROOT, cycleNode)));
        const rotated = normalized.slice(0, -1);
        const minIndex = rotated.reduce(
          (best, current, index) => (current < rotated[best] ? index : best),
          0
        );
        const canonical = rotated
          .slice(minIndex)
          .concat(rotated.slice(0, minIndex))
          .concat(rotated[minIndex]);
        cycles.add(canonical.join(' -> '));
      }
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    activeSet.add(node);
    activeStack.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (graph.has(neighbor)) {
        visit(neighbor);
      }
    }

    activeStack.pop();
    activeSet.delete(node);
  };

  for (const node of graph.keys()) {
    visit(node);
  }

  return [...cycles].sort();
};

const files = walkFiles(SRC_ROOT);
const { graph, layerViolations } = collectGraph(files);
const cycles = findCycles(graph);

const allowlist = fs.existsSync(ALLOWLIST_PATH)
  ? JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
  : { layerViolations: [], cycles: [] };

const knownLayerViolations = new Set(allowlist.layerViolations || []);
const knownCycles = new Set(allowlist.cycles || []);

const currentLayerViolationIds = layerViolations.map(
  violation => `${violation.rule}|${violation.importer}|${violation.imported}`
);
const newLayerViolations = currentLayerViolationIds.filter(id => !knownLayerViolations.has(id));
const currentCycleIds = cycles;
const newCycles = currentCycleIds.filter(id => !knownCycles.has(id));

if (newLayerViolations.length === 0 && newCycles.length === 0) {
  console.log('Architecture checks passed.');

  if (currentLayerViolationIds.length > 0 || currentCycleIds.length > 0) {
    console.log(
      `Baseline debt tracked: ${currentLayerViolationIds.length} layer issues, ${currentCycleIds.length} cycles.`
    );
  }

  process.exit(0);
}

if (newLayerViolations.length > 0) {
  console.error('\nLayer violations:');
  for (const violationId of newLayerViolations) {
    const [rule, importer, imported] = violationId.split('|');
    console.error(`- [${rule}] ${importer} -> ${imported}`);
  }
}

if (newCycles.length > 0) {
  console.error('\nCircular dependencies:');
  for (const cycle of newCycles) {
    console.error(`- ${cycle}`);
  }
}

process.exit(1);
