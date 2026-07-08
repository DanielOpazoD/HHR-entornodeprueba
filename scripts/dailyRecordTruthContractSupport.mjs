import fs from 'node:fs';
import path from 'node:path';

const readText = (root, filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');

const exists = (root, filePath) => fs.existsSync(path.join(root, filePath));

const includesAll = (source, values) => values.every(value => source.includes(value));

const buildCheck = (id, ok, description, evidence = []) => ({
  id,
  ok,
  description,
  evidence,
});

export const evaluateDailyRecordTruthContract = root => {
  const adrPath = 'docs/ADR_DAILY_CENSUS_TRUTH_CONTRACT.md';
  const adr = exists(root, adrPath) ? readText(root, adrPath) : '';
  const adrLower = adr.toLowerCase();
  const emulatorTest = readText(root, 'src/tests/emulator/sync-mutation-idempotency.emulator.test.ts');
  const conflictPresentation = readText(
    root,
    'src/application/clinical-conflicts/conflictSnapshotRecoveryPresentation.ts'
  );
  const conflictPresentationTest = readText(
    root,
    'src/tests/views/census/conflictVersionsPresentationController.test.ts'
  );
  const auditSummary = readText(
    root,
    'src/services/repositories/conflictResolutionAuditSummary.ts'
  );
  const auditSummaryTest = readText(
    root,
    'src/tests/services/repositories/conflictResolutionAuditSummary.test.ts'
  );
  const clinicalNarratives = readText(
    root,
    'src/services/admin/clinicalAuditConflictNarratives.ts'
  );
  const runbook = readText(root, 'docs/RUNBOOK_DAILY_CENSUS_RECOVERY.md');
  const firestoreSyncRunbook = readText(root, 'docs/runbooks/firestore-sync-issues.md');
  const clinicalConflictCenter = readText(
    root,
    'src/application/clinical-conflicts/clinicalConflictCenterController.ts'
  );
  const clinicalConflictClassifier = readText(
    root,
    'src/application/clinical-conflicts/clinicalConflictPathClassifier.ts'
  );
  const conflictCenterComponent = readText(
    root,
    'src/components/clinical-conflicts/ClinicalConflictCenterControl.tsx'
  );
  const repositoryAuditPort = readText(
    root,
    'src/services/repositories/ports/repositoryAuditPort.ts'
  );
  const firestoreRules = readText(root, 'firestore.rules');

  const checks = [
    buildCheck(
      'truth-contract-adr',
      exists(root, adrPath) &&
        includesAll(adr, [
          'autoridad transaccional',
          'intención clínica',
          'invariantes post-merge',
          'mutationId',
          'changedPaths',
        ]),
      'Daily census truth contract ADR must define authority, clinical intent, sync contract and invariants.',
      [adrPath]
    ),
    buildCheck(
      'last-write-wins-prohibited',
      adrLower.includes('last write wins') &&
        adrLower.includes('no es el último navegador que escribió') &&
        firestoreSyncRunbook.includes('no debe resolver por "last-write-wins"'),
      'DailyRecord conflict docs must explicitly prohibit last-write-wins as the selected clinical truth.',
      [adrPath, 'docs/runbooks/firestore-sync-issues.md']
    ),
    buildCheck(
      'two-client-restart-contract-test',
      includesAll(emulatorTest, [
        'clinical truth contract',
        'stale restarted',
        'discharge-local-b',
        'transfer-local-b',
        'cma-local-b',
        'beds.R10',
        'resetSyncMutationIdentityForTests',
      ]),
      'Emulator coverage must preserve two-client stale/restart movement intents through authority replay.',
      ['src/tests/emulator/sync-mutation-idempotency.emulator.test.ts']
    ),
    buildCheck(
      'conflict-recovery-ui-reasons',
      includesAll(conflictPresentation, [
        'expired_ttl',
        'permission_denied',
        'not_saved',
        'unknown_empty',
      ]) &&
        includesAll(conflictPresentationTest, [
          'Snapshots expirados por TTL',
          'Snapshots sin permiso de lectura',
        ]),
      'Conflict recovery UI must distinguish saved, failed, expired TTL, permission and unknown empty states.',
      [
        'src/application/clinical-conflicts/conflictSnapshotRecoveryPresentation.ts',
        'src/tests/views/census/conflictVersionsPresentationController.test.ts',
      ]
    ),
    buildCheck(
      'conflict-resolution-summary-observability',
      includesAll(auditSummary, [
        'conflictResolutionSummary',
        'authority_intent_invariants',
        'lastWriteWins: false',
        'hashIdentifier',
      ]) &&
        includesAll(auditSummaryTest, [
          'conflictResolutionSummary',
          'anon_',
          'client-real-browser-id',
        ]) &&
        includesAll(clinicalNarratives, [
          'autoridad transaccional',
          'intención clínica',
          'no por el último navegador',
        ]),
      'Auto-merge observability must explain selected truth and anonymize client/tab identifiers.',
      [
        'src/services/repositories/conflictResolutionAuditSummary.ts',
        'src/tests/services/repositories/conflictResolutionAuditSummary.test.ts',
        'src/services/admin/clinicalAuditConflictNarratives.ts',
      ]
    ),
    buildCheck(
      'operator-runbook',
      includesAll(runbook, [
        'Si aparece un conflicto auto-mergeado',
        'Cuándo restaurar una versión de conflicto',
        'Cuándo NO restaurar una versión',
        'Snapshots expirados por TTL',
        'Snapshots sin permiso',
      ]),
      'Operator runbook must explain auto-merge review, no-snapshot causes and restore/no-restore criteria.',
      ['docs/RUNBOOK_DAILY_CENSUS_RECOVERY.md']
    ),
    buildCheck(
      'clinical-conflict-center-contract',
      includesAll(clinicalConflictCenter, [
        'buildClinicalConflictCenterModel',
      ]) &&
        includesAll(clinicalConflictClassifier, [
        'nursing_handoff',
        'medical_handoff',
        'movements',
      ]) &&
        includesAll(conflictCenterComponent, [
          'Centro de conflictos clínicos',
          'Preservar',
        'manual_preserve_selected_truth',
      ]) &&
        includesAll(repositoryAuditPort, ['reviewContext', 'clinical_conflict_center']) &&
        includesAll(firestoreRules, [
          'canManageClinicalConflictSnapshots',
          "['admin', 'nurse_hospital']",
        ]),
      'Clinical conflict center must cover census, handoff and movement scopes with auditable manual preservation.',
      [
        'src/application/clinical-conflicts/clinicalConflictCenterController.ts',
        'src/application/clinical-conflicts/clinicalConflictPathClassifier.ts',
        'src/components/clinical-conflicts/ClinicalConflictCenterControl.tsx',
        'src/services/repositories/ports/repositoryAuditPort.ts',
        'firestore.rules',
      ]
    ),
  ];

  return {
    ok: checks.every(check => check.ok),
    checks,
  };
};

export const formatDailyRecordTruthContractReport = result => {
  const lines = ['# Daily Record Truth Contract', ''];
  for (const check of result.checks) {
    lines.push(`- ${check.ok ? 'OK' : 'FAIL'} ${check.id}: ${check.description}`);
    if (!check.ok && check.evidence.length > 0) {
      lines.push(`  Evidence: ${check.evidence.join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
};
