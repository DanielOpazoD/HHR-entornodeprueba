#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { runFeatureBoundaryCheck } from './lib/featureBoundaryRunner.mjs';

// Governed exception: src/hooks/controllers/*.ts may be a trivial re-export shim
// pointing at the matching feature controller. Keeps the legacy import path alive
// without allowing arbitrary deep imports into the feature.
const GOVERNED_APPLICATION_PUBLIC_IMPORTS = new Set([
  '@/features/census/components/global-search/globalSearchContracts',
  '@/features/census/components/global-search/useGlobalPatientSearch',
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

const { publicModulesByFeature } = JSON.parse(
  fs.readFileSync(new URL('./feature-public-api-allowlist.json', import.meta.url), 'utf8')
);

const isGovernedCensusControllerShim = ({ importerPath, importPath, source }) => {
  if (!importerPath.startsWith('src/hooks/controllers/')) return false;
  if (!importPath.startsWith('@/features/census/controllers/')) return false;

  const importerModule = path.basename(importerPath, path.extname(importerPath));
  const expectedSource = `export * from '@/features/census/controllers/${importerModule}';`;
  return source.trim() === expectedSource;
};

const isGovernedCensusApplicationFacadeImport = ({ importerPath, importPath }) =>
  importerPath === 'src/application/census/public.ts' &&
  GOVERNED_APPLICATION_PUBLIC_IMPORTS.has(importPath);

runFeatureBoundaryCheck({
  feature: 'census',
  label: 'Census',
  // Heavy-component entrypoint, split out from public.ts so external static
  // importers do not pull CensusView into their chunks. Callers must use a
  // dynamic import() for this module (enforced by convention, not by lint).
  extraPublicModules: publicModulesByFeature.census,
  allowException: ctx =>
    isGovernedCensusControllerShim(ctx) || isGovernedCensusApplicationFacadeImport(ctx),
});
