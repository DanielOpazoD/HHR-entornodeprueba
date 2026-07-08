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
  const diagnosticTypes = readText(
    root,
    'src/services/observability/syncConvergenceDiagnosticTypes.ts'
  );
  const diagnostics = readText(root, 'src/services/observability/syncConvergenceDiagnostics.ts');
  const handoffDiagnostics = readText(
    root,
    'src/services/observability/syncConvergenceHandoffDiagnostics.ts'
  );
  const recoveryPlanner = readText(root, 'src/services/observability/syncRecoveryPlanner.ts');
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
  const diagnosticsTests = readText(
    root,
    'src/tests/services/observability/syncConvergenceDiagnostics.test.ts'
  );
  const recoveryTests = readText(
    root,
    'src/tests/services/observability/syncRecoveryPlanner.test.ts'
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

  const autoMergeInvariantIndex = autoMerge.indexOf(
    'evaluateDailyRecordConflictPostMergeInvariants'
  );
  const autoMergeQueueIndex = autoMerge.indexOf('queueMergedRecoveryTask');
  const recoveryPlannerHasUnsafeWrites = [
    'setDoc(',
    'updateDoc(',
    'deleteDoc(',
    'queueDailyRecordSyncTask',
    'saveRecordToFirestore',
  ].some(token => recoveryPlanner.includes(token));
  const diagnosticContract = [diagnosticTypes, diagnostics, handoffDiagnostics].join('\n');

  const sections = [
    buildSection('sync-convergence', 'Post-merge convergence', [
      buildCheck(
        'diagnostic-status-contract',
        ['healthy', 'recoverable', 'needs_review', 'unsafe'].every(status =>
          diagnosticContract.includes(`'${status}'`)
        ) && diagnosticContract.includes('export const evaluateSyncConvergence'),
        'The convergence diagnostic exposes the four operational states used by support.',
        [
          'src/services/observability/syncConvergenceDiagnosticTypes.ts',
          'src/services/observability/syncConvergenceDiagnostics.ts',
        ]
      ),
      buildCheck(
        'clinical-divergence-findings',
        ['duplicate_active_patient', 'movement_not_reflected', 'handoff_divergent'].every(finding =>
          diagnosticContract.includes(`'${finding}'`)
        ),
        'The diagnostic detects duplicate active patients, missing movements and divergent handoff.',
        [
          'src/services/observability/syncConvergenceDiagnosticTypes.ts',
          'src/services/observability/syncConvergenceHandoffDiagnostics.ts',
        ]
      ),
      buildCheck(
        'handoff-module-classification',
        ['nursing_handoff', 'medical_handoff'].every(moduleName =>
          diagnosticContract.includes(`'${moduleName}'`)
        ) &&
          handoffDiagnostics.includes('collectNursingHandoffFindings') &&
          handoffDiagnostics.includes('collectMedicalHandoffFindings'),
        'Nursing and medical handoff divergences are classified with clinical module semantics.',
        [
          'src/services/observability/syncConvergenceDiagnosticTypes.ts',
          'src/services/observability/syncConvergenceHandoffDiagnostics.ts',
        ]
      ),
      buildCheck(
        'diagnostic-tests',
        diagnosticsTests.includes('duplicate active patients') &&
          diagnosticsTests.includes('movement divergence') &&
          diagnosticsTests.includes('handoff divergence'),
        'The diagnostic has focused tests for unsafe and recoverable divergence scenarios.',
        ['src/tests/services/observability/syncConvergenceDiagnostics.test.ts']
      ),
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
        'planner-action-contract',
        [
          'retry_outbox',
          'refresh_remote',
          'restore_snapshot',
          'block_for_review',
          'mark_already_applied',
        ].every(action => recoveryPlanner.includes(`'${action}'`)),
        'The recovery planner exposes explicit support actions without performing writes.',
        ['src/services/observability/syncRecoveryPlanner.ts']
      ),
      buildCheck(
        'planner-no-aggressive-writes',
        !recoveryPlannerHasUnsafeWrites,
        'The recovery planner remains a pure recommender and does not mutate Firestore or outbox state.',
        ['src/services/observability/syncRecoveryPlanner.ts']
      ),
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
      buildCheck(
        'planner-tests',
        recoveryTests.includes('stale') &&
          recoveryTests.includes('outbox') &&
          recoveryTests.includes('unsafe duplicate patients') &&
          recoveryTests.includes('already-applied mutations'),
        'Recovery planner tests cover retry, manual block and already-applied acknowledgement decisions.',
        ['src/tests/services/observability/syncRecoveryPlanner.test.ts']
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
    ]),
  ];

  const validationCommands = [
    'npx vitest run src/tests/support/clinicalSyncSimulator',
    'npx vitest run src/tests/services/observability/syncConvergenceDiagnostics.test.ts src/tests/services/observability/syncRecoveryPlanner.test.ts',
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
