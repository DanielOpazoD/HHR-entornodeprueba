import { useState } from 'react';
import { createPortal } from 'react-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name !== 'SPECIALTY_RULES_MEMORY',
}));

vi.mock('@/features/census/components/specialty-round/SpecialtyRoundEntry', () => ({
  SpecialtyRoundEntry: ({ onWindowChange }: { onWindowChange?: (open: boolean) => void }) => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            onWindowChange?.(true);
          }}
        >
          Opciones de especialidades del censo
        </button>
        {open &&
          createPortal(
            <div role="dialog" aria-label="Reglas de especialidades">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onWindowChange?.(false);
                }}
              >
                Cerrar reglas
              </button>
            </div>,
            document.body
          )}
      </>
    );
  },
}));

import { SpecialtyChip } from '@/features/census/components/patient-row/SpecialtyChip';

const scope = {
  date: '2026-09-23',
  bedId: 'R1',
  target: 'bed' as const,
  episodeId: 'synthetic-episode',
};

describe('SpecialtyChip', () => {
  it('offers census options even before a legacy patient has an episode identifier', async () => {
    render(<SpecialtyChip specialty="Med Interna" censusDate="2026-09-23" onAssign={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Especialidad: Med Interna'));
    expect(
      await screen.findByRole(
        'button',
        { name: 'Opciones de especialidades del censo' },
        { timeout: 5000 }
      )
    ).toBeVisible();
  });

  it('keeps a specialty tool mounted while the selector is hidden and restores the selector on close', async () => {
    const assign = vi.fn();
    render(<SpecialtyChip specialty="Med Interna" onAssign={assign} scope={scope} />);
    fireEvent.click(screen.getByTitle('Especialidad: Med Interna'));
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Opciones de especialidades del censo' },
        { timeout: 5000 }
      )
    );
    expect(screen.getByRole('dialog', { name: 'Reglas de especialidades' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar reglas' }));
    expect(screen.getByRole('dialog', { name: 'Asignar especialidad' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Reglas de especialidades' })).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

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

  it('restores focus after a confirmed manual specialty choice', async () => {
    const onAssign = vi.fn().mockResolvedValue(true);
    render(<SpecialtyChip specialty="" onAssign={onAssign} scope={scope} />);
    const trigger = screen.getByTitle('Asignar especialidad');
    fireEvent.click(trigger);
    const choice = screen.getByRole('button', { name: 'Cirugía' });
    choice.focus();
    fireEvent.click(choice);
    expect(onAssign).toHaveBeenCalledWith('Cirugía');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull()
    );
    expect(trigger).toHaveFocus();
  });
  it('holds only its own selector pending and rejects rapid duplicate clicks', async () => {
    let complete!: (saved: boolean) => void;
    const onAssign = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          complete = resolve;
        })
    );
    render(
      <>
        <SpecialtyChip specialty="Med Interna" onAssign={onAssign} scope={scope} />
        <SpecialtyChip
          specialty="Pediatría"
          onAssign={vi.fn()}
          scope={{ ...scope, bedId: 'R2', episodeId: 'episode-2' }}
        />
      </>
    );
    const trigger = screen.getByTitle('Especialidad: Med Interna');
    fireEvent.click(trigger);
    const choice = screen.getByRole('button', { name: 'Cirugía' });
    fireEvent.click(choice);
    fireEvent.click(choice);
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(trigger).toBeDisabled();
    expect(choice).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Guardando especialidad');
    expect(screen.getByTitle('Especialidad: Pediatría')).toBeEnabled();
    await act(async () => {
      complete(true);
    });
    expect(trigger).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
  });

  it.each([false, undefined])(
    'keeps an unconfirmed save visible when the result is %s',
    async result => {
      render(
        <SpecialtyChip specialty="" onAssign={vi.fn().mockResolvedValue(result)} scope={scope} />
      );
      fireEvent.click(screen.getByTitle('Asignar especialidad'));
      fireEvent.click(screen.getByRole('button', { name: 'Dejar sin asignar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar');
      expect(screen.getByRole('dialog', { name: 'Asignar especialidad' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Dejar sin asignar' })).toBeEnabled();
    }
  );

  it('ignores late rejection after the date or occupant changes', async () => {
    let reject!: (error: Error) => void;
    const onAssign = vi.fn(
      () =>
        new Promise<boolean>((_resolve, fail) => {
          reject = fail;
        })
    );
    const view = render(
      <SpecialtyChip specialty="Med Interna" onAssign={onAssign} scope={scope} />
    );
    fireEvent.click(screen.getByTitle('Especialidad: Med Interna'));
    fireEvent.click(screen.getByRole('button', { name: 'Cirugía' }));
    view.rerender(
      <SpecialtyChip
        specialty="Pediatría"
        onAssign={onAssign}
        scope={{ ...scope, date: '2026-09-24', episodeId: 'new-episode' }}
      />
    );
    fireEvent.click(screen.getByTitle('Especialidad: Pediatría'));
    await act(async () => {
      reject(new Error('synthetic rejected write'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Asignar especialidad' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cirugía' })).toBeEnabled();
  });
});
