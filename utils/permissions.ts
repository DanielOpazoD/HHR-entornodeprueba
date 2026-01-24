/**
 * Role-Based Access Control (RBAC) System
 * 
 * This module defines all roles and permissions for the hospital system.
 * It is SECURITY-CRITICAL and must be protected by Firestore Security Rules.
 * 
 * @module permissions
 */

import { ModuleType } from '../components/layout/Navbar';

// ==========================================
// 1. DEFINICIÓN DE ROLES
// ==========================================

/**
 * Available user roles in the system
 * 
 * @constant
 * @readonly
 */
export const ROLES = {
    ADMIN: 'admin',
    NURSE_HOSPITAL: 'nurse_hospital',     // Enfermera de turno servicio de hospitalizados
    DOCTOR_URGENCY: 'doctor_urgency',     // Médico de turno en urgencias
    VIEWER_CENSUS: 'viewer_census',       // Otros (Solo visualización censo)
} as const;

export type UserRole = typeof ROLES[keyof typeof ROLES] | string;

// ==========================================
// 2. CONFIGURACIÓN DE PERMISOS
// ==========================================

// Módulos disponibles: 'CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'REPORTS', 'AUDIT'

interface RolePermissions {
    modules: ModuleType[];           // Pestañas visibles
    canEdit: ModuleType[];           // Módulos donde puede editar/guardar
}

const PERMISSIONS: Record<string, RolePermissions> = {
    [ROLES.ADMIN]: {
        modules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'AUDIT', 'WHATSAPP', 'ERRORS', 'TRANSFER_MANAGEMENT', 'BACKUP_FILES', 'ROLE_MANAGEMENT'],
        canEdit: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'AUDIT', 'WHATSAPP', 'ERRORS', 'TRANSFER_MANAGEMENT', 'BACKUP_FILES', 'ROLE_MANAGEMENT']
    },
    [ROLES.NURSE_HOSPITAL]: {
        // Editar: Censo, CUDYR, Entrega Enf, Gestión Traslados, Archivos. Ver: Entrega Médica.
        modules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'TRANSFER_MANAGEMENT', 'BACKUP_FILES'],
        canEdit: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'TRANSFER_MANAGEMENT', 'BACKUP_FILES']
    },
    [ROLES.DOCTOR_URGENCY]: {
        // Observador de Censo, Entrega Enf y Entrega Médica.
        modules: ['CENSUS', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'],
        canEdit: []
    },
    [ROLES.VIEWER_CENSUS]: {
        // Solo visualización censo diario.
        modules: ['CENSUS'],
        canEdit: []
    }
};

const DEFAULT_PERMISSIONS: RolePermissions = {
    modules: ['CENSUS'], // Por defecto, si el rol no existe, ve el censo (read-only)
    canEdit: []
};

// ==========================================
// 3. PERMISOS DE ACCIONES (GRANULARES)
// ==========================================

/**
 * Action-level permissions for granular access control.
 * These define specific actions that can be performed in the system.
 */
export const ACTIONS = {
    // Patient Management
    PATIENT_READ: 'patient:read',
    PATIENT_WRITE: 'patient:write',
    PATIENT_DISCHARGE: 'patient:discharge',
    PATIENT_TRANSFER: 'patient:transfer',

    // Daily Record Management
    RECORD_CREATE: 'record:create',
    RECORD_DELETE: 'record:delete',
    RECORD_COPY_PREVIOUS: 'record:copy_previous',

    // CUDYR Scoring
    CUDYR_EDIT: 'cudyr:edit',

    // Handoff
    HANDOFF_NURSING_EDIT: 'handoff:nursing:edit',
    HANDOFF_MEDICAL_SIGN: 'handoff:medical:sign',
    HANDOFF_SEND_WHATSAPP: 'handoff:send:whatsapp',

    // Export & Reports
    EXPORT_EXCEL: 'export:excel',
    EXPORT_PDF: 'export:pdf',

    // Admin
    AUDIT_READ: 'audit:read',
    BED_MANAGER_ACCESS: 'bed_manager:access',
    SETTINGS_ACCESS: 'settings:access',
    DEMO_DATA_GENERATE: 'demo:generate',
} as const;

export type ActionPermission = typeof ACTIONS[keyof typeof ACTIONS];

/**
 * Mapping of roles to their allowed actions.
 * SECURITY-CRITICAL: This defines what each role can do at a granular level.
 */
