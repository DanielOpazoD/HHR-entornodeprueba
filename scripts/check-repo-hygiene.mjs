#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const HOOK_CONTROLLERS_DIR = path.join(root, 'src', 'hooks', 'controllers');
const FEATURE_CENSUS_CONTROLLERS_DIR = path.join(root, 'src', 'features', 'census', 'controllers');
const FEATURE_PUBLIC_BOUNDARIES = [
  {
    featurePath: 'src/features/census/',
    importPrefix: '@/features/census/',
    ruleId: 'census-public-api-boundary',
    description:
      'Code outside src/features/census must import census only from "@/features/census"; internal subpaths are reserved for the feature itself.',
    allowBypass: file =>
      file === 'src/application/census/public.ts' ||
      file.startsWith('src/features/census/') ||
      file.startsWith('src/tests/') ||
      // Storybook stories are dev-only artifacts (never bundled into the app), like
      // src/tests/ above; they may reference feature internals for isolated review.
      file.startsWith('stories/') ||
      file.startsWith('src/hooks/controllers/'),
    // Sanctioned heavy-component barrel, kept separate from @/features/census
    // so the authenticated-shell chunk does not pull CensusView through the
    // light public surface. Listed callers must load it via dynamic import.
    allowedSubpathImports: [
      {
        importPath: '@/features/census/census-view',
        callers: new Set(['src/views/LazyViews.ts', 'src/views/CensusRouteView.tsx']),
      },
      {
        importPath: '@/features/census/public-components',
        callers: new Set([
          'src/views/LazyViews.ts',
          'src/components/layout/app-content/AppContentOverlays.tsx',
        ]),
      },
    ],
  },
  {
    featurePath: 'src/features/handoff/',
    importPrefix: '@/features/handoff/',
    ruleId: 'handoff-public-api-boundary',
    description:
      'Code outside src/features/handoff must import handoff only from "@/features/handoff"; internal subpaths are reserved for the feature itself.',
    allowBypass: file => file.startsWith('src/features/handoff/') || file.startsWith('src/tests/'),
    // Narrow route-level entrypoint: exposes only the spreadsheet action and
    // keeps the full medical-handoff view out of the census route chunk.
    allowedSubpathImports: [
      {
        importPath: '@/features/handoff/medical-handoff-spreadsheet',
        callers: new Set(['src/views/CensusRouteView.tsx']),
      },
    ],
  },
  {
    featurePath: 'src/features/clinical-documents/',
    importPrefix: '@/features/clinical-documents/',
    ruleId: 'clinical-documents-public-api-boundary',
    description:
      'Code outside src/features/clinical-documents must import clinical documents only from "@/features/clinical-documents"; internal subpaths are reserved for the feature itself.',
    allowBypass: file =>
      file.startsWith('src/features/clinical-documents/') ||
      file.startsWith('src/application/clinical-documents/') ||
      file === 'src/application/ports/clinicalDocumentPort.ts' ||
      file.startsWith('src/shared/clinical-documents/') ||
      file.startsWith('src/tests/'),
  },
];

