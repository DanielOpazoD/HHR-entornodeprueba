import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusEmailDeliveryActions } from '@/hooks/useCensusEmailDeliveryActions';

vi.mock('@/application/census-email/sendCensusEmailUseCases', () => {
  throw new Error('chunk failed');
});

describe('useCensusEmailDeliveryActions', () => {
  it('surfaces lazy email module load failures through hook state setters', async () => {
    const setStatus = vi.fn();
    const setError = vi.fn();
    const confirm = vi.fn();

    const { result } = renderHook(() =>
      useCensusEmailDeliveryActions({
        record: null,
        currentDateString: '2026-07-04',
        nurseSignature: 'Enfermera',
        selectedYear: 2026,
        selectedMonth: 6,
        selectedDay: 4,
        user: { uid: 'u1', email: 'admin@hospital.cl', role: 'admin' },
        role: 'admin',
        recipients: ['destino@hospital.cl'],
        message: 'Censo diario',
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

    await act(async () => {
      await result.current.sendEmail();
    });

    expect(setError).toHaveBeenCalledWith(
      expect.stringContaining('No se pudo cargar el envío de censo')
    );
    expect(setStatus).toHaveBeenCalledWith('error');
    expect(confirm).not.toHaveBeenCalled();
  });
});
