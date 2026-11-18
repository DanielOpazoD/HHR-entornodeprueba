#!/usr/bin/env node

/**
 * The one direction rule between the top-level folders of `src/`.
 *
 * `scripts/folder-dependency-matrix.json` gives every top-level folder (and the files directly
 * in `src/`) a layer, from the pure core (0) to composition (6). A module depends only on its own
 * layer or the ones below. The rule binds references that run code: value imports and re-exports
 * (evaluated when the module loads) and deferred loads (`import()`, and
 * `new URL('x', import.meta.url)` for workers). Type-only references are erased when compiling
 * and are allowed in any direction. Any spelling counts: `@/` alias, relative, with or without
 * extension.
 *
 * The upward relations that exist today are listed one by one, file to file, under
 * `exceptions`, each with its reason. The list only shrinks: a new upward relation fails even if
 * another one disappeared, and a listed relation that no longer exists (or no longer goes up)
 * fails until it is removed from the list.
 *
 * Feature to feature imports are not this rule: `hhr/feature-boundaries` and
 * `hhr/public-import-boundaries` own them with `scripts/feature-dependency-matrix.json`.
 *
 * `--ownership` prints a report, not a rule: shared modules that a single feature reaches.
 * Consumers are features, composition (`app-shell`, `views`, `src/*`), Netlify Functions and the
 * entry points declared in `scripts/config/unreachable-modules.json` (the worker of the PWA, the
 * CUDYR parser that Functions compiles from `src/`). A module there is a candidate to move into
 * that feature after its owner reviews it; the report never fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  listProductionSources,
  readClassifiedReferences,
  resolveSpecifier,
} from './lib/sourceModules.mjs';

export const POLICY_PATH = 'scripts/folder-dependency-matrix.json';
const ENTRY_POINTS_PATH = 'scripts/config/unreachable-modules.json';
const NETLIFY_DIR = 'netlify/functions';
export const ROOT_FOLDER = '(raíz)';
const KIND_LABEL = { value: 'valor', deferred: 'carga diferida', type: 'tipo' };
const BOUND_KINDS = new Set(['value', 'deferred']);

const readJson = (root, relativePath, fallback) => {
  const absolute = path.join(root, relativePath);
  return fs.existsSync(absolute) ? JSON.parse(fs.readFileSync(absolute, 'utf8')) : fallback;
};

/** `src/services/x.ts` → `services`; `src/App.tsx` → `(raíz)`; null outside `src/`. */
export const folderOf = file => {
  const parts = file.split('/');
  if (parts[0] !== 'src') return null;
  return parts.length > 2 ? parts[1] : ROOT_FOLDER;
};

const relationKey = ({ from, to, kind }) => `${from}|${to}|${kind}`;

/** Policy problems that make every verdict meaningless; checked before reading the code. */
const readPolicy = root => {
  const policy = readJson(root, POLICY_PATH, null);
  const problems = [];
  if (!policy || !Array.isArray(policy.layers) || policy.layers.length === 0) {
    return { problems: [`${POLICY_PATH} no define "layers".`] };
  }
  const layerOf = new Map();
  const nameOf = new Map();
  for (const entry of policy.layers) {
    if (!Number.isInteger(entry?.layer) || !Array.isArray(entry.folders)) {
      problems.push(`Cada capa de ${POLICY_PATH} necesita "layer" (entero) y "folders".`);
      continue;
    }
    nameOf.set(entry.layer, entry.name ?? `capa ${entry.layer}`);
    for (const folder of entry.folders) {
      if (layerOf.has(folder)) problems.push(`La carpeta «${folder}» figura en dos capas.`);
      layerOf.set(folder, entry.layer);
    }
  }
  const exceptions = policy.exceptions ?? [];
  const seen = new Set();
  for (const exception of exceptions) {
    const key = relationKey(exception);
    if (
      typeof exception.from !== 'string' ||
      typeof exception.to !== 'string' ||
      !BOUND_KINDS.has(exception.kind) ||
      typeof exception.reason !== 'string' ||
      exception.reason.trim() === ''
    ) {
      problems.push(
        `Excepción inválida ${JSON.stringify(exception)}: necesita "from", "to", "kind" (value o deferred) y "reason".`
      );
    } else if (seen.has(key)) {
      problems.push(`Excepción repetida: ${exception.from} → ${exception.to} (${exception.kind}).`);
    }
    seen.add(key);
  }
  return { problems, layerOf, nameOf, exceptions };
};

