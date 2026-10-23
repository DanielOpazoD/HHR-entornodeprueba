import {
  getIsolationLanePlan,
  getIsolationVariantLanes,
} from '../../../scripts/e2eIsolationExperimentSupport.mjs';
const root = process.cwd();

export const criticalCorpus = {
  'e2e/admit-edit-discharge-smoke.spec.ts': '17f1d5840d7c34978b75-63f72e63e7d4ba688801'.split(' '),
  'e2e/auth-fixture-readiness.spec.ts':
    'deea7ea94579ca61f391-37810c4002c1ab3b9585 deea7ea94579ca61f391-3c2f88b981bf0295a42e deea7ea94579ca61f391-3c4740ff90535390b0ff'.split(
      ' '
    ),
  'e2e/auth-login-resilience.spec.ts':
    '8dbafe18a0a00611f978-7e9ab004b34d6cd43890 8dbafe18a0a00611f978-47b988489d52086c9aaa 8dbafe18a0a00611f978-7f1eb2c4c66bbb16710c 8dbafe18a0a00611f978-c3a2377e102929ff17f2 8dbafe18a0a00611f978-4cd3535c1e08d2d27df9 8dbafe18a0a00611f978-682bb5a00875248a334b 8dbafe18a0a00611f978-217a21504d71e606d155'.split(
      ' '
    ),
  'e2e/auth-multi-tab-lock.spec.ts':
    'd6f39ab577753ba20c96-c134c46e4695d50ace14 d6f39ab577753ba20c96-f2096f8212d05054e334'.split(
      ' '
    ),
  'e2e/authenticated-clinical-smoke.spec.ts':
    '53a261cf1b143a7a3127-50bf1e3ea4e0c6925c13 53a261cf1b143a7a3127-472e2a037acc4abbf514'.split(
      ' '
    ),
  'e2e/bed-crib-lifecycle-critical.spec.ts':
    '620bb62035db81487a5e-d8c111e415b837391b0e 620bb62035db81487a5e-12fd4a0ae21bc5537142 620bb62035db81487a5e-acb295de35b70b4b59a6 620bb62035db81487a5e-895a1449d76b0e562117'.split(
      ' '
    ),
  'e2e/census-persistence-reload.spec.ts': '44b60332e3fd85e33d9e-02c89073206298f6c1ad'.split(' '),
  'e2e/census-specialty-save.spec.ts':
    'e61cb571b997c6981a0d-623a7d3f886292977a6e e61cb571b997c6981a0d-92c33dc9868c07525dfc'.split(
      ' '
    ),
  'e2e/clinical-document-ai-import.spec.ts':
    '462affd78a9e23305bbd-f93d99cb527f0cfbd985 462affd78a9e23305bbd-a103591c55f2657f5210 462affd78a9e23305bbd-12ee76ebb261e6daa721 462affd78a9e23305bbd-c20ecb70d2502cbafb6d'.split(
      ' '
    ),
  'e2e/critical-emulator.spec.ts':
    '40ab54d7af9ae4b3e589-3385615b1d5fa9eff57e 40ab54d7af9ae4b3e589-2142703d89f0cceffb44 40ab54d7af9ae4b3e589-e861f1f31cc30a067c29'.split(
      ' '
    ),
  'e2e/eloisa-day-bootstrap-critical.spec.ts':
    'e4ffea29bad1f6af0459-1467fdd4611f66583622 e4ffea29bad1f6af0459-b4755843ed9d0057a78c'.split(
      ' '
    ),
  'e2e/legacy-firebase-compat.spec.ts': 'b480c87683e04a8b9969-2c9d9e31f771a956c4ed'.split(' '),
  'e2e/manual-eloisa-patient-code.spec.ts': '6a735849ad2e8f0c8543-8f8a9d013ac62ea69d20'.split(' '),
  'e2e/multiuser-offline-conflict.spec.ts':
    '50e8f3611795e8886e90-06005452c83444565f70 50e8f3611795e8886e90-31cab220bf522d9419dd'.split(
      ' '
    ),
  'e2e/night-admission-sync-recovery-critical.spec.ts':
    '48b7cc8cff541ffd50e5-6ff235cd7b0adcee25a9'.split(' '),
  'e2e/pre-outbox-multitab.spec.ts':
    '8c70ab434289d3cac79d-b5aae642bf8c859ff855 8c70ab434289d3cac79d-d5de1e9d2f215fcfcf41'.split(
      ' '
    ),
  'e2e/rayen-delayed-health-preflight.spec.ts': 'dd81bc32ff34db00430e-1368fda6ad52f0c03c14'.split(
    ' '
  ),
  'e2e/rayen-mother-newborn-d1-discharge-critical.spec.ts':
    'd1768e3ec2a0181ba816-8573dc0dbaaf3be7017a d1768e3ec2a0181ba816-67b85dcf94b94112a7e9'.split(
      ' '
    ),
  'e2e/release-role-smoke.spec.ts':
    '9e21efcf41a92e828eed-3a73c34bd6b82de7ab69 9e21efcf41a92e828eed-3eceb6ce4d9785675533 9e21efcf41a92e828eed-8a80f8c2f36dc27c6b4f'.split(
      ' '
    ),
  'e2e/sync-conflict-resolution.spec.ts':
    '9398ce8aa600d1c808db-08c224041bef49e46f91 9398ce8aa600d1c808db-bb8928901f22bce84275'.split(
      ' '
    ),
};

