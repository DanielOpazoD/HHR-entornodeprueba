import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemHealthSyncConvergencePanel } from '@/features/admin/components/SystemHealthSyncConvergencePanel';
import type { SystemHealthSyncConvergencePanelModel } from '@/features/admin/components/systemHealthSyncConvergenceModel';

const model: SystemHealthSyncConvergencePanelModel = {
  status: 'needs_review',
  statusLabel: 'Requiere revisión',
  summary: 'Requiere revisión: 2 hallazgos en 1 grupo clínico.',
  pendingOperations: 1,
  blockedOperations: 1,
  recoverableDivergences: 1,
  affectedUsers: 1,
  operatorActions: [
    'Acción segura: reintentar cola local o esperar drenaje de outbox.',
    'abrir centro de conflictos clínicos y revisar contexto antes de preservar.',
  ],
  clinicalSignals: [
    {
      label: 'Entrega médica',
      count: 1,
      examples: [
        'Hospitalizados HHR · Entrega médica divergente en medicalHandoffBySpecialty.cirugia.note. · Paciente: Ana Perez',
      ],
    },
  ],
  lastConvergenceOkAt: '2026-07-02T11:00:00.000Z',
  technicalDetails: ['raw sync detail hidden until requested'],
};

describe('SystemHealthSyncConvergencePanel', () => {
  it('shows operator actions and clinical signals before raw technical details', () => {
    render(<SystemHealthSyncConvergencePanel model={model} />);

    expect(screen.getByText('Acciones sugeridas')).toBeInTheDocument();
    expect(screen.getByText(/reintentar cola local/i)).toBeInTheDocument();
    expect(screen.getByText(/abrir centro de conflictos clínicos/i)).toBeInTheDocument();
    expect(screen.getByText('Señales clínicas')).toBeInTheDocument();
    expect(screen.getAllByText(/Entrega médica/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ana Perez/)).toBeInTheDocument();
    expect(screen.queryByText('raw sync detail hidden until requested')).not.toBeInTheDocument();

    const detailsButton = screen.getByRole('button', { name: /detalle técnico/i });
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(detailsButton);

    expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
    const actionsHeading = screen.getByText('Acciones sugeridas');
    const rawDetail = screen.getByText('raw sync detail hidden until requested');
    expect(
      actionsHeading.compareDocumentPosition(rawDetail) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
