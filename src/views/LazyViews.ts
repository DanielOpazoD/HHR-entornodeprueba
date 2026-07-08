/**
 * Lazy-loaded view components
 * Loaded on-demand when the user navigates to them
 */
import { lazyWithRetry } from '@/utils/lazyWithRetry';

// Census route entrypoint. Keep it narrower than the modal-heavy
// public-components barrel so /censo can show the table sooner.
export const CensusView = lazyWithRetry(() =>
  import('@/features/census/census-view').then(module => ({
    default: module.CensusView,
  }))
);

export const CensusEmailConfigModal = lazyWithRetry(() =>
  import('@/features/census/public-components').then(module => ({
    default: module.CensusEmailConfigModal,
  }))
);

export const AnalyticsView = lazyWithRetry(() =>
  import('@/application/analytics/public').then(module => ({
    default: module.AnalyticsView,
  }))
);

// CUDYR module (prefetch)
export const CudyrView = lazyWithRetry(() =>
  import('@/features/cudyr').then(module => ({
    default: module.CudyrView,
  }))
);

// Handoff module (prefetch)
export const HandoffView = lazyWithRetry(() =>
  import(/* webpackPrefetch: true */ '@/features/handoff').then(module => ({
    default: module.HandoffView,
  }))
);

// Admin modules
export const AuditView = lazyWithRetry(() =>
  import(/* webpackChunkName: "audit" */ '@/features/admin').then(module => ({
    default: module.AuditView,
  }))
);

export const FunctionsTelemetryView = lazyWithRetry(() =>
  import(/* webpackChunkName: "functions-telemetry" */ '@/features/admin').then(module => ({
    default: module.FunctionsTelemetryView,
  }))
);

export const ConfigurationView = lazyWithRetry(() =>
  import(/* webpackChunkName: "configuration" */ '@/features/admin').then(module => ({
    default: module.ConfigurationView,
  }))
);

export const DataView = lazyWithRetry(() =>
  import(/* webpackChunkName: "data" */ '@/features/admin').then(module => ({
    default: module.DataView,
  }))
);

export const CommunicationsView = lazyWithRetry(() =>
  import(/* webpackChunkName: "communications" */ '@/features/admin').then(module => ({
    default: module.CommunicationsView,
  }))
);

export const MedicalSignatureView = lazyWithRetry(() =>
  import(/* webpackChunkName: "signature" */ '@/features/admin').then(module => ({
    default: module.MedicalSignatureView,
  }))
);

export const WoundCareMobileUploadView = lazyWithRetry(() =>
  import(/* webpackChunkName: "wound-care-mobile-upload" */ '@/features/wound-care').then(
    module => ({
      default: module.WoundCareMobileUploadView,
    })
  )
);

export const PrescriptionUploadView = lazyWithRetry(() =>
  import(/* webpackChunkName: "prescriptions-upload" */ '@/features/prescriptions').then(
    module => ({
      default: module.PrescriptionUploadView,
    })
  )
);

export const PrescriptionVisorView = lazyWithRetry(() =>
  import(/* webpackChunkName: "prescriptions-visor" */ '@/features/prescriptions').then(module => ({
    default: module.PrescriptionVisorView,
  }))
);

export const PrescriptionAdminView = lazyWithRetry(() =>
  import(/* webpackChunkName: "prescriptions-admin" */ '@/features/prescriptions').then(module => ({
    default: module.PrescriptionAdminView,
  }))
);

export const BackupFilesView = lazyWithRetry(() =>
  import(/* webpackChunkName: "backup" */ '@/application/backup/public').then(module => ({
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
export const ReminderAdminView = lazyWithRetry(() =>
  import('@/application/reminders/public').then(module => ({
    default: module.ReminderAdminView,
  }))
);

// WhatsApp module
export const WhatsAppIntegrationView = lazyWithRetry(() =>
  import(/* webpackChunkName: "whatsapp" */ '@/application/whatsapp/public').then(m => ({
    default: m.WhatsAppIntegrationView,
  }))
);

// Transfer Management module
export const TransferManagementView = lazyWithRetry(() =>
  import('@/features/transfers').then(module => ({
    default: module.TransferManagementView,
  }))
);
