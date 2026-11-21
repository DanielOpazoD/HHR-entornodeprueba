import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockNotifyError = vi.fn();
const auditContextMocks = vi.hoisted(() => ({
  logHandoffNovedadesModified: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ error: mockNotifyError }),
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logHandoffNovedadesModified: auditContextMocks.logHandoffNovedadesModified,
    userId: 'test-user',
  }),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn().mockReturnValue(''),
}));

import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import { DailyRecordFreshnessGateError } from '@/hooks/controllers/dailyRecordFreshnessGateError';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { DataFactory } from '@/tests/factories/DataFactory';

type Actions = ReturnType<typeof useHandoffManagement>;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const createRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-11-20', {
    handoffNovedadesDayShift: 'Antes día',
    handoffNovedadesNightShift: '',
    nursesDayShift: ['Enfermera Día'],
    nursesNightShift: ['Enfermera Noche'],
  });

// Each patch below is what main (f448e06e0) sent for the same action, recorded through
// useHandoffManagement with the same record before this path was shortened.
const SAME_PATCH_AS_MAIN: [string, (actions: Actions) => void, DailyRecordPatch][] = [
  [
    'day checklist',
    a => a.updateHandoffChecklist('day', 'escalaBraden', true),
    { 'handoffDayChecklist.escalaBraden': true },
  ],
  [
    'night checklist',
    a => a.updateHandoffChecklist('night', 'estadoPiel', false),
    { 'handoffNightChecklist.estadoPiel': false },
  ],
  [
    'night checklist text',
    a => a.updateHandoffChecklist('night', 'otro', 'texto'),
    { 'handoffNightChecklist.otro': 'texto' } as DailyRecordPatch,
  ],
  [
    'crash-cart code',
    a => a.updateHandoffChecklist('shared', 'crashCartCode', '00123456'),
    { 'handoffSharedChecklist.crashCartCode': '00123456' },
  ],
  [
    'crash-cart review date',
    a => a.updateHandoffChecklist('shared', 'crashCartReviewDate', '2026-11-19'),
    { 'handoffSharedChecklist.crashCartReviewDate': '2026-11-19' },
  ],
  [
    'cleared crash-cart review date',
    a => a.updateHandoffChecklist('shared', 'crashCartReviewDate', ''),
    { 'handoffSharedChecklist.crashCartReviewDate': '' },
  ],
  [
    'day novedades',
    a => a.updateHandoffNovedades('day', 'Texto día'),
    { handoffNovedadesDayShift: 'Texto día' },
  ],
  [
    'night novedades',
    a => a.updateHandoffNovedades('night', 'Texto noche'),
    { handoffNovedadesNightShift: 'Texto noche' },
  ],
  [
    'day «Recibe»',
    a => a.updateHandoffReceives('day', ['Persona A', 'Persona B']),
    { nursesNightShift: ['Persona A', 'Persona B'] },
  ],
  [
    'night «Recibe»',
    a => a.updateHandoffReceives('night', ['Persona C']),
    { handoffNightReceives: ['Persona C'] },
  ],
  [
    'emptied night «Recibe»',
    a => a.updateHandoffReceives('night', []),
    { handoffNightReceives: [] },
  ],
];

describe('useHandoffManagement', () => {
  const unhandled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.on('unhandledRejection', unhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', unhandled);
  });

  it('returns the three handoff actions', () => {
    const { result } = renderHook(() => useHandoffManagement(createRecord(), vi.fn()));

    expect(Object.keys(result.current).sort()).toEqual([
      'updateHandoffChecklist',
      'updateHandoffNovedades',
      'updateHandoffReceives',
    ]);
  });

  it.each(SAME_PATCH_AS_MAIN)('sends the same patch as main for the %s', (_name, act, patch) => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHandoffManagement(createRecord(), patchRecord));

    act(result.current);

    expect(patchRecord.mock.calls).toEqual([[patch]]);
    expect(mockNotifyError).not.toHaveBeenCalled();
  });

  it.each([
    ['crashCartCode', '123'],
    ['crashCartCode', true],
    ['otro', '00123456'],
  ] as const)('refuses shared field %s = %s without writing, as main did', (field, value) => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHandoffManagement(createRecord(), patchRecord));

    result.current.updateHandoffChecklist('shared', field, value);

    expect(patchRecord).not.toHaveBeenCalled();
    expect(mockNotifyError).toHaveBeenCalledWith(
      'Error al guardar',
      'Revise la fecha del carro de paro y use un código de 8 dígitos.'
    );
  });

  it('writes nothing and says nothing without a day', () => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHandoffManagement(null, patchRecord));

    result.current.updateHandoffChecklist('day', 'escalaBraden', true);
    result.current.updateHandoffNovedades('day', 'Texto');
    result.current.updateHandoffReceives('night', ['Persona C']);

    expect(patchRecord).not.toHaveBeenCalled();
    expect(mockNotifyError).not.toHaveBeenCalled();
  });

  it('audits saved novedades with the previous text, as main did', async () => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useHandoffManagement(createRecord(), patchRecord));

    result.current.updateHandoffNovedades('day', 'Texto día');
    result.current.updateHandoffNovedades('night', 'Texto noche');
    await flush();

    expect(auditContextMocks.logHandoffNovedadesModified.mock.calls).toEqual([
      ['day', 'Texto día', 'Antes día', '2026-11-20', ''],
      ['night', 'Texto noche', '', '2026-11-20', ''],
    ]);
  });

  it.each([
    ['checklist', (a: Actions) => a.updateHandoffChecklist('day', 'escalaBraden', true)],
    ['novedades', (a: Actions) => a.updateHandoffNovedades('day', 'Texto día')],
    ['«Recibe»', (a: Actions) => a.updateHandoffReceives('day', ['Persona A'])],
  ])(
    'leaves no rejection behind when the %s write is refused, and lets it retry',
    async (_name, act) => {
      const patchRecord = vi
        .fn<(patch: DailyRecordPatch) => Promise<void>>()
        .mockRejectedValueOnce(new DailyRecordFreshnessGateError('Estamos verificando.'))
        .mockResolvedValue(undefined);
      const { result } = renderHook(() => useHandoffManagement(createRecord(), patchRecord));

      act(result.current);
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
      expect(auditContextMocks.logHandoffNovedadesModified).not.toHaveBeenCalled();
      // patchRecord already told the user; the hook adds no second notice.
      expect(mockNotifyError).not.toHaveBeenCalled();

      act(result.current);
      await flush();
      expect(patchRecord).toHaveBeenCalledTimes(2);
    }
  );
});
