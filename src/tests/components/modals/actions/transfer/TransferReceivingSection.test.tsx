import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RECEIVING_CENTER,
  RECEIVING_CENTER_OTHER,
} from '@/constants/clinicalMovementConstants';
import { TransferReceivingSection } from '@/components/modals/actions/transfer/TransferReceivingSection';

describe('TransferReceivingSection', () => {
  it('associates the receiving center label with the select control', async () => {
    const onReceivingCenterChange = vi.fn();
    render(
      <TransferReceivingSection
        receivingCenter={DEFAULT_RECEIVING_CENTER}
        receivingCenterOther=""
        onReceivingCenterChange={onReceivingCenterChange}
        onReceivingCenterOtherChange={vi.fn()}
      />
    );

    const select = screen.getByLabelText('Centro que Recibe');
    await userEvent.selectOptions(select, RECEIVING_CENTER_OTHER);

    expect(onReceivingCenterChange).toHaveBeenCalledWith(RECEIVING_CENTER_OTHER);
  });

  it('associates the other receiving center label with its text input', async () => {
    const onReceivingCenterOtherChange = vi.fn();
    render(
      <TransferReceivingSection
        receivingCenter={RECEIVING_CENTER_OTHER}
        receivingCenterOther=""
        onReceivingCenterChange={vi.fn()}
        onReceivingCenterOtherChange={onReceivingCenterOtherChange}
      />
    );

    const otherInput = screen.getByLabelText('Especifique Centro');
    await userEvent.type(otherInput, 'Hospital externo');

    expect(onReceivingCenterOtherChange).toHaveBeenCalled();
  });
});
