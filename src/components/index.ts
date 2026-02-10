/**
 * Components Index
 * Centralized exports for all UI components
 * 
 * Usage: import { Navbar, DateStrip, PatientRow } from './components';
 */

// ============================================================
// ERROR HANDLING (shared/)
// ============================================================
export { GlobalErrorBoundary } from './shared/GlobalErrorBoundary';
export { SectionErrorBoundary } from './shared/SectionErrorBoundary';
export { SyncWatcher } from './shared/SyncWatcher';
export { BaseModal, ModalSection } from './shared/BaseModal';
export type { BaseModalProps, ModalSectionProps } from './shared/BaseModal';

// ============================================================
// LAYOUT COMPONENTS (layout/)
// ============================================================
export { Navbar } from './layout/Navbar';
export { DateStrip } from './layout/DateStrip';
export { SummaryCard } from './layout/SummaryCard';
export { default as StorageStatusBadge } from './layout/StorageStatusBadge';
export { BookmarkBar } from './bookmarks/BookmarkBar';
export type { ModuleType } from '@/constants/navigationConfig';

// ============================================================
// AUTH COMPONENTS (auth/)
// ============================================================
export { LoginPage } from '@/features/auth/components/LoginPage';

// ============================================================
// CENSUS COMPONENTS (census/)
// ============================================================
export { PatientRow } from '@/features/census/components/PatientRow';
export { CensusEmailConfigModal } from '@/features/census/components/CensusEmailConfigModal';
export { PatientActionMenu } from '@/features/census/components/patient-row/PatientActionMenu';
export { PatientBedConfig } from '@/features/census/components/patient-row/PatientBedConfig';
export { PatientInputCells } from '@/features/census/components/patient-row/PatientInputCells';

// ============================================================
// DEBUG COMPONENTS (debug/)
// ============================================================
export { DemoModePanel } from './debug/DemoModePanel';
export { TestAgent } from './debug/TestAgent';

// ============================================================
// DEVICE SELECTOR
// ============================================================
export { DeviceSelector } from './DeviceSelector';

// ============================================================
// MODALS
// ============================================================
export { MoveCopyModal, DischargeModal, TransferModal } from './modals/ActionModals';
export { BedManagerModal } from './modals/BedManagerModal';
export { DemographicsModal } from './modals/DemographicsModal';
export { NurseManagerModal } from './modals/NurseManagerModal';
export { TensManagerModal } from './modals/TensManagerModal';
export { SettingsModal } from './modals/SettingsModal';

// ============================================================
// UI PRIMITIVES
// ============================================================
export { DebouncedInput } from './ui/DebouncedInput';
export { SyncStatusIndicator } from './ui/SyncStatusIndicator';
