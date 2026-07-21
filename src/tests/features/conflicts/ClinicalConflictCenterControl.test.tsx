/** @vitest-environment jsdom */
import '../../setup';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalConflictCenterControl } from '@/components/clinical-conflicts/ClinicalConflictCenterControl';
import type { ConflictVersionRecoveryModel } from '@/hooks/clinical-conflicts/useConflictVersionRecovery';
import type { ConflictVersionSnapshot } from '@/application/ports/dailyRecordConflictRecoveryPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const mockRecovery = vi.hoisted(() => vi.fn<() => ConflictVersionRecoveryModel>());

vi.mock('@/hooks/clinical-conflicts/useConflictVersionRecovery', () => ({
  useConflictVersionRecovery: () => mockRecovery(),
}));

const buildRecord = (pathology: string, note: string): DailyRecord =>
  ({
    date: '2026-07-01',
    beds: {
      H1: {
        bedId: 'H1',
        bedName: 'H1',
        patientName: 'Pierre Jean',
        rut: '25DF52626',
        pathology,
        handoffNoteDayShift: note,
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-01T10:00:00.000Z',
  }) as unknown as DailyRecord;

const buildSnapshot = (
  id: string,
  origin: ConflictVersionSnapshot['origin'],
  record: DailyRecord
): ConflictVersionSnapshot => ({
  id,
  origin,
  conflictId: 'conflict-1',
  sourceLastUpdated: record.lastUpdated,
  record,
});

const buildCrowdedRecord = (pathologyPrefix: string): DailyRecord =>
  ({
    date: '2026-07-01',
    beds: Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => {
        const bedId = `H${String(index).padStart(2, '0')}`;
        return [
          bedId,
          {
            bedId,
            bedName: bedId,
            patientName: `Paciente ${index}`,
            rut: `RUT-${index}`,
            pathology: `${pathologyPrefix} ${index}`,
          },
        ];
      })
    ),
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-01T10:00:00.000Z',
  }) as unknown as DailyRecord;

const buildRecordWithDischarge = (): DailyRecord =>
  ({
    ...buildRecord('Neumonia', 'A'),
    lastUpdated: '2026-07-01T18:00:00.000Z',
    discharges: [
      {
        id: 'd-1',
        bedName: 'H2',
        bedId: 'H2',
        bedType: 'Cama',
        patientName: 'Alta Posterior',
        rut: '17.274.300-5',
        diagnosis: 'Alta posterior',
        time: '15:00',
        status: 'Vivo',
      },
    ],
  }) as unknown as DailyRecord;

const defaultRecovery = (
  overrides: Partial<ConflictVersionRecoveryModel> = {}
): ConflictVersionRecoveryModel => ({
  canManageClinicalConflicts: true,
  isOpen: true,
  loading: false,
  restoringId: null,
  snapshots: [
    buildSnapshot('conflict-1__remote_premerge', 'remote_premerge', buildRecord('Neumonia', 'A')),
    buildSnapshot('conflict-1__incoming_premerge', 'incoming_premerge', buildRecord('ICC', 'B')),
  ],
  snapshotRecovery: null,
  open: vi.fn(),
  close: vi.fn(),
  restore: vi.fn(),
  ...overrides,
});

