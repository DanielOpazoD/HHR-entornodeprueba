/**
 * Lazy-loaded view components
 * Loaded on-demand when the user navigates to them
 */
import { lazy } from 'react';

// Census module (prefetch for faster navigation)
export const CensusView = lazy(() =>
    import(/* webpackPrefetch: true */ './census/CensusView').then(m => ({ default: m.CensusView }))
);

export const SharedCensusView = lazy(() =>
    import(/* webpackChunkName: "shared-census" */ './census/SharedCensusView').then(m => ({ default: m.SharedCensusView }))
) as React.ComponentType<any>;



// CUDYR module (prefetch)
export const CudyrView = lazy(() =>
    import(/* webpackPrefetch: true */ './cudyr/CudyrView').then(m => ({ default: m.CudyrView }))
);

// Handoff module (prefetch)
export const HandoffView = lazy(() =>
    import(/* webpackPrefetch: true */ './handoff/HandoffView').then(m => ({ default: m.HandoffView }))
);


// Admin modules
export const AuditView = lazy(() =>
    import(/* webpackChunkName: "audit" */ './admin/AuditView').then(m => ({ default: m.AuditView }))
);

export const MedicalSignatureView = lazy(() =>
    import(/* webpackChunkName: "signature" */ './admin/MedicalSignatureView').then(m => ({ default: m.MedicalSignatureView }))
);

export const ErrorDashboard = lazy(() =>
    import(/* webpackChunkName: "error-db" */ './admin/ErrorDashboard').then(m => ({ default: m.ErrorDashboard }))
);

export const BackupFilesView = lazy(() =>
    import(/* webpackChunkName: "backup" */ './backup/BackupFilesView').then(m => ({ default: m.BackupFilesView }))
);

// Health & Monitoring
export const SystemDiagnosticsView = lazy(() => import('./admin/SystemDiagnosticsView').then(module => ({ default: module.SystemDiagnosticsView })));
export const PatientMasterView = lazy(() => import('./admin/PatientMasterView').then(module => ({ default: module.PatientMasterView })));
export const DataMaintenanceView = lazy(() => import('./admin/DataMaintenanceView').then(module => ({ default: module.DataMaintenanceView })));

// WhatsApp module
export const WhatsAppIntegrationView = lazy(() =>
    import(/* webpackChunkName: "whatsapp" */ './whatsapp/WhatsAppIntegrationView').then(m => ({ default: m.WhatsAppIntegrationView }))
);

// Transfer Management module
export const TransferManagementView = lazy(() =>
    import(/* webpackChunkName: "transfers" */ './transfers/TransferManagementView').then(m => ({ default: m.TransferManagementView }))
);
