#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { buildReleaseConfidenceMatrixReport } from './releaseConfidenceMatrixSupport.mjs';
import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';
import { getGitReportState } from './gitReportState.mjs';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const TEST_ROOT = path.join(SRC_ROOT, 'tests');
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'quality-metrics.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'quality-metrics.md');
const MODULE_ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'module-size-allowlist.json');
const FOLDER_MATRIX_PATH = path.join(ROOT, 'scripts', 'folder-dependency-matrix.json');
const FLAKY_QUARANTINE_PATH = path.join(ROOT, 'scripts', 'config', 'flaky-quarantine.json');
const TEST_FAILURE_CATALOG_PATH = path.join(ROOT, 'scripts', 'config', 'test-failure-catalog.json');
const HOOK_CONTROLLERS_DIR = path.join(SRC_ROOT, 'hooks', 'controllers');
const FEATURE_CENSUS_CONTROLLERS_DIR = path.join(SRC_ROOT, 'features', 'census', 'controllers');
const LOGGER_CONSOLE_SINK_PATH = 'src/services/utils/loggerConsoleSink.ts';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const IMPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;

const ALLOWED_SKIP_FILES = new Set(['src/tests/security/firestore-rules.test.ts']);
const GOVERNED_FEATURE_PUBLIC_IMPORTS = new Set([
  'src/views/LazyViews.ts|@/features/census/census-view',
  'src/components/layout/app-content/AppContentOverlays.tsx|@/features/census/public-components',
]);
const FEATURE_PUBLIC_BOUNDARIES = [
  {
    importPrefix: '@/features/census/',
    allowBypass: file =>
      file.startsWith('src/features/census/') ||
      file === 'src/application/census/public.ts' ||
      file.startsWith('src/tests/') ||
      file.startsWith('src/hooks/controllers/'),
  },
  {
    importPrefix: '@/features/handoff/',
    allowBypass: file => file.startsWith('src/features/handoff/') || file.startsWith('src/tests/'),
  },
  {
    importPrefix: '@/features/transfers/',
    allowBypass: file =>
      file.startsWith('src/features/transfers/') || file.startsWith('src/tests/'),
  },
  {
    importPrefix: '@/features/clinical-documents/',
    allowBypass: file =>
      file.startsWith('src/features/clinical-documents/') ||
      file.startsWith('src/application/clinical-documents/') ||
      file === 'src/application/ports/clinicalDocumentPort.ts' ||
      file.startsWith('src/shared/clinical-documents/') ||
      file.startsWith('src/tests/'),
  },
];
const DEPRECATED_IMPORTS = [
  {
    importPath: '@/shared/census/patientContracts',
    allowBypass: file => file === 'src/shared/census/patientContracts.ts' || file.startsWith('src/tests/'),
  },
  {
    importPath: '@/shared/controllerResult',
    allowBypass: file => file === 'src/shared/controllerResult.ts' || file.startsWith('src/tests/'),
  },
  {
    importPath: '@/hooks/contracts/dailyRecordHookContracts',
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

const toPosix = value => value.split(path.sep).join('/');

const safeReadJson = filePath => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const walkFiles = dirPath => {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

const countLines = text => (text.length === 0 ? 0 : text.split('\n').length);

const isTestFile = relative =>
  relative.includes('/tests/') || TEST_FILE_PATTERN.test(relative) || relative.includes('.spec.');

const isGovernedCensusControllerShim = ({ importer, imported, importPath, source }) => {
  if (!importer.startsWith('src/hooks/controllers/')) return false;
  if (!imported.startsWith('src/features/census/controllers/')) return false;
  if (!importPath.startsWith('@/features/census/controllers/')) return false;

  const importedModule = path.basename(imported, path.extname(imported));
  const expectedSource = `export * from '@/features/census/controllers/${importedModule}';`;
  return source.trim() === expectedSource;
};

const isGovernedCensusControllerShimSource = ({ relative, source }) => {
  if (!relative.startsWith('src/hooks/controllers/')) return false;
  return /^export \* from '@\/features\/census\/controllers\/[^']+';$/u.test(source.trim());
};

const getStaticImportPaths = source => {
  const importPaths = [];
  IMPORT_REGEX.lastIndex = 0;

  let match;
  while ((match = IMPORT_REGEX.exec(source)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath) {
      importPaths.push(importPath);
    }
  }

  return importPaths;
};

const getSourceMetrics = () => {
  const files = walkFiles(SRC_ROOT).filter(filePath => {
    const extension = path.extname(filePath);
    if (!SOURCE_EXTENSIONS.has(extension)) return false;
    if (filePath.endsWith('.d.ts')) return false;
    const relative = toPosix(path.relative(ROOT, filePath));
    return !relative.includes('.stories.') && !relative.includes('/tests/');
  });

  const byZone = new Map();
  let totalLines = 0;

  for (const filePath of files) {
    const relative = toPosix(path.relative(ROOT, filePath));
    const source = fs.readFileSync(filePath, 'utf8');
    totalLines += countLines(source);

    const zone = relative.replace(/^src\//, '').split('/')[0] || 'unknown';
    byZone.set(zone, (byZone.get(zone) || 0) + 1);
  }

  const zones = [...byZone.entries()]
    .map(([zone, fileCount]) => ({ zone, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);

  return {
    fileCount: files.length,
    lineCount: totalLines,
    zones,
  };
};

const getModuleSizeMetrics = () => {
  const allowlist = safeReadJson(MODULE_ALLOWLIST_PATH) || {};
  const globalMax = typeof allowlist.globalMax === 'number' ? allowlist.globalMax : 400;
  const perFileAllowlist =
    allowlist.allowlist && typeof allowlist.allowlist === 'object' ? allowlist.allowlist : {};
  const allowlistEntries = Object.entries(perFileAllowlist).filter(
    ([, limit]) => typeof limit === 'number' && limit > globalMax
  );

  const files = walkFiles(SRC_ROOT).filter(filePath => {
    const extension = path.extname(filePath);
    if (!['.ts', '.tsx'].includes(extension)) return false;
    if (filePath.endsWith('.d.ts')) return false;
    const relative = toPosix(path.relative(ROOT, filePath));
    return (
      !relative.includes('/tests/') && !relative.includes('.test.') && !relative.includes('.spec.')
    );
  });

  const violations = [];

  for (const filePath of files) {
    const relative = toPosix(path.relative(ROOT, filePath));
    const lineCount = countLines(fs.readFileSync(filePath, 'utf8'));
    const fileLimit =
      typeof perFileAllowlist[relative] === 'number' ? perFileAllowlist[relative] : globalMax;

    if (lineCount > fileLimit) {
      violations.push({
        file: relative,
        lines: lineCount,
        limit: fileLimit,
      });
    }
  }

  violations.sort((a, b) => b.lines - a.lines);

  return {
    globalMax,
    allowlistHotspots: allowlistEntries.length,
    oversizedCount: violations.length,
    topOversized: violations.slice(0, 10),
  };
};

const resolveImport = (importerFilePath, importPath) => {
  if (!importPath.startsWith('@/') && !importPath.startsWith('.')) return null;

  const basePath = importPath.startsWith('@/')
    ? path.join(SRC_ROOT, importPath.slice(2))
    : path.resolve(path.dirname(importerFilePath), importPath);

  const candidates = [];
  if (path.extname(basePath)) {
    candidates.push(basePath);
  } else {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
      candidates.push(path.join(basePath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return null;
};

const getFolderDependencyDebtMetrics = () => {
  const matrix = safeReadJson(FOLDER_MATRIX_PATH);
  if (!matrix || !matrix.zones || typeof matrix.zones !== 'object') {
    return {
      violations: 0,
      topZonePairs: [],
    };
  }

  const knownZones = new Set(Object.keys(matrix.zones));
  const files = walkFiles(SRC_ROOT).filter(filePath => {
    const extension = path.extname(filePath);
    if (!SOURCE_EXTENSIONS.has(extension)) return false;
    if (filePath.endsWith('.d.ts')) return false;
    const relative = toPosix(path.relative(ROOT, filePath));
    return (
      !relative.includes('/tests/') && !relative.includes('.test.') && !relative.includes('.spec.')
    );
  });

  const getZone = relativePath => {
    const zone = relativePath.replace(/^src\//, '').split('/')[0];
    return knownZones.has(zone) ? zone : null;
  };

  const uniqueViolations = new Map();
  const pairCounts = new Map();

  for (const filePath of files) {
    const importer = toPosix(path.relative(ROOT, filePath));
    const importerZone = getZone(importer);
    if (!importerZone) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    IMPORT_REGEX.lastIndex = 0;
    let match;

    while ((match = IMPORT_REGEX.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) continue;

      const resolved = resolveImport(filePath, importPath);
      if (!resolved) continue;

      const imported = toPosix(path.relative(ROOT, resolved));
      const importedZone = getZone(imported);
      if (!importedZone || importedZone === importerZone) continue;

      if (
        isGovernedCensusControllerShim({
          importer,
          imported,
          importPath,
          source: content,
        })
      ) {
        continue;
      }

      const allowed = matrix.zones[importerZone]?.allowedDependencies || [];
      if (allowed.includes(importedZone)) continue;

      const key = `${importer}|${importPath}|${imported}`;
      uniqueViolations.set(key, true);

      const pair = `${importerZone}->${importedZone}`;
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
  }

  const topZonePairs = [...pairCounts.entries()]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    violations: uniqueViolations.size,
    topZonePairs,
  };
};

const getTestMetrics = () => {
  const testFiles = walkFiles(TEST_ROOT).filter(filePath => TEST_FILE_PATTERN.test(filePath));
  const flakyQuarantine = safeReadJson(FLAKY_QUARANTINE_PATH);
  const failureCatalog = safeReadJson(TEST_FAILURE_CATALOG_PATH);
  const quarantinedFiles = new Set(
    Array.isArray(flakyQuarantine?.quarantined)
      ? flakyQuarantine.quarantined
          .map(entry => (typeof entry?.file === 'string' ? toPosix(entry.file.trim()) : ''))
          .filter(Boolean)
      : []
  );

  let skipCount = 0;
  let onlyCount = 0;
  let flakeRiskFiles = 0;
  const flakeRiskFilePaths = [];
  let megatestFilesOver500 = 0;

  const skipPattern = /\b(?:it|test|describe)\.skip\s*\(/g;
  const onlyPattern = /\b(?:it|test|describe)\.only\s*\(/g;

  for (const filePath of testFiles) {
    const relative = toPosix(path.relative(ROOT, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    const lineCount = countLines(content);
    if (lineCount > 500) {
      megatestFilesOver500 += 1;
    }

    const skipMatches = content.match(skipPattern)?.length || 0;
    if (!ALLOWED_SKIP_FILES.has(relative)) {
      skipCount += skipMatches;
    }

    onlyCount += content.match(onlyPattern)?.length || 0;

    const hasNonDeterministicSignals =
      /Math\.random\s*\(/.test(content) ||
      /Date\.now\s*\(/.test(content) ||
      /new\s+Date\s*\(\s*\)/.test(content) ||
      /setTimeout\s*\(/.test(content) ||
      /setInterval\s*\(/.test(content);

    const hasFakeTimerControls =
      /vi\.useFakeTimers\s*\(/.test(content) || /jest\.useFakeTimers\s*\(/.test(content);
    const explicitlyMarkedFlakeSafe = /@flake-safe/.test(content);
    const isQuarantined = quarantinedFiles.has(relative);

    if (
      hasNonDeterministicSignals &&
      !hasFakeTimerControls &&
      !explicitlyMarkedFlakeSafe &&
      !isQuarantined
    ) {
      flakeRiskFiles += 1;
      flakeRiskFilePaths.push(relative);
    }
  }

  return {
    testFileCount: testFiles.length,
    skippedMarkers: skipCount,
    onlyMarkers: onlyCount,
    flakeRiskFiles,
    flakeRiskFilePaths,
    megatestFilesOver500,
    quarantinedFiles: quarantinedFiles.size,
    knownFailureEntries: Array.isArray(failureCatalog?.entries) ? failureCatalog.entries.length : 0,
    openKnownFailureEntries: Array.isArray(failureCatalog?.entries)
      ? failureCatalog.entries.filter(entry => entry?.status !== 'fixed').length
      : 0,
  };
};

const getTypeSafetySignals = () => {
  const files = walkFiles(SRC_ROOT).filter(filePath => {
    const extension = path.extname(filePath);
    return extension === '.ts' || extension === '.tsx';
  });

  let explicitAnyCount = 0;
  let explicitAnySourceCount = 0;
  let explicitAnyTestCount = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const count =
      (content.match(/:\s*any\b/g)?.length || 0) + (content.match(/\bas\s+any\b/g)?.length || 0);
    explicitAnyCount += count;

    const relative = toPosix(path.relative(ROOT, filePath));
    const isTest =
      relative.includes('/tests/') ||
      TEST_FILE_PATTERN.test(relative) ||
      relative.includes('.spec.');

    if (isTest) {
      explicitAnyTestCount += count;
    } else {
      explicitAnySourceCount += count;
    }
  }

  return { explicitAnyCount, explicitAnySourceCount, explicitAnyTestCount };
};

const getConvergenceSignals = () => {
  const files = walkFiles(SRC_ROOT).filter(filePath => {
    const extension = path.extname(filePath);
    if (!SOURCE_EXTENSIONS.has(extension)) return false;
    if (filePath.endsWith('.d.ts')) return false;
    return true;
  });

  let accidentalCopies = 0;
  let featureBoundaryViolations = 0;
  let deprecatedShimImports = 0;
  let dailyRecordBoundaryViolations = 0;
  let governedCompatibilityShims = 0;
  let rawConsoleOutsideStructuredSink = 0;

  for (const filePath of files) {
    const relative = toPosix(path.relative(ROOT, filePath));
    const source = fs.readFileSync(filePath, 'utf8');

    if (/(^|\/)[^/]+ 2\.(ts|tsx|js|jsx|md)$/.test(relative)) {
      accidentalCopies += 1;
    }

    if (isTestFile(relative)) {
      continue;
    }

    if (isGovernedCensusControllerShimSource({ relative, source })) {
      governedCompatibilityShims += 1;
      continue;
    }

    const hasRawConsoleWarnOrError =
      source.includes('console.warn(') || source.includes('console.error(');
    if (relative !== LOGGER_CONSOLE_SINK_PATH && hasRawConsoleWarnOrError) {
      rawConsoleOutsideStructuredSink += 1;
    }

    const importPaths = getStaticImportPaths(source);

    for (const boundary of FEATURE_PUBLIC_BOUNDARIES) {
      if (boundary.allowBypass(relative)) {
        continue;
      }

      const hasUngovernedFeatureImport = importPaths.some(importPath => {
        if (!importPath.startsWith(boundary.importPrefix)) {
          return false;
        }

        return !GOVERNED_FEATURE_PUBLIC_IMPORTS.has(`${relative}|${importPath}`);
      });

      if (hasUngovernedFeatureImport) {
        featureBoundaryViolations += 1;
      }
    }

    for (const deprecatedImport of DEPRECATED_IMPORTS) {
      if (deprecatedImport.allowBypass(relative) || !source.includes(deprecatedImport.importPath)) {
        continue;
      }
      deprecatedShimImports += 1;
    }

    const importsDailyRecordRoot = DAILY_RECORD_ROOT_IMPORTS.some(importPath =>
      source.includes(importPath)
    );
    if (!importsDailyRecordRoot) {
      continue;
    }

    const isApplicationBypass =
      relative === 'src/application/shared/dailyRecordContracts.ts' ||
      relative === 'src/application/shared/dailyRecordBedContracts.ts' ||
      relative === 'src/application/shared/dailyRecordCoreContracts.ts' ||
      relative === 'src/application/shared/dailyRecordMedicalContracts.ts' ||
      relative === 'src/application/shared/dailyRecordStaffContracts.ts' ||
      isTestFile(relative);
    const isHookBypass =
      relative === 'src/hooks/contracts/dailyRecordHookContracts.ts' || isTestFile(relative);
    const isServiceBypass =
      relative === 'src/services/contracts/dailyRecordServiceContracts.ts' ||
      relative.startsWith('src/services/repositories/') ||
      relative.startsWith('src/services/storage/') ||
      isTestFile(relative);

    if (relative.startsWith('src/application/') && !isApplicationBypass) {
      dailyRecordBoundaryViolations += 1;
    }

    if (relative.startsWith('src/hooks/') && !isHookBypass) {
      dailyRecordBoundaryViolations += 1;
    }

    if (relative.startsWith('src/services/') && !isServiceBypass) {
      dailyRecordBoundaryViolations += 1;
    }
  }

  const getSourceBasenameSet = dirPath => {
    if (!fs.existsSync(dirPath)) {
      return new Set();
    }

    return new Set(
      fs
        .readdirSync(dirPath, { withFileTypes: true })
        .filter(
          entry => entry.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))
        )
        .map(entry => entry.name)
    );
  };

  let controllerOwnershipDrift = 0;
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
      controllerOwnershipDrift += 1;
    }

    if (featureSource.includes(forbiddenFeatureBackImport)) {
      controllerOwnershipDrift += 1;
    }
  }

  return {
    accidentalCopies,
    featureBoundaryViolations,
    deprecatedShimImports,
    dailyRecordBoundaryViolations,
    governedCompatibilityShims,
    controllerOwnershipDrift,
    rawConsoleOutsideStructuredSink,
  };
};

const generatedAt = new Date().toISOString();
const releaseConfidenceMatrix = buildReleaseConfidenceMatrixReport(ROOT);
const gitState = getGitReportState(ROOT);
const gitSha = gitState.gitSha;
const metrics = {
  generatedAt,
  gitSha,
  gitDirty: gitState.gitDirty,
  generatedFor: buildEvidenceProvenance({
    root: ROOT,
    reportId: 'quality-metrics',
    gitState,
  }),
  source: getSourceMetrics(),
  moduleSize: getModuleSizeMetrics(),
  folderDependencyDebt: getFolderDependencyDebtMetrics(),
  tests: getTestMetrics(),
  typeSafety: getTypeSafetySignals(),
  convergence: getConvergenceSignals(),
  releaseConfidence: {
    overall: releaseConfidenceMatrix.overall,
    areaCount: releaseConfidenceMatrix.counts.areaCount,
    mappedCoverageZones: releaseConfidenceMatrix.coverageZones.mapped,
    totalCoverageZones: releaseConfidenceMatrix.counts.criticalCoverageZones,
    mappedSmokeScenarios: releaseConfidenceMatrix.smokeScenarios.mapped,
    totalSmokeScenarios: releaseConfidenceMatrix.counts.smokeScenarios,
    mappedFlowBudgets: releaseConfidenceMatrix.flowBudgets.mapped,
    totalFlowBudgets: releaseConfidenceMatrix.counts.flowBudgets,
    mappedBlockingSteps: releaseConfidenceMatrix.blockingSteps.mapped,
    totalBlockingSteps: releaseConfidenceMatrix.counts.blockingSteps,
  },
};

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

const mdLines = [
  '# Quality Metrics Snapshot',
  '',
  `Generated at: ${metrics.generatedAt}`,
  `Commit: ${metrics.gitSha}`,
  '',
  '## Source',
  '',
  `- Files: ${metrics.source.fileCount}`,
  `- Lines: ${metrics.source.lineCount}`,
  '',
  '## Module Size',
  '',
  `- Global line limit: ${metrics.moduleSize.globalMax}`,
  `- Allowlist hotspots: ${metrics.moduleSize.allowlistHotspots}`,
  `- Oversized modules: ${metrics.moduleSize.oversizedCount}`,
  '',
  '## Folder Dependency Debt',
  '',
  `- Violations: ${metrics.folderDependencyDebt.violations}`,
  '',
  '## Tests',
  '',
  `- Test files: ${metrics.tests.testFileCount}`,
  `- Forbidden .skip markers: ${metrics.tests.skippedMarkers}`,
  `- Forbidden .only markers: ${metrics.tests.onlyMarkers}`,
  `- Flake-risk test files: ${metrics.tests.flakeRiskFiles}`,
  ...(metrics.tests.flakeRiskFilePaths.length > 0
    ? metrics.tests.flakeRiskFilePaths.map(filePath => `  - ${filePath}`)
    : []),
  `- Megatests >500 lines: ${metrics.tests.megatestFilesOver500}`,
  `- Quarantined test files: ${metrics.tests.quarantinedFiles}`,
  `- Known failure entries: ${metrics.tests.knownFailureEntries}`,
  `- Open known failure entries: ${metrics.tests.openKnownFailureEntries}`,
  '',
  '## Type Safety Signals',
  '',
  `- Explicit any occurrences (total): ${metrics.typeSafety.explicitAnyCount}`,
  `- Explicit any in source (non-test): ${metrics.typeSafety.explicitAnySourceCount}`,
  `- Explicit any in tests: ${metrics.typeSafety.explicitAnyTestCount}`,
  '',
  '## Convergence Signals',
  '',
  `- Accidental copy files in src: ${metrics.convergence.accidentalCopies}`,
  `- Governed compatibility shims in source: ${metrics.convergence.governedCompatibilityShims}`,
  `- Feature public API boundary violations: ${metrics.convergence.featureBoundaryViolations}`,
  `- Deprecated shim imports in source: ${metrics.convergence.deprecatedShimImports}`,
  `- DailyRecord root-boundary violations in source: ${metrics.convergence.dailyRecordBoundaryViolations}`,
  `- Census controller ownership drift: ${metrics.convergence.controllerOwnershipDrift}`,
  `- Raw console warn/error outside structured sink: ${metrics.convergence.rawConsoleOutsideStructuredSink}`,
  '',
  '## Release Confidence Governance',
  '',
  `- Overall: ${metrics.releaseConfidence.overall}`,
  `- Areas: ${metrics.releaseConfidence.areaCount}`,
  `- Coverage zones mapped: ${metrics.releaseConfidence.mappedCoverageZones}/${metrics.releaseConfidence.totalCoverageZones}`,
  `- Blocking steps mapped: ${metrics.releaseConfidence.mappedBlockingSteps}/${metrics.releaseConfidence.totalBlockingSteps}`,
  `- Smoke scenarios mapped: ${metrics.releaseConfidence.mappedSmokeScenarios}/${metrics.releaseConfidence.totalSmokeScenarios}`,
  `- Flow budgets mapped: ${metrics.releaseConfidence.mappedFlowBudgets}/${metrics.releaseConfidence.totalFlowBudgets}`,
  '',
];

fs.writeFileSync(MD_OUTPUT, `${mdLines.join('\n')}`, 'utf8');

console.log(
  `Quality metrics written to ${path.relative(ROOT, JSON_OUTPUT)} and ${path.relative(ROOT, MD_OUTPUT)}.`
);
