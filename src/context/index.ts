/**
 * Context Index
 * Centralized exports for all React contexts and providers
 *
 * Usage: import { useNotification, useDailyRecordData } from './context';
 */

// UI System (Notifications + Dialogs unified)
export {
  UIProvider,
  useUI,
  // Backward compatibility
  useNotification,
  useConfirmDialog,
} from './UIContext';
export type { NotificationType, ConfirmOptions, UIContextType } from './UIContext';

// Daily Record Context
export {
  DailyRecordProvider,
  useDailyRecordData,
  useDailyRecordDayActions,
  useDailyRecordPersistenceActions,
  useDailyRecordBedActions,
} from './DailyRecordContext';

// Authentication & Roles
export { AuthProvider } from './AuthProvider';
export { useAuth, useCanEdit } from './AuthContext';
export type { UserRole, AuthContextType } from './AuthContext';

// Audit Logging
export { AuditProvider, useAuditContext } from './AuditContext';

// Staff Context
export { StaffProvider, useStaffContext } from './StaffContext';
