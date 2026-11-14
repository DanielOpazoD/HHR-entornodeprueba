import fs from 'node:fs';
import path from 'node:path';
import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';
import { formatWorktreeState, getGitReportState } from './gitReportState.mjs';

const readText = (root, filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');

const countOccurrences = (content, token) => content.split(token).length - 1;

const buildCheck = (id, ok, description, evidence = []) => ({
  id,
  ok,
  description,
  evidence,
});

const buildSection = (id, title, checks) => ({
  id,
  title,
  ok: checks.every(check => check.ok),
  checks,
});

export const evaluateSyncConvergenceEvidence = root => {
  const packageJson = JSON.parse(readText(root, 'package.json'));
  const telemetry = readText(root, 'src/services/storage/sync/syncQueueTelemetryController.ts');
  const taskFactory = readText(root, 'src/services/storage/sync/syncQueueTaskFactory.ts');
  const transport = readText(root, 'src/services/storage/sync/firestoreSyncTransport.ts');
  const autoMerge = readText(
    root,
    'src/services/repositories/dailyRecordConflictAutoMergeController.ts'
  );
  const mutationConflictTests = readText(
    root,
    'src/tests/services/storage/syncQueueMutationConflict.test.ts'
  );
  const telemetryTests = readText(
    root,
    'src/tests/services/storage/syncQueueTelemetryController.test.ts'
  );
  const panelTests = readText(
    root,
    'src/tests/features/admin/systemHealthSyncConvergencePanel.test.ts'
  );
  const simulatorHarness = readText(
    root,
    'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts'
  );
  const simulatorHarnessTests = readText(
    root,
    'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.test.ts'
  );
  const simulatorCensusTests = readText(
    root,
    'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts'
  );
  const simulatorHandoffTests = readText(
    root,
    'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.handoff.test.ts'
  );
  const simulatorRayenAcceptanceTests = readText(
    root,
    'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.rayen-acceptance.test.ts'
  );
  const simulatorRayenAcceptanceFixtures = readText(
    root,
    'src/tests/support/clinicalSyncSimulator/rayenSyncAcceptanceFixtures.ts'
  );

  const autoMergeInvariantIndex = autoMerge.indexOf(
    'evaluateDailyRecordConflictPostMergeInvariants'
  );
  const autoMergeQueueIndex = autoMerge.indexOf('queueMergedRecoveryTask');
  const sections = [
    buildSection('sync-convergence', 'Post-merge convergence', [
      buildCheck(
        'operational-panel',
        panelTests.includes('last accepted truth') &&
          panelTests.includes('failed or conflicted sync work'),
        'System Health summarizes convergence state without requiring raw log expansion.',
        ['src/tests/features/admin/systemHealthSyncConvergencePanel.test.ts']
      ),
    ]),
    buildSection('authority-replay', 'Authority replay traceability', [
      buildCheck(
        'truth-selection-telemetry',
        telemetry.includes('recordSyncQueueTruthSelectionTelemetry') &&
          telemetry.includes('sync_queue_truth_selected'),
        'Sync writes emit an explicit truth-selection telemetry event.',
        ['src/services/storage/sync/syncQueueTelemetryController.ts']
      ),
      buildCheck(
        'anonymous-actor-context',
        taskFactory.includes('anonymizeSyncActorId') &&
          taskFactory.includes('acceptedVersion') &&
          taskFactory.includes('resolution'),
        'Operational snapshots preserve accepted versions and resolution while anonymizing client/tab identifiers.',
        ['src/services/storage/sync/syncQueueTaskFactory.ts']
      ),
      buildCheck(
        'transport-resolution-paths',
        countOccurrences(transport, 'recordSyncQueueTruthSelectionTelemetry') >= 4 &&
          ['accepted', 'merged', 'blocked', 'already_applied'].every(resolution =>
            transport.includes(`resolution: '${resolution}'`)
          ),
        'Remote sync transport classifies accepted, merged, blocked and already-applied outcomes.',
        ['src/services/storage/sync/firestoreSyncTransport.ts']
      ),
      buildCheck(
        'telemetry-tests',
        telemetryTests.includes('semantic truth selection telemetry') &&
          telemetryTests.includes('sanitizes client and tab identifiers'),
        'Telemetry tests guard traceability and privacy posture.',
        ['src/tests/services/storage/syncQueueTelemetryController.test.ts']
      ),
    ]),
    buildSection('recovery-readiness', 'Conservative recovery readiness', [
      buildCheck(
        'auto-merge-invariant-gate',
        autoMergeInvariantIndex >= 0 &&
          autoMergeQueueIndex >= 0 &&
          autoMergeInvariantIndex < autoMergeQueueIndex &&
          autoMerge.includes("return { status: 'not_possible' }"),
        'Auto-merge evaluates post-merge invariants before queueing/auditing a recovered record.',
        ['src/services/repositories/dailyRecordConflictAutoMergeController.ts']
      ),
      buildCheck(
        'three-client-replay-coverage',
        mutationConflictTests.includes('converges three clients') &&
          [
            'discharges',
            'transfers',
            'cma',
            'handoffNoteNightShift',
            'medicalHandoffEntries',
          ].every(token => mutationConflictTests.includes(token)),
        'Replay tests cover stale restart convergence for movements, discharge/CMA and handoff data.',
        ['src/tests/services/storage/syncQueueMutationConflict.test.ts']
      ),
    ]),
    buildSection('clinical-sync-simulator', 'Clinical sync simulator', [
      buildCheck(
        'multi-client-simulator-coverage',
        ['restartClient', 'replayNext', 'outbox', 'expectedVersion', 'changedPaths'].every(token =>
          simulatorHarness.includes(token)
        ) &&
          simulatorHarnessTests.includes('stale outbox pending') &&
          simulatorHarnessTests.includes('post-merge invariants reject') &&
          simulatorHarnessTests.includes('incompatible stale edits') &&
          simulatorHarnessTests.includes('duplicated replay of the same mutation id'),
        'The simulator models logical clients, stale outbox, restart/replay, invariant-blocked writes, incompatible field edits and idempotent retry.',
        [
          'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts',
          'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.test.ts',
        ]
      ),
      buildCheck(
        'auditable-clinical-context',
        simulatorHarness.includes('ClinicalSyncAffectedSummary') &&
          simulatorHarness.includes('buildAffectedSummary') &&
          simulatorCensusTests.includes('patientName:') &&
          simulatorCensusTests.includes('rut:') &&
          simulatorCensusTests.includes('mutationId: expect.stringMatching'),
        'Simulator events preserve clinical context for observability: record date, mutation, client/tab, changed paths, bed, patient and RUT when available.',
        [
          'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts',
          'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts',
        ]
      ),
      buildCheck(
        'census-replay-scenarios',
        [
          'new patient created remotely',
          'bed move',
          'discharges',
          'transfers',
          'cma',
          'invasive-device edits',
        ].every(token => simulatorCensusTests.includes(token)),
        'Census scenarios cover admission, bed moves, discharge/transfer/CMA and DMI replay after stale clients.',
        ['src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts']
      ),
      buildCheck(
        'handoff-replay-scenarios',
        [
          'handoffNoteDayShift',
          'handoffNoteNightShift',
          'handoffNovedadesDayShift',
          'handoffNovedadesNightShift',
          'medicalHandoffBySpecialty',
          'medicalHandoffEntries',
        ].every(token => simulatorHandoffTests.includes(token)),
        'Nursing and medical handoff scenarios cover stale replay, parallel specialties and entry-level merge semantics.',
        ['src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.handoff.test.ts']
      ),
      buildCheck(
        'rayen-acceptance-idempotence',
        [
          'planRayenCensusImport',
          'applyCensusImportDiff',
          'clinicalCrib',
          'treatingPhysicianName',
          'repeatedPlan',
          'pendingAdministrativeDischarges: 0',
        ].every(token => simulatorRayenAcceptanceTests.includes(token)) &&
          [
            'fixture-episode-newborn',
            'fixture-episode-pavilion-1',
            'fixture-episode-pavilion-2',
            'P-R1',
            'P-R2',
          ].every(token => simulatorRayenAcceptanceFixtures.includes(token)),
        'A fictional end-to-end Rayen scenario composes census planning/application and proves a repeated snapshot is a clinical no-op.',
        [
          'src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.rayen-acceptance.test.ts',
          'src/tests/support/clinicalSyncSimulator/rayenSyncAcceptanceFixtures.ts',
        ]
      ),
    ]),
  ];

  const validationCommands = [
    'npx vitest run src/tests/support/clinicalSyncSimulator',
    'npx vitest run src/tests/services/storage/syncQueueTelemetryController.test.ts src/tests/services/storage/syncQueueMutationConflict.test.ts',
    'npx vitest run src/tests/features/admin/systemHealthSyncConvergencePanel.test.ts src/tests/hooks/controllers/systemHealthReporterController.test.ts',
    'npm run check:sync-convergence-evidence',
  ];

  return {
    ok: sections.every(section => section.ok),
    sections,
    validationCommands,
    packageScripts: {
      check: packageJson.scripts?.['check:sync-convergence-evidence'] || null,
      report: packageJson.scripts?.['report:sync-convergence'] || null,
    },
  };
};

export const buildSyncConvergenceEvidenceReport = root => {
  const evaluation = evaluateSyncConvergenceEvidence(root);
  const gitState = getGitReportState(root);
  const checks = evaluation.sections.flatMap(section =>
    section.checks.map(check => ({ ...check, sectionId: section.id }))
  );

  return {
    reportId: 'sync-convergence',
    generatedAt: new Date().toISOString(),
    gitSha: gitState.gitSha,
    gitDirty: gitState.gitDirty,
    generatedFor: buildEvidenceProvenance({
      root,
      reportId: 'sync-convergence',
      gitState,
    }),
    worktree: formatWorktreeState(gitState.gitDirty),
    summary: {
      ok: evaluation.ok,
      sectionCount: evaluation.sections.length,
      passingChecks: checks.filter(check => check.ok).length,
      failingChecks: checks.filter(check => !check.ok).length,
    },
    sections: evaluation.sections,
    validationCommands: evaluation.validationCommands,
    packageScripts: evaluation.packageScripts,
  };
};

export const formatSyncConvergenceEvidenceReport = report => {
  const lines = [
    '# Sync Convergence Evidence',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Git SHA: \`${report.gitSha}\``,
    `- Worktree: \`${report.worktree}\``,
    `- Status: \`${report.summary.ok ? 'ready' : 'needs-attention'}\``,
    `- Checks: \`${report.summary.passingChecks}/${report.summary.passingChecks + report.summary.failingChecks}\` passing`,
    '',
    '## Sections',
    '',
    '| Section | Status | Checks |',
    '| --- | --- | ---: |',
    ...report.sections.map(section => {
      const passing = section.checks.filter(check => check.ok).length;
      return `| ${section.title} | ${section.ok ? 'OK' : 'FAIL'} | ${passing}/${section.checks.length} |`;
    }),
    '',
  ];

  for (const section of report.sections) {
    lines.push(`## ${section.title}`, '');
    for (const check of section.checks) {
      lines.push(`- ${check.ok ? 'OK' : 'FAIL'} \`${check.id}\`: ${check.description}`);
      if (check.evidence.length > 0) {
        lines.push(`  - Evidence: ${check.evidence.map(item => `\`${item}\``).join(', ')}`);
      }
    }
    lines.push('');
  }

  lines.push('## Validation Commands', '');
  report.validationCommands.forEach(command => {
    lines.push(`- \`${command}\``);
  });
  lines.push('');

  return `${lines.join('\n')}\n`;
};
