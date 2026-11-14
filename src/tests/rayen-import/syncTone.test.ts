import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import type { RayenSyncEvent, RayenSyncFailureReason } from '@/types/domain/rayenSync';
import type { RayenExtensionConnectionState } from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import type { RayenSyncStage } from '@/features/rayen-import/hooks/rayenSyncExecutionState';
import {
  buildRayenSyncBarViewModel,
  type RayenSyncBarViewModelInput,
} from '@/features/rayen-import/components/rayenSyncBarViewModel';
import { presentRayenSyncRecovery } from '@/features/rayen-import/components/rayenSyncRecoveryPresentation';
import {
  localSyncAttentionLevel,
  listQuarantinedOperations,
} from '@/features/rayen-import/components/localSyncPresentation';
import { rayenFailureReasonLabel } from '@/features/rayen-import/components/rayenSyncPresentation';
import { rayenSourceStateLabel } from '@/features/rayen-import/components/RayenConnectionMonitor';
import {
  SYNC_BAR_TONE_LEVEL,
  SYNC_TONE,
  SYNC_TONE_INFO_VARIANT,
  SYNC_TONE_LEVELS,
  highestSyncTone,
  type SyncToneLevel,
} from '@/features/rayen-import/components/syncTone';

const ALARM_COLOR = /\b[a-z:-]*(?:red|rose|amber|orange|yellow)-\d{2,3}\b/;
const FAILURE_WORDING = /error|falló|alerta|¡/i;

interface PresentedState {
  id: string;
  level: SyncToneLevel;
  texts: string[];
}

const fill = {
  running: false,
  outcome: 'idle',
  attemptId: 0,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  staffingOutcome: 'idle',
} as RayenSyncBarViewModelInput['fill'];
const barInput = (overrides: Partial<RayenSyncBarViewModelInput>): RayenSyncBarViewModelInput => ({
  diff: null,
  fill,
  error: null,
  hasPersistedSync: false,
  targetDate: '2026-11-13',
  now: Date.parse('2026-11-13T15:00:00Z'),
  ...overrides,
});
const coverage = (errors: number) => ({
  total: 8,
  completed: 8 - errors,
  errors,
  sourceErrors: 0,
  completedAt: '2026-11-13T14:00:00.000Z',
});

const stages: RayenSyncStage['type'][] = [
  'preparing_context',
  'capturing',
  'planning_structure',
  'awaiting_review',
  'needs_review',
  'persisting_structure',
  'verifying_structure',
  'syncing_clinical',
  'complete',
  'partial',
  'failed',
  'cancelled',
];

const barStates = (): PresentedState[] => {
  const inputs: Array<[string, RayenSyncBarViewModelInput]> = [
    ['A1 idle', barInput({})],
    [
      'A2 stale',
      barInput({
        hasPersistedSync: true,
        persistedSync: { status: 'complete', coverage: coverage(0), at: '2026-11-13T13:00:00Z' },
      }),
    ],
    ['A5 shared clinical fill', barInput({ fill: { ...fill, running: true, done: 2, total: 8 } })],
    ['A12 validation error', barInput({ error: 'La política aún se está cargando.' })],
    [
      'A13 persisted applied',
      barInput({
        hasPersistedSync: true,
        persistedSync: { status: 'applied', coverage: coverage(0) },
      }),
    ],
    [
      'A14 persisted without coverage',
      barInput({ hasPersistedSync: true, persistedSync: { status: 'partial' } as never }),
    ],
    [
      'A15 persisted with observations',
      barInput({
        hasPersistedSync: true,
        persistedSync: { status: 'partial', coverage: coverage(1) },
      }),
    ],
    ...stages.map(
      type =>
        [`A stage ${type}`, barInput({ executionStage: { type } as RayenSyncStage })] as [
          string,
          RayenSyncBarViewModelInput,
        ]
    ),
  ];
  return inputs.map(([id, input]) => {
    const model = buildRayenSyncBarViewModel(input);
    return { id, level: SYNC_BAR_TONE_LEVEL[model.tone], texts: [model.label] };
  });
};

const failureReasons: RayenSyncFailureReason[] = [
  'extension_unavailable',
  'extension_incompatible',
  'ficha_medico_unavailable',
  'ficha_medico_stale',
  'gestion_camas_unavailable',
  'snapshot_network_error',
  'snapshot_timeout',
  'snapshot_error',
  'apply_unauthorized',
  'apply_conflict',
  'apply_failed',
];
const connections: RayenExtensionConnectionState[] = [
  'checking',
  'ready',
  'degraded',
  'blocked',
  'incompatible',
  'offline',
];

const event = (overrides: Partial<RayenSyncEvent>): RayenSyncEvent =>
  ({
    id: 'run-1',
    startedAt: '2026-11-13T14:00:00.000Z',
    by: 'enfermera@hospital.test',
    status: 'failed',
    ...overrides,
  }) as RayenSyncEvent;

const recoveryStates = (): PresentedState[] => {
  const states: PresentedState[] = [];
  const events = [
    ...failureReasons.map(reason => event({ failureReason: reason })),
    event({ status: 'partial', coverage: coverage(1) }),
    event({ status: 'applied' }),
  ];
  for (const candidate of events)
    for (const connection of connections)
      for (const running of [false, true])
        for (const clinicalRetry of [false, true]) {
          const presentation = presentRayenSyncRecovery(
            candidate,
            connection,
            running,
            clinicalRetry
          );
          if (!presentation) continue;
          states.push({
            id: `C ${candidate.status}/${candidate.failureReason ?? '-'}/${connection}/${running}/${clinicalRetry}`,
            level: presentation.level,
            texts: [presentation.title, presentation.detail, presentation.actionLabel ?? ''],
          });
        }
  return states;
};

