import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildUnitShardBalanceReport } from './unitShardBalanceSupport.mjs';

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const slash = value => value.split(path.sep).join('/');
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

export const captureTestSourceIdentity = root => {
  const gitSha = git(root, ['rev-parse', 'HEAD']).trim();
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort();
  const trackedDiff = git(root, ['diff', 'HEAD', '--binary']);
  const hash = createHash('sha256').update(trackedDiff);
  for (const file of untracked) hash.update(file).update(fs.readFileSync(path.join(root, file)));
  return {
    gitSha,
    worktreeDirty: Boolean(trackedDiff || untracked.length),
    sourceFingerprint: hash.digest('hex'),
  };
};

/** @param {{kind: string, mode: string, report: object, sourceRoot?: string}} input */
export const summarizeTestReporter = ({ kind, mode, report, sourceRoot }) => {
  const cases = [],
    suiteErrors = [],
    diagnostics = [],
    files = [];
  const normalize = file => {
    if (!file) return '';
    if (!sourceRoot) return slash(file);
    if (path.isAbsolute(file)) return slash(path.relative(sourceRoot, file));
    if (kind === 'playwright' && report.config?.rootDir && !file.startsWith('e2e/'))
      return slash(
        path.relative(sourceRoot, path.resolve(sourceRoot, report.config.rootDir, file))
      );
    return slash(file).replace(/^\.\//, '');
  };
  const add = (file, title, status, attempts = 0, flaky = false) =>
    cases.push({ file: normalize(file), title, status, attempts, flaky });
  if (kind === 'vitest') {
    if (!Array.isArray(report?.testResults)) throw new Error('Missing Vitest testResults');
    for (const suite of report.testResults) {
      files.push(normalize(suite.name));
      if (!Array.isArray(suite.assertionResults))
        throw new Error('Missing Vitest assertionResults');
      if (suite.status === 'failed')
        suiteErrors.push({
          file: normalize(suite.name),
          message: suite.message || 'Suite failed (including hooks)',
        });
      for (const test of suite.assertionResults) {
        const status = {
          passed: 'passed',
          failed: 'failed',
          pending: 'skipped',
          skipped: 'skipped',
          todo: 'todo',
        }[test.status];
        if (!status) throw new Error(`Unknown Vitest status ${test.status}`);
        add(
          suite.name,
          test.fullName || test.title,
          mode === 'collection' ? 'collected' : status,
          mode === 'execution' && ['passed', 'failed'].includes(status) ? 1 : 0
        );
      }
    }
  } else if (kind === 'playwright') {
    if (!Array.isArray(report?.suites)) throw new Error('Missing Playwright suites');
    const visit = (suite, parents = []) => {
      const ancestors = suite.title ? [...parents, suite.title] : parents;
      for (const spec of suite.specs || []) {
        files.push(normalize(spec.file || suite.file));
        for (const test of spec.tests || []) {
          const results = test.results || [],
            final = results.at(-1);
          let status =
            mode === 'collection'
              ? 'collected'
              : {
                  passed: 'passed',
                  failed: 'failed',
                  timedOut: 'failed',
                  interrupted: 'interrupted',
                  skipped: 'skipped',
                }[final?.status];
          if (!status && !final) {
            status = 'notRun';
            diagnostics.push(`Playwright test has no recorded result: ${spec.title}`);
          }
          if (!status) throw new Error(`Unknown Playwright status ${final?.status}`);
          add(
            spec.file || suite.file,
            `${test.projectName || ''}: ${[...ancestors, spec.title].join(' > ')}`,
            status,
            mode === 'execution' ? results.filter(result => result.status !== 'skipped').length : 0,
            mode === 'execution' &&
              final?.status === 'passed' &&
              results.some(result => ['failed', 'timedOut', 'interrupted'].includes(result.status))
          );
        }
      }
      for (const child of suite.suites || []) visit(child, ancestors);
    };
    report.suites.forEach(suite => visit(suite));
  } else throw new Error(`Unsupported reporter ${kind}`);
  const counts = {
    registered: cases.length,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    interrupted: 0,
    notRun: 0,
    collected: 0,
    attempts: 0,
    flaky: 0,
    retryAttempts: 0,
  };
  for (const test of cases) {
    counts[test.status] += 1;
    counts.attempts += test.attempts;
    counts.retryAttempts += Math.max(0, test.attempts - 1);
    if (test.flaky) counts.flaky += 1;
    if (['passed', 'failed', 'interrupted'].includes(test.status)) counts.executed += 1;
  }
  const duplicateFiles =
    kind === 'vitest' ? [...new Set(files.filter((file, i) => files.indexOf(file) !== i))] : [];
  return {
    counts,
    cases,
    files: [...new Set(files)].sort(),
    duplicateFiles,
    suiteErrors,
    diagnostics,
    reporterSuccess: report.success,
    globalErrors: (report.errors?.length || 0) + diagnostics.length,
  };
};

const executionIssues = item => {
  const issues = [];
  if (item.mode !== 'execution') issues.push('Required evidence must be execution');
  if (!item.counts?.executed) issues.push('Required evidence executed zero cases');
  if (item.exitCode !== 0) issues.push('Required evidence has nonzero or absent exitCode');
  if (
    item.reporterSuccess === false ||
    item.counts?.failed ||
    item.counts?.interrupted ||
    item.counts?.notRun ||
    item.suiteErrors?.length ||
    item.globalErrors
  )
    issues.push('Required evidence has reporter, test, hook or global errors');
  return issues;
};

export const validateTestEvidence = (evidence, identity, expectedCi) => {
  if (!evidence) throw new Error('Expected reporter artifact is absent');
  if (evidence.schemaVersion !== 1 || !evidence.identity || !evidence.command?.length)
    throw new Error('Unattributed reporter artifact; capture it with --capture');
  if (!['execution', 'collection'].includes(evidence.mode))
    throw new Error('Invalid evidence mode');
  if (evidence.identity.gitSha !== identity.gitSha)
    throw new Error('Reporter SHA differs from current SHA');
  if (
    evidence.identity.sourceFingerprint !== identity.sourceFingerprint ||
    evidence.identity.worktreeDirty !== identity.worktreeDirty
  )
    throw new Error('Reporter source differs from current worktree');
  if (!evidence.sourceUnchanged) throw new Error('Sources changed during reporter capture');
  if (evidence.captureError) throw new Error(`Reporter capture failed: ${evidence.captureError}`);
  const summary = summarizeTestReporter(evidence);
  if (expectedCi) {
    const attempt = Number(evidence.ci?.runAttempt),
      current = Number(expectedCi.runAttempt);
    if (
      evidence.ci?.runId !== expectedCi.runId ||
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      !Number.isInteger(current) ||
      attempt > current
    )
      throw new Error('Reporter CI run or attempt differs from current run');
    if (evidence.identity.worktreeDirty) throw new Error('CI reporter source must be clean');
    const failures = executionIssues({ ...evidence, ...summary });
    if (failures.length) throw new Error(failures.join('; '));
  }
  return summary;
};

const selectLiteralE2eFiles = (root, script, scripts, seen = new Set()) => {
  const key = `npm:${script}`;
  if (seen.has(key) || !scripts[script]) return [];
  seen.add(key);
  const scan = body => {
    const files = [...body.matchAll(/\be2e\/[\w/.-]+(?:\.spec\.ts|\.measurement\.ts)\b/g)].map(
      match => match[0]
    );
    for (const match of body.matchAll(/\bnpm run ([\w:.-]+)/g))
      files.push(...selectLiteralE2eFiles(root, match[1], scripts, seen));
    for (const match of body.matchAll(/\bbash (scripts\/[\w/.-]+\.sh)\b/g)) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      if (fs.existsSync(path.join(root, match[1])))
        files.push(...scan(fs.readFileSync(path.join(root, match[1]), 'utf8')));
    }
    for (const match of body.matchAll(/(?:-c\s+|--config(?:=|\s+))(playwright\.[\w.-]+\.ts)/g)) {
      if (!fs.existsSync(path.join(root, match[1]))) continue;
      const config = fs.readFileSync(path.join(root, match[1]), 'utf8');
      for (const selection of config.matchAll(
        /testMatch:\s*['"]([\w.-]+(?:\.spec\.ts|\.measurement\.ts))['"]/g
      ))
        files.push(`e2e/${selection[1]}`);
    }
    return files;
  };
  return [...new Set(scan(scripts[script]))].sort();
};

export const collectE2eOwnershipIssues = (files, ownership, root) => {
  const issues = [],
    entries = ownership.specs || [],
    seen = new Set();
  const scripts = root ? readJson(root, 'package.json').scripts : null;
  for (const entry of entries) {
    if (seen.has(entry.file)) issues.push(`Duplicate E2E owner: ${entry.file}`);
    seen.add(entry.file);
    if (!files.includes(entry.file)) issues.push(`Owned E2E file does not exist: ${entry.file}`);
    if (
      !['ci', 'nightly', 'manual', 'retire-candidate'].includes(entry.lane) ||
      !entry.reason ||
      !entry.command
    )
      issues.push(`Incomplete E2E decision: ${entry.file}`);
    if (!scripts || !['ci', 'nightly'].includes(entry.lane)) continue;
    const script = entry.command.match(/^npm run ([\w:.-]+)$/)?.[1];
    const invoked = entry.entryScript || script;
    if (!script || !scripts[script] || !scripts[invoked]) {
      issues.push(`Unknown E2E npm script: ${entry.file}`);
      continue;
    }
    const workflow = entry.workflow && path.join(root, entry.workflow);
    const body = workflow && fs.existsSync(workflow) ? fs.readFileSync(workflow, 'utf8') : '';
    if (
      !new RegExp(`npm run ${invoked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(body)
    )
      issues.push(`E2E entry script is not invoked by its workflow: ${entry.file}`);
    if (!selectLiteralE2eFiles(root, script, scripts).includes(entry.file))
      issues.push(`E2E spec selection is unverified for declared script: ${entry.file}`);
    if (invoked !== script && !selectLiteralE2eFiles(root, invoked, scripts).includes(entry.file)) {
      const profile = scripts[invoked].match(
        /run-release-confidence-pack\.mjs --profile (\w+)/
      )?.[1];
      const pack = profile ? readJson(root, 'scripts/config/release-confidence-pack.json') : null;
      if (
        !pack?.profiles[profile]?.some(id =>
          pack.steps.some(step => step.id === id && step.command === entry.command)
        )
      )
        issues.push(`E2E script is absent from its declared entrypoint: ${entry.file}`);
    }
  }
  for (const file of files) if (!seen.has(file)) issues.push(`Unowned E2E file: ${file}`);
  return issues;
};

export const buildRequiredCiSuites = root => {
  const scripts = readJson(root, 'package.json').scripts;
  const shards = buildUnitShardBalanceReport(root).shards;
  return [
    ...shards.map(shard => ({
      suiteId: `unit-${shard.index}`,
      job: 'unit-risk-shards',
      kind: 'vitest',
      script: 'test:ci:unit:shard',
      shard: `${shard.index}/${shards.length}`,
      args: [
        '--',
        `${shard.index}/${shards.length}`,
        '--reporter=default',
        '--reporter=json',
        `--outputFile=reports/execution/unit-${shard.index}.raw.json`,
      ],
      files: shard.files,
    })),
    {
      suiteId: 'storage',
      job: 'rules-emulator',
      kind: 'vitest',
      script: 'test:storage-rules:ci',
      files: ['src/tests/security/storage-rules.test.ts'],
      allowSkipped: false,
    },
    {
      suiteId: 'critical',
      job: 'e2e-critical-emulator',
      kind: 'playwright',
      script: 'test:e2e:critical:ci',
      files: selectLiteralE2eFiles(root, 'test:e2e:critical', scripts),
    },
    {
      suiteId: 'flow',
      job: 'e2e-critical-emulator',
      kind: 'playwright',
      script: 'test:e2e:flow-performance:built',
      files: selectLiteralE2eFiles(root, 'test:e2e:flow-performance:built', scripts),
    },
  ];
};

export const collectRequiredCiEvidenceIssues = (
  observations,
  expectedSuites,
  { requireAll = true } = {}
) => {
  const issues = [];
  for (const item of observations) {
    if (!expectedSuites.some(suite => suite.suiteId === item.suiteId))
      issues.push(`Unknown required CI suite: ${item.suiteId || '(missing suiteId)'}`);
  }
  for (const suite of expectedSuites) {
    const matches = observations.filter(item => item.suiteId === suite.suiteId);
    const issue = message => issues.push(`${suite.suiteId}: ${message}`);
    if (!matches.length) {
      if (requireAll) issue('Required evidence is absent');
      continue;
    }
    if (matches.length !== 1) {
      issue('Duplicate suite evidence');
      continue;
    }
    const item = matches[0];
    if (!item.accepted) {
      issue(`Evidence rejected: ${item.reason}`);
      continue;
    }
    for (const failure of executionIssues(item)) issue(failure);
    if (item.ci && item.ci.job !== suite.job) issue(`Expected producer job ${suite.job}`);
    if (item.kind !== suite.kind) issue(`Expected reporter ${suite.kind}`);
    if (
      !['npm', 'npm.cmd'].includes(item.command?.[0]) ||
      item.command?.[1] !== 'run' ||
      item.command?.[2] !== suite.script
    )
      issue(`Expected command npm run ${suite.script}`);
    const expectedArgs = suite.args ?? (suite.shard ? ['--', suite.shard] : []);
    if (JSON.stringify(item.command?.slice(3)) !== JSON.stringify(expectedArgs))
      issue('Unexpected runner arguments or test filters');
    if (suite.shard) {
      const shardArgs = item.command.filter(arg => /^\d+\/\d+$/.test(arg));
      if (shardArgs.length !== 1 || shardArgs[0] !== suite.shard)
        issue(`Expected shard argument ${suite.shard}`);
    }
    if (
      suite.allowSkipped === false &&
      (item.counts.skipped || item.counts.todo || item.counts.collected)
    )
      issue('Required Storage rules cases were skipped or unfinished');
    for (const file of item.duplicateFiles || []) issue(`Duplicate observed file: ${file}`);
    const observed = new Set(item.files || []),
      expected = new Set(suite.files);
    if (!expected.size) issue('Expected source selection is empty or unverified');
    for (const file of expected) if (!observed.has(file)) issue(`Missing observed file: ${file}`);
    for (const file of observed)
      if (!expected.has(file)) issue(`Unexpected observed file: ${file}`);
  }
  return issues;
};

export const buildTestExecutionManifest = (root, evidenceInputs = []) => {
  const identity = captureTestSourceIdentity(root);
  const sourceFiles = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(
      file =>
        /\.(test|spec)\.[cm]?[jt]sx?$|\.measurement\.ts$/.test(file) &&
        fs.existsSync(path.join(root, file))
    )
    .sort();
  const ownership = readJson(root, 'scripts/config/e2e-test-ownership.json');
  const issues = collectE2eOwnershipIssues(
    sourceFiles.filter(file => file.startsWith('e2e/')),
    ownership,
    root
  );
  const expectedCi = process.env.GITHUB_RUN_ID
    ? { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT }
    : undefined;
  const observations = evidenceInputs.map(({ file, evidence }) => {
    const item = {
      file,
      suiteId: evidence?.suiteId,
      identity: evidence?.identity,
      ci: evidence?.ci,
      kind: evidence?.kind,
      mode: evidence?.mode,
      command: evidence?.command,
      exitCode: evidence?.exitCode,
    };
    let summary;
    try {
      if (evidence?.report) summary = summarizeTestReporter(evidence);
    } catch {
      summary = undefined;
    }
    try {
      return { ...item, accepted: true, ...validateTestEvidence(evidence, identity, expectedCi) };
    } catch (error) {
      issues.push(`${file}: ${error.message}`);
      return { ...item, ...summary, accepted: false, reason: error.message };
    }
  });
  const requiredCiSuites = buildRequiredCiSuites(root);
  issues.push(
    ...collectRequiredCiEvidenceIssues(
      expectedCi ? observations : observations.filter(item => item.suiteId),
      requiredCiSuites,
      { requireAll: Boolean(expectedCi) }
    )
  );
  const e2e = ownership.specs.map(entry => {
    const expected = requiredCiSuites.filter(
      suite => suite.kind === 'playwright' && suite.files.includes(entry.file)
    );
    const observedIn = observations
      .filter(
        item =>
          item.accepted &&
          item.mode === 'execution' &&
          item.cases.some(test => test.file === entry.file && test.attempts > 0)
      )
      .map(item => item.suiteId || item.file);
    return {
      ...entry,
      observation: observedIn.length
        ? 'observed'
        : expected.length
          ? 'absent'
          : 'outside-capture-scope',
      observedIn,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    identity,
    inventory: {
      sourceFiles,
      unitShardFiles: requiredCiSuites
        .filter(suite => suite.kind === 'vitest' && suite.shard)
        .flatMap(suite => suite.files),
      e2e,
    },
    requiredCiSuites,
    observations,
    issues,
    limitations: [
      'Inventory and ownership do not prove execution.',
      'Required CI capture scope is four unit shards, Storage rules, critical E2E and flow performance; other owners remain outside capture scope.',
      'Collection reports count zero executed cases.',
      'Observations are separate runs; counts are not summed across overlapping suites.',
      'A dirty worktree is identified by SHA plus source fingerprint, not SHA alone.',
      'Earlier attempts are accepted only for complete passing evidence from the same CI run and identical tested source.',
    ],
  };
};

export const formatTestExecutionManifestMarkdown = manifest =>
  [
    '# Test execution manifest',
    '',
    `SHA: ${manifest.identity.gitSha}. Worktree: ${manifest.identity.worktreeDirty ? 'dirty' : 'clean'}.`,
    `Source fingerprint: ${manifest.identity.sourceFingerprint}.`,
    '',
    `Discovered source files: ${manifest.inventory.sourceFiles.length}. Unit shard membership: ${manifest.inventory.unitShardFiles.length}. E2E decisions: ${manifest.inventory.e2e.length}.`,
    '',
    '| Evidence / Suite | Accepted | Mode | Executed | Passed | Failed | Skipped | Todo | Not run | Flaky | Retry attempts | Exit | Errors |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...manifest.observations.map(
      item =>
        `| ${item.file} / ${item.suiteId || 'unassigned'} | ${item.accepted ? 'yes' : `Rejected: ${item.reason}`} | ${item.mode || ''} | ${item.counts?.executed ?? ''} | ${item.counts?.passed ?? ''} | ${item.counts?.failed ?? ''} | ${item.counts?.skipped ?? ''} | ${item.counts?.todo ?? ''} | ${item.counts?.notRun ?? ''} | ${item.counts?.flaky ?? ''} | ${item.counts?.retryAttempts ?? ''} | ${item.exitCode ?? ''} | ${item.suiteErrors?.length ?? ''} suite / ${item.globalErrors ?? ''} global |`
    ),
    '',
    '## E2E ownership',
    '',
    '| Spec | Lane | Observation | Reason | Command |',
    '| --- | --- | --- | --- | --- |',
    ...manifest.inventory.e2e.map(
      item =>
        `| ${item.file} | ${item.lane} | ${item.observation} | ${item.reason} | \`${item.command}\` |`
    ),
    '',
    ...manifest.limitations.map(item => `- ${item}`),
    '',
    ...manifest.issues.map(item => `- ISSUE: ${item}`),
    '',
  ].join('\n');
