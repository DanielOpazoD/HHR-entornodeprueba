import React, { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppRouter } from '@/components/AppRouter';

const mockCanAccessAppModuleRoute = vi.fn();
const mockCanForceCreateDayCopyOverride = vi.fn();
const mockGetVisibleAppModules = vi.fn();
const mockResolveSpecialistCensusAccessProfile = vi.fn();
const mockIsE2EEditableRecordOverrideEnabled = vi.fn();
const mockCanEditAppModule = vi.fn();
const lazyRouteState = vi.hoisted(() => ({
  suspendedViews: new Set<string>(),
  pendingViewChunk: new Promise<void>(() => {
    // Intentionally unresolved: lets tests assert the Suspense fallback state.
  }),
}));

vi.mock('@/components/shared/GlobalErrorBoundary', () => ({
  GlobalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/shared/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({
    children,
    sectionName,
  }: {
    children: React.ReactNode;
    sectionName: string;
  }) => <section data-testid={`section-${sectionName}`}>{children}</section>,
}));

vi.mock('@/components/ui/ViewLoader', () => ({
  ViewLoader: () => <div data-testid="view-loader">Loading</div>,
}));

vi.mock('@/views/LazyViews', () => ({
  AnalyticsView: ({ onOpenCensusDate }: { onOpenCensusDate?: (date: string) => void }) => (
    <div data-testid="analytics-view" data-has-open-date={Boolean(onOpenCensusDate)} />
  ),
  CensusView: (props: Record<string, unknown>) => (
    <div data-testid="census-view" data-props={JSON.stringify(props)} />
  ),
  CudyrView: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="cudyr-view" data-read-only={String(readOnly)} />
  ),
  HandoffView: ({ type, readOnly }: { type: string; readOnly: boolean }) => {
    if (lazyRouteState.suspendedViews.has(`handoff-${type}`)) {
      throw lazyRouteState.pendingViewChunk;
    }

    return <div data-testid={`handoff-${type}`} data-read-only={String(readOnly)} />;
  },
  AuditView: () => <div data-testid="audit-view" />,
  CommunicationsView: () => <div data-testid="communications-view" />,
  ConfigurationView: () => <div data-testid="configuration-view" />,
  DataView: () => <div data-testid="data-view" />,
  FunctionsTelemetryView: () => <div data-testid="functions-telemetry-view" />,
  MedicalSignatureView: () => <div data-testid="medical-signature-view" />,
  WhatsAppIntegrationView: () => <div data-testid="whatsapp-view" />,
  SystemDiagnosticsView: () => <div data-testid="system-diagnostics-view" />,
  TransferManagementView: () => {
    if (lazyRouteState.suspendedViews.has('transfer-management')) {
      throw lazyRouteState.pendingViewChunk;
    }

    return <div data-testid="transfer-management-view" />;
  },
  BackupFilesView: ({ backupType }: { backupType: string }) => (
    <div data-testid="backup-files-view" data-backup-type={backupType} />
  ),
  PatientMasterView: () => <div data-testid="patient-master-view" />,
  DataMaintenanceView: () => <div data-testid="data-maintenance-view" />,
  RoleManagementView: () => <div data-testid="role-management-view" />,
  ReminderAdminView: () => <div data-testid="reminder-admin-view" />,
}));

vi.mock('@/shared/access/operationalAccessPolicy', () => ({
  canAccessAppModuleRoute: (...args: unknown[]) => mockCanAccessAppModuleRoute(...args),
  canEditAppModule: (...args: unknown[]) => mockCanEditAppModule(...args),
  canForceCreateDayCopyOverride: (...args: unknown[]) => mockCanForceCreateDayCopyOverride(...args),
  getVisibleAppModules: (...args: unknown[]) => mockGetVisibleAppModules(...args),
}));

vi.mock('@/shared/access/specialistAccessPolicy', () => ({
  resolveSpecialistCensusAccessProfile: (...args: unknown[]) =>
    mockResolveSpecialistCensusAccessProfile(...args),
}));

vi.mock('@/shared/runtime/e2eRuntime', () => ({
  isE2EEditableRecordOverrideEnabled: (...args: unknown[]) =>
    mockIsE2EEditableRecordOverrideEnabled(...args),
}));

type AppRouterProps = ComponentProps<typeof AppRouter>;

