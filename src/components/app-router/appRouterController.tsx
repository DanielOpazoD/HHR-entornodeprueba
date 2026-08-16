import React from 'react';
import type { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/context';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import {
  AnalyticsView,
  AuditView,
  BackupFilesView,
  CensusView,
  CommunicationsView,
  ConfigurationView,
  CudyrView,
  DataMaintenanceView,
  DataView,
  FunctionsTelemetryView,
  HandoffView,
  MedicalSignatureView,
  PatientMasterView,
  ReminderAdminView,
  RoleManagementView,
  SystemDiagnosticsView,
  WhatsAppIntegrationView,
} from '@/views/LazyViews';
import {
  canAccessAppModuleRoute,
  canForceCreateDayCopyOverride,
  canEditAppModule,
  getVisibleAppModules,
} from '@/shared/access/operationalAccessPolicy';
import { resolveSpecialistCensusAccessProfile } from '@/shared/access/specialistAccessPolicy';
import { isE2EEditableRecordOverrideEnabled } from '@/shared/runtime/e2eRuntime';

export interface AppRouterResolvedContext {
  censusAccessProfile: ReturnType<typeof resolveSpecialistCensusAccessProfile>;
  visibleModules: ModuleType[];
  e2eEditableOverride: boolean;
}

export interface AppRouterShellState {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  role: UserRole;
  isSignatureMode: boolean;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  onOpenCensusDate?: (date: string) => void;
}

export interface SimpleModuleRouteDefinition {
  module: ModuleType;
  sectionName: string;
  requiresAccessCheck?: boolean;
  render: () => React.ReactNode;
}

export interface CoreModuleRouteRenderParams {
  ui: UseUIStateReturn;
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  onOpenCensusDate?: (date: string) => void;
  resolveReadOnly: (module: ModuleType) => boolean;
  allowAdminCopyOverride: boolean;
  censusAccessProfile: AppRouterResolvedContext['censusAccessProfile'];
  canOpenMedicalHandoff: boolean;
}

export interface CoreModuleRouteDefinition {
  module: ModuleType;
  sectionName: string;
  render: (params: CoreModuleRouteRenderParams) => React.ReactNode;
}

export const SIMPLE_MODULE_ROUTE_DEFINITIONS: readonly SimpleModuleRouteDefinition[] = [
  {
    module: 'AUDIT',
    sectionName: 'Auditoría',
    requiresAccessCheck: true,
    render: () => <AuditView />,
  },
  {
    module: 'FUNCTIONS_TELEMETRY',
    sectionName: 'Telemetría de Servicios',
    requiresAccessCheck: true,
    render: () => <FunctionsTelemetryView />,
  },
  {
    module: 'CONFIGURATION',
    sectionName: 'Configuración',
    requiresAccessCheck: true,
    render: () => <ConfigurationView />,
  },
  {
    module: 'DATA',
    sectionName: 'Datos',
    requiresAccessCheck: true,
    render: () => <DataView />,
  },
  {
    module: 'COMMUNICATIONS',
    sectionName: 'Comunicación',
    requiresAccessCheck: true,
    render: () => <CommunicationsView />,
  },
  {
    module: 'WHATSAPP',
    sectionName: 'Integración WhatsApp',
    render: () => <WhatsAppIntegrationView />,
  },
  {
    module: 'DIAGNOSTICS',
    sectionName: 'Diagnóstico del Sistema',
    requiresAccessCheck: true,
    render: () => <SystemDiagnosticsView />,
  },
  {
    module: 'BACKUP_FILES',
    sectionName: 'Respaldos',
    requiresAccessCheck: true,
    render: () => <BackupFilesView backupType="handoff" />,
  },
  {
    module: 'PATIENT_MASTER_INDEX',
    sectionName: 'Base de Pacientes',
    requiresAccessCheck: true,
    render: () => <PatientMasterView />,
  },
  {
    module: 'DATA_MAINTENANCE',
    sectionName: 'Mantenimiento de Datos',
    requiresAccessCheck: true,
    render: () => <DataMaintenanceView />,
  },
  {
    module: 'ROLE_MANAGEMENT',
    sectionName: 'Gestión de Roles',
    requiresAccessCheck: true,
    render: () => <RoleManagementView />,
  },
  {
    module: 'REMINDERS',
    sectionName: 'Avisos al Personal',
    requiresAccessCheck: true,
    render: () => <ReminderAdminView />,
  },
];