/** Every resolved reference of production code in `src/` and Netlify Functions. */
const readGraph = root => {
  const appFiles = listProductionSources(root, 'src');
  const netlifyFiles = listProductionSources(root, NETLIFY_DIR);
  const known = new Set([...appFiles, ...netlifyFiles]);
  const edges = [];
  for (const from of [...appFiles, ...netlifyFiles]) {
    const source = fs.readFileSync(path.join(root, from), 'utf8');
    for (const reference of readClassifiedReferences(from, source)) {
      const to = resolveSpecifier(from, reference.specifier, known);
      if (to && to !== from) edges.push({ from, to, ...reference });
    }
  }
  return { appFiles, edges };
};

/** For each shared module, the consumers that reach it; see the header. */
const computeConsumers = (root, appFiles, edges, layerOf, featureLayer) => {
  const declaredEntries = new Map(
    (readJson(root, ENTRY_POINTS_PATH, {}).entryPoints ?? []).map(entry => [
      entry.file,
      `entrada: ${entry.declaredIn}`,
    ])
  );
  const importers = new Map();
  for (const edge of edges) {
    if (!importers.has(edge.to)) importers.set(edge.to, new Set());
    importers.get(edge.to).add(edge.from);
  }
  const ownLabel = file => {
    const folder = folderOf(file);
    if (folder === null) return 'Netlify Functions';
    if (folder === 'features') return `features/${file.split('/')[2]}`;
    if (layerOf.get(folder) > featureLayer) return 'composición';
    return null;
  };
  const consumersOf = new Map();
  for (const file of appFiles) {
    if (ownLabel(file) !== null) continue;
    const labels = new Set();
    const visited = new Set([file]);
    const pending = [file];
    while (pending.length > 0) {
      const current = pending.pop();
      if (declaredEntries.has(current)) labels.add(declaredEntries.get(current));
      for (const importer of importers.get(current) ?? []) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        const label = ownLabel(importer);
        if (label) labels.add(label);
        else pending.push(importer);
      }
    }
    consumersOf.set(file, labels);
  }
  return consumersOf;
};

/** The whole analysis, for the command and for `report-quality-metrics`. */
export const analyzeFolderDependencies = (root = process.cwd()) => {
  const policy = readPolicy(root);
  if (policy.problems.length > 0) return { problems: policy.problems };
  const { layerOf, nameOf, exceptions } = policy;
  const featureLayer = layerOf.get('features');
  const { appFiles, edges } = readGraph(root);
  const problems = [];
  const unknownFolders = [
    ...new Set(appFiles.map(folderOf).filter(folder => !layerOf.has(folder))),
  ].sort();
  for (const folder of unknownFolders) {
    problems.push(
      `src/${folder === ROOT_FOLDER ? '' : `${folder}/`} no tiene capa: agrégala a una de las capas de ${POLICY_PATH}.`
    );
  }
  if (problems.length > 0) return { problems };

  const counts = { value: 0, deferred: 0, type: 0 };
  const upward = new Map();
  const upwardTypes = new Set();
  for (const edge of edges) {
    const fromFolder = folderOf(edge.from);
    const toFolder = folderOf(edge.to);
    if (fromFolder === null || toFolder === null || fromFolder === toFolder) continue;
    counts[edge.kind] += 1;
    if (layerOf.get(toFolder) <= layerOf.get(fromFolder)) continue;
    if (!BOUND_KINDS.has(edge.kind)) {
      upwardTypes.add(`${edge.from}|${edge.to}`);
      continue;
    }
    const relation = { from: edge.from, to: edge.to, kind: edge.kind };
    if (!upward.has(relationKey(relation)))
      upward.set(relationKey(relation), { ...relation, edge });
  }

  const listed = new Map(exceptions.map(exception => [relationKey(exception), exception]));
  const unlisted = [...upward.values()].filter(relation => !listed.has(relationKey(relation)));
  const stale = exceptions.filter(exception => !upward.has(relationKey(exception)));
  const consumersOf = computeConsumers(root, appFiles, edges, layerOf, featureLayer);
  const describe = file => {
    const folder = folderOf(file);
    return { folder, layer: layerOf.get(folder), name: nameOf.get(layerOf.get(folder)) };
  };
  return {
    problems,
    counts,
    upward: [...upward.values()],
    upwardTypeRelations: upwardTypes.size,
    unlisted,
    stale,
    consumersOf,
    describe,
  };
};

