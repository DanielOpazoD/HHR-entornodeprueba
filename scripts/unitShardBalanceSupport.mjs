import fs from 'node:fs';
import path from 'node:path';
import { getGitReportState } from './gitReportState.mjs';

const CONFIG_PATH = 'scripts/config/unit-shard-balance.json';
const RAW_VITEST_PROFILE_PATH = 'reports/unit-shard-vitest-profile.json';
const REPORT_PATH = 'reports/unit-shard-runtime-profile.json';

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

const normalizePath = value => String(value || '').split(path.sep).join('/').replace(/^\.\//, '');

const readText = (root, relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const readJson = (root, relativePath) => JSON.parse(readText(root, relativePath));

const safeReadJson = (root, relativePath) => {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const escapeRegex = value => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

const globToRegex = glob => {
  const normalized = normalizePath(glob);
  let output = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      output += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      output += '[^/]*';
      continue;
    }
    output += escapeRegex(char);
  }
  return new RegExp(`${output}$`);
};

const matchesAnyGlob = (file, globs = []) => {
  const normalized = normalizePath(file);
  return globs.some(glob => globToRegex(glob).test(normalized));
};

const isTestFile = file => TEST_FILE_PATTERN.test(file);

const sortFiles = files => [...new Set(files.map(normalizePath))].sort((a, b) => a.localeCompare(b));

export const loadUnitShardBalanceConfig = root => readJson(root, CONFIG_PATH);

export const discoverUnitTestFiles = (root, config = loadUnitShardBalanceConfig(root)) => {
  const testRoot = path.join(root, 'src/tests');
  const files = [];

  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isTestFile(entry.name)) continue;
      const relative = normalizePath(path.relative(root, fullPath));
      if (!matchesAnyGlob(relative, config.excludedFromUnitSuite || [])) {
        files.push(relative);
      }
    }
  };

  walk(testRoot);
  return sortFiles(files);
};

const durationHintsForFile = (file, config) => {
  for (const hint of config.durationHints || []) {
    if (matchesAnyGlob(file, hint.globs || [])) {
      return Number(hint.estimatedDurationMs || 0);
    }
  }
  return 0;
};

const fileSizeEstimate = (root, file) => {
  try {
    const stats = fs.statSync(path.join(root, file));
    return Math.min(4500, Math.max(250, Math.round(stats.size / 45)));
  } catch {
    return 500;
  }
};

export const classifyUnitTestFunctionalGroup = file => {
  if (file.includes('/clinicalSyncSimulator/') || file.includes('/sync') || file.includes('Sync')) {
    return 'storage-sync';
  }
  if (file.includes('/census') || file.includes('Census') || file.includes('dailyRecord')) {
    return 'census';
  }
  if (file.includes('/handoff') || file.includes('Handoff')) {
    return 'handoff';
  }
  if (file.includes('/audit') || file.includes('Audit') || file.includes('/observability/')) {
    return 'audit-observability';
  }
  if (file.includes('/build/') || file.includes('/security/') || file.includes('Governance')) {
    return 'governance';
  }
  if (file.includes('/repositories/') || file.includes('Repository')) {
    return 'repositories';
  }
  if (file.includes('/components/') || file.endsWith('.test.tsx')) {
    return 'ui-components';
  }
  return 'unit-general';
};

export const readVitestJsonDurations = (root, relativePath = RAW_VITEST_PROFILE_PATH) => {
  const report = safeReadJson(root, relativePath);
  const durationByFile = {};
  for (const result of report?.testResults || []) {
    if (!result?.name) continue;
    const file = normalizePath(path.relative(root, result.name));
    const duration = Number(result.endTime || 0) - Number(result.startTime || 0);
    const assertionDuration = (result.assertionResults || []).reduce(
      (sum, assertion) => sum + Number(assertion.duration || 0),
      0
    );
    durationByFile[file] = Math.max(1, Math.round(duration || assertionDuration || 0));
  }
  return durationByFile;
};