export const SIGNATURE_ROUTE_DEFINITION: CoreModuleRouteDefinition = {
  module: 'MEDICAL_HANDOFF',
  sectionName: 'Firma Médica',
  render: () => <MedicalSignatureView />,
};

export const CORE_MODULE_ROUTE_DEFINITIONS: readonly CoreModuleRouteDefinition[] = [
  {
    module: 'CENSUS',
    sectionName: 'Censo',
    render: ({
      selectedDay,
      selectedMonth,
      currentDateString,
      showBedManagerModal,
      onCloseBedManagerModal,
      onOpenCensusDate,
      resolveReadOnly,
      allowAdminCopyOverride,
      censusAccessProfile,
      canOpenMedicalHandoff,
    }) => (
      <CensusView
        selectedDay={selectedDay}
        selectedMonth={selectedMonth}
        currentDateString={currentDateString}
        showBedManagerModal={showBedManagerModal}
        onCloseBedManagerModal={onCloseBedManagerModal}
        onOpenCensusDate={onOpenCensusDate}
        canOpenMedicalHandoffSpreadsheet={canOpenMedicalHandoff}
        readOnly={resolveReadOnly('CENSUS')}
        allowAdminCopyOverride={allowAdminCopyOverride}
        accessProfile={censusAccessProfile}
      />
    ),
  },
  {
    module: 'ANALYTICS',
    sectionName: 'Estadísticas MINSAL/DEIS',
    render: ({ onOpenCensusDate }) => <AnalyticsView onOpenCensusDate={onOpenCensusDate} />,
  },
  {
    module: 'CUDYR',
    sectionName: 'CUDYR',
    render: ({ resolveReadOnly }) => <CudyrView readOnly={resolveReadOnly('CUDYR')} />,
  },
  {
    module: 'NURSING_HANDOFF',
    sectionName: 'Entrega Enfermería',
    render: ({ ui, resolveReadOnly }) => (
      <HandoffView ui={ui} type="nursing" readOnly={resolveReadOnly('NURSING_HANDOFF')} />
    ),
  },
  {
    module: 'MEDICAL_HANDOFF',
    sectionName: 'Entrega Médica',
    render: ({ ui, resolveReadOnly }) => (
      <HandoffView ui={ui} type="medical" readOnly={resolveReadOnly('MEDICAL_HANDOFF')} />
    ),
  },
];

export const resolveAppRouterContext = (role: UserRole): AppRouterResolvedContext => ({
  censusAccessProfile: resolveSpecialistCensusAccessProfile(role),
  visibleModules: getVisibleAppModules(role),
  e2eEditableOverride: isE2EEditableRecordOverrideEnabled(),
});

export const resolveModuleReadOnly = ({
  role,
  module,
  e2eEditableOverride,
}: {
  role: UserRole;
  module: ModuleType;
  e2eEditableOverride: boolean;
}): boolean => !canEditAppModule(role, module) && !e2eEditableOverride;

export const resolveAllowAdminCopyOverride = (role: UserRole): boolean =>
  canForceCreateDayCopyOverride(role);

export const canRenderSimpleModuleRoute = ({
  currentModule,
  route,
  role,
  visibleModules,
}: {
  currentModule: ModuleType;
  route: SimpleModuleRouteDefinition;
  role: UserRole;
  visibleModules: readonly ModuleType[];
}): boolean => {
  if (currentModule !== route.module) {
    return false;
  }

  if (!route.requiresAccessCheck) {
    return true;
  }

  return canAccessAppModuleRoute({
    role,
    module: route.module,
    visibleModules,
  });
};

export const resolveCoreModuleRoute = (
  currentModule: ModuleType
): CoreModuleRouteDefinition | null =>
  CORE_MODULE_ROUTE_DEFINITIONS.find(route => route.module === currentModule) ?? null;

export const resolveSimpleModuleRoute = (
  currentModule: ModuleType
): SimpleModuleRouteDefinition | null =>
  SIMPLE_MODULE_ROUTE_DEFINITIONS.find(route => route.module === currentModule) ?? null;
