import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import { clearSessionScopedClientState } from '@/services/storage/sessionScopedStorageService';
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  clearAllRecords: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/storage/sync', () => ({
  clearSyncQueueForOwner: vi.fn().mockResolvedValue(undefined),
  recordSyncQueueOwnershipTelemetry: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
const patient = DataFactory.createMockPatient('R4', {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  clinicalEpisodeId: 'ep-A',
  medicalHandoffEntries: [{ id: 'entry-A', specialty: 'Medicina Interna', note: 'Persistida A' }],
});
const cell = () => (
  <table>
    <tbody>
      <tr>
        <HandoffMedicalObservationsCell
          patient={patient}
          reportDate="2026-10-24"
          isFieldReadOnly={false}
          primaryNoteValue=""
          onPrimaryNoteChange={vi.fn()}
          onEntryNoteChange={vi.fn()}
        />
      </tr>
    </tbody>
  </table>
);
afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe('medical draft owner recovery', () => {
  it('survives automatic session cleanup and is visible only when the original owner returns', async () => {
    localStorage.clear();
    localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-A');
    const view = render(cell());
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Borrador conservado de A' },
    });
    fireEvent.blur(screen.getByRole('textbox'));
    view.unmount();
    await act(async () => {
      await clearSessionScopedClientState('automatic');
    });
    localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-B');
    const other = render(cell());
    expect(screen.getByRole('textbox')).toHaveValue('Persistida A');
    other.unmount();
    localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-A');
    render(cell());
    expect(screen.getByRole('textbox')).toHaveValue('Persistida A');
    fireEvent.click(screen.getByText('Revisar borrador'));
    expect(screen.getByText('Borrador conservado de A')).toBeVisible();
  });
});
