import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EVACUATION_METHOD,
  EVACUATION_METHOD_COMMERCIAL,
  EVACUATION_METHOD_OTHER,
} from '@/constants/clinicalMovementConstants';
import { TransferEvacuationSection } from '@/components/modals/actions/transfer/TransferEvacuationSection';

const defaultProps = {
  evacuationMethod: DEFAULT_EVACUATION_METHOD,
  evacuationMethodOther: '',
  transferEscort: 'Enfermera',
  isPredefinedEscort: true,
  onEvacuationMethodChange: vi.fn(),
  onEvacuationMethodOtherChange: vi.fn(),
  onEscortSelectChange: vi.fn(),
  onEscortValueChange: vi.fn(),
};

describe('TransferEvacuationSection', () => {
  it('associates the evacuation method label with the select control', async () => {
    const onEvacuationMethodChange = vi.fn();
    render(
      <TransferEvacuationSection
        {...defaultProps}
        onEvacuationMethodChange={onEvacuationMethodChange}
      />
    );

    const methodSelect = screen.getByLabelText('Medio de Evacuación');
    await userEvent.selectOptions(methodSelect, EVACUATION_METHOD_OTHER);

    expect(onEvacuationMethodChange).toHaveBeenCalledWith(EVACUATION_METHOD_OTHER);
  });

  it('associates the commercial flight escort label with the select control', async () => {
    const onEscortSelectChange = vi.fn();
    render(
      <TransferEvacuationSection
        {...defaultProps}
        evacuationMethod={EVACUATION_METHOD_COMMERCIAL}
        onEscortSelectChange={onEscortSelectChange}
      />
    );

    const escortSelect = screen.getByLabelText('Acompañante Vuelo Comercial');
    await userEvent.selectOptions(escortSelect, 'TENS');

    expect(onEscortSelectChange).toHaveBeenCalledWith('TENS');
  });

  it('associates the custom evacuation method label with its text input', async () => {
    const onEvacuationMethodOtherChange = vi.fn();
    render(
      <TransferEvacuationSection
        {...defaultProps}
        evacuationMethod={EVACUATION_METHOD_OTHER}
        onEvacuationMethodOtherChange={onEvacuationMethodOtherChange}
      />
    );

    const otherInput = screen.getByLabelText('Especifique Método');
    await userEvent.type(otherInput, 'Lancha institucional');

    expect(onEvacuationMethodOtherChange).toHaveBeenCalled();
  });
});
