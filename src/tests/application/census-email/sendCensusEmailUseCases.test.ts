import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSendCensusConfirmationMessage,
  executeSendCensusEmail,
} from '@/application/census-email/sendCensusEmailUseCases';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

const buildCensusMasterBinaryMock = vi.fn().mockResolvedValue(new Uint8Array());

vi.mock('@/services/exporters/censusMasterWorkbook', () => ({
  buildCensusMasterBinary: (...args: unknown[]) => buildCensusMasterBinaryMock(...args),
}));

describe('sendCensusEmailUseCases', () => {
  const record: DailyRecord = {
    date: '2026-03-06',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-03-06T10:00:00.000Z',
    activeExtraBeds: [],
    nursesDayShift: [],
    nursesNightShift: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the confirmation text using the resolved recipients', () => {
    const message = buildSendCensusConfirmationMessage({
      currentDateString: '2026-03-06',
      recipients: ['a@test.com'],
      testModeEnabled: false,
      testRecipient: '',
      isAdminUser: true,
    });

    expect(message).toContain('a@test.com');
  });

  it('returns validation failure when trying to send without record', async () => {
    const result = await executeSendCensusEmail({
      record: null,
      currentDateString: '2026-03-06',
      nurseSignature: 'Nurse',
      selectedYear: 2026,
      selectedMonth: 2,
      selectedDay: 6,
      user: { email: 'admin@test.com', role: 'admin' },
      role: 'admin',
      recipients: ['a@test.com'],
      message: 'test',
      testModeEnabled: false,
      testRecipient: '',
      isAdminUser: true,
    });

    expect(result.status).toBe('failed');
  });

  it('sends the census email as an Excel-only delivery', async () => {
    const initializeDay = vi.fn().mockResolvedValue(undefined);
    const getMonthRecords = vi.fn().mockResolvedValue([]);
    const sendEmailWithResult = vi.fn().mockResolvedValue({
      status: 'success',
      issues: [],
    });
    const uploadBackupWithResult = vi.fn().mockResolvedValue({
      status: 'success',
      issues: [],
    });

    const result = await executeSendCensusEmail(
      {
        record,
        currentDateString: '2026-03-06',
        nurseSignature: 'Nurse',
        selectedYear: 2026,
        selectedMonth: 2,
        selectedDay: 6,
        user: { email: 'admin@test.com', role: 'admin' },
        role: 'admin',
        recipients: ['a@test.com'],
        message: 'test',
        testModeEnabled: false,
        testRecipient: '',
        isAdminUser: true,
      },
      {
        dailyRecordReadPort: {
          initializeDay,
          getMonthRecords,
        },
        censusEmailDeliveryPort: {
          sendEmailWithResult,
          uploadBackupWithResult,
        } as never,
      }
    );

    expect(result.status).toBe('success');
    expect(sendEmailWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['a@test.com'],
        body: 'test',
      })
    );
    expect(uploadBackupWithResult).toHaveBeenCalledTimes(1);
  });

  const upcRecord = (completed: boolean): DailyRecord => ({
    ...record,
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente sintético',
        upcChecklist: completed
          ? {
              uciCriteria: [],
              utiCriteria: [],
              classification: null,
              evaluatedForDate: record.date,
              evaluatedBedId: 'R1',
              evaluatedAt: '2026-03-06T10:00:00Z',
              evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
              responsibleNurse: { name: 'Enfermera de prueba', source: 'assigned' },
            }
          : undefined,
      }),
    },
  });
  const sendInput = (current: DailyRecord) => ({
    record: current,
    currentDateString: record.date,
    nurseSignature: 'Enfermera',
    selectedYear: 2026,
    selectedMonth: 2,
    selectedDay: 6,
    user: { email: 'admin@test.com', role: 'admin' },
    role: 'admin',
    recipients: ['a@test.com'],
    message: 'test',
    testModeEnabled: false,
    testRecipient: 'test@test.com',
    isAdminUser: true,
  });
  const dependencies = (month: DailyRecord[] = []) => ({
    dailyRecordReadPort: {
      initializeDay: vi.fn().mockResolvedValue(undefined),
      getMonthRecords: vi.fn().mockResolvedValue(month),
    },
    censusEmailDeliveryPort: {
      sendEmail: vi.fn(),
      uploadBackup: vi.fn(),
      sendEmailWithResult: vi.fn().mockResolvedValue({ status: 'success', issues: [] }),
      uploadBackupWithResult: vi.fn().mockResolvedValue({ status: 'success', issues: [] }),
    },
  });

  it.each([false, true])(
    'blocks before side effects, including test mode %s',
    async testModeEnabled => {
      const ports = dependencies();
      const result = await executeSendCensusEmail(
        { ...sendInput(upcRecord(false)), testModeEnabled },
        ports
      );
      expect(result.status).toBe('failed');
      expect(result.issues[0].message).toContain('UPC');
      expect(ports.dailyRecordReadPort.initializeDay).not.toHaveBeenCalled();
      expect(ports.censusEmailDeliveryPort.sendEmailWithResult).not.toHaveBeenCalled();
      expect(buildCensusMasterBinaryMock).not.toHaveBeenCalled();
    }
  );
  it('also blocks when the actual attachment day has a pending review', async () => {
    const ports = dependencies([upcRecord(false)]);
    const result = await executeSendCensusEmail(sendInput(upcRecord(true)), ports);
    expect(result.status).toBe('failed');
    expect(result.issues[0].message).toContain('R1');
    expect(ports.censusEmailDeliveryPort.sendEmailWithResult).not.toHaveBeenCalled();
    expect(ports.censusEmailDeliveryPort.uploadBackupWithResult).not.toHaveBeenCalled();
  });
  it('permits a reviewed No UPC day without retroactively blocking older monthly sheets', async () => {
    const ports = dependencies([{ ...upcRecord(false), date: '2026-03-05' }, upcRecord(true)]);
    const result = await executeSendCensusEmail(sendInput(upcRecord(true)), ports);
    expect(result.status).toBe('success');
    expect(ports.censusEmailDeliveryPort.sendEmailWithResult).toHaveBeenCalledTimes(1);
  });
});