const ACTION_PERMISSIONS: Record<string, ActionPermission[]> = {
    [ROLES.ADMIN]: [
        // Admin can do everything
        ACTIONS.PATIENT_READ, ACTIONS.PATIENT_WRITE, ACTIONS.PATIENT_DISCHARGE, ACTIONS.PATIENT_TRANSFER,
        ACTIONS.RECORD_CREATE, ACTIONS.RECORD_DELETE, ACTIONS.RECORD_COPY_PREVIOUS,
        ACTIONS.CUDYR_EDIT,
        ACTIONS.HANDOFF_NURSING_EDIT, ACTIONS.HANDOFF_MEDICAL_SIGN, ACTIONS.HANDOFF_SEND_WHATSAPP,
        ACTIONS.EXPORT_EXCEL, ACTIONS.EXPORT_PDF,
        ACTIONS.AUDIT_READ, ACTIONS.BED_MANAGER_ACCESS, ACTIONS.SETTINGS_ACCESS, ACTIONS.DEMO_DATA_GENERATE
    ],
    [ROLES.NURSE_HOSPITAL]: [
        // Nurse can manage patients, create records, but NOT delete or access audit
        ACTIONS.PATIENT_READ, ACTIONS.PATIENT_WRITE, ACTIONS.PATIENT_DISCHARGE, ACTIONS.PATIENT_TRANSFER,
        ACTIONS.RECORD_CREATE, ACTIONS.RECORD_COPY_PREVIOUS,
        ACTIONS.CUDYR_EDIT,
        ACTIONS.HANDOFF_NURSING_EDIT, ACTIONS.HANDOFF_SEND_WHATSAPP,
        ACTIONS.EXPORT_EXCEL, ACTIONS.EXPORT_PDF
    ],
    [ROLES.DOCTOR_URGENCY]: [
        // Doctor can only view and sign medical handoff
        ACTIONS.PATIENT_READ,
        ACTIONS.HANDOFF_MEDICAL_SIGN,
        ACTIONS.EXPORT_PDF
    ],
    [ROLES.VIEWER_CENSUS]: [
        // Viewer can only read
        ACTIONS.PATIENT_READ
    ]
};

const DEFAULT_ACTIONS: ActionPermission[] = [ACTIONS.PATIENT_READ];

// ==========================================
// 3. UTILIDADES
// ==========================================

/**
 * Obtiene los permisos para un rol dado.
 */
const getPermissions = (role?: string): RolePermissions => {
    if (!role) return DEFAULT_PERMISSIONS;
    return PERMISSIONS[role] || DEFAULT_PERMISSIONS;
};

/**
 * Get action permissions for a given role.
 * @param role - User's role
 * @returns Array of allowed action permissions
 */
const getActionPermissions = (role?: string): ActionPermission[] => {
    if (!role) return DEFAULT_ACTIONS;
    return ACTION_PERMISSIONS[role] || DEFAULT_ACTIONS;
};

/**
 * Check if a user can perform a specific action.
 * 
 * SECURITY-CRITICAL: This is the primary function for checking granular permissions.
 * Use this for fine-grained access control on specific operations.
 * 
 * @param role - User's role
 * @param action - The action to check (from ACTIONS enum)
 * @returns True if the user can perform the action
 * 
 * @example
 * ```typescript
 * import { canDoAction, ACTIONS } from '../utils/permissions';
 * 
 * // In a component or hook:
 * if (canDoAction(userRole, ACTIONS.RECORD_DELETE)) {
 *     showDeleteButton();
 * }
 * 
 * // Protect a function:
 * function deleteRecord(role: string) {
 *     if (!canDoAction(role, ACTIONS.RECORD_DELETE)) {
 *         throw new Error('Permission denied');
 *     }
 *     // ... proceed with deletion
 * }
 * ```
 */
export function canDoAction(role: UserRole | undefined, action: ActionPermission): boolean {
    const permissions = getActionPermissions(role);
    return permissions.includes(action);
}

/**
 * Get all action permissions for a role (for debugging/display).
 * @param role - User's role
 * @returns Array of all allowed action strings
 */
export function getAllowedActions(role: UserRole | undefined): ActionPermission[] {
    return getActionPermissions(role);
}

/**
 * Get visible modules for a given role
 * 
 * Returns array of module names that should be visible in the navigation
 * for the specified role.
 * 
 * @param {UserRole | undefined} role - User's role
 * @returns {ModuleType[]} Array of visible module names
 * 
 * @example
 * ```typescript
 * const modules = getVisibleModules('nurse_hospital');
 * // Returns: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', ...]
 * ```
 */
export function getVisibleModules(role: UserRole | undefined): ModuleType[] {
    return getPermissions(role).modules;
};

/**
 * Check if user can edit a specific module
 * 
 * SECURITY-CRITICAL: This function determines write access.
 * Must align with Firestore Security Rules.
 * 
 * @param {UserRole | undefined} role - User's role
 * @param {ModuleType} module - Module to check
 * @returns {boolean} True if user can edit, false otherwise
 * 
 * @example
 * ```typescript
 * if (canEditModule(userRole, 'CENSUS')) {
 *   // Allow editing
 * }
 * ```
 */
export function canEditModule(role: UserRole | undefined, module: ModuleType): boolean {
    const perms = getPermissions(role);
    return perms.canEdit.includes(module);
};

/**
 * Check if user is an administrator
 * 
 * @param {UserRole | undefined} role - User's role
 * @returns {boolean} True if user is admin, false otherwise
 */
export function isAdmin(role: UserRole | undefined): boolean {
    return role === ROLES.ADMIN;
};

/**
 * Check if user can view a specific module
 * 
 * @param {UserRole | undefined} role - User's role
 * @param {ModuleType} module - Module to check
 * @returns {boolean} True if user can view, false otherwise
 */
export function canViewModule(role: UserRole | undefined, module: ModuleType): boolean {
    return getVisibleModules(role).includes(module);
};

/**
 * Human-friendly display name for a given role.
 */
export function getRoleDisplayName(role?: UserRole): string {
    switch (role) {
        case ROLES.ADMIN:
            return 'Administrador';
        case ROLES.NURSE_HOSPITAL:
            return 'Enfermería Hospitalizados';
        case ROLES.DOCTOR_URGENCY:
            return 'Médico de Urgencia';
        case ROLES.VIEWER_CENSUS:
            return 'Visualizador de Censo';
        default:
            return 'Invitado';
    }
}
