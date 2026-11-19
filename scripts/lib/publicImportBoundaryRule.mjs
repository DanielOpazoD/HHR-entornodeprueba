import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'src');
const { publicImportPatterns, publicModulesByFeature } = JSON.parse(
  fs.readFileSync(new URL('../feature-dependency-matrix.json', import.meta.url), 'utf8')
);
const extensions = ['.ts', '.tsx', '.js', '.jsx'];
export const GOVERNED_APPLICATION_PUBLIC_IMPORTS = new Set([
  '@/features/census/components/global-search/globalSearchContracts',
  '@/features/census/controllers/bedManagerGridItemsController',
  '@/features/census/controllers/bedManagerModalController',
  '@/features/census/controllers/censusEmailRecipientsController',
  '@/features/census/controllers/clinicalShiftCalendarController',
  '@/features/census/controllers/dischargeModalController',
  '@/features/census/controllers/modalFormController',
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
]);

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
      public:
        'Importa «{{target}}» por la superficie pública de «{{feature}}»: {{paths}}. Fuera de las features, si una capa general puede depender de una feature lo decide npm run check:folder-dependencies.',
    },
  },
  create(context) {
    const importer = path.relative(ROOT, context.filename).split(path.sep).join('/');
    if (['.test.', '.spec.', '.stories.'].some(marker => importer.includes(marker))) return {};
    if (importer.includes('/tests/')) return {};
    const check = node => {
      if (typeof node?.value !== 'string') return;
      const target = node.value;
      const resolved = resolve(importer, target);
      if (!resolved) return;
      const relative = path.relative(SRC, resolved).split(path.sep).join('/');
      const feature = relative.match(/^features\/([^/]+)\//)?.[1];
      if (!feature || importer.startsWith(`src/features/${feature}/`)) return;
      const publicPaths = [
        ...publicImportPatterns.map(pattern => pattern.replace('{feature}', feature)),
        ...(publicModulesByFeature[feature] ?? []),
      ];
      if (publicPaths.includes(target)) return;
      if (
        importer === 'src/application/census/public.ts' &&
        GOVERNED_APPLICATION_PUBLIC_IMPORTS.has(target)
      )
        return;
      context.report({
        node,
        messageId: 'public',
        data: { target, feature, paths: publicPaths.join(', ') },
      });
    };
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
    };
  },
};