const ownerOf = (consumersOf, file) => {
  const labels = [...(consumersOf.get(file) ?? [])];
  return labels.length === 1 && labels[0].startsWith('features/') ? labels[0] : null;
};

const formatUnlisted = (analysis, relation) => {
  const { describe, consumersOf } = analysis;
  const from = describe(relation.from);
  const to = describe(relation.to);
  const owner = to.folder === 'features' ? ownerOf(consumersOf, relation.from) : null;
  const targetFeature = to.folder === 'features' ? `features/${relation.to.split('/')[2]}` : null;
  const advice =
    owner && owner === targetFeature
      ? `${relation.from} solo lo usa ${owner}: muévelo a src/${owner}/.`
      : `mueve hacia abajo lo que comparten (lo que ${relation.from} usa de ${relation.to}, a la capa ${from.layer} o menor), o lleva a su feature lo que solo usa una feature. Si basta el tipo, usa «import type».`;
  return [
    `- ${relation.from}:${relation.edge.line} → ${relation.to} (${KIND_LABEL[relation.kind]}, «${relation.edge.specifier}»)`,
    `  ${from.folder} está en la capa ${from.layer} (${from.name}) y ${to.folder} en la capa ${to.layer} (${to.name}): una capa depende solo de la suya o de las de abajo.`,
    `  Qué hacer: ${advice} No la agregues a "exceptions" en ${POLICY_PATH}: ese libro solo baja.`,
  ];
};

const formatOwnership = analysis => {
  const byFeature = new Map();
  for (const [file] of analysis.consumersOf) {
    const owner = ownerOf(analysis.consumersOf, file);
    if (!owner) continue;
    if (!byFeature.has(owner)) byFeature.set(owner, []);
    byFeature.get(owner).push(file);
  }
  const total = [...byFeature.values()].reduce((sum, files) => sum + files.length, 0);
  const lines = [
    `Informe de pertenencia (no es una regla): ${total} módulos compartidos que alcanza una sola feature.`,
    'Cada uno abre una revisión de su dueño; muévelo a la feature solo si el dueño lo confirma.',
  ];
  for (const [owner, files] of [...byFeature].sort((a, b) => b[1].length - a[1].length)) {
    lines.push('', `${owner} (${files.length}):`, ...files.sort().map(file => `- ${file}`));
  }
  return `${lines.join('\n')}\n`;
};

/** Checks the rule in the repository at `root`, as the command prints and exits. */
export const checkFolderDependencies = (root = process.cwd()) => {
  const analysis = analyzeFolderDependencies(root);
  if (analysis.problems.length > 0) {
    return { status: 1, stdout: '', stderr: `${analysis.problems.join('\n')}\n` };
  }
  const { counts, upward, unlisted, stale } = analysis;
  if (unlisted.length === 0 && stale.length === 0) {
    const byKind = kind => upward.filter(relation => relation.kind === kind).length;
    return {
      status: 0,
      stdout:
        `Folder dependency checks passed: ${counts.value} referencias de valor, ${counts.deferred} diferidas y ${counts.type} de tipo entre carpetas; ` +
        `${upward.length} relaciones hacia arriba, todas en el libro (${byKind('value')} de valor, ${byKind('deferred')} diferidas); ` +
        `${analysis.upwardTypeRelations} de tipo hacia arriba, permitidas.\n`,
      stderr: '',
    };
  }
  const lines = [];
  if (unlisted.length > 0) {
    lines.push(`\nDependencias hacia arriba sin registrar (regla en ${POLICY_PATH}):`);
    for (const relation of unlisted) lines.push(...formatUnlisted(analysis, relation));
  }
  if (stale.length > 0) {
    lines.push('\nEl libro de excepciones registra relaciones que ya no suben en el código:');
    for (const exception of stale) {
      lines.push(
        `- ${exception.from} → ${exception.to} (${KIND_LABEL[exception.kind]})`,
        `  Sácala de "exceptions" en ${POLICY_PATH}: el libro solo baja.`
      );
    }
  }
  return { status: 1, stdout: '', stderr: `${lines.join('\n')}\n` };
};

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  if (process.argv.includes('--ownership')) {
    const analysis = analyzeFolderDependencies();
    if (analysis.problems.length > 0) {
      process.stderr.write(`${analysis.problems.join('\n')}\n`);
      process.exitCode = 1;
    } else process.stdout.write(formatOwnership(analysis));
  } else {
    const { status, stdout, stderr } = checkFolderDependencies();
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    process.exitCode = status;
  }
}
