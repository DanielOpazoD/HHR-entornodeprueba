import { LayoutList, MessageSquare, Stethoscope, Truck, FolderArchive, BarChart3, Settings, ShieldCheck, Activity, Database, LucideIcon } from 'lucide-react';

export type ModuleType = 'CENSUS' | 'CUDYR' | 'NURSING_HANDOFF' | 'MEDICAL_HANDOFF' | 'AUDIT' | 'WHATSAPP' | 'TRANSFER_MANAGEMENT' | 'BACKUP_FILES' | 'PATIENT_MASTER_INDEX' | 'DATA_MAINTENANCE' | 'DIAGNOSTICS' | 'ROLE_MANAGEMENT' | 'ERRORS';

export type NavActionType = 'MODULE_CHANGE' | 'SETTINGS' | 'ANALYTICS_TOGGLE';

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
        requiredModule: 'CENSUS'
    },

    {
        id: 'nursing-handoff',
        label: 'Entrega Turno Enfermería',
        icon: MessageSquare,
        module: 'NURSING_HANDOFF',
        actionType: 'MODULE_CHANGE',
        requiredModule: 'NURSING_HANDOFF'
    },
    {
        id: 'medical-handoff',
        label: 'Entrega Turno Médicos',
        icon: Stethoscope,
        module: 'MEDICAL_HANDOFF',
        actionType: 'MODULE_CHANGE',
        requiredModule: 'MEDICAL_HANDOFF'
    },
    {
        id: 'transfer-management',
        label: 'Gestión Traslados',
        icon: Truck,
        module: 'TRANSFER_MANAGEMENT',
        actionType: 'MODULE_CHANGE',
        requiredModule: 'TRANSFER_MANAGEMENT'
    },

    // --- Utility Dropdown Items (NavbarTabs Dropdown) ---
    {
        id: 'analytics',
        label: 'Estadística',
        icon: BarChart3,
        module: 'CENSUS',
        actionType: 'ANALYTICS_TOGGLE',
        censusMode: 'ANALYTICS',
        isUtility: true,
        adminOnly: true,
        excludeFromRoles: ['viewer_census']
    },
    {
        id: 'backup-files',
        label: 'Archivos',
        icon: FolderArchive,
        module: 'BACKUP_FILES',
        actionType: 'MODULE_CHANGE',
        isUtility: true,
        adminOnly: true,
        requiredModule: 'BACKUP_FILES'
    },

    // --- System / Brand Menu Items (NavbarMenu) ---
    {
        id: 'data-maintenance',
        label: 'Mantenimiento de Datos',
        icon: Database,
        module: 'DATA_MAINTENANCE',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'settings',
        label: 'Configuración',
        icon: Settings,
        actionType: 'SETTINGS',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'audit',
        label: 'Auditoría',
        icon: ShieldCheck,
        module: 'AUDIT',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'whatsapp',
        label: 'WhatsApp',
        icon: MessageSquare,
        module: 'WHATSAPP',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'diagnostics',
        label: 'Diagnóstico del Sistema',
        icon: Activity,
        module: 'DIAGNOSTICS',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'patient-master',
        label: 'Base de Pacientes',
        icon: Database,
        module: 'PATIENT_MASTER_INDEX',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'role-management',
        label: 'Gestión de Roles',
        icon: ShieldCheck,
        module: 'ROLE_MANAGEMENT',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    },
    {
        id: 'errors',
        label: 'Panel de Errores',
        icon: Activity,
        module: 'ERRORS',
        actionType: 'MODULE_CHANGE',
        isSystem: true,
        adminOnly: true
    }
];
