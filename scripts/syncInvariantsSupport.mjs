import fs from 'node:fs';
import path from 'node:path';

const readText = (root, filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');

const buildInvariant = (id, ok, description, evidence = []) => ({
  id,
  ok,
  description,
  evidence,
});

const productionRepositoryFiles = root => {
  const repositoryRoot = path.join(root, 'src/services/repositories');
  const visit = directory =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return visit(absolutePath);
      }
      return entry.isFile() && absolutePath.endsWith('.ts') ? [absolutePath] : [];
    });
  return visit(repositoryRoot);
};

const hasVoidLocalPersistenceImport = (root, filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  return /import\s*\{[^}]*\b(?:saveRecord|saveRecords|deleteRecord)\b(?!Strict)[^}]*\}\s*from\s*['"]@\/services\/storage\/indexeddb\/indexedDbRecordService['"]/.test(
    source
  );
};

export const evaluateSyncInvariants = root => {
  const packageJson = JSON.parse(readText(root, 'package.json'));
  const ports = readText(root, 'src/services/storage/sync/syncQueuePorts.ts');
  const engine = readText(root, 'src/services/storage/sync/syncQueueEngine.ts');
  const enqueuePolicy = readText(root, 'src/services/storage/sync/syncQueueEnqueuePolicy.ts');
  const publicQueue = readText(root, 'src/services/storage/sync/publicSyncQueue.ts');
  const contractPolicy = readText(root, 'src/services/storage/sync/syncTaskContractPolicy.ts');
  const transport = readText(root, 'src/services/storage/sync/firestoreSyncTransport.ts');
  const conflictPolicy = readText(root, 'src/services/storage/sync/firestoreSyncConflictPolicy.ts');
  const repositoryWrite = readText(
    root,
    'src/services/repositories/dailyRecordRepositoryWriteService.ts'
  );
  const preOutboxRemoteAckPolicy = readText(
    root,
    'src/services/repositories/dailyRecordPreOutboxRemoteAckPolicy.ts'
  );
  const preOutboxRemoteAckCallbacks = readText(
    root,
    'src/services/repositories/dailyRecordPreOutboxRemoteAckCallbacks.ts'
  );
  const firestoreWrites = readText(root, 'src/services/storage/firestore/firestoreRecordWrites.ts');
  const telemetry = readText(root, 'src/services/storage/sync/syncQueueTelemetryController.ts');
  const envExample = readText(root, '.env.example');
  const runbook = readText(root, 'docs/RUNBOOK_SYNC_RESILIENCE.md');

  const repositoryOffenders = productionRepositoryFiles(root)
    .filter(filePath => hasVoidLocalPersistenceImport(root, filePath))
    .map(filePath => path.relative(root, filePath));

  const invariants = [
    buildInvariant(
      'atomic-sync-claim-api',
      ports.includes('claimReadyPending') && !ports.includes('listReadyPending'),
      'Sync queue workers must atomically claim ready tasks instead of listing and updating separately.',
      ['syncQueuePorts.ts']
    ),
    buildInvariant(
      'claimed-completion-telemetry',
      engine.includes('recordSyncQueueStaleClaimTelemetry') &&
        telemetry.includes("operation: 'sync_queue_stale_claim_noop'"),
      'Claimed task completion/update no-ops must be observable as recoverable stale-claim telemetry.',
      ['syncQueueEngine.ts', 'syncQueueTelemetryController.ts']
    ),
    buildInvariant(
      'authority-release-gate',
      packageJson.scripts?.['ci:release-gate']?.includes(
        'check:daily-record-authority-release-gate'
      ) && envExample.includes('Release must use VITE_DAILY_RECORD_AUTHORITY_MODE=enforced'),
      'Release writes must require daily-record authority mode and document the deploy env flag.',
      ['package.json', '.env.example']
    ),
    buildInvariant(
      'strict-repository-local-persistence',
      repositoryOffenders.length === 0,
      'Critical repository writes must avoid void local persistence wrappers.',
      repositoryOffenders.length > 0 ? repositoryOffenders : ['src/services/repositories']
    ),
    buildInvariant(
      'sync-runbook',
      runbook.includes('PROCESSING` con `leaseUntil` vencido') &&
        runbook.includes('sync_queue_stale_claim_noop') &&
        runbook.includes('pre-outbox'),
      'The sync runbook must explain expired leases, stale-claim telemetry and pre-outbox ack flow for support.',
      ['docs/RUNBOOK_SYNC_RESILIENCE.md']
    ),
    buildInvariant(
      'full-save-sync-contract',
      repositoryWrite.includes('buildDailyRecordSyncContract(validatedRecord') &&
        /saveRecordToFirestore\(validatedRecord, command\.expectedLastUpdated, \{\s*syncContract/.test(
          repositoryWrite
        ) &&
        firestoreWrites.includes('syncContract: options.syncContract'),
      'Full daily-record saves must propagate syncContract/baseRevision to the remote authority path.',
      [
        'src/services/repositories/dailyRecordRepositoryWriteService.ts',
        'src/services/storage/firestore/firestoreRecordWrites.ts',
      ]
    ),
    buildInvariant(
      'pre-outbox-direct-write-ack',
      repositoryWrite.includes('queueLocalBeforeRemote') &&
        repositoryWrite.includes('buildPreOutboxRemoteAckCallbacks') &&
        preOutboxRemoteAckCallbacks.includes('ackLocalAfterRemote') &&
        preOutboxRemoteAckCallbacks.includes('releaseLocalPreOutboxHold') &&
        preOutboxRemoteAckCallbacks.includes('renewLocalPreOutboxHold') &&
        publicQueue.includes('ackDailyRecordSyncTask') &&
        publicQueue.includes('releaseDailyRecordPreOutboxHold') &&
        engine.includes('deferProcessing') &&
        engine.includes('resolveSyncTaskNextAttemptAt') &&
        enqueuePolicy.includes('holdForMs') &&
        preOutboxRemoteAckPolicy.includes('PRE_OUTBOX_DIRECT_WRITE_HOLD_MS') &&
        preOutboxRemoteAckPolicy.includes("preOutboxHoldReason: 'awaiting_remote_ack'"),
      'Repository writes must prequeue local outbox tasks transactionally, hold/defer processing, and ack them after confirmed remote success.',
      [
        'src/services/repositories/dailyRecordRepositoryWriteService.ts',
        'src/services/repositories/dailyRecordPreOutboxRemoteAckCallbacks.ts',
        'src/services/repositories/dailyRecordPreOutboxRemoteAckPolicy.ts',
        'src/services/storage/sync/publicSyncQueue.ts',
        'src/services/storage/sync/syncQueueEngine.ts',
      ]
    ),
    buildInvariant(
      'sync-contract-coalescing',
      contractPolicy.includes('mergeSyncTaskContracts') &&
        engine.includes('mergeSyncTaskContracts(existing.syncContract'),
      'Reused sync tasks must merge semantic syncContract paths instead of overwriting them.',
      [
        'src/services/storage/sync/syncTaskContractPolicy.ts',
        'src/services/storage/sync/syncQueueEngine.ts',
      ]
    ),
    buildInvariant(
      'idempotent-mutation-drain',
      transport.includes('hasRemoteAppliedMutation') &&
        transport.includes("resolution: 'already_applied'") &&
        transport.includes('record: null') &&
        conflictPolicy.includes('lastMutationId'),
      'Sync queue replay must treat a remote matching mutationId as an already-applied success so local outbox can drain.',
      [
        'src/services/storage/sync/firestoreSyncTransport.ts',
        'src/services/storage/sync/firestoreSyncConflictPolicy.ts',
      ]
    ),
  ];

  return {
    ok: invariants.every(invariant => invariant.ok),
    invariants,
  };
};

export const formatSyncInvariantsReport = result => {
  const lines = ['# Sync Invariants', ''];
  for (const invariant of result.invariants) {
    lines.push(`- ${invariant.ok ? 'OK' : 'FAIL'} ${invariant.id}: ${invariant.description}`);
    if (!invariant.ok && invariant.evidence.length > 0) {
      lines.push(`  Evidence: ${invariant.evidence.join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
};