const createProps = (overrides: Partial<AppRouterProps> = {}): AppRouterProps => ({
  ui: {
    currentModule: 'CENSUS',
  } as AppRouterProps['ui'],
  shell: {
    selectedDay: 22,
    selectedMonth: 3,
    currentDateString: '2026-04-22',
    role: 'admin',
    isSignatureMode: false,
    showBedManagerModal: false,
    onCloseBedManagerModal: vi.fn(),
    onOpenCensusDate: vi.fn(),
  },
  ...overrides,
});

describe('AppRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lazyRouteState.suspendedViews.clear();
    mockResolveSpecialistCensusAccessProfile.mockReturnValue('default');
    mockGetVisibleAppModules.mockReturnValue([
      'CENSUS',
      'ANALYTICS',
      'NURSING_HANDOFF',
      'DIAGNOSTICS',
      'TRANSFER_MANAGEMENT',
    ]);
    mockCanAccessAppModuleRoute.mockReturnValue(true);
    mockCanForceCreateDayCopyOverride.mockReturnValue(true);
    mockIsE2EEditableRecordOverrideEnabled.mockReturnValue(false);
    mockCanEditAppModule.mockReturnValue(true);
  });

  it('renders census with the expected access props', () => {
    render(<AppRouter {...createProps()} />);

    const censusView = screen.getByTestId('census-view');
    const props = JSON.parse(censusView.getAttribute('data-props') ?? '{}');

    expect(screen.getByTestId('section-Censo')).toBeInTheDocument();
    expect(props).toEqual(
      expect.objectContaining({
        selectedDay: 22,
        selectedMonth: 3,
        currentDateString: '2026-04-22',
        readOnly: false,
        allowAdminCopyOverride: true,
        accessProfile: 'default',
      })
    );
  });

  it('renders nursing handoff with readOnly derived from module edit access', () => {
    mockCanEditAppModule.mockImplementation(
      (_role: string, module: string) => module !== 'NURSING_HANDOFF'
    );

    render(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'NURSING_HANDOFF' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.getByTestId('section-Entrega Enfermería')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-nursing')).toHaveAttribute('data-read-only', 'true');
  });

  it('renders a simple protected module when access is allowed', () => {
    render(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'DIAGNOSTICS' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.getByTestId('section-Diagnóstico del Sistema')).toBeInTheDocument();
    expect(screen.getByTestId('system-diagnostics-view')).toBeInTheDocument();
  });

  it('hides a protected simple module when access is denied', () => {
    mockCanAccessAppModuleRoute.mockReturnValue(false);

    render(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'DIAGNOSTICS' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.queryByTestId('system-diagnostics-view')).not.toBeInTheDocument();
  });

  it('renders transfer management without requiring the protected-route gate', () => {
    mockCanAccessAppModuleRoute.mockReturnValue(false);

    render(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'TRANSFER_MANAGEMENT' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.getByTestId('section-Traslados')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-management-view')).toBeInTheDocument();
  });

  it('shows only the internal content loader while handoff chunks are loading', () => {
    lazyRouteState.suspendedViews.add('handoff-nursing');
    lazyRouteState.suspendedViews.add('handoff-medical');

    const { rerender } = render(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'NURSING_HANDOFF' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.getByTestId('view-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-nursing')).not.toBeInTheDocument();

    rerender(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'MEDICAL_HANDOFF' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.getByTestId('view-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-medical')).not.toBeInTheDocument();
  });

  it('shows only the internal content loader while transfer management chunks are loading', () => {
    lazyRouteState.suspendedViews.add('transfer-management');

    render(
      <AppRouter
        {...createProps({
          ui: { currentModule: 'TRANSFER_MANAGEMENT' } as AppRouterProps['ui'],
        })}
      />
    );

    expect(screen.getByTestId('view-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('transfer-management-view')).not.toBeInTheDocument();
  });

  it('renders the signature route ahead of module-specific content', () => {
    render(
      <AppRouter
        {...createProps({
          shell: {
            ...createProps().shell,
            isSignatureMode: true,
          },
        })}
      />
    );

    expect(screen.getByTestId('section-Firma Médica')).toBeInTheDocument();
    expect(screen.getByTestId('medical-signature-view')).toBeInTheDocument();
    expect(screen.queryByTestId('census-view')).not.toBeInTheDocument();
  });
});
