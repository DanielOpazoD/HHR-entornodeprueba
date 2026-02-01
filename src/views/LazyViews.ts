/**
 * Lazy-loaded view components
 * Loaded on-demand when the user navigates to them
 */
import { lazy } from 'react';

// Census module (prefetch for faster navigation)
export const CensusView = lazy(() =>
    import(/* webpackPrefetch: true */ '@/features/census').then(m => ({ default: m.CensusView }))
);

export const SharedCensusView = lazy(() =>
    import(/* webpackChunkName: "shared-census" */ '@/features/census').then(m => ({ default: m.SharedCensusView }))
);

// CUDYR module (prefetch)
export const CudyrView = lazy(() =>
    import(/* webpackPrefetch: true */ '@/features/cudyr').then(m => ({ default: m.CudyrView }))
);

// Handoff module (prefetch)
export const HandoffView = lazy(() =>
    import(/* webpackPrefetch: true */ '@/features/handoff').then(m => ({ default: m.HandoffView }))
);

// Admin modules
export const AuditView = lazy(() =>
    import(/* webpackChunkName: "audit" */ '@/features/admin/components/AuditView').then(m => ({ default: m.AuditView }))
);

export const MedicalSignatureView = lazy(() =>
    import(/* webpackChunkName: "signature" */ '@/features/admin/components/MedicalSignatureView').then(m => ({ default: m.MedicalSignatureView }))
);

export const ErrorDashboard = lazy(() =>
    import(/* webpackChunkName: "error-db" */ '@/features/admin/components/ErrorDashboard').then(m => ({ default: m.ErrorDashboard }))
);

export const BackupFilesView = lazy(() =>
    import(/* webpackChunkName: "backup" */ '@/features/backup/components/BackupFilesView').then(m => ({ default: m.BackupFilesView }))
);

// Health & Monitoring
export const SystemDiagnosticsView = lazy(() => import('@/features/admin/components/SystemDiagnosticsView').then(module => ({ default: module.SystemDiagnosticsView })));
export const PatientMasterView = lazy(() => import('@/features/admin/components/PatientMasterView').then(module => ({ default: module.PatientMasterView })));
export const DataMaintenanceView = lazy(() => import('@/features/admin/components/DataMaintenanceView').then(module => ({ default: module.DataMaintenanceView })));
export const RoleManagementView = lazy(() => import('@/features/admin/components/RoleManagementView').then(module => ({ default: module.default })));

// WhatsApp module
export const WhatsAppIntegrationView = lazy(() =>
    import(/* webpackChunkName: "whatsapp" */ '@/features/whatsapp/components/WhatsAppIntegrationView').then(m => ({ default: m.WhatsAppIntegrationView }))
);

// Transfer Management module
export const TransferManagementView = lazy(() => import('@/features/transfers/components/TransferManagementView'));
