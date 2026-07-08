import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BedReasonDialog } from '@/components/modals/BedReasonDialog';

describe('BedReasonDialog', () => {
  it('associates the reason label with the text input', async () => {
    const onReasonChange = vi.fn();
    render(
      <BedReasonDialog
        isOpen={true}
        onClose={vi.fn()}
        title="Bloquear cama"
        headerIconColor="text-red-600"
        reason=""
        error={null}
        onReasonChange={onReasonChange}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirmLabel="Bloquear"
        confirmClassName="bg-red-600"
      />
    );

    const reasonInput = screen.getByLabelText('Motivo del Bloqueo');
    await userEvent.type(reasonInput, 'Mantencion');

    expect(onReasonChange).toHaveBeenCalled();
  });
});
