import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { formatWorktreeState, getGitReportState } from './gitReportState.mjs';
import { buildFirestoreRulesGovernanceReport } from './firestoreRulesGovernanceSupport.mjs';
import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';
import {
  buildLegacyRetirementDebtRows,
  buildMaintenanceDebtWatchlistRows,
} from './maintenanceDebtScorecardSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'maintenance-debt-scorecard.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'maintenance-debt-scorecard.md');
const QUALITY_METRICS_JSON = path.join(REPORTS_DIR, 'quality-metrics.json');
const LEGACY_RETIREMENT_DEBT_JSON = path.join(REPORTS_DIR, 'legacy-retirement-debt.json');
const MODULE_ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'module-size-allowlist.json');
const HOOK_LIMITS_PATH = path.join(ROOT, 'scripts', 'hook-hotspots-limits.json');

const WATCHLIST_FILES = [
  'firestore.rules',
  'src/services/repositories/dailyRecordWriteSupport.ts',
  'src/hooks/useCensusEmailRecipientLists.ts',
  'src/hooks/useBedManagementReducer.ts',
  'src/features/handoff/components/HandoffRowCells.tsx',
  'src/features/laboratory/controllers/labAnalyticsController.ts',
];

const CHURN_PREFIXES = [
  'src/features/census/',
  'src/features/handoff/',
  'src/features/laboratory/',
  'src/services/repositories/',
  'src/hooks/',
];

const readJson = file =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;

const countLines = filePath => {
  const absolutePath = path.join(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    return 0;
  }
  const normalized = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
  const withoutFinalNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutFinalNewline.length === 0 ? 0 : withoutFinalNewline.split('\n').length;
};

const buildPendingHotspotRows = () => {
  const moduleConfig = readJson(MODULE_ALLOWLIST_PATH) ?? {};
  const hookConfig = readJson(HOOK_LIMITS_PATH) ?? {};
  const globalMax = typeof moduleConfig.globalMax === 'number' ? moduleConfig.globalMax : 400;
  const moduleAllowlist =
    moduleConfig.allowlist && typeof moduleConfig.allowlist === 'object' ? moduleConfig.allowlist : {};
  const hookFiles = hookConfig.files && typeof hookConfig.files === 'object' ? hookConfig.files : {};

  const entries = [
    ...Object.entries(moduleAllowlist).map(([file, limit]) => ({
      file,
      limit: typeof limit === 'number' ? limit : globalMax,
      lines: countLines(file),
      source: 'module-allowlist',
    })),
    ...Object.entries(hookFiles).map(([file, limit]) => ({
      file,
      limit: typeof limit === 'number' ? limit : globalMax,
      lines: countLines(file),
      source: 'hook-hotspot',
    })),
  ];

  return entries
    .filter(entry => entry.lines > entry.limit)
    .sort((a, b) => b.lines - a.lines);
};