const trackedFiles = execSync('git ls-files -z', { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const EDITABLE_MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
const LOCAL_DOC_LINK_PATTERNS = [/\/Users\//, /file:\/\//];

const forbiddenPatterns = [
  {
    id: 'macos-metadata',
    description: 'macOS metadata files must not be tracked.',
    match: file => path.basename(file) === '.DS_Store',
  },
  {
    id: 'office-temp',
    description: 'Office temporary files must not be tracked.',
    match: file => /(^|\/)~\$[^/]+$/.test(file),
  },
  {
    id: 'accidental-copy-suffix',
    description: 'Accidental duplicate files with " 2" suffix must not be tracked.',
    match: file => /(^|\/)[^/]+ 2\.(ts|tsx|js|jsx|md)$/.test(file),
  },
  {
    id: 'empty-file',
    description: 'Unexpected empty files must not be tracked.',
    match: file => {
      const absolutePath = path.join(root, file);
      if (!fs.existsSync(absolutePath)) return false;
      const stat = fs.statSync(absolutePath);
      return stat.isFile() && stat.size === 0;
    },
  },
];
const DEPRECATED_IMPORTS = [
  {
    importPath: '@/shared/census/patientContracts',
    ruleId: 'deprecated-shared-patient-contracts',
    description:
      'Patient domain types must import from "@/types/domain/patient"; shared/census/patientContracts is a compatibility shim.',
    allowBypass: file => file === 'src/shared/census/patientContracts.ts' || file.startsWith('src/tests/'),
  },
  {
    importPath: '@/shared/controllerResult',
    ruleId: 'deprecated-shared-controller-result',
    description:
      'Generic controller result contracts must import from "@/shared/contracts/controllerResult"; shared/controllerResult is a compatibility shim.',
    allowBypass: file => file === 'src/shared/controllerResult.ts' || file.startsWith('src/tests/'),
  },
  {
    importPath: '@/hooks/contracts/dailyRecordHookContracts',
    ruleId: 'deprecated-daily-record-hook-contracts',
    description:
      'Hook/application code should import daily record contracts from "@/application/shared/dailyRecordContracts"; hooks/contracts/dailyRecordHookContracts is a compatibility shim.',
    allowBypass: file =>
      file === 'src/hooks/contracts/dailyRecordHookContracts.ts' || file.startsWith('src/tests/'),
  },
];
const DAILY_RECORD_ROOT_IMPORTS = [
  '@/types/domain/dailyRecord',
  '@/types/domain/dailyRecordPatch',
  '@/types/domain/dailyRecordSlices',
  '@/types/domain/dailyRecordMedicalHandoff',
];

const isDailyRecordApplicationBoundaryBypass = file =>
  file === 'src/application/shared/dailyRecordContracts.ts' ||
  file === 'src/application/shared/dailyRecordBedContracts.ts' ||
  file === 'src/application/shared/dailyRecordCoreContracts.ts' ||
  file === 'src/application/shared/dailyRecordMedicalContracts.ts' ||
  file === 'src/application/shared/dailyRecordStaffContracts.ts' ||
  file.startsWith('src/tests/');

const isDailyRecordHookBoundaryBypass = file =>
  file === 'src/hooks/contracts/dailyRecordHookContracts.ts' || file.startsWith('src/tests/');

const isDailyRecordServiceBoundaryBypass = file =>
  file === 'src/services/contracts/dailyRecordServiceContracts.ts' ||
  file.startsWith('src/services/repositories/') ||
  file.startsWith('src/services/storage/') ||
  file.startsWith('src/tests/');

const failures = [];

const getSourceBasenameSet = dirPath => {
  if (!fs.existsSync(dirPath)) {
    return new Set();
  }

  return new Set(
    fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name)))
      .map(entry => entry.name)
  );
};

const isSourceFile = file => SOURCE_EXTENSIONS.has(path.extname(file));

const isEditableMarkdownFile = file => {
  if (!EDITABLE_MARKDOWN_EXTENSIONS.has(path.extname(file))) return false;
  if (file.startsWith('docs/api/')) return false;
  if (file.startsWith('reports/')) return false;
  return true;
};

