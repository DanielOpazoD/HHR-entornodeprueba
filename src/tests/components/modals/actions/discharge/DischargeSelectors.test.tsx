import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DISCHARGE_TYPE_OTHER } from '@/constants/clinicalMovementConstants';
import { DischargeTargetSelector } from '@/components/modals/actions/discharge/DischargeTargetSelector';
import { DischargeTypeSelector } from '@/components/modals/actions/discharge/DischargeTypeSelector';

describe('discharge selectors', () => {
  it('groups discharge type radios under an accessible name', () => {
    render(
      <DischargeTypeSelector
        selectedType={DISCHARGE_TYPE_OTHER}
        otherDetails=""
        onTypeChange={vi.fn()}
        onOtherDetailsChange={vi.fn()}
      />
    );

    const group = screen.getByRole('group', { name: 'Tipo de Alta' });
    expect(group).toContainElement(screen.getByRole('radio', { name: 'Otra' }));
  });

  it('exposes the selected discharge target state to assistive technology', async () => {
    const onChange = vi.fn();
    render(<DischargeTargetSelector target="mother" onChange={onChange} />);

    const group = screen.getByRole('group', { name: '¿A quién dar de alta?' });
    const motherButton = screen.getByRole('button', { name: 'Solo Madre' });
    const babyButton = screen.getByRole('button', { name: 'Solo RN' });

    expect(group).toContainElement(motherButton);
    expect(motherButton).toHaveAttribute('aria-pressed', 'true');
    expect(babyButton).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(babyButton);
    expect(onChange).toHaveBeenCalledWith('baby');
  });
});
