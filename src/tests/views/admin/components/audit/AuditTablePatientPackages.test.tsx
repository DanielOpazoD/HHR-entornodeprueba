import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuditTable } from '@/features/admin/components/internal/audit/AuditTable';
import { buildClinicalAuditPatientPackages } from '@/services/admin/clinicalAuditPatientPackages';
import type {
  ClinicalAuditPatientPackageFilterOption,
  ClinicalAuditPatientPackageIntentOption,
} from '@/services/admin/clinicalAuditPatientPackageFilters';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const statusLog: AuditLogEntry = {
  id: 'status-1',
  timestamp: '2026-07-01T19:36:29.000Z',
  userId: 'daniel.opazo@hospitalhangaroa.cl',
  userDisplayName: 'Daniel Opazo Damiani',
  userUid: 'uid-123',
  ipAddress: '148.227.67.162',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'H4C1',
  recordDate: '2026-07-01',
  patientIdentifier: '25DF52626',
  details: {
    patientName: 'Anastasio Hey Riroroko',
    rut: '25DF52626',
    bedId: 'H4C1',
    changes: { status: { old: '', new: 'Estable' } },
  },
};

const diagnosisLog: AuditLogEntry = {
  ...statusLog,
  id: 'diagnosis-1',
  timestamp: '2026-07-01T19:36:54.000Z',
  action: 'PATIENT_DIAGNOSIS_CHANGED',
  details: {
    patientName: 'Anastasio Hey Riroroko',
    rut: '25DF52626',
    bedId: 'H4C1',
    changes: { diagnosis: { old: '', new: 'ICC' } },
  },
};

const patientPackages = buildClinicalAuditPatientPackages([statusLog, diagnosisLog]);

const baseProps = {
  filteredLogs: [statusLog, diagnosisLog],
  displayLogsCount: 2,
  paginatedLogs: [statusLog, diagnosisLog],
  patientPackages,
  paginatedPatientPackages: patientPackages,
  loading: false,
  compactView: false,
  setCompactView: vi.fn(),
  groupedView: true,
  setGroupedView: vi.fn(),
  patientPackageFilterOptions: [
    { id: 'ALL', label: 'Todos', count: 1 },
    { id: 'CENSUS', label: 'Censo', count: 0 },
    { id: 'PATIENT', label: 'Paciente', count: 1 },
    { id: 'BED', label: 'Cama', count: 1 },
    { id: 'DISCHARGE', label: 'Altas', count: 0 },
    { id: 'TRANSFER', label: 'Traslados', count: 0 },
    { id: 'INTERNAL_MOVEMENT', label: 'Mov. internos', count: 0 },
    { id: 'CMA', label: 'CMA', count: 0 },
    { id: 'DOCUMENTS', label: 'Documentos', count: 0 },
    { id: 'DIAGNOSIS', label: 'Diagnóstico', count: 1 },
    { id: 'STATUS', label: 'Estado', count: 1 },
    { id: 'CONFLICT', label: 'Conflictos', count: 0 },
    { id: 'VIEW_ACTIVITY', label: 'Visualizaciones', count: 0 },
    { id: 'SYSTEM', label: 'Sistema', count: 0 },
    { id: 'MEDICATIONS', label: 'Indicaciones', count: 0 },
  ] satisfies ClinicalAuditPatientPackageFilterOption[],
  activePatientPackageFilter: 'ALL' as const,
  onPatientPackageFilterChange: vi.fn(),
  patientPackageIntentOptions: [
    { id: 'CLINICAL_OPERATIONS', label: 'Cambios clínicos/operacionales', count: 1 },
    { id: 'VIEW_ACTIVITY', label: 'Visualizaciones', count: 0 },
    { id: 'SYSTEM_SYNC', label: 'Sistema/sincronización', count: 0 },
  ] satisfies ClinicalAuditPatientPackageIntentOption[],
  activePatientPackageIntent: 'CLINICAL_OPERATIONS' as const,
  onPatientPackageIntentChange: vi.fn(),
  expandedRows: new Set<string>(),
  toggleRow: vi.fn(),
  onPdfExport: vi.fn(),
  onExcelExport: vi.fn(),
  isExporting: false,
  fetchLimit: 500,
  canLoadMoreLogs: false,
  onLoadMoreLogs: vi.fn(),
  currentPage: 1,
  totalPages: 1,
  onPageChange: vi.fn(),
  itemsPerPage: 50,
};

