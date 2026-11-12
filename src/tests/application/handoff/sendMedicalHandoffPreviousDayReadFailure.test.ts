import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.unmock('@/application/ports/dailyRecordPort');

const remote = vi.hoisted(() => ({
  enabled: false,
  previousDate: vi.fn(async (_date: string): Promise<string | null> => null),
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<object>()),
  isFirestoreEnabled: () => remote.enabled,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<object>()),
  getPreviousRecordDateFromFirestore: remote.previousDate,
}));
vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  formatHandoffMessage: vi.fn((_template: string, data: { signedBy: string }) => data.signedBy),
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { executeSendMedicalHandoff } from '@/application/handoff/sendMedicalHandoffUseCase';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import { sendWhatsAppMessage } from '@/services/integrations/whatsapp/whatsappService';

const TODAY = '2026-10-05';
const today = DataFactory.createMockDailyRecord(TODAY, { medicalHandoffDoctor: '' });
const send = () =>
  executeSendMedicalHandoff({
    record: today,
    templateContent: 'Plantilla sintética',
    targetGroupId: 'synthetic-group',
    patchRecord: vi.fn().mockResolvedValue(undefined),
    getPreviousDay: defaultDailyRecordReadPort.getPreviousDay,
  });

beforeEach(async () => {
  remote.enabled = false;
  remote.previousDate.mockReset();
  remote.previousDate.mockResolvedValue(null);
  vi.mocked(sendWhatsAppMessage).mockClear();
  await hospitalDB.dailyRecords.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await hospitalDB.dailyRecords.clear();
});

describe('medical handoff when the previous day could not be read', () => {
  it('does not send "Sin especificar" when the local previous day read fails', async () => {
    await hospitalDB.dailyRecords.put(
      DataFactory.createMockDailyRecord('2026-10-04', { medicalHandoffDoctor: 'Dra. Sintética' })
    );
    vi.spyOn(hospitalDB.dailyRecords, 'where').mockImplementation(() => {
      throw new Error('synthetic local previous day unavailable');
    });

    const outcome = await send();

    expect(outcome.status).toBe('failed');
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('does not send "Sin especificar" when the server previous day lookup fails', async () => {
    remote.enabled = true;
    remote.previousDate.mockRejectedValue(new Error('synthetic server lookup unavailable'));

    const outcome = await send();

    expect(outcome.status).toBe('failed');
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe('medical handoff when the previous day was read', () => {
  it('signs with the doctor of the previous local day', async () => {
    await hospitalDB.dailyRecords.put(
      DataFactory.createMockDailyRecord('2026-10-04', { medicalHandoffDoctor: 'Dra. Sintética' })
    );

    const outcome = await send();

    expect(outcome.status).toBe('success');
    expect(outcome.data?.doctorName).toBe('Dra. Sintética');
  });

  it('still sends "Sin especificar" when no previous day exists anywhere', async () => {
    remote.enabled = true;

    const outcome = await send();

    expect(remote.previousDate).toHaveBeenCalledWith(TODAY);
    expect(outcome.status).toBe('success');
    expect(outcome.data?.doctorName).toBe('Sin especificar');
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('synthetic-group', 'Sin especificar');
  });
});
