#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { countExplicitAny } from './explicitAnySupport.mjs';
import { findTestModifiers } from './testGovernanceSupport.mjs';
import { buildReleaseConfidenceMatrixReport } from './releaseConfidenceMatrixSupport.mjs';
import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';
import { getGitReportState } from './gitReportState.mjs';
import { analyzeFolderDependencies } from './check-folder-dependencies.mjs';
import {
  measureAgentRules,
  measureExceptionBooks,
  measureModuleGraph,
  measureNpmScripts,
} from './lib/evaluationMetrics.mjs';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const TEST_ROOT = path.join(SRC_ROOT, 'tests');
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'quality-metrics.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'quality-metrics.md');
const MODULE_ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'module-size-allowlist.json');
const HOOK_CONTROLLERS_DIR = path.join(SRC_ROOT, 'hooks', 'controllers');
const FEATURE_CENSUS_CONTROLLERS_DIR = path.join(SRC_ROOT, 'features', 'census', 'controllers');
const LOGGER_CONSOLE_SINK_PATH = 'src/services/utils/loggerService.ts';

// Size the quality evaluations call large, below the 600-line cap of check:module-size.
const LARGE_MODULE_LINES = 400;
const UNKNOWN_CAST_PATTERN = /\bas unknown as\b/g;
const UNKNOWN_CAST_TO_DAILY_RECORD_PATTERN = /\bas unknown as DailyRecord\b/g;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const IMPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;