export const parseUnitShardRunArguments = args => {
  const shardArg = (args || []).find(arg => /^\d+\/\d+$/.test(String(arg || '')));
  if (!shardArg) {
    throw new Error('Expected shard argument in <index>/<count> format, for example 1/4.');
  }

  const match = shardArg.match(/^(\d+)\/(\d+)$/);
  return {
    requestedShard: {
      index: Number(match[1]),
      count: Number(match[2]),
    },
    passthroughArgs: (args || []).filter(arg => arg !== shardArg),
  };
};

export const estimateDurationByFile = ({ root = process.cwd(), files, config, measuredDurations = {} }) => {
  const durationByFile = {};
  const perFileOverheadMs = Number(config?.perFileOverheadMs || 0);
  for (const file of sortFiles(files)) {
    durationByFile[file] =
      (Number(measuredDurations[file] || 0) ||
        durationHintsForFile(file, config) ||
        fileSizeEstimate(root, file)) + perFileOverheadMs;
  }
  return durationByFile;
};

const buildAffinityItems = ({ files, config, durationByFile, lockedFiles }) => {
  const remaining = new Set(files.filter(file => !lockedFiles.has(file)));
  const items = [];

  for (const group of config.affinityGroups || []) {
    const groupFiles = sortFiles([...remaining].filter(file => matchesAnyGlob(file, group.globs || [])));
    if (groupFiles.length === 0) continue;
    for (const file of groupFiles) {
      remaining.delete(file);
    }
    items.push({
      id: group.id,
      files: groupFiles,
      estimatedDurationMs: groupFiles.reduce((sum, file) => sum + Number(durationByFile[file] || 0), 0),
    });
  }

  for (const file of sortFiles([...remaining])) {
    items.push({
      id: file,
      files: [file],
      estimatedDurationMs: Number(durationByFile[file] || 0),
    });
  }

  return items.sort(
    (a, b) => b.estimatedDurationMs - a.estimatedDurationMs || a.id.localeCompare(b.id)
  );
};

export const assignUnitTestFilesToShards = ({
  files,
  shardCount,
  durationByFile = {},
  lockedAssignments = {},
  config = {},
}) => {
  const normalizedFiles = sortFiles(files);
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    index: index + 1,
    files: [],
    estimatedDurationMs: 0,
  }));
  const lockedFiles = new Set();

  for (const [rawShard, rawFiles] of Object.entries(lockedAssignments || {})) {
    const shardIndex = Number(rawShard);
    const shard = shards[shardIndex - 1];
    if (!shard) continue;
    for (const file of sortFiles(rawFiles || [])) {
      if (!normalizedFiles.includes(file)) continue;
      shard.files.push(file);
      shard.estimatedDurationMs += Number(durationByFile[file] || 0);
      lockedFiles.add(file);
    }
  }

  const items = buildAffinityItems({
    files: normalizedFiles,
    config,
    durationByFile,
    lockedFiles,
  });

  for (const item of items) {
    const target = [...shards].sort(
      (a, b) => a.estimatedDurationMs - b.estimatedDurationMs || a.files.length - b.files.length
    )[0];
    target.files.push(...item.files);
    target.estimatedDurationMs += item.estimatedDurationMs;
  }

  for (const shard of shards) {
    shard.files = sortFiles(shard.files);
    shard.estimatedDurationMs = Math.round(shard.estimatedDurationMs);
  }

  return shards;
};

export const calculateShardSpread = shards => {
  const totals = shards.map(shard => Number(shard.estimatedDurationMs || 0));
  const slowestMs = Math.max(...totals, 0);
  const fastestMs = Math.min(...totals.filter(total => total > 0), slowestMs || 0);
  const spreadMs = Math.max(0, slowestMs - fastestMs);
  const spreadPercent = fastestMs > 0 ? Math.round((spreadMs / fastestMs) * 1000) / 10 : 0;
  return {
    fastestMs,
    slowestMs,
    spreadMs,
    spreadPercent,
  };
};

const collectDuplicateFiles = assignments => {
  const seen = new Map();
  const duplicates = new Set();
  for (const shard of assignments || []) {
    for (const file of shard.files || []) {
      const normalized = normalizePath(file);
      if (seen.has(normalized)) {
        duplicates.add(normalized);
      }
      seen.set(normalized, shard.index);
    }
  }
  return [...duplicates].sort();
};

