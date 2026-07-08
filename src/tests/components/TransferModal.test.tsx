import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  EVACUATION_METHOD_AEROCARDAL,
  DEFAULT_RECEIVING_CENTER,
  EVACUATION_METHOD_COMMERCIAL,
} from '@/constants/clinicalMovementConstants';
import { TransferModal } from '@/components/modals/actions/TransferModal';

describe('TransferModal', () => {
  it('shows the operational consequence before confirming a new transfer', () => {
    render(
      <TransferModal
        isOpen={true}
        isEditing={false}
        evacuationMethod={EVACUATION_METHOD_COMMERCIAL}
        evacuationMethodOther=""
        receivingCenter={DEFAULT_RECEIVING_CENTER}
        receivingCenterOther=""
        transferEscort="Enfermera"
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText('Estado final')).toBeInTheDocument();
    expect(screen.getByText(/traslado clínico/i)).toBeInTheDocument();
  });

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

  it('keeps discharge diagnosis in the confirm payload', () => {
    const onConfirm = vi.fn();

    render(
      <TransferModal
        isOpen={true}
        isEditing={true}
        evacuationMethod={EVACUATION_METHOD_COMMERCIAL}
        evacuationMethodOther=""
        receivingCenter={DEFAULT_RECEIVING_CENTER}
        receivingCenterOther=""
        transferEscort="Enfermera"
        diagnosis="Neumonía basal derecha"
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosis: 'Neumonía basal derecha' })
    );
  });
});
