import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CensusNursingScalesSetting } from '@/features/admin/components/CensusNursingScalesSetting';

const table = vi.hoisted(() => ({
  config: { pageMargin: 12, nursingScalesVisible: undefined as boolean | undefined },
}));
const save = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
vi.mock('@/context/TableConfigContext', () => ({ useTableConfig: () => table }));
vi.mock('@/services/storage/tableConfigService', () => ({ saveTableConfig: save }));
vi.mock('@/context/UIContext', () => ({ useNotification: () => ({ notify }) }));

describe('Configuración › Braden y Downton en el censo diario', () => {
  it('starts on and turns the scales off for everyone in the shared table configuration', () => {
    save.mockResolvedValue(undefined);
    render(<CensusNursingScalesSetting />);
    const toggle = screen.getByRole('button', {
      name: 'Mostrar Braden y Downton en el censo diario',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Para todos los usuarios/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(save).toHaveBeenCalledWith({ pageMargin: 12, nursingScalesVisible: false });
  });

  it('shows the switch off once an admin hid them, and says when the change was not saved', async () => {
    table.config.nursingScalesVisible = false;
    save.mockRejectedValue(new Error('offline'));
    render(<CensusNursingScalesSetting />);
    const toggle = screen.getByRole('button', { name: /Braden y Downton/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(save).toHaveBeenLastCalledWith({ pageMargin: 12, nursingScalesVisible: true });
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'No se guardó el cambio' })
      )
    );
  });
});
