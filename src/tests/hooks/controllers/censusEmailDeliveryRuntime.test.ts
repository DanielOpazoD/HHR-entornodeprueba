import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverCensusEmail } from '@/hooks/controllers/censusEmailDeliveryRuntime';

const executeSend = vi.hoisted(() => vi.fn());
vi.mock('@/application/census-email/sendCensusEmailUseCases', () => ({
  buildSendCensusConfirmationMessage: () => 'Confirmación sintética',
  executeSendCensusEmail: executeSend,
}));

const createParams = () => ({
  record: null,
  currentDateString: '2026-07-04',
  nurseSignature: 'Enfermera sintética',
  selectedYear: 2026,
  selectedMonth: 6,
  selectedDay: 4,
  user: { uid: 'synthetic-user' },
  role: 'admin',
  recipients: ['synthetic@example.com'],
  message: 'Censo sintético',
  testModeEnabled: false,
  testRecipient: '',
  isAdminUser: true,
  setStatus: vi.fn(),
  setError: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
  alert: vi.fn(),
  latestContext: { current: { record: null, currentDateString: '2026-07-04' } },
});

describe('census email delivery runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves cancellation without sending', async () => {
    const params = createParams();
    params.confirm.mockResolvedValue(false);
    await deliverCensusEmail(params);
    expect(executeSend).not.toHaveBeenCalled();
    expect(params.setStatus).not.toHaveBeenCalled();
  });

  it('blocks a date change while confirming', async () => {
    const params = createParams();
    params.latestContext.current = { record: null, currentDateString: '2026-07-05' };
    await deliverCensusEmail(params);
    expect(executeSend).not.toHaveBeenCalled();
    expect(params.setStatus).toHaveBeenCalledWith('error');
    expect(params.alert).toHaveBeenCalledWith(
      expect.stringContaining('cambió de fecha'),
      'Envío bloqueado'
    );
  });

  it('presents a delivery failure without reporting success', async () => {
    executeSend.mockResolvedValue({ status: 'failed', issues: [{ message: 'Fallo sintético' }] });
    const params = createParams();
    await deliverCensusEmail(params);
    expect(executeSend).toHaveBeenCalledWith(
      expect.objectContaining({ currentDateString: '2026-07-04' })
    );
    expect(params.setStatus.mock.calls).toEqual([['loading'], ['error']]);
    expect(params.alert).toHaveBeenCalledWith('Fallo sintético', 'Error al enviar');
  });
});
