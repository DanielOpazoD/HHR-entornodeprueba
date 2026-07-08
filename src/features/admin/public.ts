/**
 * @module admin (public API)
 * @description Public entry point for the admin feature module.
 * Other modules should import from this file, not from internal paths.
 *
 * @example
 * ```ts
 * import { MedicalSignatureView, evaluateSystemHealthState } from '@/features/admin/public';
 * ```
 */

// ── View components ─────────────────────────────────────────────────────────
export { AuditView } from './components/AuditView';
export { CommunicationsView } from './components/CommunicationsView';
export { ConfigurationView } from './components/ConfigurationView';
export { DataView } from './components/DataView';
export { FunctionsTelemetryView } from './components/FunctionsTelemetryView';
export { MedicalSignatureView } from './components/MedicalSignatureView';
export { SystemDiagnosticsView } from './components/SystemDiagnosticsView';
export { PatientMasterView } from './components/PatientMasterView';
export { DataMaintenanceView } from './components/DataMaintenanceView';
export { default as RoleManagementView } from './components/RoleManagementView';

// ── Types / contracts ───────────────────────────────────────────────────────
export type { DailyRecord } from './contracts/publicMedicalSignatureContracts';

// ── Controllers (pure functions reusable by other modules) ──────────────────
export { createPublicMedicalSignatureContextValue } from './controllers/publicMedicalSignatureContextController';

// ── Hooks ───────────────────────────────────────────────────────────────────
export { usePublicMedicalSignature } from './hooks/usePublicMedicalSignature';

// ── System health utilities ─────────────────────────────────────────────────
export {
  evaluateSystemHealthState,
  DEFAULT_SYSTEM_HEALTH_THRESHOLDS,
} from './components/systemHealthStatusPolicy';
export type {
  SystemHealthState,
  SystemHealthThresholds,
} from './components/systemHealthStatusPolicy';
