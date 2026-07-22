import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { RayenNursingShiftProposalModal } from '@/features/rayen-import/components/RayenNursingShiftProposalModal';
import type { CensusImportDiff } from '@/features/rayen-import';

const mocks = vi.hoisted(() => ({
  useRayenFillProgress: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => mocks.useRayenFillProgress(),
}));

const diff: CensusImportDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [
    {
      bedId: 'H2C1',
      rut: '22.025.389-9',
      patientName: 'Paciente Egresado',
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
      verification: {
        medicalEpicrisis: 'confirmed',
        nursingEpicrisis: 'confirmed',
        hospitalDischarge: 'confirmed',
      },
    },
  ],
  pendingAdministrativeDischarges: [
    {
      bedId: 'H5C1',
      rut: '29.335.605-K',
      patientName: 'Paciente Pendiente',
      signal: 'clinical-closure',
      encounterId: '141705',
      verification: {
        medicalEpicrisis: 'confirmed',
        nursingEpicrisis: 'not-detected',
        hospitalDischarge: 'not-detected',
      },
    },
  ],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 1,
    pendingAdministrativeDischarges: 1,
    conflicts: 0,
    unchanged: 0,
  },
};

describe('RayenImportPreviewModal discharge verification', () => {
  beforeEach(() => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'idle',
      attemptId: 0,
      done: 0,
      total: 0,
      errors: 0,
      lastCompletedAt: null,
      staffingOutcome: 'idle',
    });
  });

  it('shows independent document evidence instead of a single ambiguous closure message', () => {
    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getAllByTitle('Epicrisis médica: confirmado')).toHaveLength(2);
    expect(screen.getByTitle('Epicrisis enfermería: confirmado')).toBeInTheDocument();
    expect(screen.getByTitle('Egreso hospitalario: confirmado')).toBeInTheDocument();
    expect(screen.getByTitle('Epicrisis enfermería: no detectado')).toBeInTheDocument();
    expect(screen.getByTitle('Egreso hospitalario: no detectado')).toBeInTheDocument();
    expect(
      screen.getAllByRole('group', { name: 'Verificación documental del egreso' })
    ).toHaveLength(2);
    expect(screen.getAllByText(': confirmado')).toHaveLength(4);
    expect(
      screen.getByText('cierre clínico registrado; egreso hospitalario aún no detectado')
    ).toBeInTheDocument();
  });

  it('shows deterministic patient progress and the real synchronization scope', () => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      outcome: 'running',
      attemptId: 1,
      done: 2,
      total: 4,
      errors: 0,
      lastCompletedAt: null,
      staffingOutcome: 'idle',
    });

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByRole('progressbar', { name: 'Progreso de sincronización con Eloísa' })
    ).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText('2 de 4 pacientes revisados')).not.toBeInTheDocument();
    expect(screen.getByText('Censo y demografía')).toBeInTheDocument();
    expect(screen.getByText('Signos vitales')).toBeInTheDocument();
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.getByText('Enfermería')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar e importar' })).not.toBeInTheDocument();
  });

  it('offers a calm close action when a no-change run settles', () => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      outcome: 'running',
      attemptId: 1,
      done: 4,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-20T17:00:00.000Z',
      staffingOutcome: 'idle',
    });
    const onCancel = vi.fn();
    const noChanges = {
      ...diff,
      discharges: [],
      pendingAdministrativeDischarges: [],
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 8,
      },
    };

    const { rerender } = render(
      <RayenImportPreviewModal
        isOpen
        diff={noChanges}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'complete',
      attemptId: 1,
      done: 8,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-21T17:00:00.000Z',
      staffingOutcome: 'resolved',
    });
    rerender(
      <RayenImportPreviewModal
        isOpen
        diff={noChanges}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Todo está actualizado')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByRole('button', { name: 'Confirmar e importar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('recognizes a current fill that completed before the preview effect observed running', () => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'complete',
      attemptId: 1,
      done: 8,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-20T17:00:00.000Z',
      staffingOutcome: 'resolved',
    });
    const noChanges = {
      ...diff,
      discharges: [],
      pendingAdministrativeDischarges: [],
      summary: { ...diff.summary, discharges: 0, pendingAdministrativeDischarges: 0 },
    };

    render(
      <RayenImportPreviewModal
        isOpen
        diff={noChanges}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Todo está actualizado')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('does not claim everything is updated while census conflicts remain unresolved', () => {
    const conflictedDiff = {
      ...diff,
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [{ bedId: 'H2C1', reason: 'La cama cambió durante la revisión.' }],
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 1,
        unchanged: 7,
      },
    };
    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      outcome: 'running',
      attemptId: 1,
      done: 2,
      total: 8,
      errors: 0,
      lastCompletedAt: null,
      staffingOutcome: 'idle',
    });

    const { rerender } = render(
      <RayenImportPreviewModal
        isOpen
        diff={conflictedDiff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'complete',
      attemptId: 1,
      done: 8,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-21T17:00:00.000Z',
      staffingOutcome: 'resolved',
    });
    rerender(
      <RayenImportPreviewModal
        isOpen
        diff={conflictedDiff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
    expect(screen.getByText('Sincronización completada con conflictos pendientes')).toBeVisible();
    expect(screen.getByText(/Los conflictos del censo no se aplicaron/)).toBeVisible();
    expect(screen.getByText('H2C1: La cama cambió durante la revisión.')).toBeVisible();
  });

  it('allows keeping current staffing without depending on the nursing portal', () => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'complete',
      attemptId: 1,
      done: 8,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-21T17:00:00.000Z',
      staffingOutcome: 'pending',
    });
    const onCancel = vi.fn();

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
    expect(screen.getByText('Información revisada · confirma enfermería')).toBeVisible();
    const keepCurrent = screen.getByRole('button', { name: 'Mantener actual y cerrar' });
    expect(keepCurrent).toBeEnabled();
    fireEvent.click(keepCurrent);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps completed clinical progress at 100% while applying nursing staffing', () => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'complete',
      attemptId: 1,
      done: 8,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-21T17:00:00.000Z',
      staffingOutcome: 'applying',
    });

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Actualizando enfermería')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows a global clinical failure as an observation instead of complete success', () => {
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      outcome: 'partial',
      attemptId: 1,
      done: 8,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-21T17:00:00.000Z',
      staffingOutcome: 'resolved',
    });

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
    expect(screen.getByText('Sincronización completada con observaciones')).toBeVisible();
    fireEvent.click(screen.getByText('Ver observaciones'));
    expect(screen.getByText(/Parte de la información clínica no pudo revisarse/)).toBeVisible();
  });

  it('does not report success when the latest clinical fill is rejected by single-flight', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));

    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      outcome: 'rejected',
      attemptId: 2,
      done: 3,
      total: 8,
      errors: 0,
      lastCompletedAt: '2026-07-20T17:00:00.000Z',
      staffingOutcome: 'idle',
    });
    rerender(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        isBusy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByText('La información clínica no pudo iniciar')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByText('Todo está actualizado')).not.toBeInTheDocument();
  });

  it('keeps the nursing result inside the same synchronization dialog', async () => {
    render(
      <>
        <RayenImportPreviewModal
          isOpen
          diff={diff}
          isBusy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
        <RayenNursingShiftProposalModal
          proposal={{
            censusDate: '2026-07-21',
            day: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
            night: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
          }}
          isBusy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </>
    );

    const panel = await screen.findByTestId('rayen-nursing-shift-proposal');
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContainElement(panel);
    expect(screen.getByText(/No se encontraron registros suficientes/)).toBeInTheDocument();
  });
});