export const previewCorpus = {
  'e2e/census-preview-bootstrap.spec.ts':
    '9cc780e052b912f7f2cd-10cb171628c9ec507457 9cc780e052b912f7f2cd-3211319bfd88961af5d3 9cc780e052b912f7f2cd-65c13ed3d44f8e286305 9cc780e052b912f7f2cd-d1ac2baf5148df536d77 9cc780e052b912f7f2cd-4d9ef11903bc612128bc 9cc780e052b912f7f2cd-0a2e11975e620c7a06e2 9cc780e052b912f7f2cd-0825c0cf426385556b78 9cc780e052b912f7f2cd-03e0d32d874f57be23e8 9cc780e052b912f7f2cd-f683ab8ed5e332ee507a 9cc780e052b912f7f2cd-87ec2cb652c4565eac51 9cc780e052b912f7f2cd-81ada9838105daad59f1 9cc780e052b912f7f2cd-2ca4c4ca153ec9e93242 9cc780e052b912f7f2cd-00280279b9b7d35e0fb1 9cc780e052b912f7f2cd-2bc94cee3b906345a74f 9cc780e052b912f7f2cd-7ad561ae46554bc18e0c 9cc780e052b912f7f2cd-a53f34e1cc5d375fd7c9 9cc780e052b912f7f2cd-09549045e85a9cdb0bc3 9cc780e052b912f7f2cd-6fb295903273b70dfa69 9cc780e052b912f7f2cd-c7f09ca61cd6449afed1 9cc780e052b912f7f2cd-ed22fe45ba94c216efd4 9cc780e052b912f7f2cd-ae10a2cbc4c1fa3ecab3 9cc780e052b912f7f2cd-444ab5c1a4ae52697506 9cc780e052b912f7f2cd-91d0910e31ca7257f8a1 9cc780e052b912f7f2cd-1399a017fd2208a9280d'.split(
      ' '
    ),
  'e2e/census-sync-history-navigation.spec.ts':
    '0b65069253a7908d9c27-8bbe863cb3a388e57478 0b65069253a7908d9c27-62bba10f519cc2509a70'.split(
      ' '
    ),
  'e2e/clinical-carryover-preview.spec.ts': '78d76d3b9dd2f69d654d-bc763a7c3a0b487f2579'.split(' '),
  'e2e/clinical-library-pharmacy.spec.ts':
    'a0c449bcb0800b2c3a80-b8c6a1e8ceb2471e821b a0c449bcb0800b2c3a80-4817e6b5af816122d5ea a0c449bcb0800b2c3a80-f86354f44676424e45bb'.split(
      ' '
    ),
  'e2e/clinical-library-smoke.spec.ts':
    '7d789c4e137495d80b4b-0d11f5d3812829baddca 7d789c4e137495d80b4b-debb79c0120ed494e3cb 7d789c4e137495d80b4b-fbbf5fc7180c197aa206'.split(
      ' '
    ),
  'e2e/clinical-panel-reading-smoke.spec.ts':
    'a07d3955b5e578cb50c1-a4ae9346830c9f103c25 a07d3955b5e578cb50c1-c0f9bd7b93e43b1ed48e a07d3955b5e578cb50c1-4adc4f895273286008f9 a07d3955b5e578cb50c1-f2b6e13b2e7997d6c857 a07d3955b5e578cb50c1-57f30c3201cac7b6bff5'.split(
      ' '
    ),
  'e2e/dicom-viewer.spec.ts':
    '313f852ef114680c6c6b-1e4f85dd063979d15874 313f852ef114680c6c6b-c8a1da037ab0f808b69f 313f852ef114680c6c6b-cd5ccb582b81821504e9 313f852ef114680c6c6b-4a20923b6889ee742cc2 313f852ef114680c6c6b-44ba49314cf6d7657083 313f852ef114680c6c6b-a10616216a45fff28e01 313f852ef114680c6c6b-56108c344048eb58ffad 313f852ef114680c6c6b-0e7afd871384062decc4 313f852ef114680c6c6b-70dfe331d30a5dd25ffc 313f852ef114680c6c6b-8e043ae2fb2fb3dc9df3 313f852ef114680c6c6b-e03236f63365c7d0cce6 313f852ef114680c6c6b-f6b34d13e2b5db8572d2 313f852ef114680c6c6b-51767bdc06077ca57e09 313f852ef114680c6c6b-2e9c2a9cbe5ffed4988e 313f852ef114680c6c6b-904da77ff9e914547ac8 313f852ef114680c6c6b-09be94c69b9d6ab45b1c 313f852ef114680c6c6b-d210ada2047ab5b2300f 313f852ef114680c6c6b-363b95466beca00f06e4 313f852ef114680c6c6b-68e5e33b19992615d2ee 313f852ef114680c6c6b-405d3a46aca04722f78a 313f852ef114680c6c6b-cbd650d1275043520939 313f852ef114680c6c6b-f6fb5ef08623c0af9b10 313f852ef114680c6c6b-ac5a94e97b560f40fd56 313f852ef114680c6c6b-11b473043d9ca26afc14 313f852ef114680c6c6b-b563183d1b62d74f2d0f 313f852ef114680c6c6b-f1f9230a87623453f248'.split(
      ' '
    ),
};

