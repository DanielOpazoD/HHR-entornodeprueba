import {
  LayoutList,
  MessageSquare,
  FolderArchive,
  BarChart3,
  Settings,
  Activity,
  Database,
  LucideIcon,
} from 'lucide-react';

export type ModuleType =
  | 'CENSUS'
  | 'ANALYTICS'
  | 'CUDYR'
  | 'NURSING_HANDOFF'
  | 'MEDICAL_HANDOFF'
  | 'AUDIT'
  | 'WHATSAPP'
  | 'BACKUP_FILES'
  | 'PATIENT_MASTER_INDEX'
  | 'DATA_MAINTENANCE'
  | 'DIAGNOSTICS'
  | 'FUNCTIONS_TELEMETRY'
  | 'CONFIGURATION'
  | 'DATA'
  | 'COMMUNICATIONS'
  | 'ROLE_MANAGEMENT'
  | 'REMINDERS';

export type NavActionType = 'MODULE_CHANGE';

export interface NavItemConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleType;
  actionType: NavActionType;
  isUtility?: boolean;
  isSystem?: boolean;
  requiredModule?: ModuleType; // Checked against visibleModules from permissions.ts
  adminOnly?: boolean;
  excludeFromRoles?: string[];
  censusMode?: 'REGISTER' | 'ANALYTICS';
}

export const NAVIGATION_CONFIG: NavItemConfig[] = [
  // --- Main Clinical Tabs (NavbarTabs) ---
  {
    id: 'census',
    label: 'Censo Diario',
    icon: LayoutList,
    module: 'CENSUS',
    actionType: 'MODULE_CHANGE',
    censusMode: 'REGISTER',
    requiredModule: 'CENSUS',
  },

  {
    id: 'nursing-handoff',
    label: 'Entrega Turno Enfermería',
    icon: MessageSquare,
    module: 'NURSING_HANDOFF',
    actionType: 'MODULE_CHANGE',
    requiredModule: 'NURSING_HANDOFF',
  },
  // --- Utility Dropdown Items (NavbarTabs Dropdown) ---
  {
    id: 'analytics',
    label: 'Estadísticas',
    icon: BarChart3,
    module: 'ANALYTICS',
    actionType: 'MODULE_CHANGE',
    isUtility: true,
    adminOnly: true,
    requiredModule: 'ANALYTICS',
  },
  {
    id: 'backup-files',
    label: 'Archivos',
    icon: FolderArchive,
    module: 'BACKUP_FILES',
    actionType: 'MODULE_CHANGE',
    isUtility: true,
    adminOnly: true,
    requiredModule: 'BACKUP_FILES',
  },

  // --- System / Brand Menu Items (NavbarMenu) ---
  {
    id: 'data',
    label: 'Datos',
    icon: Database,
    module: 'DATA',
    actionType: 'MODULE_CHANGE',
    isSystem: true,
    adminOnly: true,
  },
  {
    id: 'configuration',
    label: 'Configuración',
    icon: Settings,
    module: 'CONFIGURATION',
    actionType: 'MODULE_CHANGE',
    isSystem: true,
    adminOnly: true,
  },
  {
    id: 'diagnostics',
    label: 'Observabilidad',
    icon: Activity,
    module: 'DIAGNOSTICS',
    actionType: 'MODULE_CHANGE',
    isSystem: true,
    adminOnly: true,
  },
  {
    id: 'communications',
    label: 'Comunicación',
    icon: MessageSquare,
    module: 'COMMUNICATIONS',
    actionType: 'MODULE_CHANGE',
    isSystem: true,
    adminOnly: true,
  },
];
