#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import istanbulCoverage from 'istanbul-lib-coverage';
import { getGitReportState } from './gitReportState.mjs';

const { createCoverageMap } = istanbulCoverage;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;
const THRESHOLDS_PATH = path.join('scripts', 'config', 'critical-coverage-thresholds.json');
const COVERAGE_FINAL_PATH = path.join('coverage', 'critical', 'coverage-final.json');

const walkFiles = dirPath => {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
};

const isSourceFile = filePath => {
  if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) return false;
  if (TEST_FILE_PATTERN.test(filePath)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  return true;
};

const toRelativePosix = (root, targetPath) =>
  path.relative(root, targetPath).split(path.sep).join('/');

const toOneDecimal = value => Number(value.toFixed(1));

const toPercent = value => `${value.toFixed(1)}%`;

const readThresholds = root => {
  const raw = fs.readFileSync(path.join(root, THRESHOLDS_PATH), 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.zones && typeof parsed.zones === 'object' ? parsed.zones : {};
};

const normalizeSourceEntries = (zoneKey, config) => {
  const configuredSources = Array.isArray(config.sources) ? config.sources : [zoneKey];
  return [...new Set(configuredSources.filter(source => typeof source === 'string' && source.trim()))];
};

const normalizeTestEntries = value => {
  const configuredTests = Array.isArray(value) ? value : [value];
  return [
    ...new Set(configuredTests.filter(test => typeof test === 'string' && test.trim())),
  ];
};

const readCoverageMap = root => {
  const coveragePath = path.join(root, COVERAGE_FINAL_PATH);
  if (!fs.existsSync(coveragePath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  return createCoverageMap(raw);
};

const listSourceFiles = (root, sourceEntries) => {
  const discovered = [];

  for (const sourceEntry of sourceEntries) {
    const absoluteEntry = path.join(root, sourceEntry);
    if (!fs.existsSync(absoluteEntry)) {
      continue;
    }

    const stat = fs.statSync(absoluteEntry);
    if (stat.isDirectory()) {
      discovered.push(...walkFiles(absoluteEntry));
      continue;
    }

    if (stat.isFile()) {
      discovered.push(absoluteEntry);
    }
  }

  return [...new Set(discovered.filter(isSourceFile).map(filePath => toRelativePosix(root, filePath)))].sort(
    (left, right) => left.localeCompare(right)
  );
};

const countTestFiles = (root, testRoot) =>
  walkFiles(path.join(root, testRoot)).filter(filePath => TEST_FILE_PATTERN.test(filePath)).length;

const createEmptyMetricSummary = () => ({
  total: 0,
  covered: 0,
  skipped: 0,
  pct: 0,
});

const createEmptyZoneCoverage = () => ({
  lines: createEmptyMetricSummary(),
  functions: createEmptyMetricSummary(),
  branches: createEmptyMetricSummary(),
  filesInCoverage: 0,
  missingFiles: [],
});

const finalizeMetricSummary = metric => ({
  total: metric.total,
  covered: metric.covered,
  skipped: metric.skipped,
  pct: metric.total === 0 ? 0 : toOneDecimal((metric.covered / metric.total) * 100),
});

const summarizeZoneCoverage = (root, coverageMap, sourceFiles) => {
  if (!coverageMap) {
    return {
      ...createEmptyZoneCoverage(),
      missingFiles: sourceFiles,
    };
  }

  const aggregate = {
    lines: createEmptyMetricSummary(),
    functions: createEmptyMetricSummary(),
    branches: createEmptyMetricSummary(),
    filesInCoverage: 0,
    missingFiles: [],
  };

  for (const relativeFile of sourceFiles) {
    const absoluteFile = path.join(root, relativeFile);
    if (!coverageMap.data[absoluteFile]) {
      aggregate.missingFiles.push(relativeFile);
      continue;
    }

    const summary = coverageMap.fileCoverageFor(absoluteFile).toSummary();
    aggregate.filesInCoverage += 1;

    for (const key of ['lines', 'functions', 'branches']) {
      aggregate[key].total += summary[key].total;
      aggregate[key].covered += summary[key].covered;
      aggregate[key].skipped += summary[key].skipped;
    }
  }

  return {
    lines: finalizeMetricSummary(aggregate.lines),
    functions: finalizeMetricSummary(aggregate.functions),
    branches: finalizeMetricSummary(aggregate.branches),
    filesInCoverage: aggregate.filesInCoverage,
    missingFiles: aggregate.missingFiles,
  };
};

const evaluateStructuralGate = zone => ({
  passed:
    zone.sourceFileCount > 0 &&
    zone.testFileCount >= zone.minTestFileCount &&
    zone.testToSourceRatio >= zone.minTestToSourceRatio,
  failures: [
    ...(zone.sourceFileCount === 0 ? ['No source files were discovered for the zone.'] : []),
    ...(zone.testFileCount < zone.minTestFileCount
      ? [
          `Test files ${zone.testFileCount} < required minimum ${zone.minTestFileCount}.`,
        ]
      : []),
    ...(zone.testToSourceRatio < zone.minTestToSourceRatio
      ? [
          `Test/source ratio ${toPercent(zone.testToSourceRatio * 100)} < required ${toPercent(zone.minTestToSourceRatio * 100)}.`,
        ]
      : []),
  ],
});

const evaluateCoverageGate = zone => {
  const baseline = zone.coverageBaseline || {};
  const failures = [];

  for (const metric of ['lines', 'functions', 'branches']) {
    const actual = zone.coverage[metric].pct;
    const minimum = Number(baseline[metric] || 0);
    if (actual < minimum) {
      failures.push(`${metric} ${toPercent(actual)} < baseline ${toPercent(minimum)}.`);
    }
  }

  if (zone.coverage.missingFiles.length > 0) {
    failures.push(`${zone.coverage.missingFiles.length} source files are missing from coverage data.`);
  }

  return {
    passed: failures.length === 0,
    failures,
  };
};

export const loadCriticalCoverageConfig = root => {
  const zones = readThresholds(root);

  return Object.entries(zones).map(([zoneKey, config]) => ({
    root: zoneKey,
    label: config.label || zoneKey,
    tests: config.tests,
    coverageTests: normalizeTestEntries(config.coverageTests ?? config.tests),
    sources: normalizeSourceEntries(zoneKey, config),
    minTestFileCount: Number(config.minTestFileCount || 0),
    minTestToSourceRatio: Number(config.minTestToSourceRatio || 0),
    coverageBaseline: {
      lines: Number(config.coverageBaseline?.lines || 0),
      functions: Number(config.coverageBaseline?.functions || 0),
      branches: Number(config.coverageBaseline?.branches || 0),
    },
  }));
};

export const getCriticalCoverageTestTargets = root => {
  const zones = loadCriticalCoverageConfig(root);
  return [...new Set(zones.flatMap(zone => zone.coverageTests))].sort((left, right) =>
    left.localeCompare(right)
  );
};

export const buildCriticalCoverageReport = root => {
  const coverageMap = readCoverageMap(root);
  const configuredZones = loadCriticalCoverageConfig(root);
  const gitState = getGitReportState(root);

  const criticalZones = configuredZones.map(zoneConfig => {
    const sourceFiles = listSourceFiles(root, zoneConfig.sources);
    const sourceFileCount = sourceFiles.length;
    const testFileCount = countTestFiles(root, zoneConfig.tests);
    const testToSourceRatio = sourceFileCount === 0 ? 0 : testFileCount / sourceFileCount;
    const coverage = summarizeZoneCoverage(root, coverageMap, sourceFiles);

    const zone = {
      ...zoneConfig,
      sourceFiles,
      sourceFileCount,
      testFileCount,
      testToSourceRatio,
      coverage,
    };

    const structuralGate = evaluateStructuralGate(zone);
    const coverageGate = evaluateCoverageGate(zone);

    return {
      ...zone,
      structuralGate,
      coverageGate,
      passed: structuralGate.passed && coverageGate.passed,
    };
  });

  const failedZones = criticalZones.filter(zone => !zone.passed);

  return {
    generatedAt: new Date().toISOString(),
    ...gitState,
    mode: 'dual-gated',
    coverageArtifact: COVERAGE_FINAL_PATH,
    coverageArtifactPresent: coverageMap !== null,
    status: failedZones.length === 0 ? 'passing' : 'failing',
    criticalZones,
    notes:
      failedZones.length === 0
        ? [
            'El gate principal usa cobertura instrumentada por zona critica.',
            'La metrica estructural se mantiene como guardrail auxiliar para detectar zonas sin masa critica de pruebas.',
          ]
        : [
            'Una o mas zonas criticas quedaron bajo baseline instrumentado o fallaron el guardrail estructural.',
            'El reporte muestra el baseline exigido y la cobertura real agregada por zona.',
          ],
  };
};

export const formatCriticalCoverageMarkdown = report => `# Critical Coverage Report

- Generated: ${report.generatedAt}
- Mode: ${report.mode}
- Coverage artifact: \`${report.coverageArtifact}\`
- Coverage artifact present: ${report.coverageArtifactPresent ? 'yes' : 'no'}
- Status: ${report.status}

## Critical Zones

| Zone | Source files | Test files | Structural | Lines | Functions | Branches | Baseline | Status |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |
${report.criticalZones
  .map(
    zone =>
      `| \`${zone.root}\` | ${zone.sourceFileCount} | ${zone.testFileCount} | ${zone.structuralGate.passed ? `PASS (${toPercent(zone.testToSourceRatio * 100)})` : `FAIL (${toPercent(zone.testToSourceRatio * 100)})`} | ${toPercent(zone.coverage.lines.pct)} | ${toPercent(zone.coverage.functions.pct)} | ${toPercent(zone.coverage.branches.pct)} | ${toPercent(zone.coverageBaseline.lines)} / ${toPercent(zone.coverageBaseline.functions)} / ${toPercent(zone.coverageBaseline.branches)} | ${zone.passed ? 'PASS' : 'FAIL'} |`
  )
  .join('\n')}

## Notes

${report.notes.map(note => `- ${note}`).join('\n')}
`;