const identity = {
  gitSha: 'a'.repeat(40),
  sourceFingerprint: 'b'.repeat(64),
  worktreeDirty: false,
};
const ci = { runId: '42', runAttempt: '1', job: 'e2e-isolation-lanes' };
const stamp = '2026-10-21T12:00:00.000Z';

export const report = (corpus: Record<string, string[]>, execute: boolean) => ({
  config: { workers: 1, fullyParallel: false, projects: [{ name: 'chromium' }] },
  stats: {
    expected: execute ? Object.values(corpus).flat().length : 0,
    unexpected: 0,
    skipped: 0,
    flaky: 0,
    interrupted: 0,
  },
  errors: [],
  suites: Object.entries(corpus).map(([file, ids]) => ({
    file,
    specs: ids.map(id => ({
      id,
      file,
      title: id,
      tests: [{ projectName: 'chromium', results: execute ? [{ status: 'passed' }] : [] }],
    })),
  })),
});
const envelope = (
  suiteId: string,
  command: string[],
  corpus: Record<string, string[]>,
  execute: boolean
) => ({
  schemaVersion: 1,
  identity: { ...identity },
  ci: { ...ci },
  sourceUnchanged: true,
  sourceRoot: root,
  suiteId,
  command,
  kind: 'playwright',
  mode: execute ? 'execution' : 'collection',
  exitCode: 0,
  report: report(corpus, execute),
});
const phaseScripts: Record<string, string> = {
  'extension-runtime': 'test:e2e:rayen-extension-runtime',
  'extension-upgrade': 'test:e2e:rayen-extension-upgrade',
  'shared-offscreen': 'test:e2e:shared-offscreen',
  'remote-performance': 'test:e2e:census-remote-performance',
  budget: 'check:flow-performance-budget',
};
export const fixture = (variant = 'B') => ({
  root,
  variant,
  identity: { ...identity },
  ci: { ...ci },
  records: getIsolationVariantLanes(variant).map(lane => {
    const plan = getIsolationLanePlan(root, lane);
    const names = [
      'critical-list',
      'preview-list',
      ...(plan.auxiliary ? ['extension-runtime', 'extension-upgrade', 'shared-offscreen'] : []),
      ...(variant === 'A'
        ? ['critical-ci']
        : ['emulator', 'build', 'critical', ...(plan.auxiliary ? ['flow', 'budget'] : [])]),
      'operational-metrics',
      ...(plan.auxiliary ? ['remote-performance'] : []),
    ];
    return {
      lane,
      metadata: {
        schemaVersion: 1,
        lane,
        identity: { ...identity },
        ci: { ...ci },
        sourceUnchanged: true,
        startedAt: stamp,
        finishedAt: stamp,
        versions: Object.fromEntries(
          [
            'node',
            'java',
            'playwright',
            'chromium',
            'firestore',
            'lockfile',
            'runnerImage',
            'runnerOS',
            'runnerArch',
          ].map(key => [key, 'fixture-version'])
        ),
        phases: names.map(name => ({
          name,
          command: ['npm', 'run', phaseScripts[name] || name],
          startedAt: stamp,
          finishedAt: stamp,
          durationMs: 0,
          exitCode: 0,
          signal: null,
        })),
      },
      critical: envelope(
        plan.suiteId,
        plan.command,
        Object.fromEntries(
          Object.entries(criticalCorpus).filter(([file]) => plan.specs.includes(file))
        ),
        true
      ),
      listed: envelope(
        'isolation-critical-list',
        ['npm', 'run', 'test:e2e:critical', '--', '--list', '--reporter=json'],
        criticalCorpus,
        false
      ),
      previewListed: envelope(
        'isolation-preview-list',
        ['npm', 'run', 'ci:preview-smoke:built', '--', '--list', '--reporter=json'],
        previewCorpus,
        false
      ),
      flow: plan.auxiliary
        ? envelope(
            'flow',
            ['npm', 'run', 'test:e2e:flow-performance:built'],
            { 'e2e/startup-performance-budget.spec.ts': ['flow-id'] },
            true
          )
        : null,
    };
  }),
});
