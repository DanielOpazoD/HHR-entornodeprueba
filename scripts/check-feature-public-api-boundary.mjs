#!/usr/bin/env node

/**
 * Generic feature-boundary check that protects every feature that does NOT
 * already have a dedicated check-<feature>-feature-boundary.mjs script.
 *
 * Why this exists: the codebase enforces "outside importers must go through
 * `@/features/<feature>/public` or `@/features/<feature>/index`" only for the
 * six high-traffic features that earned their own boundary script (auth,
 * census, clinical-documents, handoff, transfers, wound-care). The remaining
 * seven (admin, analytics, backup, cudyr, laboratory, reminders, whatsapp)
 * had no protection — drift back into deep imports was undetectable.
 *
 * This script reuses the existing featureBoundaryRunner so the rule is
 * identical: imports from outside the feature root are allowed only when
 * they land on the feature's public surface (`public.ts` or `index.ts`) or
 * on a path explicitly enumerated in the allowlist below (legitimate
 * exceptions like `application/<feature>/public.ts` exposing a view).
 */

import fs from 'node:fs';
import path from 'node:path';
import { runFeatureBoundaryCheck } from './lib/featureBoundaryRunner.mjs';

const ROOT = process.cwd();
const FEATURES_ROOT = path.join(ROOT, 'src', 'features');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'feature-public-api-allowlist.json');

// Features that keep a dedicated check script because they need
// configuration (extraPublicModules, allowException) the generic runner
// does not expose. Keep them out of this check so they do not run twice.
//
// Features previously listed here but with trivial 4-line dedicated scripts
// (auth, handoff, transfers, wound-care) were migrated to this generic
// check and their dedicated scripts were removed to reduce duplication.
const FEATURES_WITH_DEDICATED_CHECK = new Set(['census', 'clinical-documents']);

const allowlist = fs.existsSync(ALLOWLIST_PATH)
  ? JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
  : { exceptionsByFeature: {} };

const exceptionsByFeature = allowlist.exceptionsByFeature || {};

const featureLabel = name =>
  name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const features = fs
  .readdirSync(FEATURES_ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => !FEATURES_WITH_DEDICATED_CHECK.has(name))
  .sort();

if (features.length === 0) {
  console.log('Feature public-API boundary check has no features to evaluate.');
  process.exit(0);
}

let exitCode = 0;
for (const feature of features) {
  const exceptions = new Set(exceptionsByFeature[feature] || []);
  try {
    runFeatureBoundaryCheck({
      feature,
      label: `${featureLabel(feature)} (generic)`,
      allowException: ({ importerPath, importPath }) =>
        exceptions.has(`${importerPath} -> ${importPath}`),
    });
  } catch (error) {
    // runFeatureBoundaryCheck calls process.exit(1) on violations — anything
    // reaching this catch is a programmer error in the runner contract.
    console.error(`[feature-public-api-boundary] Unexpected failure for ${feature}:`, error);
    exitCode = 1;
  }
}

process.exit(exitCode);
