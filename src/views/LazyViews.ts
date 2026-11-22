/**
 * Lazy-loaded view components
 * Loaded on-demand when the user navigates to them
 */
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';

// Census route entrypoint. Keep it narrower than the modal-heavy
// public-components barrel so /censo can show the table sooner.
export const CensusView = lazyWithRetry(() =>
  import('./CensusRouteView').then(module => ({
    default: module.CensusRouteView,
  }))
);

export const CensusEmailConfigModal = lazyWithRetry(() =>
  import('@/features/census/public-components').then(module => ({
    default: module.CensusEmailConfigModal,
  }))
);

export const GlobalPatientSearchModal = lazyWithRetry(() =>
  import('@/features/census/public-components').then(module => ({
    default: module.GlobalPatientSearchModal,
  }))
);

export const AnalyticsView = lazyWithRetry(() =>
  import('@/features/analytics/public').then(module => ({
    default: module.AnalyticsView,
  }))
);

// CUDYR module (prefetch)
export const CudyrView = lazyWithRetry(() =>
  import('@/features/cudyr').then(module => ({
    default: module.CudyrView,
  }))
);

// Handoff module
export const HandoffView = lazyWithRetry(() =>
  import('@/features/handoff').then(module => ({
    default: module.HandoffView,
  }))
);

// Admin modules
export const AuditView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.AuditView,
  }))
);

export const FunctionsTelemetryView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.FunctionsTelemetryView,
  }))
);

export const ConfigurationView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.ConfigurationView,
  }))
);

export const DataView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.DataView,
  }))
);

export const CommunicationsView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.CommunicationsView,
  }))
);

export const WoundCareMobileUploadView = lazyWithRetry(() =>
  import('@/features/wound-care').then(module => ({
    default: module.WoundCareMobileUploadView,
  }))
);

export const PrescriptionUploadView = lazyWithRetry(() =>
  import('@/features/prescriptions').then(module => ({
    default: module.PrescriptionUploadView,
  }))
);

export const DocumentScannerDemoView = lazyWithRetry(() =>
  import('@/features/document-scanner').then(module => ({
    default: module.DocumentScannerDemoView,
  }))
);

export const DocumentScannerQueueView = lazyWithRetry(() =>
  import('@/features/document-scanner').then(module => ({
    default: module.DocumentScannerQueueView,
  }))
);

export const DocumentScannerLocalQueueView = lazyWithRetry(() =>
  import('@/features/document-scanner').then(module => ({
    default: module.DocumentScannerLocalQueueView,
  }))
);

export const PrescriptionVisorView = lazyWithRetry(() =>
  import('@/features/prescriptions').then(module => ({
    default: module.PrescriptionVisorView,
  }))
);

export const PrescriptionAdminView = lazyWithRetry(() =>
  import('@/features/prescriptions').then(module => ({
    default: module.PrescriptionAdminView,
  }))
);

export const BackupFilesView = lazyWithRetry(() =>
  import('@/features/backup/public').then(module => ({
    default: module.BackupFilesView,
  }))
);

// Health & Monitoring
export const SystemDiagnosticsView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.SystemDiagnosticsView,
  }))
);
export const PatientMasterView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.PatientMasterView,
  }))
);
export const DataMaintenanceView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.DataMaintenanceView,
  }))
);
export const RoleManagementView = lazyWithRetry(() =>
  import('@/features/admin').then(module => ({
    default: module.RoleManagementView,
  }))
);
export const AuditDocumentsView = lazyWithRetry(() =>
  import('@/features/audit-documents').then(module => ({
    default: module.AuditDocumentsView,
  }))
);
export const ReminderAdminView = lazyWithRetry(() =>
  import('@/features/reminders/public').then(module => ({
    default: module.ReminderAdminView,
  }))
);

// WhatsApp module
export const WhatsAppIntegrationView = lazyWithRetry(() =>
  import('@/features/whatsapp/public').then(m => ({
    default: m.WhatsAppIntegrationView,
  }))
);

export const AdmissionAuditView = lazyWithRetry(() =>
  import('@/features/admin/admission-audit').then(module => ({
    default: module.AdmissionAuditView,
  }))
);
