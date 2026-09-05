import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusEmailDeliveryActions } from '@/hooks/useCensusEmailDeliveryActions';
import { DataFactory } from '@/tests/factories/DataFactory';

const execute = vi.hoisted(() => vi.fn());
vi.mock('@/application/census-email/sendCensusEmailUseCases', () => ({
  buildSendCensusConfirmationMessage: () => 'Confirmar envío de prueba',
  executeSendCensusEmail: execute,
}));
const date = '2026-09-04';
const makeRecord = (completed: boolean) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente sintético',
        upcChecklist: completed
          ? {
              uciCriteria: [],
              utiCriteria: [],
              classification: null,
              evaluatedAt: '2026-09-04T10:00:00Z',
              evaluatedForDate: date,
              evaluatedBedId: 'R1',
              evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
              responsibleNurse: { name: 'Enfermera de prueba', source: 'assigned' },
            }
          : undefined,
      }),
    },
  });
const setup = (completed = true) => {
  const params: Parameters<typeof useCensusEmailDeliveryActions>[0] = {
    record: makeRecord(completed),
    currentDateString: date,
    nurseSignature: 'Enfermera',
    selectedYear: 2026,
    selectedMonth: 8,
    selectedDay: 4,
    user: { uid: 'test', role: 'admin' },
    role: 'admin',
    recipients: ['test@example.com'],
    message: 'Prueba',
    status: 'idle',
    testModeEnabled: false,
    testRecipient: '',
    isAdminUser: true,
    setStatus: vi.fn(),
    setError: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(undefined),
  };
  return { params, ...renderHook(useCensusEmailDeliveryActions, { initialProps: params }) };
};
beforeEach(() => {
  execute.mockReset().mockResolvedValue({
    status: 'success',
    data: { recipients: [], backupUploaded: true },
    issues: [],
  });
});

describe('UPC email confirmation gate', () => {
  it('never asks to confirm or sends when the current day is pending', async () => {
    const { result, params } = setup(false);
    await act(() => result.current.sendEmail());
    expect(params.confirm).not.toHaveBeenCalled();
    expect(params.setError).toHaveBeenCalledWith(expect.stringContaining('R1'));
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['pending', 'different-day'])(
    'rechecks %s changes while confirmation is open',
    async change => {
      const { result, params, rerender } = setup();
      let confirm!: (accepted: boolean) => void;
      vi.mocked(params.confirm).mockReturnValue(
        new Promise(resolve => {
          confirm = resolve;
        })
      );
      let sending!: Promise<void>;
      act(() => {
        sending = result.current.sendEmail();
      });
      await waitFor(() => expect(params.confirm).toHaveBeenCalledTimes(1));
      rerender({
        ...params,
        record: change === 'pending' ? makeRecord(false) : params.record,
        currentDateString: change === 'different-day' ? '2026-09-05' : date,
      });
      await act(async () => {
        confirm(true);
        await sending;
      });
      expect(execute).not.toHaveBeenCalled();
      expect(params.setStatus).toHaveBeenCalledWith('error');
    }
  );
  it('allows a valid reviewed day through the existing confirmation and delivery', async () => {
    const { result, params } = setup();
    await act(() => result.current.sendEmail());
    expect(params.confirm).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ record: params.record }));
  });
});
