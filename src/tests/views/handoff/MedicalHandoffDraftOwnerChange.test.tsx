/** Synthetic-only: text typed while the session is gone never reaches another user on this tab. */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { MedicalHandoffDraftsPanel } from '@/features/handoff/components/MedicalHandoffDraftsPanel';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';

const OWNER_KEY = 'hhr_session_owner_v1';
const FIRST_USER = 'user:synthetic-specialist-one';
const SECOND_USER = 'user:synthetic-specialist-two';
const patient = DataFactory.createMockPatient('R4', {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  clinicalEpisodeId: 'ep-A',
  medicalHandoffEntries: [{ id: 'entry-A', specialty: 'Medicina Interna', note: 'Persistida A' }],
});
const view = (save: (...args: unknown[]) => unknown) => (
  <>
    <table>
      <tbody>
        <tr>
          <HandoffMedicalObservationsCell
            patient={patient}
            reportDate="2026-10-24"
            isFieldReadOnly={false}
            primaryNoteValue=""
            onPrimaryNoteChange={save}
            onEntryNoteChange={save}
          />
        </tr>
      </tbody>
    </table>
    <MedicalHandoffDraftsPanel />
  </>
);
const box = () => screen.getByRole('textbox');
const typeAndLeave = (value: string) => {
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value } });
  fireEvent.blur(box());
};
const storedDraftText = () =>
  Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter(key => key?.startsWith('hhr.medicalHandoffDraft'))
    .map(key => localStorage.getItem(key as string))
    .join('|');
const realSetItem = localStorage.setItem;

beforeEach(() => {
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.setItem = realSetItem;
  localStorage.clear();
  localStorage.setItem(OWNER_KEY, FIRST_USER);
});
afterEach(() => {
  cleanup();
  localStorage.setItem = realSetItem;
});

describe('text typed while the session is lost', () => {
  it('goes back to the same user when that user signs in again, and is never sent meanwhile', () => {
    const save = vi.fn();
    const first = render(view(save));
    localStorage.removeItem(OWNER_KEY);
    typeAndLeave('Texto sin sesión');
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/solo en memoria/);
    expect(storedDraftText()).not.toContain('Texto sin sesión');
    first.unmount();

    // Still signed out: a remount keeps the text in the box, with the honest notice.
    const remounted = render(view(save));
    expect(box()).toHaveValue('Texto sin sesión');
    expect(screen.getByRole('status')).toHaveTextContent(/solo en memoria/);
    fireEvent.focus(box());
    fireEvent.blur(box());
    remounted.unmount();

    localStorage.setItem(OWNER_KEY, FIRST_USER);
    render(view(save));
    fireEvent.click(screen.getByText('Revisar borrador'));
    expect(screen.getByText('Texto sin sesión')).toBeVisible();
    expect(storedDraftText()).toContain('Texto sin sesión');
    expect(save).not.toHaveBeenCalled();
  });

  it('is never shown, stored or sent under a different user who signs in next', () => {
    const firstSave = vi.fn();
    const first = render(view(firstSave));
    localStorage.removeItem(OWNER_KEY);
    typeAndLeave('Texto sin sesión');
    first.unmount();

    localStorage.setItem(OWNER_KEY, SECOND_USER);
    const secondSave = vi.fn();
    render(view(secondSave));
    expect(document.body.textContent).not.toContain('Texto sin sesión');
    expect(screen.queryByText('Revisar borrador')).not.toBeInTheDocument();
    expect(screen.getByText('Se descartó texto no guardado de otra sesión.')).toBeVisible();
    expect(storedDraftText()).not.toContain('Texto sin sesión');
    fireEvent.focus(box());
    fireEvent.blur(box());
    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).not.toHaveBeenCalled();
  });

  it('drops in-memory copies and the open editing session at logout, even for the same user', () => {
    const save = vi.fn();
    localStorage.setItem = () => {
      throw new DOMException('Synthetic storage limit', 'QuotaExceededError');
    };
    const first = render(view(save));
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'Texto solo en memoria' } });
    expect(screen.getByRole('status')).toHaveTextContent(/solo en memoria/);
    localStorage.setItem = realSetItem;

    localStorage.removeItem(OWNER_KEY);
    first.rerender(view(save));
    expect(box()).toHaveValue('Persistida A');
    localStorage.setItem(OWNER_KEY, FIRST_USER);
    first.rerender(view(save));
    expect(box()).toHaveValue('Persistida A');
    expect(document.body.textContent).not.toContain('Texto solo en memoria');
    expect(storedDraftText()).not.toContain('Texto solo en memoria');
  });
});