const stats = (overrides: Partial<SyncQueueStats>): SyncQueueStats =>
  ({
    pending: 0,
    failed: 0,
    conflict: 0,
    retrying: 0,
    acked: 0,
    oldestPendingAgeMs: 0,
    readState: 'ready',
    recentOperationsReadState: 'ready',
    ...overrides,
  }) as SyncQueueStats;

const localStates = (): PresentedState[] =>
  (
    [
      [
        'B1 aging pending',
        stats({ pending: 1, oldestPendingAgeMs: 60_000 }),
        'Guardado pendiente · Ver detalle',
      ],
      ['B1 retrying', stats({ pending: 1, retrying: 1 }), 'Guardado pendiente · Ver detalle'],
      [
        'B2 unreadable queue',
        stats({ readState: 'unavailable' }),
        'Guardado pendiente · Ver detalle',
      ],
      ['B3 failed send', stats({ failed: 1 }), 'Hay cambios sin enviar · Revisa el detalle'],
      ['B3 conflict', stats({ conflict: 1 }), 'Hay cambios sin enviar · Revisa el detalle'],
    ] as const
  ).map(([id, value, text]) => ({ id, level: localSyncAttentionLevel(value)!, texts: [text] }));

const connectionStates = (): PresentedState[] =>
  connections.flatMap(connection =>
    (['fichaMedico', 'gestionCamas'] as const).map(blockedBy => ({
      id: `D ${connection}/${blockedBy}`,
      level: (connection === 'ready' || connection === 'checking'
        ? 'info'
        : 'review') as SyncToneLevel,
      texts: [rayenSourceStateLabel(connection, blockedBy === 'gestionCamas', false, blockedBy)],
    }))
  );

const allStates = (): PresentedState[] => [
  ...barStates(),
  ...recoveryStates(),
  ...localStates(),
  ...connectionStates(),
  ...failureReasons.map(reason => ({
    id: `C reason ${reason}`,
    level: 'review' as SyncToneLevel,
    texts: [rayenFailureReasonLabel(reason)],
  })),
];

describe('sync box tone', () => {
  it('places every state of the inventory in exactly one of the three levels', () => {
    const states = allStates();
    expect(states.length).toBeGreaterThan(60);
    for (const state of states) expect(SYNC_TONE_LEVELS, state.id).toContain(state.level);
  });

  it('keeps alarm reds, oranges and yellows out of the informative and review levels', () => {
    const calm = [
      SYNC_TONE.info,
      SYNC_TONE.review,
      SYNC_TONE_INFO_VARIANT.ok,
      SYNC_TONE_INFO_VARIANT.progress,
      SYNC_TONE_INFO_VARIANT.idle,
    ];
    for (const classes of calm)
      for (const value of Object.values(classes)) expect(value).not.toMatch(ALARM_COLOR);
    // The action level stays unmistakable by shape and weight, not by an alarm color either.
    for (const value of Object.values(SYNC_TONE.action)) expect(value).not.toMatch(ALARM_COLOR);
    expect(SYNC_TONE.action.surface).toContain('border-2');
    expect(SYNC_TONE.action.text).toContain('font-semibold');
  });

  it('words informative and review states without failure or alarm language', () => {
    for (const state of allStates().filter(candidate => candidate.level !== 'action'))
      for (const text of state.texts) expect(text, state.id).not.toMatch(FAILURE_WORDING);
  });

  it('reserves the action level for local sends that stopped and will not resume alone', () => {
    const actionStates = allStates().filter(state => state.level === 'action');
    expect(actionStates.map(state => state.id)).toEqual(['B3 failed send', 'B3 conflict']);
    expect(localSyncAttentionLevel(stats({}))).toBeNull();
    expect(highestSyncTone('review', null, 'action', 'info')).toBe('action');
    expect(highestSyncTone(undefined, null)).toBeNull();
  });

  it('labels stopped sends with what happened, never as a bare error', () => {
    const labels = (['conflict', 'authorization', 'validation', 'network', 'unknown'] as const).map(
      category =>
        listQuarantinedOperations([
          {
            id: 1,
            type: 'UPDATE_DAILY_RECORD',
            status: 'FAILED',
            key: 'daily:2026-11-13',
            lastErrorCategory: category,
          } as never,
        ])[0].categoryLabel
    );
    for (const label of labels) expect(label).not.toMatch(FAILURE_WORDING);
  });

  it('leaves no loose alarm color classes in the sync box components', () => {
    const directory = path.resolve(__dirname, '../../features/rayen-import/components');
    const boxFiles = [
      'RayenImportButton.tsx',
      'RayenSyncStatusLine.tsx',
      'RayenImportFlowStatus.tsx',
      'RayenImportSummaryChips.tsx',
      'RayenSyncRecoveryNotice.tsx',
      'RayenConnectionMonitor.tsx',
      'RayenSyncQueueDetails.tsx',
      'DailyRecordTaskRecovery.tsx',
      'RayenCompatibleReaderNotice.tsx',
      'RayenExtensionDownload.tsx',
      'RayenExtensionDownloadDetails.tsx',
      'rayenSyncPresentation.ts',
      'rayenSyncBarViewModel.ts',
      'localSyncPresentation.ts',
      'rayenSyncRecoveryPresentation.ts',
      'syncTone.ts',
    ];
    for (const file of boxFiles) {
      const source = readFileSync(path.join(directory, file), 'utf8');
      expect(source.match(ALARM_COLOR)?.[0] ?? null, `${file}: use syncTone.ts`).toBeNull();
    }
  });
});
