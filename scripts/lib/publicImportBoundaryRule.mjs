import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'src');
const { publicModulesByFeature = {}, exceptionsByFeature = {} } = JSON.parse(
  fs.readFileSync(new URL('../feature-public-api-allowlist.json', import.meta.url), 'utf8')
);
const extensions = ['.ts', '.tsx', '.js', '.jsx'];
const sharedLayers = new Set(['components', 'hooks', 'services', 'context', 'domain']);
export const GOVERNED_APPLICATION_PUBLIC_IMPORTS = new Set([
  '@/features/census/components/global-search/globalSearchContracts',
  '@/features/census/controllers/bedManagerGridItemsController',
  '@/features/census/controllers/bedManagerModalController',
  '@/features/census/controllers/censusEmailRecipientsController',
  '@/features/census/controllers/dischargeModalController',
  '@/features/census/controllers/patientMovementCreationController',
  '@/features/census/controllers/patientMovementCreationErrorPresentation',
  '@/features/census/controllers/patientMovementCreationInputController',
  '@/features/census/controllers/patientMovementMutationController',
  '@/features/census/controllers/patientMovementRuntimeController',
  '@/features/census/controllers/patientMovementSelectionController',
  '@/features/census/controllers/patientMovementUndoController',
  '@/features/census/controllers/patientMovementUndoErrorPresentation',
  '@/features/census/controllers/patientMovementUndoMutationController',
  '@/features/census/controllers/transferModalController',
  '@/features/census/types/censusAccessProfile',
]);

const isShim = (importer, target, source) =>
  importer.startsWith('src/hooks/controllers/') &&
  target.startsWith('@/features/census/controllers/') &&
  source.trim() ===
    `export * from '@/features/census/controllers/${path.basename(importer, path.extname(importer))}';`;

// Resolve only existing files, in the same order as the former source checks.
const resolve = (importer, raw) => {
  if (!raw.startsWith('@/') && !raw.startsWith('.')) return null;
  const base = raw.startsWith('@/')
    ? path.join(SRC, raw.slice(2))
    : path.resolve(ROOT, path.dirname(importer), raw);
  const candidates = path.extname(base)
    ? [base]
    : [
        ...extensions.map(extension => `${base}${extension}`),
        ...extensions.map(extension => path.join(base, `index${extension}`)),
      ];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
};

export const publicImportBoundaryRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      public: 'Importa «{{target}}» por la superficie pública de «{{feature}}».',
      shared:
        'La capa compartida no importa features directamente: «{{target}}». Usa su contrato de aplicación.',
    },
  },
  create(context) {
    const importer = path.relative(ROOT, context.filename).split(path.sep).join('/');
    if (['.test.', '.spec.', '.stories.'].some(marker => importer.includes(marker))) return {};
    const source = context.sourceCode.text;
    const genericScope = !importer.includes('/tests/');
    const sharedScope = sharedLayers.has(importer.split('/')[1]);
    const check = (node, dynamic = false) => {
      if (typeof node?.value !== 'string') return;
      const target = node.value;
      const shim = isShim(importer, target, source);
      if (sharedScope && target.startsWith('@/features/') && (dynamic || !shim)) {
        context.report({ node, messageId: 'shared', data: { target } });
        return;
      }
      if (!genericScope) return;
      const resolved = resolve(importer, target);
      if (!resolved) return;
      const relative = path.relative(SRC, resolved).split(path.sep).join('/');
      const feature = relative.match(/^features\/([^/]+)\//)?.[1];
      if (!feature || importer.startsWith(`src/features/${feature}/`)) return;
      const publicPaths = [
        `@/features/${feature}`,
        `@/features/${feature}/index`,
        `@/features/${feature}/public`,
        ...(publicModulesByFeature[feature] ?? []),
      ];
      if (publicPaths.includes(target)) return;
      if (feature === 'census') {
        if (
          shim ||
          (importer === 'src/application/census/public.ts' &&
            GOVERNED_APPLICATION_PUBLIC_IMPORTS.has(target))
        )
          return;
      } else if (
        feature !== 'clinical-documents' &&
        (exceptionsByFeature[feature] ?? []).includes(`${importer} -> ${target}`)
      )
        return;
      context.report({ node, messageId: 'public', data: { target, feature } });
    };
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source, true),
    };
  },
};