for (const file of trackedFiles) {
  const absolutePath = path.join(root, file);
  if (!fs.existsSync(absolutePath)) continue;

  for (const rule of forbiddenPatterns) {
    if (rule.match(file)) {
      failures.push({ file, rule });
    }
  }

  if (isEditableMarkdownFile(file)) {
    const markdown = fs.readFileSync(absolutePath, 'utf8');
    const hasLocalDocPath = LOCAL_DOC_LINK_PATTERNS.some(pattern => pattern.test(markdown));
    if (hasLocalDocPath) {
      failures.push({
        file,
        rule: {
          id: 'local-doc-link',
          description:
            'Editable documentation must use repo-relative links and must not contain local filesystem paths or local file URLs.',
        },
      });
    }
  }

  if (!isSourceFile(file)) {
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const boundary of FEATURE_PUBLIC_BOUNDARIES) {
    if (boundary.allowBypass(file) || !source.includes(boundary.importPrefix)) {
      continue;
    }

    // Strip occurrences of explicitly-sanctioned subpath imports for this
    // file before deciding whether a forbidden subpath remains.
    let residualSource = source;
    for (const allowance of boundary.allowedSubpathImports ?? []) {
      if (allowance.callers.has(file)) {
        residualSource = residualSource.split(allowance.importPath).join('');
      }
    }
    if (!residualSource.includes(boundary.importPrefix)) {
      continue;
    }

    failures.push({
      file,
      rule: {
        id: boundary.ruleId,
        description: boundary.description,
      },
    });
  }

  for (const deprecatedImport of DEPRECATED_IMPORTS) {
    if (deprecatedImport.allowBypass(file) || !source.includes(deprecatedImport.importPath)) {
      continue;
    }

    failures.push({
      file,
      rule: {
        id: deprecatedImport.ruleId,
        description: deprecatedImport.description,
      },
    });
  }

  const importsDailyRecordRoot = DAILY_RECORD_ROOT_IMPORTS.some(importPath => source.includes(importPath));
  if (!importsDailyRecordRoot) {
    continue;
  }

  if (file.startsWith('src/application/') && !isDailyRecordApplicationBoundaryBypass(file)) {
    failures.push({
      file,
      rule: {
        id: 'daily-record-application-contract-boundary',
        description:
          'Application code must import daily record contracts from "@/application/shared/dailyRecordContracts" instead of the root persistence types.',
      },
    });
  }

  if (file.startsWith('src/hooks/') && !isDailyRecordHookBoundaryBypass(file)) {
    failures.push({
      file,
      rule: {
        id: 'daily-record-hook-contract-boundary',
        description:
          'Hooks must import daily record contracts from "@/application/shared/dailyRecordContracts" instead of the root persistence types.',
      },
    });
  }

  if (file.startsWith('src/services/') && !isDailyRecordServiceBoundaryBypass(file)) {
    failures.push({
      file,
      rule: {
        id: 'daily-record-service-contract-boundary',
        description:
          'Non-repository services must import daily record contracts from "@/services/contracts/dailyRecordServiceContracts" instead of the root persistence types.',
      },
    });
  }
}

const hookControllerBasenames = getSourceBasenameSet(HOOK_CONTROLLERS_DIR);
const featureControllerBasenames = getSourceBasenameSet(FEATURE_CENSUS_CONTROLLERS_DIR);

for (const basename of hookControllerBasenames) {
  if (!featureControllerBasenames.has(basename)) {
    continue;
  }

  const moduleName = basename.replace(/\.[^.]+$/, '');
  const hookPath = path.join(HOOK_CONTROLLERS_DIR, basename);
  const featurePath = path.join(FEATURE_CENSUS_CONTROLLERS_DIR, basename);
  const hookSource = fs.readFileSync(hookPath, 'utf8').trim();
  const featureSource = fs.readFileSync(featurePath, 'utf8');
  const expectedHookShim = `export * from '@/features/census/controllers/${moduleName}';`;
  const forbiddenFeatureBackImport = `@/hooks/controllers/${moduleName}`;

  if (hookSource !== expectedHookShim) {
    failures.push({
      file: path.relative(root, hookPath),
      rule: {
        id: 'census-controller-owner-shim',
        description:
          'Duplicate census controller basenames in hooks/controllers must be compatibility shims that reexport the feature owner.',
      },
    });
  }

  if (featureSource.includes(forbiddenFeatureBackImport)) {
    failures.push({
      file: path.relative(root, featurePath),
      rule: {
        id: 'census-controller-owner-feature',
        description:
          'Feature census controllers must own the implementation and must not reexport back from hooks/controllers.',
      },
    });
  }
}

if (failures.length > 0) {
  console.error('\nRepository hygiene checks failed:\n');
  for (const failure of failures) {
    console.error(`- [${failure.rule.id}] ${failure.rule.description} (${failure.file})`);
  }
  process.exit(1);
}

console.log('Repository hygiene checks passed.');
