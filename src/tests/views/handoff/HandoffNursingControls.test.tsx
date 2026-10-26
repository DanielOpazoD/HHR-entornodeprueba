import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HandoffChecklistNight } from '@/features/handoff/components/HandoffChecklistNight';
import { HandoffNovedades } from '@/features/handoff/components/HandoffNovedades';
import { HandoffShiftSwitcher } from '@/features/handoff/components/HandoffShiftSwitcher';

describe('Nursing handoff controls', () => {
  it('switches the active shift without submitting a surrounding form', async () => {
    const user = userEvent.setup();
    const setSelectedShift = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <HandoffShiftSwitcher selectedShift="day" setSelectedShift={setSelectedShift} />
      </form>
    );

    expect(screen.getByRole('button', { name: 'Turno Largo' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'Turno Noche' }));
    expect(setSelectedShift).toHaveBeenCalledExactlyOnceWith('night');
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<HandoffShiftSwitcher selectedShift="night" setSelectedShift={setSelectedShift} />);
    expect(screen.getByRole('button', { name: 'Turno Noche' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('names the next medication count date and preserves the exact update field', () => {
    const onUpdate = vi.fn();
    render(
      <HandoffChecklistNight
        data={{ conteoNoControladosProximaFecha: '2026-10-24' }}
        onUpdate={onUpdate}
      />
    );
    const date = screen.getByLabelText('Próximo conteo de medicamentos no controlados');
    expect(date).toHaveValue('2026-10-24');

    fireEvent.change(date, { target: { value: '2026-10-25' } });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(
      'conteoNoControladosProximaFecha',
      '2026-10-25'
    );
  });

  it('keeps every night checklist control disabled in read-only mode', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HandoffChecklistNight readOnly onUpdate={onUpdate} />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(6);
    checkboxes.forEach(checkbox => expect(checkbox).toBeDisabled());
    expect(screen.getByLabelText('Próximo conteo de medicamentos no controlados')).toBeDisabled();
    await user.click(checkboxes[0]);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('associates the notes field with its visible heading', () => {
    const onChange = vi.fn();
    render(<HandoffNovedades value="Novedad sintética" onChange={onChange} />);

    const notes = screen.getByRole('textbox', { name: 'Novedades' });
    expect(notes).toHaveValue('Novedad sintética');
    fireEvent.change(notes, { target: { value: 'Novedad actualizada' } });
    fireEvent.blur(notes);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Novedad actualizada');
  });
});
