#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Linter } from 'eslint';

const DEFAULT_ROOT = process.cwd();
const DEFAULT_BASELINE_PATH = path.join(
  DEFAULT_ROOT,
  'scripts',
  'config',
  'extension-hotspots-baseline.json'
);
const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);
const IMPLICIT_FUNCTION_TYPES = new Set(['PropertyDefinition', 'StaticBlock']);

const toPosix = value => value.split(path.sep).join('/');

const countLines = source => (source.length === 0 ? 0 : source.split(/\r?\n/u).length);

const propertyName = node => {
  if (!node) return 'unknown';
  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return 'computed';
};

const expressionName = node => {
  if (!node) return 'unknown';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'Super') return 'super';
  if (node.type === 'MemberExpression') {
    const object = expressionName(node.object);
    const property = propertyName(node.property);
    return `${object}${node.computed ? `[${property}]` : `.${property}`}`;
  }
  if (node.type === 'CallExpression') return `${expressionName(node.callee)}()`;
  return node.type;
};

const localFunctionLabel = (node, parent) => {
  if (node.type === 'FunctionDeclaration' && node.id?.name) {
    return `function:${node.id.name}`;
  }
  if (node.type === 'FunctionExpression' && node.id?.name) {
    return `function:${node.id.name}`;
  }
  if (parent?.type === 'VariableDeclarator') {
    return `variable:${propertyName(parent.id)}`;
  }
  if (parent?.type === 'AssignmentExpression') {
    return `assignment:${expressionName(parent.left)}`;
  }
  if (parent?.type === 'Property' || parent?.type === 'MethodDefinition') {
    return `property:${propertyName(parent.key)}`;
  }
  if (parent?.type === 'CallExpression') {
    if (parent.callee === node) return 'iife';
    return `callback:${expressionName(parent.callee)}:${parent.arguments.indexOf(node)}`;
  }
  return `anonymous:${node.type}`;
};

const buildFunctionLocations = sourceCode => {
  const locations = [];

  const visit = (node, parent = null, owner = '') => {
    if (!node || typeof node.type !== 'string') return;

    let nextOwner = owner;
    if (FUNCTION_TYPES.has(node.type) || IMPLICIT_FUNCTION_TYPES.has(node.type)) {
      const label = node.type === 'PropertyDefinition'
        ? `class-field:${propertyName(node.key)}`
        : node.type === 'StaticBlock'
          ? 'class-static-block'
          : localFunctionLabel(node, parent);
      nextOwner = owner ? `${owner}>${label}` : label;
      const reportedNode = node.type === 'PropertyDefinition' ? node.value : node;
      if (!reportedNode) return;
      locations.push({
        line: reportedNode.loc.start.line,
        column: reportedNode.loc.start.column + 1,
        endLine: reportedNode.loc.end.line,
        endColumn: reportedNode.loc.end.column + 1,
        nodeType: reportedNode.type,
        id: nextOwner,
      });
    }

    const childKeys = sourceCode.visitorKeys[node.type] || [];
    for (const key of childKeys) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child, node, nextOwner);
      } else {
        visit(value, node, nextOwner);
      }
    }
  };

  visit(sourceCode.ast);
  return locations;
};

