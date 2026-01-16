/**
 * Views Index
 * Centralized exports for all application views
 * 
 * Usage: import { CensusView, CudyrView } from './views';
 */

// ============================================================
// MAIN VIEWS (from feature subdirectories)
// ============================================================
export { CensusView } from './census/CensusView';
export { CudyrView } from './cudyr/CudyrView';
export { HandoffView } from './handoff/HandoffView';
// export { ReportsView } from './reports/ReportsView';
export { AnalyticsView } from './analytics/AnalyticsView';
export { AuditView } from './admin/AuditView';
export { MedicalSignatureView } from './admin/MedicalSignatureView';

// ============================================================
// CENSUS SUB-VIEWS / COMPONENTS
// ============================================================
export { CensusTable } from './census/CensusTable';
export { NurseSelector } from './census/NurseSelector';
export { CensusActionsProvider, useCensusActions } from './census/CensusActionsContext';

// ============================================================
// CUDYR SUB-VIEWS / COMPONENTS
// ============================================================
export { CudyrHeader } from './cudyr/CudyrHeader';
export { CudyrRow } from './cudyr/CudyrRow';

// ============================================================
// HANDOFF SUB-VIEWS / COMPONENTS
// ============================================================
export { HandoffHeader } from './handoff/HandoffHeader';
export { HandoffRow } from './handoff/HandoffRow';
export { MedicalHandoffHeader } from './handoff/MedicalHandoffHeader';
export { MovementsSummary } from './handoff/MovementsSummary';

// ============================================================
// WHATSAPP SUB-VIEWS / COMPONENTS
// ============================================================
export { WhatsAppIntegrationView } from './whatsapp/WhatsAppIntegrationView';
export { WhatsAppConfigView } from './whatsapp/WhatsAppConfigView';
export { ShiftPanelView } from './whatsapp/ShiftPanelView';
