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
 * Shared UI holds no data access: `components/` does not load, by value or deferred, a module of
 * `services/` that opens data, that is, one that imports a package of `dataAccess.packages`
 * (Firestore, Storage, IndexedDB through Dexie), uses a global of `dataAccess.globals` (the raw
 * `indexedDB`) or is listed in `dataAccess.modules` (data readers no package reveals: the REST
 * reader of Firestore, the local DailyRecord backup), directly or through other modules of
 * `services/`. It is a guide, not a proof: other ways to data are left to review.
 * Data access is spread over many service folders next to pure helpers, so it is told by what a
 * module imports, not by its folder.
 *
 * The relations of both rules that exist today are listed one by one, file to file, in the
 * exceptions book (`exceptions` and `dataAccess.exceptions`), each with its reason. The book only
 * shrinks: see `scripts/lib/folderDependencyBook.mjs`.
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
  usesGlobal,
} from './lib/sourceModules.mjs';
import {
  compareWithBase,
  relationKey,
  resolveBookBase,
  validateSection,
} from './lib/folderDependencyBook.mjs';

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
  const dataAccess = policy.dataAccess ?? {};
  const netlifyBoundary = policy.netlifyBoundary ?? null;
  if (!Array.isArray(dataAccess.from) || !Array.isArray(dataAccess.packages)) {
    problems.push(`${POLICY_PATH} necesita "dataAccess" con "from" y "packages".`);
  }
  if (netlifyBoundary !== null && !Number.isInteger(netlifyBoundary.allowedMaxLayer)) {
    problems.push(`${POLICY_PATH} necesita "netlifyBoundary.allowedMaxLayer" (entero).`);
  }
  problems.push(
    ...validateSection(exceptions, 'exceptions'),
    ...validateSection(dataAccess.exceptions ?? [], 'dataAccess.exceptions'),
    ...validateSection(netlifyBoundary?.exceptions ?? [], 'netlifyBoundary.exceptions')
  );
  return { problems, layerOf, nameOf, exceptions, dataAccess, netlifyBoundary, policy };
};

/** Every resolved reference of production code in `src/` and Netlify Functions. */
const readGraph = (root, dataGlobals = []) => {
  const appFiles = listProductionSources(root, 'src');
  const netlifyFiles = listProductionSources(root, NETLIFY_DIR);
  const known = new Set([...appFiles, ...netlifyFiles]);
  const edges = [];
  const packageReferences = [];
  for (const from of [...appFiles, ...netlifyFiles]) {
    const source = fs.readFileSync(path.join(root, from), 'utf8');
    for (const name of dataGlobals)
      if (usesGlobal(from, source, [name]))
        packageReferences.push({ from, specifier: name, kind: 'global' });
    for (const reference of readClassifiedReferences(from, source)) {
      const to = resolveSpecifier(from, reference.specifier, known);
      if (to && to !== from) edges.push({ from, to, ...reference });
      else if (!to && !/^[./@]/.test(reference.specifier) && reference.kind !== 'type')
        packageReferences.push({ from, ...reference });
    }
  }
  return { appFiles, edges, packageReferences };
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

/**
 * Modules of `services/` that open data, each with how: the package or global it uses, its listing
 * in `dataAccess.modules` (a file, or a folder ending in `/`), or the module of `services/` through
 * which it reaches one of those.
 */
const findDataServices = (
  appFiles,
  edges,
  packageReferences,
  { packages, globals = [], modules = [] }
) => {
  const opensData = specifier =>
    globals.find(name => specifier === name) ??
    packages.find(name => specifier === name || specifier.startsWith(`${name}/`));
  const isService = file => folderOf(file) === 'services';
  const reasons = new Map();
  for (const file of appFiles) {
    const listed = modules.find(entry =>
      entry.endsWith('/') ? file.startsWith(entry) : file === entry
    );
    if (listed && isService(file)) reasons.set(file, { package: listed, declared: true });
  }
  for (const reference of packageReferences) {
    const name = opensData(reference.specifier);
    if (name && isService(reference.from) && !reasons.has(reference.from))
      reasons.set(reference.from, { package: name });
  }
  const runtimeEdges = edges.filter(
    edge => edge.kind !== 'type' && isService(edge.from) && isService(edge.to)
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const edge of runtimeEdges) {
      if (reasons.has(edge.from) || !reasons.has(edge.to)) continue;
      reasons.set(edge.from, { package: reasons.get(edge.to).package, via: edge.to });
      grew = true;
    }
  }
  return reasons;
};

