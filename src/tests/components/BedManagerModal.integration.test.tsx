import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BedManagerModal } from '@/features/census/components/bed-manager/BedManagerModal';

const mockedUseDailyRecordBeds = vi.fn();
const mockedUseDailyRecordBedActions = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => mockedUseDailyRecordBeds(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: () => mockedUseDailyRecordBedActions(),
}));

vi.mock('../../hooks/useScrollLock', () => ({
  useScrollLock: () => {},
  default: () => {},
}));

describe('BedManagerModal integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('supports block, edit and unblock flows end-to-end', () => {
    const toggleBlockBed = vi.fn();
    const updateBlockedReason = vi.fn();

    mockedUseDailyRecordBedActions.mockReturnValue({
      toggleBlockBed,
      updateBlockedReason,
    });

    mockedUseDailyRecordBeds.mockReturnValue({
      R1: { isBlocked: true, blockedReason: 'Mantención inicial' },
      R2: { isBlocked: false },
    });
    render(<BedManagerModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cama R2: Disponible' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(toggleBlockBed).not.toHaveBeenCalledWith('R2', expect.anything());

    fireEvent.change(screen.getByPlaceholderText('Ej: Mantención, Aislamiento…'), {
      target: { value: 'Aislamiento respiratorio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(toggleBlockBed).toHaveBeenCalledWith('R2', 'Aislamiento respiratorio');

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cama R1: Bloqueada' }));
    fireEvent.change(screen.getByDisplayValue('Mantención inicial'), {
      target: { value: 'Cambio de motivo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(updateBlockedReason).toHaveBeenCalledWith('R1', 'Cambio de motivo');

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cama R1: Bloqueada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear Cama' }));
    expect(toggleBlockBed).toHaveBeenCalledWith('R1');

    expect(screen.queryByText('Camas Extras')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activar cama extra/i })).not.toBeInTheDocument();
  });
});
