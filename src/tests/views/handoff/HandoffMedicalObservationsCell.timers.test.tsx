import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { MedicalHandoffDraftsPanel } from '@/features/handoff/components/MedicalHandoffDraftsPanel';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';

const patient = DataFactory.createMockPatient('R4', {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  clinicalEpisodeId: 'ep-A',
  medicalHandoffEntries: [
    { id: 'primary-entry', specialty: 'Medicina Interna', note: 'Persistida A' },
  ],
});
const cell = (p = patient, onChange = vi.fn()) => (
  <table>
    <tbody>
      <HandoffMedicalObservationsCell
        patient={p}
        reportDate="2026-10-24"
        isFieldReadOnly={false}
        primaryNoteValue=""
        onPrimaryNoteChange={onChange}
        onEntryNoteChange={onChange}
      />
    </tbody>
  </table>
);
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

describe('medical draft continuity and episode ownership', () => {
  it('keeps a rejected note visible past 2.5 seconds and after a reload without retrying', async () => {
    const save = vi.fn();
    const view = render(cell(patient, save));
    const box = screen.getByRole('textbox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'Nota larga escrita para A' } });
    fireEvent.blur(box);
    expect(save).toHaveBeenCalledWith('primary-entry', 'Nota larga escrita para A');
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('textbox')).toHaveValue('Nota larga escrita para A');
    expect(screen.getByRole('status')).toHaveTextContent(/Pendiente de confirmar/);
    view.unmount();
    resetMedicalHandoffDraftMemoryForTests();
    render(cell(patient, save));
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox')).toHaveValue('Persistida A');
    fireEvent.click(screen.getByText('Revisar borrador'));
    expect(screen.getByText('Nota larga escrita para A')).toBeVisible();
    expect(screen.getByText(/Episodio ep-A/)).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('replaces the editor on turnover while keeping A’s unblurred text for review, never sending it to B', () => {
    const saveA = vi.fn();
    const saveB = vi.fn();
    const view = render(cell(patient, saveA));
    const box = screen.getByRole('textbox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'Nota escrita para A' } });
    const b = {
      ...patient,
      patientName: 'Paciente B Sintético',
      clinicalEpisodeId: 'ep-B',
      medicalHandoffEntries: [
        { id: 'primary-entry', specialty: 'Medicina Interna', note: 'Persistida B' },
      ],
    };
    view.rerender(cell(b, saveB));
    expect(screen.getByRole('textbox')).not.toBe(box);
    expect(screen.getByRole('textbox')).toHaveValue('Persistida B');
    fireEvent.blur(screen.getByRole('textbox'));
    act(() => vi.advanceTimersByTime(5000));
    expect(saveA).not.toHaveBeenCalled();
    expect(saveB).not.toHaveBeenCalled();
    render(<MedicalHandoffDraftsPanel />);
    fireEvent.click(screen.getByText(/Revisar borradores de entrega/));
    expect(screen.getByText('Nota escrita para A')).toBeVisible();
    expect(screen.getByText('Nota de entrega de Paciente A Sintético · 24-10-2026')).toBeVisible();
    expect(screen.getByText(/Episodio ep-A/)).toBeVisible();
  });

  it('captures the save callback on the first keystroke rather than on blur', () => {
    const original = vi.fn();
    const later = vi.fn();
    const view = render(cell(patient, original));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Texto para A' } });
    view.rerender(cell(patient, later));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(original).toHaveBeenCalledWith('primary-entry', 'Texto para A');
    expect(later).not.toHaveBeenCalled();
  });
});
