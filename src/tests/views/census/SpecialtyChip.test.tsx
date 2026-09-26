import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name !== 'SPECIALTY_RULES_MEMORY',
}));

import { SpecialtyChip } from '@/features/census/components/patient-row/SpecialtyChip';

const scope = {
  date: '2026-09-23',
  bedId: 'R1',
  target: 'bed' as const,
  episodeId: 'synthetic-episode',
};

describe('SpecialtyChip', () => {
  it('keeps manual specialty choices without Jev controls', () => {
    render(<SpecialtyChip specialty="" onAssign={vi.fn()} cie10Code="J18.9" scope={scope} />);

    fireEvent.click(screen.getByTitle('Asignar especialidad'));

    expect(screen.getByRole('button', { name: 'Med Interna' })).toBeEnabled();
    expect(screen.queryByText('Apoyo Jev · decisión profesional')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preparar consulta Jev' })).toBeNull();
  });

  it('closes an open specialty choice when the occupant changes', () => {
    const assign = vi.fn();
    const view = render(<SpecialtyChip specialty="" onAssign={assign} scope={scope} />);
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    expect(screen.getByRole('button', { name: 'Cirugía' })).toBeEnabled();

    view.rerender(
      <SpecialtyChip
        specialty=""
        onAssign={assign}
        scope={{ ...scope, episodeId: 'new-episode' }}
      />
    );

    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the menu above the census scroller and explains an unconfirmed episode', () => {
    render(
      <div className="overflow-hidden">
        <SpecialtyChip specialty="" onAssign={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    const dialog = screen.getByRole('dialog', { name: 'Asignar especialidad' });
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByRole('status').textContent).toContain('confirme el episodio clínico');
    expect(screen.getByRole('button', { name: 'Med Interna' })).toBeDisabled();
    fireEvent.scroll(window);
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
  });

  it('moves keyboard focus into the selector and restores it when closed', async () => {
    render(<SpecialtyChip specialty="" onAssign={vi.fn()} />);
    const trigger = screen.getByTitle('Asignar especialidad');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Asignar especialidad' });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar selector de especialidad' }));
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('restores focus after a manual specialty choice', () => {
    const onAssign = vi.fn();
    render(<SpecialtyChip specialty="" onAssign={onAssign} scope={scope} />);
    const trigger = screen.getByTitle('Asignar especialidad');
    fireEvent.click(trigger);
    const choice = screen.getByRole('button', { name: 'Cirugía' });
    choice.focus();
    fireEvent.click(choice);
    expect(onAssign).toHaveBeenCalledWith('Cirugía');
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
