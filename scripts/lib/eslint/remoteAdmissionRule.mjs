import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const remoteAdmissionRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      admission:
        'Las lecturas remotas deben entrar por admitRemoteDailyRecords y usar su fila devuelta; no abras ni escribas el almacén directamente.',
    },
  },
  create(context) {
    const report = node => context.report({ node, messageId: 'admission' });
    const check = (source, declaration) => {
      if (!source || typeof source.value !== 'string') return;
      const raw = source.value;
      const target = (
        raw.startsWith('.')
          ? path.posix.normalize(
              path.posix.join(
                path.posix.dirname(path.relative(ROOT, context.filename).split(path.sep).join('/')),
                raw
              )
            )
          : raw.replace(/^@\//, 'src/')
      ).replace(/\.[cm]?[jt]sx?$/, '');
      if (target === 'src/services/storage/indexeddb/indexedDbRecordService') {
        const allowed =
          /^(get|captureLocalRecordBase$|inspectLocalRecordAdmission$|admitLocalRecords$)/;
        if (!declaration || declaration.type !== 'ImportDeclaration') return report(source);
        for (const specifier of declaration.specifiers) {
          if (declaration.importKind === 'type' || specifier.importKind === 'type') continue;
          if (
            specifier.type !== 'ImportSpecifier' ||
            !allowed.test(specifier.imported.name ?? specifier.imported.value)
          )
            report(specifier);
        }
        return;
      }
      if (
        /^dexie(?:\/|$)/.test(target) ||
        /^src\/services\/storage\/(indexeddb|localpersistence|localstorage)\//.test(target)
      )
        report(source);
    };
    return {
      ImportDeclaration: node => check(node.source, node),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
      TSImportEqualsDeclaration: node => check(node.moduleReference.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          check(node.arguments[0]);
      },
      Identifier(node) {
        if (node.name !== 'indexedDB') return;
        if (
          node.parent.type === 'MemberExpression' &&
          node.parent.property === node &&
          !node.parent.computed
        )
          return;
        report(node);
      },
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;
        if (name === 'indexedDB') report(node);
      },
    };
  },
};
