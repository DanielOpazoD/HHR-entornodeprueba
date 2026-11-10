import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCensusEmailDeliveryActions } from '@/hooks/useCensusEmailDeliveryActions';

const loadDelivery = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/controllers/censusEmailDeliveryRuntime', () => {
  loadDelivery();
  throw new Error('delivery unavailable');
});

it('loads delivery only on request and reports a failed load without confirming or sending', async () => {
  const setError = vi.fn();
  const setStatus = vi.fn();
  const confirm = vi.fn();
  const { result } = renderHook(() =>
    useCensusEmailDeliveryActions({
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
      status: 'idle',
      testModeEnabled: false,
      testRecipient: '',
      isAdminUser: true,
      setStatus,
      setError,
      confirm,
      alert: vi.fn(),
    })
  );
  expect(loadDelivery).not.toHaveBeenCalled();
  await act(async () => result.current.sendEmail());
  expect(loadDelivery).toHaveBeenCalledOnce();
  expect(setError).toHaveBeenCalledWith(
    expect.stringContaining('No se pudo cargar el envío de censo')
  );
  expect(setStatus).toHaveBeenCalledWith('error');
  expect(setStatus).not.toHaveBeenCalledWith('success');
  expect(confirm).not.toHaveBeenCalled();
});