const analyzeComplexity = ({ source, file, threshold }) => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    source,
    {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
      rules: { complexity: ['error', threshold] },
    },
    { filename: file }
  );
  const parseErrors = messages.filter(message => message.fatal || message.ruleId === null);
  if (parseErrors.length > 0) {
    throw new Error(
      `${file}: ${parseErrors.map(message => message.message).join(' ')}`
    );
  }

  const sourceCode = linter.getSourceCode();
  const locations = buildFunctionLocations(sourceCode);
  const complexityGroups = new Map();

  for (const message of messages.filter(entry => entry.ruleId === 'complexity')) {
    const match = message.message.match(/complexity of (?<value>\d+)/u);
    const complexity = Number(match?.groups?.value);
    const location = `${message.line}:${message.column}`;
    const id = locations
      .filter(entry =>
        entry.nodeType === message.nodeType &&
        (entry.line < message.line ||
          entry.line === message.line && entry.column <= message.column) &&
        (entry.endLine > message.line ||
          entry.endLine === message.line && entry.endColumn >= message.column)
      )
      .sort((left, right) =>
        right.line - left.line ||
        right.column - left.column ||
        left.endLine - right.endLine ||
        left.endColumn - right.endColumn
      )[0]?.id;
    if (!id || !Number.isInteger(complexity)) {
      throw new Error(`${file}: no se pudo identificar el hotspot en ${location}.`);
    }
    const group = complexityGroups.get(id) || [];
    group.push(complexity);
    complexityGroups.set(id, group);
  }

  const hotspots = {};
  for (const [id, complexities] of complexityGroups) {
    const ordered = [...complexities].sort((left, right) => right - left);
    if (ordered.length === 1) {
      hotspots[id] = ordered[0];
      continue;
    }
    ordered.forEach((complexity, index) => {
      hotspots[`${id}#${index + 1}`] = complexity;
    });
  }

  return Object.fromEntries(Object.entries(hotspots).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
};

export const collectExtensionMetrics = ({ root, baseline }) => {
  const extensionRoot = String(baseline.extensionRoot || 'extension');
  const extensionPath = path.join(root, extensionRoot);
  const vendorFiles = new Set(Array.isArray(baseline.vendorFiles) ? baseline.vendorFiles : []);
  const threshold = Number(baseline.complexityThreshold);

  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error('complexityThreshold debe ser un entero positivo.');
  }

  const allJsFiles = fs.readdirSync(extensionPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort();
  const missingVendors = [...vendorFiles].filter(file => !allJsFiles.includes(file));
  if (missingVendors.length > 0) {
    throw new Error(`Vendor inexistente en la whitelist: ${missingVendors.join(', ')}.`);
  }

  const authoredFiles = allJsFiles.filter(file => !vendorFiles.has(file));
  const files = {};
  for (const file of authoredFiles) {
    const source = fs.readFileSync(path.join(extensionPath, file), 'utf8');
    files[file] = {
      lines: countLines(source),
      hotspots: analyzeComplexity({ source, file, threshold }),
    };
  }

  return { allJsFiles, authoredFiles, files };
};

export const buildBaseline = ({ baseline, metrics }) => ({
  $schemaNote: baseline.$schemaNote,
  schemaVersion: 1,
  extensionRoot: baseline.extensionRoot || 'extension',
  complexityThreshold: baseline.complexityThreshold,
  vendorFiles: [...baseline.vendorFiles].sort(),
  files: Object.fromEntries(metrics.authoredFiles.map(file => [
    file,
    {
      maxLines: metrics.files[file].lines,
      hotspots: metrics.files[file].hotspots,
    },
  ])),
});

export const collectBaselineUpdateIssues = ({ previous, next }) => {
  const issues = [];
  for (const [file, nextEntry] of Object.entries(next.files || {})) {
    const previousEntry = previous.files?.[file];
    if (!previousEntry) {
      issues.push(`${file}: archivo nuevo; la línea base no se actualiza automáticamente.`);
      continue;
    }
    if (nextEntry.maxLines > previousEntry.maxLines) {
      issues.push(
        `${file}: líneas ${nextEntry.maxLines} exceden la línea base ${previousEntry.maxLines}.`
      );
    }
    for (const [id, complexity] of Object.entries(nextEntry.hotspots || {})) {
      const previousComplexity = previousEntry.hotspots?.[id];
      if (!Number.isInteger(previousComplexity)) {
        issues.push(`${file}: hotspot nuevo ${id} (${complexity}).`);
      } else if (complexity > previousComplexity) {
        issues.push(
          `${file}: ${id} aumentó de ${previousComplexity} a ${complexity}.`
        );
      }
    }
  }
  return issues;
};

