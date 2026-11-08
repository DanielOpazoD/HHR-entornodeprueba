import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { DataFactory } from '@/tests/factories/DataFactory';
import { updateSpecialistMedicalHandoffViaCallable } from '@/services/storage/firestore/specialistMedicalHandoffClient';
import { UIProvider } from '@/context/UIContext';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

import { useEffect, useRef } from 'react';
import { useHandoffManagementDelivery } from '@/hooks/useHandoffManagementDelivery';
import { sendWhatsAppMessage } from '@/services/integrations/whatsapp/whatsappService';

vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  formatHandoffMessage: () => 'Entrega sintética',
  sendWhatsAppMessage: vi.fn(),
}));

const { repository } = vi.hoisted(() => ({
  repository: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    subscribeDetailed: vi.fn(() => vi.fn()),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    syncWithFirestoreDetailed: vi.fn(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => {
    throw Object.assign(new Error('Synthetic episode conflict'), {
      code: 'functions/failed-precondition',
    });
  },
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getFunctions: async () => ({}) },
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: async () => ({
    exists: () => true,
    data: () => ({
      beds: {
        R4: {
          clinicalEpisodeId: 'synthetic-episode-A',
          patientName: 'Paciente A Sintético',
          rut: '99.999.999-9',
        },
      },
    }),
  }),
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({}),
}));

vi.mock('@/utils/dateCoreUtils', async () => ({
  ...(await vi.importActual('@/utils/dateCoreUtils')),
  getTodayISO: () => '2025-12-27',
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: repository,
  defaultDailyRecordWritePort: {
    updatePartial: repository.updatePartialDetailed,
    save: repository.saveDetailed,
    delete: repository.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: repository.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: repository,
}));

vi.mock('@/services/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/RepositoryContext')>()),
  useRepositories: () => ({ dailyRecord: repository }),
}));

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ checkVersion: vi.fn(), currentVersion: 1, isOutdated: false }),
}));

vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: vi.fn().mockResolvedValue({
    success: true,
    data: { date: '2025-12-27', outcome: 'clean', record: null },
  }),
}));

const mockDate = '2025-12-27';
const mockRecord = DataFactory.createMockDailyRecord(mockDate, {
  beds: {},
  lastUpdated: '2026-01-01T00:00:00.000Z',
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
});

const buildReadResult = () => ({
  serverConfirmed: false,
  date: mockDate,
  record: mockRecord,
  source: 'indexeddb' as const,
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: 'local_only' as const,
  sourceOfTruth: 'local' as const,
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read'],
  repairApplied: false,
});

const createWrapper = () =>
  createQueryClientTestWrapper({
    wrapChildren: children => <UIProvider>{children}</UIProvider>,
  }).wrapper;

