import type { UserRole } from '@/types/authRoleTypes';
import { GENERAL_LOGIN_ROLES, resolveRoleAccess } from './roleAccessMatrix';

const toRoleSet = (roles: readonly UserRole[]): ReadonlySet<string> => new Set(roles);

/** Authenticated roles allowed general login to HHR (proxies, CIE-10, MMRAD). */
export const SERVERLESS_ALL_LOGIN_ROLES: ReadonlySet<string> = toRoleSet(GENERAL_LOGIN_ROLES);

/** Roles authorized to read clinical documents (AI import and attachment naming). */
export const SERVERLESS_CLINICAL_DOCUMENT_ROLES: ReadonlySet<string> = toRoleSet(
  GENERAL_LOGIN_ROLES.filter(role => resolveRoleAccess(role).canReadClinicalDocuments)
);

/** Hospital nursing and administration roles (census email and fuga notifications). */
export const SERVERLESS_ADMIN_AND_NURSE_ROLES: ReadonlySet<string> = toRoleSet([
  'admin',
  'nurse_hospital',
]);

/** Administrator-only serverless operations (AI provider status/test, fuga test mode). */
export const SERVERLESS_ADMIN_ONLY_ROLES: ReadonlySet<string> = toRoleSet(['admin']);

export const isServerlessAdminRole = (role: string | undefined): boolean =>
  typeof role === 'string' && SERVERLESS_ADMIN_ONLY_ROLES.has(role);