describe('ClinicalConflictCenterControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render the affordance for users without conflict management access', () => {
    mockRecovery.mockReturnValue(defaultRecovery({ canManageClinicalConflicts: false }));

    render(<ClinicalConflictCenterControl date="2026-07-01" scope="nursing_handoff" />);

    expect(screen.queryByTestId('clinical-conflict-center-button')).not.toBeInTheDocument();
  });

  it('renders an explainable empty state when snapshots are unavailable', () => {
    mockRecovery.mockReturnValue(
      defaultRecovery({
        snapshots: [],
        snapshotRecovery: {
          status: 'saved',
          snapshotIds: ['conflict-1__remote_premerge'],
          origins: ['remote_premerge'],
          ttlMs: 172800000,
          unavailableReason: 'permission_denied',
        },
      })
    );

    render(<ClinicalConflictCenterControl date="2026-07-01" scope="medical_handoff" />);

    expect(screen.getByTestId('clinical-conflict-center-modal')).toBeInTheDocument();
    expect(screen.getByText('Snapshots sin permiso de lectura')).toBeInTheDocument();
    expect(screen.getByText(/Entrega médica · 2026-07-01/)).toBeInTheDocument();
  });

  it('keeps the center operable when snapshot lookup fails because Firestore needs an index', () => {
    mockRecovery.mockReturnValue(
      defaultRecovery({
        snapshots: [],
        snapshotRecovery: {
          status: 'failed',
          unavailableReason: 'query_index_missing',
        },
      })
    );

    render(<ClinicalConflictCenterControl date="2026-07-03" scope="census" />);

    expect(screen.getByTestId('clinical-conflict-center-modal')).toBeInTheDocument();
    expect(screen.getByText('Consulta de snapshots no disponible')).toBeInTheDocument();
    expect(screen.getByText(/falta un índice\/consulta de Firestore/i)).toBeInTheDocument();
  });

  it('shows truncation hints and audits total counts when the conflict summary is capped', () => {
    const restore = vi.fn();
    mockRecovery.mockReturnValue(
      defaultRecovery({
        restore,
        snapshots: [
          buildSnapshot(
            'conflict-1__remote_premerge',
            'remote_premerge',
            buildCrowdedRecord('Remoto')
          ),
          buildSnapshot(
            'conflict-1__incoming_premerge',
            'incoming_premerge',
            buildCrowdedRecord('Local')
          ),
        ],
      })
    );

    render(<ClinicalConflictCenterControl date="2026-07-01" scope="census" />);

    expect(screen.getByText('+7 paciente(s) adicionales')).toBeInTheDocument();
    expect(
      screen.getByText('+5 diferencia(s) adicionales en el registro completo.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Preservar')[0]);

    expect(restore).toHaveBeenCalledWith(
      'conflict-1__remote_premerge',
      expect.objectContaining({
        reviewContext: expect.objectContaining({
          patientContextCount: 13,
          patientContextsTruncated: true,
          changedFieldCount: 13,
          changedFieldsTruncated: true,
        }),
      })
    );
  });

  it('shows patient-centered differences and delegates preservation to audited restore', () => {
    const restore = vi.fn();
    mockRecovery.mockReturnValue(defaultRecovery({ restore }));

    render(<ClinicalConflictCenterControl date="2026-07-01" scope="nursing_handoff" />);

    expect(screen.getByText('Pierre Jean · 25DF52626 · H1')).toBeInTheDocument();
    expect(screen.getByText('Diagnóstico')).toBeInTheDocument();
    expect(screen.getByText('Nota enfermería turno largo')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Preservar')[0]);

    expect(restore).toHaveBeenCalledWith(
      'conflict-1__remote_premerge',
      expect.objectContaining({
        title: 'Preservar versión seleccionada',
        confirmText: 'Preservar',
        reviewContext: expect.objectContaining({
          source: 'clinical_conflict_center',
          scope: 'nursing_handoff',
          selectedVersionLabel: 'Versión en la nube',
          patientContexts: expect.arrayContaining([
            expect.objectContaining({ patientName: 'Pierre Jean', rut: '25DF52626' }),
          ]),
          changedFields: expect.arrayContaining([
            expect.objectContaining({ label: 'Diagnóstico', before: 'Neumonia', after: 'ICC' }),
          ]),
        }),
      })
    );
  });

  it('can hide the visible census button label without losing the actionable accessible name', () => {
    mockRecovery.mockReturnValue(defaultRecovery({ isOpen: false }));

    render(
      <ClinicalConflictCenterControl
        date="2026-07-01"
        scope="census"
        buttonTestId="conflict-versions-button"
        hideButtonLabel
      />
    );

    const button = screen.getByTestId('conflict-versions-button');
    expect(button).toHaveAccessibleName(
      'Centro de conflictos clínicos de Censo diario · revisión requerida'
    );
    expect(button).not.toHaveTextContent('Conflictos');
    expect(button).toHaveTextContent('2');
  });

  it('supports the compact HHR quick-action presentation used beside Lab', () => {
    mockRecovery.mockReturnValue(defaultRecovery({ isOpen: false, snapshots: [] }));

    render(
      <ClinicalConflictCenterControl
        date="2026-07-01"
        scope="census"
        buttonTestId="conflict-versions-button"
        buttonLabel="Conflictos HHR"
        buttonVariant="quick-action"
      />
    );

    const button = screen.getByTestId('conflict-versions-button');
    expect(button).toHaveTextContent('Conflictos HHR');
    expect(button).toHaveClass('h-[30px]', 'min-w-[96px]', 'border-slate-200');
  });

  it('shows anti-rollback impact and disables preserving a version that would remove a later movement', () => {
    const restore = vi.fn();
    mockRecovery.mockReturnValue(defaultRecovery({ restore }));

    render(
      <ClinicalConflictCenterControl
        date="2026-07-01"
        scope="census"
        currentRecord={buildRecordWithDischarge()}
      />
    );

    expect(screen.getAllByText('Bloqueado por seguridad clínica')[0]).toBeInTheDocument();
    expect(screen.getAllByText(/eliminaría una alta visible/i)[0]).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Bloqueado')[0]);

    expect(restore).not.toHaveBeenCalled();
  });

  it('shows review-required impact while still allowing preservation for newer handoff notes', () => {
    const restore = vi.fn();
    mockRecovery.mockReturnValue(defaultRecovery({ restore }));

    render(
      <ClinicalConflictCenterControl
        date="2026-07-01"
        scope="nursing_handoff"
        currentRecord={buildRecord('Neumonia', 'Nota posterior de enfermeria')}
      />
    );

    expect(screen.getAllByText('Requiere revisión')[0]).toBeInTheDocument();
    expect(screen.getAllByText(/nota posterior de entrega de enfermería/i)[0]).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Preservar')[0]);

    expect(restore).toHaveBeenCalledWith(
      'conflict-1__remote_premerge',
      expect.objectContaining({
        reviewContext: expect.objectContaining({
          scope: 'nursing_handoff',
        }),
      })
    );
  });
});
