import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { MedicalHandoffDraftsPanel } from '@/features/handoff/components/MedicalHandoffDraftsPanel';
import { DataFactory } from '@/tests/factories/DataFactory';
import { readMedicalHandoffDrafts } from '@/services/storage/medicalHandoffDraftStorage';

const patient = DataFactory.createMockPatient('R4', {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  clinicalEpisodeId: 'ep-A',
  medicalHandoffEntries: [
    { id: 'entry-A', specialty: 'Medicina Interna', note: 'Registro original' },
  ],
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
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-A');
});
afterEach(cleanup);

describe('medical handoff draft recovery', () => {
  it('D5 removes the exact confirmed text, then shows and edits the colleague registry value after reload', () => {
    const save = vi.fn();
    const view = render(cell(patient, save));
    type('Nota v1');
    const saved = {
      ...patient,
      medicalHandoffEntries: [{ ...patient.medicalHandoffEntries![0], note: 'Nota v1' }],
    };
    view.rerender(cell(saved, save));
    expect(readMedicalHandoffDrafts()).toHaveLength(0);
    const colleague = {
      ...saved,
      medicalHandoffEntries: [{ ...saved.medicalHandoffEntries[0], note: 'Nota del colega' }],
    };
    view.rerender(cell(colleague, save));
    expect(screen.getByRole('textbox')).toHaveValue('Nota del colega');
    view.unmount();
    render(cell(colleague, save));
    expect(screen.getByRole('textbox')).toHaveValue('Nota del colega');
    type('Nota del colega.');
    expect(save).toHaveBeenLastCalledWith('entry-A', 'Nota del colega.');
  });

  it('offers a rejected draft after reload, never resends it until explicit restore, and allows discard', () => {
    const save = vi.fn();
    const view = render(cell(patient, save));
    type('Texto rechazado');
    view.unmount();
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
    fireEvent.click(screen.getByText('Descartar borrador'));
    expect(screen.getByRole('textbox')).toHaveValue('Registro original');
    expect(readMedicalHandoffDrafts()).toHaveLength(0);
  });

  it('shows a colleague update during focus while preserving the differing text without sending it', () => {
    const save = vi.fn();
    const view = render(cell(patient, save));
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Borrador pendiente' } });
    view.rerender(
      cell(
        {
          ...patient,
          medicalHandoffEntries: [
            { ...patient.medicalHandoffEntries![0], note: 'Nueva nota del colega' },
          ],
        },
        save
      )
    );
    expect(screen.getByRole('textbox')).toHaveValue('Nueva nota del colega');
    fireEvent.blur(screen.getByRole('textbox'));
    expect(save).not.toHaveBeenCalled();
    expect(readMedicalHandoffDrafts()[0].value).toBe('Borrador pendiente');
  });

  it('D7 bounds retained drafts to one per patient, episode and entry across twenty dates', () => {
    for (let day = 1; day <= 20; day++) {
      const view = render(cell(patient, vi.fn(), `2026-10-${String(day).padStart(2, '0')}`));
      type(`Pendiente día ${day}`);
      view.unmount();
    }
    expect(readMedicalHandoffDrafts()).toHaveLength(1);
    expect(readMedicalHandoffDrafts()[0].value).toBe('Pendiente día 20');
  });

  it('D8 retains a remotely deleted entry for review without resurrecting an editor that cannot save', () => {
    const save = vi.fn();
    const other = { id: 'entry-B', specialty: 'Cirugía', note: 'Segunda nota' };
    const view = render(
      cell({ ...patient, medicalHandoffEntries: [...patient.medicalHandoffEntries!, other] }, save)
    );
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Texto de entrada eliminada' },
    });
    fireEvent.blur(screen.getAllByRole('textbox')[0]);
    view.rerender(cell({ ...patient, medicalHandoffEntries: [other] }, save));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('Segunda nota');
    render(<MedicalHandoffDraftsPanel date="2026-10-24" />);
    fireEvent.click(screen.getByText(/Revisar borradores de entrega/));
    expect(screen.getByText('Texto de entrada eliminada')).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Restaurar y guardar borrador'));
    expect(screen.getByRole('status')).toHaveTextContent(/No se puede guardar/);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('D4c never persists an unauthenticated draft and says it is only in memory', () => {
    localStorage.removeItem('hhr_session_owner_v1');
    render(cell());
    type('Sin sesión autenticada');
    fireEvent.click(screen.getByText('Revisar borrador'));
    expect(screen.getByRole('status')).toHaveTextContent(/solo en memoria/);
    expect(
      Object.keys(localStorage).filter(key => key.startsWith('hhr.medicalHandoffDrafts'))
    ).toEqual([]);
  });
});