const ALLOWED_SKIP_FILES = new Set(['src/tests/security/firestore-rules.test.ts']);
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
    importPrefix: '@/features/clinical-documents/',
    allowBypass: file =>
      file.startsWith('src/features/clinical-documents/') || file.startsWith('src/tests/'),
  },
];
const DEPRECATED_IMPORTS = [
  {
    importPath: '@/shared/controllerResult',
    allowBypass: file => file === 'src/shared/controllerResult.ts' || file.startsWith('src/tests/'),
  },
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

// Collect the source inventory once per CLI run; metric-specific filters stay unchanged.
const sourceFiles = walkFiles(SRC_ROOT);

const countLines = text => (text.length === 0 ? 0 : text.split('\n').length);

const isTestFile = relative =>
  relative.includes('/tests/') || TEST_FILE_PATTERN.test(relative) || relative.includes('.spec.');

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
  const files = sourceFiles.filter(filePath => {
    const extension = path.extname(filePath);
    if (!SOURCE_EXTENSIONS.has(extension)) return false;
    if (filePath.endsWith('.d.ts')) return false;
    const relative = toPosix(path.relative(ROOT, filePath));
    return !relative.includes('.stories.') && !relative.includes('/tests/');
  });

  const byZone = new Map();
  let totalLines = 0;
  let largeModuleCount = 0;

  for (const filePath of files) {
    const relative = toPosix(path.relative(ROOT, filePath));
    const source = fs.readFileSync(filePath, 'utf8');
    const lineCount = countLines(source);
    totalLines += lineCount;
    if (lineCount > LARGE_MODULE_LINES) largeModuleCount += 1;

    const zone = relative.replace(/^src\//, '').split('/')[0] || 'unknown';
    byZone.set(zone, (byZone.get(zone) || 0) + 1);
  }

  const zones = [...byZone.entries()]
    .map(([zone, fileCount]) => ({ zone, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);

  return {
    fileCount: files.length,
    lineCount: totalLines,
    largeModuleLines: LARGE_MODULE_LINES,
    largeModuleCount,
    zones,
  };
};

const getModuleSizeMetrics = () => {
  const allowlist = safeReadJson(MODULE_ALLOWLIST_PATH) || {};
  const globalMax = typeof allowlist.globalMax === 'number' ? allowlist.globalMax : 600;
  const perFileAllowlist =
    allowlist.allowlist && typeof allowlist.allowlist === 'object' ? allowlist.allowlist : {};
  const allowlistEntries = Object.entries(perFileAllowlist).filter(
    ([, limit]) => typeof limit === 'number' && limit > globalMax
  );

  const files = sourceFiles.filter(filePath => {
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

/** The folder rule's own analysis: unlisted upward relations are violations. */
const getFolderDependencyDebtMetrics = () => {
  const analysis = analyzeFolderDependencies(ROOT);
  if (analysis.problems.length > 0) return { violations: analysis.problems.length, listed: 0 };
  return {
    violations:
      analysis.unlisted.length +
      analysis.stale.length +
      analysis.dataUnlisted.length +
      analysis.dataStale.length,
    listed:
      analysis.upward.length -
      analysis.unlisted.length +
      analysis.dataReads.length -
      analysis.dataUnlisted.length,
  };
};

const getTestMetrics = () => {
  const testFiles = walkFiles(TEST_ROOT).filter(filePath => TEST_FILE_PATTERN.test(filePath));

  let skipCount = 0;
  let onlyCount = 0;
  // Informative only: flake risk is measured from test execution (system-confidence).
  const clockSignalFilePaths = [];
  let megatestFilesOver500 = 0;

  for (const filePath of testFiles) {
    const relative = toPosix(path.relative(ROOT, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    const lineCount = countLines(content);
    if (lineCount > 500) {
      megatestFilesOver500 += 1;
    }

    const modifiers = findTestModifiers(relative, content);
    const skipMatches = modifiers.filter(modifier => modifier.rule === 'skip').length;
    if (!ALLOWED_SKIP_FILES.has(relative)) {
      skipCount += skipMatches;
    }

    onlyCount += modifiers.filter(modifier => modifier.rule === 'only').length;

    const hasNonDeterministicSignals =
      /Math\.random\s*\(/.test(content) ||
      /Date\.now\s*\(/.test(content) ||
      /new\s+Date\s*\(\s*\)/.test(content) ||
      /setTimeout\s*\(/.test(content) ||
      /setInterval\s*\(/.test(content);

    const hasFakeTimerControls =
      /vi\.useFakeTimers\s*\(/.test(content) || /jest\.useFakeTimers\s*\(/.test(content);
    const explicitlyMarkedFlakeSafe = /@flake-safe/.test(content);

    if (hasNonDeterministicSignals && !hasFakeTimerControls && !explicitlyMarkedFlakeSafe) {
      clockSignalFilePaths.push(relative);
    }
  }

  return {
    testFileCount: testFiles.length,
    skippedMarkers: skipCount,
    onlyMarkers: onlyCount,
    clockSignalFiles: clockSignalFilePaths.length,
    clockSignalFilePaths,
    megatestFilesOver500,
  };
};

const getTypeSafetySignals = () => {
  const files = sourceFiles.filter(filePath => {
    const extension = path.extname(filePath);
    return extension === '.ts' || extension === '.tsx';
  });

  let explicitAnyCount = 0;
  let explicitAnySourceCount = 0;
  let explicitAnyTestCount = 0;
  let unknownCastSourceCount = 0;
  let unknownCastTestCount = 0;
  let unknownCastToDailyRecordTestCount = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const count = countExplicitAny(content, filePath);
    const unknownCasts = content.match(UNKNOWN_CAST_PATTERN)?.length ?? 0;
    explicitAnyCount += count;

    const relative = toPosix(path.relative(ROOT, filePath));
    const isTest =
      relative.includes('/tests/') ||
      TEST_FILE_PATTERN.test(relative) ||
      relative.includes('.spec.');

    if (isTest) {
      explicitAnyTestCount += count;
      unknownCastTestCount += unknownCasts;
      unknownCastToDailyRecordTestCount +=
        content.match(UNKNOWN_CAST_TO_DAILY_RECORD_PATTERN)?.length ?? 0;
    } else {
      explicitAnySourceCount += count;
      unknownCastSourceCount += unknownCasts;
    }
  }

  return {
    explicitAnyCount,
    explicitAnySourceCount,
    explicitAnyTestCount,
    unknownCastSourceCount,
    unknownCastTestCount,
    unknownCastToDailyRecordTestCount,
  };
};

const getConvergenceSignals = () => {
  const featureMatrix = safeReadJson(path.join(ROOT, 'scripts', 'feature-dependency-matrix.json'));
  const publicModulesByFeature = featureMatrix?.publicModulesByFeature || {};
  const featurePublicModules = Object.fromEntries(
    FEATURE_PUBLIC_BOUNDARIES.map(boundary => {
      const feature = boundary.importPrefix.split('/')[2];
      return [
        feature,
        new Set([
          `@/features/${feature}`,
          `@/features/${feature}/index`,
          `@/features/${feature}/public`,
          ...(publicModulesByFeature[feature] || []),
        ]),
      ];
    })
  );
  const files = sourceFiles.filter(filePath => {
    const extension = path.extname(filePath);
    if (!SOURCE_EXTENSIONS.has(extension)) return false;
    if (filePath.endsWith('.d.ts')) return false;
    return true;
  });

  let accidentalCopies = 0;
  let featureBoundaryViolations = 0;
  let deprecatedShimImports = 0;
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
        return !featurePublicModules[boundary.importPrefix.split('/')[2]].has(importPath);
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
  }

  const getSourceBasenameSet = dirPath => {
    if (!fs.existsSync(dirPath)) {
      return new Set();
    }

    return new Set(
      fs
        .readdirSync(dirPath, { withFileTypes: true })
        .filter(
          entry =>
            entry.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))
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
  evaluation: {
    ...measureModuleGraph(ROOT),
    npmScripts: measureNpmScripts(ROOT),
    agentRules: measureAgentRules(ROOT),
    exceptionBooks: measureExceptionBooks(ROOT),
  },
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

/** A figure the report could not read is "not measured", never zero. */
const shown = value => (value === null || value === undefined ? 'not measured' : value);

const evaluationMarkdown = ({
  unusedProductionExports: unused,
  singleImporterModules: single,
  npmScripts,
  agentRules,
  exceptionBooks: books,
}) => [
  '## Evaluation Figures',
  '',
  `- Production exports no production module imports: ${unused.total} (${unused.values} values, ${unused.types} types; ${unused.valuesUsedInOwnFile} values used in their own file)`,
  `- Production modules with a single production importer: ${single.count} (${single.upTo60Lines} of them up to 60 lines)`,
  `- npm scripts: ${
    npmScripts
      ? `${npmScripts.total} (${Object.entries(npmScripts.byPrefix)
          .map(([prefix, count]) => `${prefix} ${count}`)
          .join(', ')})`
      : shown(null)
  }`,
  `- AGENTS.md rules: ${shown(agentRules?.rules)}; naming **[docs]**: ${shown(agentRules?.withDocs)}; **[docs]** alone: ${shown(agentRules?.docsOnly)}; size: ${shown(agentRules?.bytes)} bytes`,
  `- Exception books: unknown-cast ceilings ${shown(books.unknownCastCeilings)}, unchecked-index baseline ${shown(books.uncheckedIndexBaseline)}, pending raw session reads ${shown(books.sessionRawReadPending)}, unreachable modules retained ${shown(books.unreachableRetainedFiles)}`,
  '',
];

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
  `- Modules over ${metrics.source.largeModuleLines} lines: ${metrics.source.largeModuleCount}`,
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
  `- Upward relations listed in the exceptions book: ${metrics.folderDependencyDebt.listed}`,
  '',
  '## Tests',
  '',
  `- Test files: ${metrics.tests.testFileCount}`,
  `- Forbidden .skip markers: ${metrics.tests.skippedMarkers}`,
  `- Forbidden .only markers: ${metrics.tests.onlyMarkers}`,
  `- Test files with clock or timer calls and no fake timers (informative, not flake risk): ${metrics.tests.clockSignalFiles}`,
  ...(metrics.tests.clockSignalFilePaths.length > 0
    ? metrics.tests.clockSignalFilePaths.map(filePath => `  - ${filePath}`)
    : []),
  `- Megatests >500 lines: ${metrics.tests.megatestFilesOver500}`,
  '',
  '## Type Safety Signals',
  '',
  `- Explicit any occurrences (total): ${metrics.typeSafety.explicitAnyCount}`,
  `- Explicit any in source (non-test): ${metrics.typeSafety.explicitAnySourceCount}`,
  `- Explicit any in tests: ${metrics.typeSafety.explicitAnyTestCount}`,
  `- \`as unknown as\` in source (non-test): ${metrics.typeSafety.unknownCastSourceCount}`,
  `- \`as unknown as\` in tests: ${metrics.typeSafety.unknownCastTestCount}`,
  `- \`as unknown as DailyRecord\` in tests: ${metrics.typeSafety.unknownCastToDailyRecordTestCount}`,
  '',
  '## Convergence Signals',
  '',
  `- Accidental copy files in src: ${metrics.convergence.accidentalCopies}`,
  `- Feature public API boundary violations: ${metrics.convergence.featureBoundaryViolations}`,
  `- Deprecated shim imports in source: ${metrics.convergence.deprecatedShimImports}`,
  `- Census controller ownership drift: ${metrics.convergence.controllerOwnershipDrift}`,
  `- Raw console warn/error outside structured sink: ${metrics.convergence.rawConsoleOutsideStructuredSink}`,
  '',
  ...evaluationMarkdown(metrics.evaluation),
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
