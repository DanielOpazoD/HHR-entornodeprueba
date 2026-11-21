import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One AST rule owns cross-feature imports, including relative and dynamic imports.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FEATURE_MATRIX = JSON.parse(
  readFileSync(new URL('../../feature-dependency-matrix.json', import.meta.url), 'utf8')
);
const featurePublicPaths = feature => [
  ...FEATURE_MATRIX.publicImportPatterns.map(pattern => pattern.replace('{feature}', feature)),
  ...(FEATURE_MATRIX.publicModulesByFeature[feature] ?? []),
];
const featureOf = importer => importer.match(/^src\/features\/([^/]+)\//)?.[1];

export const featureBoundaryRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { checkDynamicImports: { type: 'boolean' }, checkPorts: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      port: 'Accede a «{{target}}» por su puerto de aplicación.',
      dependency:
        '«{{from}}» no depende de «{{to}}» en scripts/feature-dependency-matrix.json. Agrega la dependencia allí o resuelve la necesidad en otra capa.',
      public: '{{target}}: Importa «{{to}}» por su superficie pública: {{paths}}.',
    },
  },
  create(context) {
    const importer = path.relative(ROOT, context.filename).split(path.sep).join('/');
    const from = featureOf(importer);
    const check = source => {
      if (!source || typeof source.value !== 'string') return;
      const raw = source.value;
      const target = raw.startsWith('.')
        ? path.posix
            .normalize(path.posix.join(path.posix.dirname(importer), raw))
            .replace(/^src\/features\//, '@/features/')
        : raw;
      const service = (
        raw.startsWith('.')
          ? path.posix.normalize(path.posix.join(path.posix.dirname(importer), raw))
          : raw.replace(/^@\//, 'src/')
      ).replace(/\.[cm]?[jt]sx?$/, '');
      if (
        context.options[0]?.checkPorts &&
        [
          'src/services/repositories/ClinicalDocumentRepository',
          'src/services/integrations/censusEmailService',
        ].includes(service)
      )
        context.report({ node: source, messageId: 'port', data: { target: raw } });
      if (!from || !target.startsWith('@/features/')) return;
      const to = target.slice('@/features/'.length).split('/')[0];
      if (to === from) return;
      const allowed = FEATURE_MATRIX.features[from]?.includes(to);
      if (allowed && featurePublicPaths(to).includes(target)) return;
      context.report({
        node: source,
        messageId: allowed ? 'public' : 'dependency',
        data: { from, to, target: raw, paths: featurePublicPaths(to).join(', ') },
      });
    };
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => {
        if (context.options[0]?.checkDynamicImports !== false) check(node.source);
      },
      TSImportEqualsDeclaration: node => check(node.moduleReference.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(node.arguments[0]);
        }
      },
    };
  },
};
