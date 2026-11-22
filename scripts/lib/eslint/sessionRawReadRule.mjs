import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One session gate: an operation that waits asks guardAuthoringSession() whether the person who
// started it is still signed in, instead of comparing the owner and generation by hand (the same
// block was copied ~30 times, W17-S1). Owners and the ledger of files still to migrate live in
// one JSON; a ledger row goes once its file no longer imports a raw reader.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SESSION_RAW_READ_LEDGER_PATH = 'scripts/config/session-raw-read-ledger.json';
const SESSION_RAW_READ_LEDGER = JSON.parse(
  readFileSync(new URL('../../config/session-raw-read-ledger.json', import.meta.url), 'utf8')
);
const SESSION_RAW_READERS = new Set([
  'getStoredSessionOwnerKey',
  'getSessionGeneration',
  'getSessionEpoch',
]);
const isSessionOwner = file =>
  Object.keys(SESSION_RAW_READ_LEDGER.owners).some(owner =>
    owner.endsWith('/') ? file.startsWith(owner) : file === owner
  );

export const sessionRawReadRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      raw: 'No compares la sesión a mano con {{name}}(): usa guardAuthoringSession() (src/services/session/authoringSession.ts) si la operación escribe, guarda o lee datos compartidos después de una espera, y authoringSessionScope() como clave de lo guardado por persona; sessionEpochGuard() si el resultado solo se muestra en esta pestaña; useSessionEpoch() como clave de React (AGENTS.md, sesión).',
      stale:
        'Este archivo ya no lee la sesión cruda: quita su fila de «pending» en ' +
        SESSION_RAW_READ_LEDGER_PATH +
        ' y baja LEDGER_SIZE en src/tests/build/sessionRawReadLint.test.ts.',
    },
  },
  create(context) {
    const file = path.relative(ROOT, context.filename).split(path.sep).join('/');
    if (isSessionOwner(file)) return {};
    const pending = Object.hasOwn(SESSION_RAW_READ_LEDGER.pending, file);
    let rawReads = 0;
    const read = (node, name) => {
      if (!SESSION_RAW_READERS.has(name)) return;
      rawReads += 1;
      if (!pending) context.report({ node, messageId: 'raw', data: { name } });
    };
    // Every way to reach a module's export: a named import or re-export, a namespace import, and
    // import() awaited, destructured or passed to then(). Only names bound to a module count, so an
    // injected port (the queue's `runtime.getSessionGeneration`) is not a raw read.
    const modules = new Set();
    const nameOf = node =>
      node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? node.value : undefined;
    const unwrap = node => (node?.type === 'AwaitExpression' ? node.argument : node);
    const isModule = node => {
      const value = unwrap(node);
      return (
        value?.type === 'ImportExpression' ||
        (value?.type === 'Identifier' && modules.has(value.name))
      );
    };
    const bindModule = target => {
      if (target?.type === 'Identifier') modules.add(target.name);
      else if (target?.type === 'ObjectPattern')
        for (const property of target.properties)
          if (property.type === 'Property' && !property.computed)
            read(property.key, nameOf(property.key));
    };
    return {
      ImportSpecifier: node => read(node, nameOf(node.imported)),
      ImportNamespaceSpecifier: node => modules.add(node.local.name),
      ExportSpecifier(node) {
        if (node.parent.source) read(node, nameOf(node.local));
      },
      VariableDeclarator(node) {
        if (isModule(node.init)) bindModule(node.id);
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type === 'MemberExpression' && nameOf(callee.property) === 'then')
          if (unwrap(callee.object)?.type === 'ImportExpression')
            bindModule(node.arguments[0]?.params?.[0]);
      },
      MemberExpression(node) {
        if (!isModule(node.object)) return;
        const property = node.computed
          ? node.property.type === 'Literal'
            ? node.property.value
            : undefined
          : node.property.name;
        read(node.property, property);
      },
      'Program:exit'(program) {
        if (pending && rawReads === 0) context.report({ node: program, messageId: 'stale' });
      },
    };
  },
};