const buildRecentChurnRows = () => {
  const logOutput = execSync('git log --since="30 days ago" --name-only --pretty=format:', {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const touchedFiles = logOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const churnRows = CHURN_PREFIXES.map(prefix => ({
    prefix,
    touches: touchedFiles.filter(file => file.startsWith(prefix)).length,
  })).sort((a, b) => b.touches - a.touches);

  return churnRows;
};

const qualityMetrics = readJson(QUALITY_METRICS_JSON);
const legacyRetirementDebt = buildLegacyRetirementDebtRows(readJson(LEGACY_RETIREMENT_DEBT_JSON));
const moduleConfig = readJson(MODULE_ALLOWLIST_PATH) ?? {};
const hookConfig = readJson(HOOK_LIMITS_PATH) ?? {};
const firestoreRulesGovernance = buildFirestoreRulesGovernanceReport(ROOT);
const rulesLimits =
  firestoreRulesGovernance.generatedRules.maxLines == null
    ? {}
    : {
        [firestoreRulesGovernance.generatedRules.file]: firestoreRulesGovernance.generatedRules.maxLines,
      };
const pendingHotspots = buildPendingHotspotRows();
const watchlist = buildMaintenanceDebtWatchlistRows({
  watchlistFiles: WATCHLIST_FILES,
  countLines,
  hookLimits: hookConfig.files && typeof hookConfig.files === 'object' ? hookConfig.files : {},
  moduleLimits:
    moduleConfig.allowlist && typeof moduleConfig.allowlist === 'object'
      ? moduleConfig.allowlist
      : {},
  rulesLimits,
});
const churn = buildRecentChurnRows();
const gitState = getGitReportState(ROOT);

const payload = {
  generatedAt: new Date().toISOString(),
  ...gitState,
  generatedFor: buildEvidenceProvenance({
    root: ROOT,
    reportId: 'maintenance-debt-scorecard',
    gitState,
  }),
  pendingHotspots,
  watchlist,
  tests: {
    flakeRiskFiles: qualityMetrics?.tests?.flakeRiskFiles ?? null,
    knownFailureEntries: qualityMetrics?.tests?.knownFailureEntries ?? null,
    openKnownFailureEntries: qualityMetrics?.tests?.openKnownFailureEntries ?? null,
  },
  legacyRetirementDebt,
  firestoreRules: {
    lines: watchlist.find(entry => entry.file === 'firestore.rules')?.lines ?? 0,
    maxLines: firestoreRulesGovernance.generatedRules.maxLines,
    remainingLines: firestoreRulesGovernance.generatedRules.remainingLines,
    ownerAreaId: firestoreRulesGovernance.generatedRules.ownerAreaId,
    ownedFragments: firestoreRulesGovernance.fragments.length,
    governanceIssues: firestoreRulesGovernance.issues,
  },
  recentChurn: churn,
};

const markdown = `# Maintenance Debt Scorecard

Generated at: ${payload.generatedAt}
Commit: ${payload.gitSha}
Worktree: ${formatWorktreeState(payload.gitDirty)}

## Pending Hotspots

${
  pendingHotspots.length === 0
    ? '- None'
    : pendingHotspots
        .map(
          entry =>
            `- ${entry.file}: ${entry.lines} líneas (limit ${entry.limit}, source ${entry.source})`
        )
        .join('\n')
}

## Watchlist By Size

${watchlist
  .map(entry => {
    const limitSuffix =
      entry.limit == null
        ? ''
        : ` (limit ${entry.limit}, ${entry.remainingLines} líneas libres, source ${entry.limitSource})`;
    return `- ${entry.file}: ${entry.lines} líneas${limitSuffix}`;
  })
  .join('\n')}

## Test Stability Signals

- Flake-risk test files: ${payload.tests.flakeRiskFiles ?? 'n/a'}
- Known failure entries: ${payload.tests.knownFailureEntries ?? 'n/a'}
- Open known failure entries: ${payload.tests.openKnownFailureEntries ?? 'n/a'}

## Legacy Retirement Debt

- Status: ${payload.legacyRetirementDebt.status}
- Open surfaces: ${payload.legacyRetirementDebt.openSurfaceCount ?? 'n/a'} / ${
  payload.legacyRetirementDebt.maxOpenSurfaces ?? 'n/a'
}

${
  payload.legacyRetirementDebt.rows.length === 0
    ? '- No legacy retirement snapshot available'
    : payload.legacyRetirementDebt.rows
        .map(
          entry =>
            `- ${entry.label}: ${entry.status} (${entry.phase}, owner ${entry.owner}; ${entry.signal}) - next: ${entry.nextAction}`
        )
        .join('\n')
}

## Firestore Rules Growth

- firestore.rules: ${payload.firestoreRules.lines} / ${payload.firestoreRules.maxLines ?? 'n/a'} líneas
- Remaining budget: ${payload.firestoreRules.remainingLines ?? 'n/a'} líneas
- Owner area: ${payload.firestoreRules.ownerAreaId ?? 'n/a'}
- Owned fragments: ${payload.firestoreRules.ownedFragments}
- Governance issues: ${
  payload.firestoreRules.governanceIssues.length === 0
    ? 'none'
    : payload.firestoreRules.governanceIssues.join('; ')
}

## Recent Churn (30 Days)

${churn.map(entry => `- ${entry.prefix}: ${entry.touches} archivos tocados`).join('\n')}
`;

fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
fs.writeFileSync(MD_OUTPUT, `${markdown}\n`);

console.log(`Wrote ${path.relative(ROOT, JSON_OUTPUT)}`);
console.log(`Wrote ${path.relative(ROOT, MD_OUTPUT)}`);