export const collectUnitShardBalanceIssues = ({ allFiles, config, assignments }) => {
  const issues = [];
  const shardCount = Number(config?.shardCount || 0);
  const normalizedFiles = sortFiles(allFiles || []);
  const assignedFiles = sortFiles((assignments || []).flatMap(shard => shard.files || []));

  if (shardCount !== 4) {
    issues.push(`Unit shard balance must define exactly 4 shards; found ${shardCount}.`);
  }
  if ((assignments || []).length !== shardCount) {
    issues.push(`Unit shard assignment count must match shardCount (${shardCount}).`);
  }

  for (const duplicate of collectDuplicateFiles(assignments)) {
    issues.push(`${duplicate} is assigned to multiple unit shards.`);
  }

  const assignedSet = new Set(assignedFiles);
  for (const file of normalizedFiles) {
    if (!assignedSet.has(file)) {
      issues.push(`Unit test is not assigned to any shard: ${file}.`);
    }
  }

  for (const file of normalizedFiles.filter(file => matchesAnyGlob(file, config?.criticalTestGlobs || []))) {
    if (!assignedSet.has(file)) {
      issues.push(`Critical unit test is not assigned to any shard: ${file}.`);
    }
  }

  const lockedSeen = new Map();
  for (const [shard, files] of Object.entries(config?.lockedAssignments || {})) {
    for (const file of sortFiles(files || [])) {
      if (lockedSeen.has(file)) {
        issues.push(`${file} is locked to multiple unit shards (${lockedSeen.get(file)}, ${shard}).`);
      }
      lockedSeen.set(file, shard);
    }
  }

  const spread = calculateShardSpread(assignments || []);
  if (spread.spreadPercent > Number(config?.tolerancePercent || 100)) {
    issues.push(
      `Unit shard balance spread ${spread.spreadPercent}% exceeds tolerance ${config.tolerancePercent}%.`
    );
  }

  return issues;
};

const buildFunctionalGroups = ({ files, durationByFile }) => {
  const groups = new Map();
  for (const file of files) {
    const id = classifyUnitTestFunctionalGroup(file);
    const current = groups.get(id) || { id, files: 0, estimatedDurationMs: 0 };
    current.files += 1;
    current.estimatedDurationMs += Number(durationByFile[file] || 0);
    groups.set(id, current);
  }
  return [...groups.values()].sort(
    (a, b) => b.estimatedDurationMs - a.estimatedDurationMs || a.id.localeCompare(b.id)
  );
};

export const buildUnitShardRuntimeProfile = ({
  root = process.cwd(),
  files,
  config,
  durationByFile: rawDurationByFile,
}) => {
  const normalizedFiles = sortFiles(files);
  const durationByFile = estimateDurationByFile({
    root,
    files: normalizedFiles,
    config,
    measuredDurations: rawDurationByFile,
  });
  const shards = assignUnitTestFilesToShards({
    files: normalizedFiles,
    shardCount: Number(config.shardCount || 4),
    durationByFile,
    lockedAssignments: config.lockedAssignments,
    config,
  });
  const spread = calculateShardSpread(shards);
  const slowestFiles = normalizedFiles
    .map(file => ({
      file,
      estimatedDurationMs: Math.round(Number(durationByFile[file] || 0)),
      group: classifyUnitTestFunctionalGroup(file),
    }))
    .sort((a, b) => b.estimatedDurationMs - a.estimatedDurationMs || a.file.localeCompare(b.file))
    .slice(0, Number(config.slowestFileCount || 20));
  const totalDurationMs = shards.reduce((sum, shard) => sum + shard.estimatedDurationMs, 0);

  return {
    reportId: 'unit-shard-runtime-profile',
    generatedAt: new Date().toISOString(),
    ...getGitReportState(root),
    summary: {
      totalFiles: normalizedFiles.length,
      shardCount: shards.length,
      totalEstimatedDurationMs: totalDurationMs,
      slowestShard: shards.reduce((selected, shard) =>
        shard.estimatedDurationMs > selected.estimatedDurationMs ? shard : selected
      ),
      fastestShard: shards.reduce((selected, shard) =>
        shard.estimatedDurationMs < selected.estimatedDurationMs ? shard : selected
      ),
      spreadPercent: spread.spreadPercent,
      tolerancePercent: Number(config.tolerancePercent || 0),
      perFileOverheadMs: Number(config.perFileOverheadMs || 0),
    },
    shards,
    spread,
    slowestFiles,
    functionalGroups: buildFunctionalGroups({ files: normalizedFiles, durationByFile }),
    durationByFile,
    recommendation:
      spread.spreadPercent <= Number(config.tolerancePercent || 0)
        ? `unit shard balance is within ${config.tolerancePercent}% tolerance; keep current generated assignment.`
        : `unit shard balance exceeds ${config.tolerancePercent}% tolerance; update duration hints or locked assignments.`,
  };
};

