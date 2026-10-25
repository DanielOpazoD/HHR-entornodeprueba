import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { MedicalHandoffDraftsPanel } from '@/features/handoff/components/MedicalHandoffDraftsPanel';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  confirmMedicalHandoffDrafts,
  readMedicalHandoffDrafts,
  resetMedicalHandoffDraftMemoryForTests,
} from '@/services/storage/medicalHandoffDraftStorage';
import { buildSpecialistHandoffIdentity } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';

const patient = DataFactory.createMockPatient('R4', {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  clinicalEpisodeId: 'ep-A',
  medicalHandoffEntries: [
    { id: 'entry-A', specialty: 'Medicina Interna', note: 'Registro original' },
  ],
});
const withNote = (note: string) => ({
  ...patient,
  medicalHandoffEntries: [{ ...patient.medicalHandoffEntries![0], note }],
});
const cell = (p = patient, save = vi.fn(), date = '2026-10-24') => (
  <table>
    <tbody>
      <tr>
        <HandoffMedicalObservationsCell
          patient={p}
          reportDate={date}
          isFieldReadOnly={false}
          primaryNoteValue=""
          onPrimaryNoteChange={save}
          onEntryNoteChange={save}
        />
      </tr>
    </tbody>
  </table>
);
const type = (value: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  fireEvent.blur(screen.getByRole('textbox'));
};
/** A reload drops this page's memory; localStorage keeps the drafts. */
const reload = () => {
  cleanup();
  resetMedicalHandoffDraftMemoryForTests();
};
const serverConfirms = (note: string) =>
  confirmMedicalHandoffDrafts('2026-10-24', [
    { ...buildSpecialistHandoffIdentity(patient), entries: [{ id: 'entry-A', note }] },
  ]);
beforeEach(() => {
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-A');
});
afterEach(cleanup);

describe('medical handoff draft recovery', () => {
  it('D5 keeps the draft until the server confirms that text, then shows the colleague value', async () => {
    const save = vi.fn();
    const view = render(cell(patient, save));
    type('Nota v1');
    await act(async () => {});
    view.rerender(cell(withNote('Nota v1'), save));
    expect(readMedicalHandoffDrafts()).toHaveLength(1);
    serverConfirms('Nota v1');
    expect(readMedicalHandoffDrafts()).toHaveLength(0);
    view.rerender(cell(withNote('Nota del colega'), save));
    expect(screen.getByRole('textbox')).toHaveValue('Nota del colega');
    reload();
    render(cell(withNote('Nota del colega'), save));
    expect(screen.getByRole('textbox')).toHaveValue('Nota del colega');
    type('Nota del colega.');
    expect(save).toHaveBeenLastCalledWith('entry-A', 'Nota del colega.');
  });

  it('does not take a matching local copy as a confirmation', () => {
    const view = render(cell());
    type('Nota local');
    view.rerender(cell(withNote('Nota local')));
    reload();
    render(cell(withNote('Nota local')));
    expect(screen.getByText(/pendiente de confirmar en el servidor/)).toBeVisible();
    expect(readMedicalHandoffDrafts().map(draft => draft.value)).toEqual(['Nota local']);
  });

  it('offers a rejected draft after reload, never resends it until restored, and discards it only after confirming', () => {
    const save = vi.fn();
    render(cell(patient, save));
    type('Texto rechazado');
    reload();
    render(cell(patient, save));
    expect(screen.getByRole('textbox')).toHaveValue('Registro original');
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Revisar borrador'));
    expect(screen.getByText('Texto rechazado')).toBeVisible();
    fireEvent.click(screen.getByText('Restaurar y guardar borrador'));
    expect(save).toHaveBeenLastCalledWith('entry-A', 'Texto rechazado');
    expect(save).toHaveBeenCalledTimes(2);

    reload();
    render(cell(patient, save));
    fireEvent.click(screen.getByText('Revisar borrador'));
    fireEvent.click(screen.getByText('Descartar borrador'));
    expect(readMedicalHandoffDrafts()).toHaveLength(1);
    fireEvent.click(screen.getByText('Sí, descartar'));
    expect(screen.getByRole('textbox')).toHaveValue('Registro original');
    expect(readMedicalHandoffDrafts()).toHaveLength(0);
  });

  it('keeps the typed text during a colleague update while focused and sends nothing', () => {
    const save = vi.fn();
    const view = render(cell(patient, save));
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Borrador pendiente' } });
    view.rerender(cell(withNote('Nueva nota del colega'), save));
    expect(screen.getByRole('textbox')).toHaveValue('Borrador pendiente');
    expect(within(screen.getByRole('status')).getByText('Nueva nota del colega')).toBeVisible();
    fireEvent.blur(screen.getByRole('textbox'));
    expect(save).not.toHaveBeenCalled();
    expect(readMedicalHandoffDrafts()[0].value).toBe('Borrador pendiente');
  });

  it('D7 keeps one dated draft per clinical date, never replacing an earlier day', () => {
    for (let day = 1; day <= 20; day++) {
      const view = render(cell(patient, vi.fn(), `2026-10-${String(day).padStart(2, '0')}`));
      type(`Pendiente día ${day}`);
      view.unmount();
    }
    expect(readMedicalHandoffDrafts()).toHaveLength(20);
    render(<MedicalHandoffDraftsPanel />);
    fireEvent.click(screen.getByText('Revisar borradores de entrega (20)'));
    expect(screen.getByText('Nota de entrega de Paciente A Sintético · 01-10-2026')).toBeVisible();
    expect(screen.getByText('Pendiente día 1')).toBeVisible();
    expect(screen.getByText('Pendiente día 20')).toBeVisible();
  });

  it('D8 keeps a remotely deleted entry for review without an editor that cannot save', async () => {
    const save = vi.fn();
    const other = { id: 'entry-B', specialty: 'Cirugía', note: 'Segunda nota' };
    const view = render(
      cell({ ...patient, medicalHandoffEntries: [...patient.medicalHandoffEntries!, other] }, save)
    );
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Texto de entrada eliminada' },
    });
    fireEvent.blur(screen.getAllByRole('textbox')[0]);
    await act(async () => {});
    view.rerender(cell({ ...patient, medicalHandoffEntries: [other] }, save));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('Segunda nota');
    render(<MedicalHandoffDraftsPanel />);
    fireEvent.click(screen.getByText(/Revisar borradores de entrega/));
    expect(screen.getByText('Texto de entrada eliminada')).toBeVisible();
    expect(screen.queryByText('Restaurar y guardar borrador')).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('D4c never persists an unauthenticated draft and says it is only in memory', () => {
    localStorage.removeItem('hhr_session_owner_v1');
    render(cell());
    type('Sin sesión autenticada');
    expect(screen.getByRole('status')).toHaveTextContent(/solo en memoria/);
    expect(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
        key => key?.startsWith('hhr.medicalHandoffDraft')
      )
    ).toEqual([]);
  });
});