describe('useDailyRecordSyncQuery notification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult()
    );
    vi.mocked(defaultDailyRecordRepositoryPort.saveDetailed).mockResolvedValue(
      createSaveDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        savedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
      })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['import', 'previous day', 'signature token', 'WhatsApp', 'sent marker'])(
    'keeps send writes and confirmation on the origin day when switching during %s',
    async stage => {
      const originDate = mockDate;
      const nextDate = '2025-12-28';
      const records = new Map(
        [originDate, nextDate].map(date => [date, DataFactory.createMockDailyRecord(date)])
      );
      records.get(originDate)!.medicalSignatureLinkTokenByScope = { upc: 'synthetic-upc' };
      const nextRecord = records.get(nextDate);
      let release = () => {};
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const pause = vi.fn(async (step: string) => {
        if (stage === step) {
          await gate;
        }
      });
      vi.spyOn(repository, 'getForDateWithMeta').mockImplementation(async date => ({
        ...buildReadResult(),
        record: records.get(date) ?? null,
        date,
      }));
      vi.spyOn(repository, 'getPreviousDay').mockImplementation(async () => {
        await pause('previous day');
        return { medicalHandoffDoctor: 'Dra. Sintética' };
      });
      vi.spyOn(repository, 'updatePartialDetailed').mockImplementation(async (date, patch) => {
        await pause(patch.medicalHandoffSentAt ? 'sent marker' : 'signature token');
        const record = { ...records.get(date)!, ...patch };
        records.set(date, record);
        return createUpdatePartialDailyRecordResult({
          date,
          outcome: 'clean',
          savedLocally: true,
          updatedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: Object.keys(patch).length,
          confirmedRecord: record,
        });
      });
      vi.mocked(sendWhatsAppMessage).mockImplementation(async () => {
        await pause('WhatsApp');
        return { success: true };
      });
      const informed = vi.fn();
      const { wrapper, queryClient } = createQueryClientTestWrapper({
        wrapChildren: children => <UIProvider>{children}</UIProvider>,
      });
      const { result, rerender } = renderHook(
        ({ date }) => {
          const sync = useDailyRecordSyncQuery(date, false, 'local_only');
          const recordRef = useRef(sync.record);
          useEffect(() => {
            recordRef.current = sync.record;
          }, [sync.record]);
          const delivery = useHandoffManagementDelivery({
            recordRef,
            recordDate: date,
            role: 'admin',
            patchRecord: sync.patchRecord,
            success: informed,
            notifyError: informed,
          });
          return { sync, delivery };
        },
        { initialProps: { date: originDate }, wrapper }
      );
      await waitFor(() => expect(result.current.sync.record?.date).toBe(originDate));
      let sending: Promise<void>;
      act(() => {
        sending = result.current.delivery.sendMedicalHandoff(
          'synthetic-template',
          'synthetic-group'
        );
      });
      if (stage !== 'import') await waitFor(() => expect(pause).toHaveBeenCalledWith(stage));
      rerender({ date: nextDate });
      await waitFor(() => expect(result.current.sync.record?.date).toBe(nextDate));
      await act(async () => {
        release();
        await sending;
      });
      expect(repository.updatePartialDetailed.mock.calls.map(([date]) => date)).toEqual([
        originDate,
        originDate,
      ]);
      expect(records.get(originDate)).toMatchObject({
        medicalHandoffDoctor: 'Dra. Sintética',
        medicalHandoffSentAt: expect.any(String),
        medicalSignatureLinkTokenByScope: {
          upc: 'synthetic-upc',
          all: expect.any(String),
        },
      });
      expect(records.get(nextDate)).toEqual(nextRecord);
      expect(result.current.sync.record).toEqual(nextRecord);
      expect(informed).toHaveBeenCalledWith('WhatsApp Enviado', expect.any(String));
      queryClient.clear();
    }
  );

  it('shows the specialist server episode rejection as an editing conflict, never as saved', async () => {
    const partial = { 'beds.R4.medicalHandoffNote': 'Nota sintética de A' };
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementationOnce(
      async () => {
        await updateSpecialistMedicalHandoffViaCallable({
          date: mockDate,
          patch: partial,
          expectedOccupants: [
            {
              bedId: 'R4',
              target: 'bed',
              clinicalEpisodeId: 'synthetic-episode-A',
              patientName: 'Paciente A Sintético',
              rut: '99.999.999-9',
              documentType: 'RUT',
            },
          ],
        });
        throw new Error('Expected the server to reject the replaced episode');
      }
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());
    await act(async () => {
      await expect(result.current.patchRecord(partial)).rejects.toThrow(/R4.*borrador/);
    });
    expect(screen.getAllByText('Conflicto de Edición')).toHaveLength(1);
    expect(screen.getByText(/episodio o la nota de la cama R4.*borrador/)).toBeInTheDocument();
    expect(screen.queryByText('Cambio guardado')).not.toBeInTheDocument();
    expect(repository.updatePartialDetailed).toHaveBeenCalledTimes(1);
  });

  it('passes the identity captured while typing through the patch boundary without forcing online-only persistence', async () => {
    const expected = [
      {
        bedId: 'R4',
        target: 'bed' as const,
        clinicalEpisodeId: 'ep-A',
        rut: '99.999.999-9',
        documentType: 'RUT',
        patientName: 'Paciente A Sintético',
      },
    ];
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());
    await act(async () => {
      await result.current.patchRecord(
        { 'beds.R4.medicalHandoffNote': 'Nota de A' },
        { specialistHandoffTargets: expected }
      );
    });
    expect(repository.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      expect.anything(),
      expect.objectContaining({ specialistHandoffTargets: expected })
    );
    expect(repository.updatePartialDetailed.mock.calls[0][2]).not.toHaveProperty(
      'requireRemoteAuthorityFirst'
    );
  });

  it('emits exactly one truthful notice for a server-confirmed save', async () => {
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await result.current.saveAndUpdate({
        ...mockRecord,
        lastUpdated: '2026-01-01T00:00:02.000Z',
      });
    });

    expect(screen.getAllByText('Censo guardado')).toHaveLength(1);
    expect(screen.getAllByText('Los cambios quedaron confirmados en el servidor.')).toHaveLength(1);
    expect(screen.queryByText(/se guardaron localmente/i)).not.toBeInTheDocument();
  });

  it('emits exactly one non-committal notice when a patch fails completely', async () => {
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await expect(result.current.patchRecord({ nurses: [] })).rejects.toThrow(
        'storage unavailable'
      );
    });

    expect(screen.getAllByText('Cambio no guardado')).toHaveLength(1);
    expect(
      screen.getAllByText(
        'No fue posible completar la actualización. El cambio no quedó confirmado; revisa el censo antes de reintentar.'
      )
    ).toHaveLength(1);
    expect(screen.queryByText(/los cambios se guardaron localmente/i)).not.toBeInTheDocument();
  });

  it('emits exactly one rejection notice when a resolved save outcome is blocked', async () => {
    vi.mocked(defaultDailyRecordRepositoryPort.saveDetailed).mockResolvedValueOnce(
      createSaveDailyRecordResult({
        date: mockDate,
        outcome: 'blocked',
        savedLocally: false,
        savedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
        blockingReason: 'validation',
      })
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await expect(result.current.saveAndUpdate(mockRecord)).rejects.toThrow(
        'La operación quedó bloqueada por una validación de consistencia.'
      );
    });

    expect(screen.getAllByText('Guardado bloqueado')).toHaveLength(1);
    expect(screen.getAllByText('La operación fue rechazada y no quedó confirmada.')).toHaveLength(
      1
    );
    expect(screen.queryByText('Error de sincronización')).not.toBeInTheDocument();
  });
});
