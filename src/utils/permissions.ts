/**
 * Role-Based Access Control (RBAC) System
 *
 * This module defines all roles and permissions for the hospital system.
 * It is SECURITY-CRITICAL and must be protected by Firestore Security Rules.
 *
 * @module permissions
 */

import { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/types/authRoleTypes';
import { resolveRoleAccess } from '@/shared/access/roleAccessMatrix';

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
  NURSE_HOSPITAL: 'nurse_hospital', // Enfermera de turno servicio de hospitalizados
  DOCTOR_URGENCY: 'doctor_urgency', // Médico de turno en urgencias
  DOCTOR_SPECIALIST: 'doctor_specialist', // Especialista con acceso limitado a censo y entrega médica
  VIEWER: 'viewer', // Invitado interno (solo lectura)
} as const;

// ==========================================
// 2. CONFIGURACIÓN DE PERMISOS
// ==========================================

// Módulos disponibles: 'CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'REPORTS', 'AUDIT'

interface RolePermissions {
  modules: ModuleType[]; // Pestañas visibles
  canEdit: ModuleType[]; // Módulos donde puede editar/guardar
}

const PERMISSIONS: Record<UserRole, RolePermissions> = {
  [ROLES.ADMIN]: {
    modules: resolveRoleAccess(ROLES.ADMIN).modules,
    canEdit: resolveRoleAccess(ROLES.ADMIN).canEdit,
  },
  [ROLES.NURSE_HOSPITAL]: {
    modules: resolveRoleAccess(ROLES.NURSE_HOSPITAL).modules,
    canEdit: resolveRoleAccess(ROLES.NURSE_HOSPITAL).canEdit,
  },
  editor: {
    modules: resolveRoleAccess('editor').modules,
    canEdit: resolveRoleAccess('editor').canEdit,
  },
  [ROLES.DOCTOR_URGENCY]: {
    modules: resolveRoleAccess(ROLES.DOCTOR_URGENCY).modules,
    canEdit: resolveRoleAccess(ROLES.DOCTOR_URGENCY).canEdit,
  },
  [ROLES.DOCTOR_SPECIALIST]: {
    modules: resolveRoleAccess(ROLES.DOCTOR_SPECIALIST).modules,
    canEdit: resolveRoleAccess(ROLES.DOCTOR_SPECIALIST).canEdit,
  },
  [ROLES.VIEWER]: {
    modules: resolveRoleAccess(ROLES.VIEWER).modules,
    canEdit: resolveRoleAccess(ROLES.VIEWER).canEdit,
  },
};

const DEFAULT_PERMISSIONS: RolePermissions = {
  modules: ['CENSUS'], // Por defecto, si el rol no existe, ve el censo (read-only)
  canEdit: [],
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

export type ActionPermission = (typeof ACTIONS)[keyof typeof ACTIONS];

/**
 * Mapping of roles to their allowed actions.
 * SECURITY-CRITICAL: This defines what each role can do at a granular level.
 */
const ACTION_PERMISSIONS: Partial<Record<UserRole, ActionPermission[]>> = {
  [ROLES.ADMIN]: [
    // Admin can do everything
    ACTIONS.PATIENT_READ,
    ACTIONS.PATIENT_WRITE,
    ACTIONS.PATIENT_DISCHARGE,
    ACTIONS.PATIENT_TRANSFER,
    ACTIONS.RECORD_CREATE,
    ACTIONS.RECORD_DELETE,
    ACTIONS.RECORD_COPY_PREVIOUS,
    ACTIONS.CUDYR_EDIT,
    ACTIONS.HANDOFF_NURSING_EDIT,
    ACTIONS.HANDOFF_MEDICAL_SIGN,
    ACTIONS.HANDOFF_SEND_WHATSAPP,
    ACTIONS.EXPORT_EXCEL,
    ACTIONS.EXPORT_PDF,
    ACTIONS.AUDIT_READ,
    ACTIONS.BED_MANAGER_ACCESS,
    ACTIONS.SETTINGS_ACCESS,
    ACTIONS.DEMO_DATA_GENERATE,
  ],
  [ROLES.NURSE_HOSPITAL]: [
    // Nurse can manage patients, create and delete records, but NOT access audit
    ACTIONS.PATIENT_READ,
    ACTIONS.PATIENT_WRITE,
    ACTIONS.PATIENT_DISCHARGE,
    ACTIONS.PATIENT_TRANSFER,
    ACTIONS.RECORD_CREATE,
    ACTIONS.RECORD_DELETE,
    ACTIONS.RECORD_COPY_PREVIOUS,
    ACTIONS.CUDYR_EDIT,
    ACTIONS.HANDOFF_NURSING_EDIT,
    ACTIONS.HANDOFF_SEND_WHATSAPP,
    ACTIONS.EXPORT_EXCEL,
    ACTIONS.EXPORT_PDF,
  ],
  [ROLES.DOCTOR_URGENCY]: [
    // Doctor can only view and sign medical handoff
    ACTIONS.PATIENT_READ,
    ACTIONS.HANDOFF_MEDICAL_SIGN,
    ACTIONS.EXPORT_PDF,
  ],
  [ROLES.DOCTOR_SPECIALIST]: [ACTIONS.PATIENT_READ],
  [ROLES.VIEWER]: [
    // Viewer can only read
    ACTIONS.PATIENT_READ,
  ],
};

const DEFAULT_ACTIONS: ActionPermission[] = [ACTIONS.PATIENT_READ];

// ==========================================
// 3. UTILIDADES
// ==========================================

/**
 * Obtiene los permisos para un rol dado.
 */
const getPermissions = (role?: UserRole): RolePermissions => {
  if (!role) return DEFAULT_PERMISSIONS;
  return PERMISSIONS[role] || DEFAULT_PERMISSIONS;
};

/**
 * Get action permissions for a given role.
 * @param role - User's role
 * @returns Array of allowed action permissions
 */
const getActionPermissions = (role?: UserRole): ActionPermission[] => {
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
 * import { canDoAction, ACTIONS } from '@/utils/permissions';
 *
 * // In a component or hook:
 * if (canDoAction(userRole, ACTIONS.RECORD_DELETE)) {
 *     showDeleteButton();
 * }
 *
 * // Protect a function:
 * function deleteRecord(role: UserRole) {
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
}

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
}

/**
 * Check if user is an administrator
 *
 * @param {UserRole | undefined} role - User's role
 * @returns {boolean} True if user is admin, false otherwise
 */
export function isAdmin(role: UserRole | undefined): boolean {
  return role === ROLES.ADMIN;
}

/**
 * Check if user can view a specific module
 *
 * @param {UserRole | undefined} role - User's role
 * @param {ModuleType} module - Module to check
 * @returns {boolean} True if user can view, false otherwise
 */
export function canViewModule(role: UserRole | undefined, module: ModuleType): boolean {
  return getVisibleModules(role).includes(module);
}

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
    case ROLES.DOCTOR_SPECIALIST:
      return 'Especialista';
    case ROLES.VIEWER:
      return 'Visualizador de Censo';
    default:
      return resolveRoleAccess(role).specialistRestrictedMedicalAccess
        ? 'Especialista'
        : 'Invitado';
  }
}