/** The whole analysis, for the command and for `report-quality-metrics`. */
export const analyzeFolderDependencies = (root = process.cwd()) => {
  const policy = readPolicy(root);
  if (policy.problems.length > 0) return { problems: policy.problems };
  const { layerOf, nameOf, exceptions, dataAccess, netlifyBoundary } = policy;
  const featureLayer = layerOf.get('features');
  const { appFiles, edges, packageReferences } = readGraph(root, dataAccess.globals ?? []);
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

  const dataServices = findDataServices(appFiles, edges, packageReferences, dataAccess);
  const dataReads = new Map();
  for (const edge of edges) {
    if (!dataAccess.from.includes(folderOf(edge.from)) || !BOUND_KINDS.has(edge.kind)) continue;
    if (!dataServices.has(edge.to)) continue;
    const relation = { from: edge.from, to: edge.to, kind: edge.kind };
    if (!dataReads.has(relationKey(relation)))
      dataReads.set(relationKey(relation), { ...relation, edge, data: dataServices.get(edge.to) });
  }
  const netlifyCrossings = new Map();
  if (netlifyBoundary !== null) {
    for (const edge of edges) {
      if (!edge.from.startsWith(`${NETLIFY_DIR}/`) || !BOUND_KINDS.has(edge.kind)) continue;
      const toFolder = folderOf(edge.to);
      if (toFolder === null || layerOf.get(toFolder) <= netlifyBoundary.allowedMaxLayer) continue;
      const relation = { from: edge.from, to: edge.to, kind: edge.kind };
      if (!netlifyCrossings.has(relationKey(relation)))
        netlifyCrossings.set(relationKey(relation), { ...relation, edge });
    }
  }
  const compare = (found, book) => {
    const listed = new Set(book.map(relationKey));
    return {
      unlisted: [...found.values()].filter(relation => !listed.has(relationKey(relation))),
      stale: book.filter(entry => !found.has(relationKey(entry))),
    };
  };
  const { unlisted, stale } = compare(upward, exceptions);
  const data = compare(dataReads, dataAccess.exceptions ?? []);
  const netlify = compare(netlifyCrossings, netlifyBoundary?.exceptions ?? []);
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
    dataReads: [...dataReads.values()],
    dataUnlisted: data.unlisted,
    dataStale: data.stale,
    dataServiceCount: dataServices.size,
    netlifyCrossings: [...netlifyCrossings.values()],
    netlifyUnlisted: netlify.unlisted,
    netlifyStale: netlify.stale,
    netlifyAllowedMaxLayer: netlifyBoundary?.allowedMaxLayer ?? null,
    policy: policy.policy,
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

const formatDataRead = (analysis, relation) => {
  const { package: name, via, declared } = relation.data;
  const source = declared ? `${name} (en "dataAccess.modules")` : name;
  const how = via
    ? `llega a ${source} por ${via}`
    : declared
      ? `figura en "dataAccess.modules"`
      : `usa ${name}`;
  const from = analysis.describe(relation.from);
  return [
    `- ${relation.from}:${relation.edge.line} → ${relation.to} (${KIND_LABEL[relation.kind]}, «${relation.edge.specifier}»)`,
    `  ${from.folder} es ${from.name} sin acceso a datos, y ${relation.to} abre datos: ${how}.`,
    `  Qué hacer: sube la lectura o la escritura a un hook o contexto (capa 3) o a la feature que la usa, y entrega al componente los datos y las acciones por props. Si basta el tipo, usa «import type». No la agregues a "dataAccess.exceptions" en ${POLICY_PATH}: ese libro solo baja.`,
  ];
};

const formatNetlifyCrossing = (analysis, relation) => {
  const to = analysis.describe(relation.to);
  return [
    `- ${relation.from}:${relation.edge.line} → ${relation.to} (${KIND_LABEL[relation.kind]}, «${relation.edge.specifier}»)`,
    `  Las funciones de Netlify solo pueden importar capa ${analysis.netlifyAllowedMaxLayer} desde src/, y ${to.folder} está en la capa ${to.layer} (${to.name}).`,
    `  Qué hacer: mueve el contrato o la regla pura a la capa ${analysis.netlifyAllowedMaxLayer} (domain/, shared/, utils/, constants/, schemas/ o types/). Si basta el tipo, usa «import type». No la agregues a "netlifyBoundary.exceptions" en ${POLICY_PATH}: ese libro solo baja.`,
  ];
};

const formatStale = (entries, label) =>
  entries.flatMap(entry => [
    `- ${entry.from} → ${entry.to} (${KIND_LABEL[entry.kind]})`,
    `  Sácala de "${label}" en ${POLICY_PATH}: el libro solo baja.`,
  ]);

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

/**
 * Checks the rule in the repository at `root`, as the command prints and exits. `env` gives the
 * base of the book (`FOLDER_BOOK_BASE`); without it, `git merge-base HEAD origin/main`.
 */
export const checkFolderDependencies = (root = process.cwd(), env = process.env) => {
  const analysis = analyzeFolderDependencies(root);
  if (analysis.problems.length > 0) {
    return { status: 1, stdout: '', stderr: `${analysis.problems.join('\n')}\n` };
  }
  const {
    counts,
    upward,
    unlisted,
    stale,
    dataReads,
    dataUnlisted,
    dataStale,
    netlifyCrossings,
    netlifyUnlisted,
    netlifyStale,
  } = analysis;
  const resolved = resolveBookBase(root, env);
  if (resolved.error) return { status: 1, stdout: '', stderr: `${resolved.error}\n` };
  const book = compareWithBase(root, POLICY_PATH, analysis.policy, resolved.base);
  const lines = [];
  if (unlisted.length > 0) {
    lines.push(`\nDependencias hacia arriba sin registrar (regla en ${POLICY_PATH}):`);
    for (const relation of unlisted) lines.push(...formatUnlisted(analysis, relation));
  }
  if (dataUnlisted.length > 0) {
    lines.push(`\nInterfaz compartida que abre datos (regla "dataAccess" en ${POLICY_PATH}):`);
    for (const relation of dataUnlisted) lines.push(...formatDataRead(analysis, relation));
  }
  if (netlifyUnlisted.length > 0) {
    lines.push(
      `\nFunciones de Netlify importando capas no puras de src/ (regla "netlifyBoundary" en ${POLICY_PATH}):`
    );
    for (const relation of netlifyUnlisted)
      lines.push(...formatNetlifyCrossing(analysis, relation));
  }
  if (stale.length + dataStale.length + netlifyStale.length > 0) {
    lines.push('\nEl libro de excepciones registra relaciones que el código ya no tiene:');
    lines.push(
      ...formatStale(stale, 'exceptions'),
      ...formatStale(dataStale, 'dataAccess.exceptions'),
      ...formatStale(netlifyStale, 'netlifyBoundary.exceptions')
    );
  }
  if (book.added.length > 0) {
    lines.push(
      `\nEl libro solo baja: estas entradas no están en el de la base ${book.base.slice(0, 9)}.`
    );
    for (const entry of book.added) {
      lines.push(
        `- "${entry.section}": ${entry.from} → ${entry.to} (${KIND_LABEL[entry.kind]})`,
        '  Quítala del libro y corrige la dependencia; registrar una relación nueva es decisión del responsable, en su propia PR.'
      );
    }
  }
  if (lines.length > 0) return { status: 1, stdout: '', stderr: `${lines.join('\n')}\n` };
  const byKind = (relations, kind) => relations.filter(relation => relation.kind === kind).length;
  const netlifySummary =
    analysis.netlifyAllowedMaxLayer !== null
      ? ` ${netlifyCrossings.length} cruces de Netlify fuera de capa ${analysis.netlifyAllowedMaxLayer}, todos en el libro.`
      : '';
  const summary =
    `Folder dependency checks passed: ${counts.value} referencias de valor, ${counts.deferred} diferidas y ${counts.type} de tipo entre carpetas; ` +
    `${upward.length} relaciones hacia arriba, todas en el libro (${byKind(upward, 'value')} de valor, ${byKind(upward, 'deferred')} diferidas); ` +
    `${analysis.upwardTypeRelations} de tipo hacia arriba, permitidas; ` +
    `${dataReads.length} lecturas de datos desde la interfaz compartida, todas en el libro (${analysis.dataServiceCount} módulos de services abren datos).${netlifySummary}`;
  return {
    status: 0,
    stdout: `${summary}\n${book.notice ? `${book.notice}\n` : ''}`,
    stderr: '',
  };
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
