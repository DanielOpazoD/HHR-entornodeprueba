/** Synthetic-only: the specialist keeps typing while saves are confirmed or a colleague writes. */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';

const DATE = '2026-10-24';
const patientWith = (note: string) =>
  DataFactory.createMockPatient('R4', {
    patientName: 'Paciente A Sintético',
    rut: '99.999.999-9',
    documentType: 'RUT',
    admissionDate: '2026-10-20',
    clinicalEpisodeId: 'ep-A',
    medicalHandoffEntries: [{ id: 'entry-1', specialty: 'Medicina Interna', note }],
  });
const cell = (note: string, save: (entryId: string, value: string) => unknown) => (
  <table>
    <tbody>
      <tr>
        <HandoffMedicalObservationsCell
          patient={patientWith(note)}
          reportDate={DATE}
          isFieldReadOnly={false}
          primaryNoteValue=""
          onPrimaryNoteChange={vi.fn()}
          onEntryNoteChange={save}
        />
      </tr>
    </tbody>
  </table>
);
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });

beforeEach(() => {
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-A');
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the editor owns the text while the specialist writes', () => {
  it('keeps the words typed after a pause when that pause is confirmed', () => {
    const save = vi.fn();
    const view = render(cell('', save));
    fireEvent.focus(box());
    type('Nota v1');
    act(() => vi.advanceTimersByTime(1600));
    expect(save).toHaveBeenLastCalledWith('entry-1', 'Nota v1');

    type('Nota v1 y hallazgo nuevo');
    view.rerender(cell('Nota v1', save));
    expect(box()).toHaveValue('Nota v1 y hallazgo nuevo');

    act(() => vi.advanceTimersByTime(1600));
    expect(save).toHaveBeenLastCalledWith('entry-1', 'Nota v1 y hallazgo nuevo');
    type('Nota v1 y hallazgo nuevo. Control mañana');
    fireEvent.blur(box());
    expect(save).toHaveBeenLastCalledWith('entry-1', 'Nota v1 y hallazgo nuevo. Control mañana');
  });

  it('keeps the words typed after a blur when that blur is confirmed', () => {
    const save = vi.fn();
    const view = render(cell('Base', save));
    fireEvent.focus(box());
    type('Base. Control');
    fireEvent.blur(box());
    fireEvent.focus(box());
    type('Base. Control de potasio mañana');
    view.rerender(cell('Base. Control', save));
    expect(box()).toHaveValue('Base. Control de potasio mañana');
    fireEvent.blur(box());
    expect(save).toHaveBeenLastCalledWith('entry-1', 'Base. Control de potasio mañana');
  });

  it('keeps showing the sent text while its save is still in flight and the box is not focused', async () => {
    let finish: () => void = () => {};
    const save = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
    const view = render(cell('Base', save));
    fireEvent.focus(box());
    type('Base. Texto enviado');
    fireEvent.blur(box());
    view.rerender(cell('Base', save));
    expect(box()).toHaveValue('Base. Texto enviado');
    view.rerender(cell('Base. Texto enviado', save));
    await act(async () => finish());
    expect(box()).toHaveValue('Base. Texto enviado');
  });

  it('shows a colleague update beside the typed text and sends nothing until the specialist chooses', () => {
    const save = vi.fn();
    const view = render(cell('Base', save));
    fireEvent.focus(box());
    type('Base. Mi evaluación de la tarde');
    view.rerender(cell('Base. Agregado del colega', save));
    expect(box()).toHaveValue('Base. Mi evaluación de la tarde');
    expect(within(screen.getByRole('status')).getByText('Base. Agregado del colega')).toBeVisible();

    type('Base. Mi evaluación de la tarde y plan');
    act(() => vi.advanceTimersByTime(1600));
    fireEvent.blur(box());
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Guardar mi texto'));
    expect(save).toHaveBeenLastCalledWith('entry-1', 'Base. Mi evaluación de la tarde y plan');
  });

  it('can take the colleague text instead, only after confirming the discard', () => {
    const save = vi.fn();
    const view = render(cell('Base', save));
    fireEvent.focus(box());
    type('Base. Mi evaluación');
    fireEvent.blur(box());
    view.rerender(cell('Base. Agregado del colega', save));
    fireEvent.click(screen.getByText('Usar el texto guardado'));
    expect(box()).toHaveValue('Base. Mi evaluación');
    fireEvent.click(screen.getByText('Sí, descartar'));
    expect(box()).toHaveValue('Base. Agregado del colega');
    expect(screen.queryByText('Revisar borrador')).not.toBeInTheDocument();
  });
});