export const buildUnitShardBalanceReport = root => {
  const config = loadUnitShardBalanceConfig(root);
  const files = discoverUnitTestFiles(root, config);
  const measuredDurations = {
    ...(safeReadJson(root, REPORT_PATH)?.durationByFile || {}),
    ...readVitestJsonDurations(root, RAW_VITEST_PROFILE_PATH),
  };
  const profile = buildUnitShardRuntimeProfile({
    root,
    files,
    config,
    durationByFile: measuredDurations,
  });

  return {
    ...profile,
    durationByFile: estimateDurationByFile({
      root,
      files,
      config,
      measuredDurations,
    }),
  };
};

export const collectCurrentUnitShardBalanceIssues = root => {
  const config = loadUnitShardBalanceConfig(root);
  const files = discoverUnitTestFiles(root, config);
  const profile = buildUnitShardBalanceReport(root);
  return collectUnitShardBalanceIssues({
    allFiles: files,
    config,
    assignments: profile.shards,
  });
};

const formatMs = ms => `${(Number(ms || 0) / 1000).toFixed(1)}s`;

export const formatUnitShardRuntimeProfileMarkdown = profile => {
  const lines = [
    '# Unit Shard Runtime Profile',
    '',
    `- Generated: ${profile.generatedAt}`,
    `- Git SHA: \`${profile.gitSha}\``,
    `- Worktree dirty: \`${profile.gitDirty}\``,
    `- Files: ${profile.summary.totalFiles}`,
    `- Shards: ${profile.summary.shardCount}`,
    `- Spread: ${profile.summary.spreadPercent}% (tolerance ${profile.summary.tolerancePercent}%)`,
    `- Per-file overhead: ${formatMs(profile.summary.perFileOverheadMs)}`,
    '',
    '## Shard Balance',
    '',
    '| Shard | Files | Estimated Duration | Top files |',
    '| ---: | ---: | ---: | --- |',
    ...profile.shards.map(shard => {
      const topFiles = shard.files
        .map(file => ({
          file,
          duration: Number(profile.durationByFile?.[file] || 0),
        }))
        .sort((a, b) => b.duration - a.duration || a.file.localeCompare(b.file))
        .slice(0, 4)
        .map(entry => `\`${entry.file}\``)
        .join('<br>');
      return `| ${shard.index} | ${shard.files.length} | ${formatMs(shard.estimatedDurationMs)} | ${topFiles} |`;
    }),
    '',
    '## Slowest Files',
    '',
    '| File | Group | Estimated Duration |',
    '| --- | --- | ---: |',
    ...profile.slowestFiles.map(
      entry => `| \`${entry.file}\` | ${entry.group} | ${formatMs(entry.estimatedDurationMs)} |`
    ),
    '',
    '## Functional Groups',
    '',
    '| Group | Files | Estimated Duration |',
    '| --- | ---: | ---: |',
    ...profile.functionalGroups.map(
      group => `| ${group.id} | ${group.files} | ${formatMs(group.estimatedDurationMs)} |`
    ),
    '',
    '## Recommendation',
    '',
    profile.recommendation,
    '',
  ];

  return `${lines.join('\n')}\n`;
};
