import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HandoffStaffSelector } from '@/features/handoff/components/HandoffStaffSelector';

describe('Historical nursing signatures', () => {
  it.each([true, false])(
    'keeps historical names and explicit vacancy visible, compact=%s',
    compact => {
      const onUpdate = vi.fn();
      const props = {
        label: 'Recibe',
        type: 'receives' as const,
        selectedNurses: ['Firma histórica', 'Vacante'],
        availableNurses: ['Funcionario actual'],
        onUpdate,
        compact,
      };
      const { rerender } = render(<HandoffStaffSelector {...props} />);
      expect(screen.getByRole('combobox', { name: 'Recibe: enfermería 1' })).toHaveValue(
        'Firma histórica'
      );
      expect(screen.getByRole('combobox', { name: 'Recibe: enfermería 2' })).toHaveValue('Vacante');
      rerender(<HandoffStaffSelector {...props} availableNurses={[]} readOnly />);
      expect(screen.getByRole('combobox', { name: 'Recibe: enfermería 1' })).toHaveValue(
        'Firma histórica'
      );
      expect(screen.getByRole('combobox', { name: 'Recibe: enfermería 1' })).toBeDisabled();
      expect(
        within(screen.getByRole('combobox', { name: 'Recibe: enfermería 2' })).queryByRole(
          'option',
          { name: 'Firma histórica' }
        )
      ).not.toBeInTheDocument();
      expect(onUpdate).not.toHaveBeenCalled();
    }
  );
  it('changes only the explicitly selected slot and does not mutate the catalog', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const catalog = ['Funcionario actual'];
    render(
      <HandoffStaffSelector
        label="Recibe"
        type="receives"
        selectedNurses={['Firma histórica', 'Otra firma']}
        availableNurses={catalog}
        onUpdate={onUpdate}
      />
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Recibe: enfermería 1' }),
      'Funcionario actual'
    );
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(['Funcionario actual', 'Otra firma']);
    expect(catalog).toEqual(['Funcionario actual']);
  });
});
