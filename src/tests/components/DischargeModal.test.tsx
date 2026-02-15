import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DischargeModal } from '@/components/modals/actions/DischargeModal';

describe('DischargeModal', () => {
  it('shows validation error when type is Otra without details', () => {
    const onConfirm = vi.fn();

    render(
      <DischargeModal
        isOpen={true}
        isEditing={false}
        status="Vivo"
        initialType="Otra"
        initialOtherDetails=""
        initialTime="10:00"
        onStatusChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmar alta/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Debe especificar el detalle/i)).toBeInTheDocument();
  });

  it('submits payload without dischargeTarget when no clinical crib exists', () => {
    const onConfirm = vi.fn();

    render(
      <DischargeModal
        isOpen={true}
        isEditing={false}
        status="Vivo"
        initialType="Voluntaria"
        initialOtherDetails=""
        initialTime="11:30"
        hasClinicalCrib={false}
        onStatusChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmar alta/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      status: 'Vivo',
      type: 'Voluntaria',
      typeOther: undefined,
      time: '11:30',
      movementDate: undefined,
      dischargeTarget: undefined,
    });
  });
});