export const evaluateExtensionHotspots = ({ baseline, metrics }) => {
  const issues = [];
  const baselineFiles = Object.keys(baseline.files || {}).sort();
  const currentFiles = [...metrics.authoredFiles].sort();

  for (const file of currentFiles.filter(name => !baselineFiles.includes(name))) {
    issues.push(`${file}: falta en la línea base de archivos propios.`);
  }
  for (const file of baselineFiles.filter(name => !currentFiles.includes(name))) {
    issues.push(`${file}: entrada obsoleta; el archivo propio ya no existe.`);
  }

  for (const file of currentFiles.filter(name => baseline.files?.[name])) {
    const observed = metrics.files[file];
    const allowed = baseline.files[file];
    if (!Number.isInteger(allowed.maxLines) || allowed.maxLines < 0) {
      issues.push(`${file}: maxLines debe ser un entero no negativo.`);
    } else if (observed.lines > allowed.maxLines) {
      issues.push(`${file}: ${observed.lines} líneas exceden el límite ${allowed.maxLines}.`);
    }

    const observedHotspots = observed.hotspots || {};
    const allowedHotspots = allowed.hotspots || {};
    for (const [id, complexity] of Object.entries(observedHotspots)) {
      const limit = allowedHotspots[id];
      if (!Number.isInteger(limit)) {
        issues.push(`${file}: hotspot nuevo ${id} con complejidad ${complexity}.`);
      } else if (complexity > limit) {
        issues.push(`${file}: ${id} aumentó de ${limit} a ${complexity}.`);
      }
    }
    for (const id of Object.keys(allowedHotspots)) {
      if (!Object.prototype.hasOwnProperty.call(observedHotspots, id)) {
        issues.push(`${file}: hotspot resuelto u obsoleto ${id}; reduce la línea base.`);
      }
    }
  }

  return issues;
};

const readBaseline = baselinePath => JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const run = ({ root = DEFAULT_ROOT, baselinePath = DEFAULT_BASELINE_PATH } = {}) => {
  if (!fs.existsSync(baselinePath)) {
    console.error(`[extension-hotspots] Falta ${toPosix(path.relative(root, baselinePath))}.`);
    process.exit(1);
  }

  const baseline = readBaseline(baselinePath);
  if (baseline.schemaVersion !== 1) {
    console.error(
      `[extension-hotspots] schemaVersion debe ser 1; recibido ${String(baseline.schemaVersion)}.`
    );
    process.exit(1);
  }
  const metrics = collectExtensionMetrics({ root, baseline });
  const nextBaseline = buildBaseline({ baseline, metrics });

  if (process.argv.includes('--write-baseline')) {
    const initialize = process.argv.includes('--initialize');
    if (initialize && Object.keys(baseline.files || {}).length > 0) {
      console.error('[extension-hotspots] --initialize sólo acepta una línea base vacía.');
      process.exit(1);
    }
    const updateIssues = initialize
      ? []
      : collectBaselineUpdateIssues({ previous: baseline, next: nextBaseline });
    if (updateIssues.length > 0) {
      console.error('[extension-hotspots] Se rechazó un aumento de línea base:');
      for (const issue of updateIssues) console.error(`- ${issue}`);
      process.exit(1);
    }
    fs.writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
    console.log('[extension-hotspots] Línea base reducida al estado actual.');
    return;
  }

  const issues = evaluateExtensionHotspots({ baseline, metrics });
  if (issues.length > 0) {
    console.error('[extension-hotspots] Regresiones encontradas:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  const hotspotCount = Object.values(metrics.files)
    .reduce((total, entry) => total + Object.keys(entry.hotspots).length, 0);
  console.log(
    `[extension-hotspots] OK (${metrics.authoredFiles.length} archivos propios, ` +
      `${hotspotCount} hotspots gobernados, umbral ${baseline.complexityThreshold}).`
  );
};

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) run();
