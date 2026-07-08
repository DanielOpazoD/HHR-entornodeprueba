import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DischargeStatusRadioGroup } from '@/components/modals/actions/discharge/DischargeStatusRadioGroup';

describe('DischargeStatusRadioGroup', () => {
  it('groups discharge status radios under an accessible name', async () => {
    const onChange = vi.fn();
    render(
      <DischargeStatusRadioGroup
        inputName="patientStatus"
        label="Estado del paciente"
        status="Vivo"
        onChange={onChange}
      />
    );

    const group = screen.getByRole('group', { name: 'Estado del paciente' });
    const deceasedRadio = screen.getByRole('radio', { name: 'Fallecido' });

    expect(group).toContainElement(screen.getByRole('radio', { name: 'Vivo' }));
    expect(group).toContainElement(deceasedRadio);

    await userEvent.click(deceasedRadio);
    expect(onChange).toHaveBeenCalledWith('Fallecido');
  });
});
