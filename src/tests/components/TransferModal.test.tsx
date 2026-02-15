import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  EVACUATION_METHOD_AEROCARDAL,
  DEFAULT_RECEIVING_CENTER,
  EVACUATION_METHOD_COMMERCIAL,
} from '@/constants';
import { TransferModal } from '@/components/modals/actions/TransferModal';

describe('TransferModal', () => {
  it('shows escort validation error and blocks confirm when escort is missing', () => {
    const onConfirm = vi.fn();
    const onUpdate = vi.fn();

    render(
      <TransferModal
        isOpen={true}
        isEditing={false}
        evacuationMethod={EVACUATION_METHOD_COMMERCIAL}
        evacuationMethodOther=""
        receivingCenter={DEFAULT_RECEIVING_CENTER}
        receivingCenterOther=""
        transferEscort=""
        onUpdate={onUpdate}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmar traslado/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Debe indicar acompañante/i)).toBeInTheDocument();
  });

  it('applies method side effects when method changes to commercial', () => {
    const onUpdate = vi.fn();

    render(
      <TransferModal
        isOpen={true}
        isEditing={false}
        evacuationMethod={EVACUATION_METHOD_AEROCARDAL}
        evacuationMethodOther="tmp"
        receivingCenter={DEFAULT_RECEIVING_CENTER}
        receivingCenterOther=""
        transferEscort="TENS"
        onUpdate={onUpdate}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: EVACUATION_METHOD_COMMERCIAL },
    });

    expect(onUpdate).toHaveBeenCalledWith('evacuationMethod', EVACUATION_METHOD_COMMERCIAL);
    expect(onUpdate).toHaveBeenCalledWith('transferEscort', 'Enfermera');
    expect(onUpdate).toHaveBeenCalledWith('evacuationMethodOther', '');
  });
});