describe('AuditTable patient-centered packages', () => {
  it('renders compact patient packages when grouped view is enabled', () => {
    const toggleRow = vi.fn();
    render(<AuditTable {...baseProps} toggleRow={toggleRow} />);

    expect(screen.getByText(/paquetes por paciente/i)).toBeInTheDocument();
    expect(screen.getAllByText('Anastasio Hey Riroroko')).toHaveLength(1);
    expect(screen.getByText('Estable')).toBeInTheDocument();
    expect(screen.getByText('ICC')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /abrir detalle de auditoría de anastasio hey riroroko/i,
      })
    );

    expect(toggleRow).toHaveBeenCalledWith(patientPackages[0].id);
  });

  it('keeps the raw event table when grouped view is disabled', () => {
    render(<AuditTable {...baseProps} groupedView={false} />);

    expect(screen.getByText('Evento clínico')).toBeInTheDocument();
    expect(screen.getByText('Diagnóstico actualizado')).toBeInTheDocument();
  });

  it('offers a bounded load-more action when the current audit window may be incomplete', () => {
    const onLoadMoreLogs = vi.fn();
    render(<AuditTable {...baseProps} canLoadMoreLogs onLoadMoreLogs={onLoadMoreLogs} />);

    fireEvent.click(screen.getByRole('button', { name: /cargar m[aá]s registros de auditoría/i }));

    expect(onLoadMoreLogs).toHaveBeenCalledTimes(1);
  });

  it('explains empty patient-package filters and suggests expanding the audit window', () => {
    render(
      <AuditTable
        {...baseProps}
        patientPackages={[]}
        paginatedPatientPackages={[]}
        activePatientPackageFilter="DISCHARGE"
        canLoadMoreLogs
      />
    );

    expect(
      screen.getByText(/no hay paquetes por paciente para esta combinación/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/amplía la ventana de auditoría/i)).toBeInTheDocument();
  });

  it('shows the loaded audit window when no more logs can be requested', () => {
    render(<AuditTable {...baseProps} fetchLimit={750} canLoadMoreLogs={false} />);

    expect(screen.getByText(/ventana cargada: 750 registros/i)).toBeInTheDocument();
  });

  it('shows patient package quick filters with counts', () => {
    const onPatientPackageFilterChange = vi.fn();
    render(
      <AuditTable {...baseProps} onPatientPackageFilterChange={onPatientPackageFilterChange} />
    );

    expect(screen.getByRole('button', { name: /todos 1/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: /altas 0/i }));

    expect(onPatientPackageFilterChange).toHaveBeenCalledWith('DISCHARGE');
  });

  it('surfaces clinical sync state and mutation evidence with fewer clicks', () => {
    const blockedLog: AuditLogEntry = {
      ...statusLog,
      id: 'blocked-sync-1',
      action: 'CONFLICT_AUTO_MERGED',
      entityType: 'dailyRecord',
      entityId: '2026-07-01',
      details: {
        patientName: 'Paciente Bloqueado',
        rut: '33.333.333-3',
        bedId: 'H5C1',
        mutationId: 'mut-blocked-ui',
        clientId: 'pc-a',
        tabId: 'tab-a',
        resolution: 'blocked',
        changedPaths: ['beds.H5C1.pathology'],
        changes: { diagnosis: { old: 'EPOC', new: 'ICC' } },
      },
    };
    const syncPackages = buildClinicalAuditPatientPackages([blockedLog]);
    const toggleRow = vi.fn();

    render(
      <AuditTable
        {...baseProps}
        filteredLogs={[blockedLog]}
        paginatedLogs={[blockedLog]}
        patientPackages={syncPackages}
        paginatedPatientPackages={syncPackages}
        patientPackageFilterOptions={[
          { id: 'ALL', label: 'Todos', count: 1 },
          { id: 'SYNC_BLOCKED', label: 'Bloqueadas', count: 1 },
        ]}
        expandedRows={new Set([syncPackages[0].id])}
        toggleRow={toggleRow}
      />
    );

    expect(screen.getByText('Paciente Bloqueado')).toBeInTheDocument();
    expect(screen.getAllByText('Bloqueada').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /bloqueadas 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ver eventos incluidos/i }));

    expect(screen.getByText(/mut-blocked-ui · pc-a · tab-a/i)).toBeInTheDocument();
    expect(screen.getAllByText(/beds\.H5C1\.pathology/i).length).toBeGreaterThan(0);
  });

  it('renders intention tabs so view-only events do not contaminate clinical edits', () => {
    const onPatientPackageIntentChange = vi.fn();
    render(
      <AuditTable {...baseProps} onPatientPackageIntentChange={onPatientPackageIntentChange} />
    );

    expect(screen.getByRole('tab', { name: /cambios clínicos\/operacionales 1/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const activeTab = screen.getByRole('tab', {
      name: /cambios clínicos\/operacionales 1/i,
    });
    const viewTab = screen.getByRole('tab', { name: /visualizaciones 0/i });
    const panel = screen.getByRole('tabpanel');

    expect(activeTab).toHaveAttribute('tabindex', '0');
    expect(viewTab).toHaveAttribute('aria-selected', 'false');
    expect(viewTab).toHaveAttribute('tabindex', '-1');
    expect(activeTab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', activeTab.id);

    fireEvent.keyDown(activeTab, { key: 'ArrowRight' });

    expect(onPatientPackageIntentChange).toHaveBeenCalledWith('VIEW_ACTIVITY');
  });
});
