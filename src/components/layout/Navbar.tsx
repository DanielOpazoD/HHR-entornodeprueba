/**
 * Navbar - Main navigation bar component
 * Refactored to use smaller, specialized sub-components.
 */

import React, { useRef, useState } from 'react';
import { BellRing, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { NavbarMenu } from './NavbarMenu';
import { NavbarTabs } from './NavbarTabs';
import { UserMenu } from './UserMenu';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { getVisibleAppModules } from '@/shared/access/operationalAccessPolicy';
import { useUserAvatarProfile } from '@/hooks/useUserAvatarProfile';
import { useNotification } from '@/context/UIContext';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import {
  buildUserAvatarFeedback,
  resolveVisibleUserAvatarUrl,
} from '@/components/layout/userAvatarPresentationController';

import { ModuleType } from '@/constants/navigationConfig';
type ViewMode = 'REGISTER' | 'ANALYTICS';

const ReminderBadge = lazyWithRetry(() =>
  import('@/components/reminders/ReminderBadge').then(module => ({
    default: module.ReminderBadge,
  }))
);

const UserAvatarModal = lazyWithRetry(() =>
  import('./UserAvatarModal').then(module => ({
    default: module.UserAvatarModal,
  }))
);

export const ReminderBadgeFallback = () => (
  <div
    className="relative flex h-8 w-[58px] items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-0 py-0 text-white/70"
    aria-label="Avisos cargando"
    aria-busy="true"
    role="status"
  >
    <BellRing size={14} aria-hidden="true" />
    <span className="w-5 rounded-full bg-white/10 px-0 py-0.5 text-center text-[10px] leading-none">
      ...
    </span>
  </div>
);

export interface NavbarProps {
  currentModule: ModuleType;
  setModule: (mod: ModuleType) => void;
  censusViewMode: ViewMode;
  setCensusViewMode: (mode: ViewMode) => void;
  onOpenBedManager: () => void;
  onExportCSV: () => void;
  onImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  userEmail?: string | null;
  onLogout?: () => void;
  isFirebaseConnected?: boolean;
  hideRuntimeIndicators?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentModule,
  setModule,
  censusViewMode,
  setCensusViewMode,
  onImportJSON,
  userEmail,
  onLogout,
  isFirebaseConnected,
  hideRuntimeIndicators = false,
}) => {
  const { currentUser, role, remoteSyncStatus } = useAuth();
  const visibleModules = getVisibleAppModules(role);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const userAvatar = useUserAvatarProfile(currentUser);
  const { success, error: notifyError } = useNotification();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarUrl = resolveVisibleUserAvatarUrl(userAvatar.profile?.photoURL);
  const runtimeIndicatorSlot = hideRuntimeIndicators ? (
    <div className="hidden sm:flex items-center gap-3 invisible" aria-hidden="true">
      <div className="h-8 w-[88px] rounded-full" />
      <div className="h-8 w-[58px] rounded-full" />
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <SyncStatusIndicator />
      <React.Suspense fallback={<ReminderBadgeFallback />}>
        <ReminderBadge />
      </React.Suspense>

      {!isFirebaseConnected && <WifiOff size={14} className="text-red-200/80" aria-hidden="true" />}
    </div>
  );

  const handleModuleChange = (mod: ModuleType) => {
    setModule(mod);
    if (mod === 'CENSUS') {
      setCensusViewMode('REGISTER');
    }
  };

  // Module Color Map
  const getNavColor = () => {
    switch (currentModule) {
      case 'CENSUS':
        return 'bg-gradient-to-r from-[#0c4a6e] via-[#0369a1] to-[#0c4a6e]';
      case 'ANALYTICS':
        return 'bg-gradient-to-r from-sky-800 via-sky-700 to-cyan-700';
      case 'NURSING_HANDOFF':
        return 'bg-gradient-to-r from-[#0369a1] via-[#0284c7] to-[#0369a1]';
      case 'MEDICAL_HANDOFF':
        return 'bg-gradient-to-r from-teal-800 via-teal-700 to-teal-800';
      case 'AUDIT':
        return 'bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800';
      case 'BACKUP_FILES':
        return 'bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700';
      case 'PATIENT_MASTER_INDEX':
        return 'bg-gradient-to-r from-blue-700 via-blue-600 to-blue-700';
      case 'DATA_MAINTENANCE':
        return 'bg-gradient-to-r from-emerald-800 via-emerald-700 to-emerald-800';
      case 'DIAGNOSTICS':
        return 'bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900';
      case 'ROLE_MANAGEMENT':
        return 'bg-gradient-to-r from-indigo-800 via-indigo-700 to-indigo-800';
      case 'REMINDERS':
        return 'bg-gradient-to-r from-amber-800 via-amber-700 to-amber-800';
      default:
        return 'bg-gradient-to-r from-[#0c4a6e] via-[#0369a1] to-[#0c4a6e]';
    }
  };

  return (
    <nav
      data-app-top-bar
      className={clsx(
        getNavColor(),
        'text-white shadow-md shadow-black/10 sticky top-0 z-[60] print:hidden transition-colors duration-300 h-[56px] flex items-center border-b border-white/[0.08]'
      )}
      style={{ transform: 'translateZ(0)' }}
    >
      <div className="w-full max-w-screen-2xl mx-auto px-4 flex flex-wrap gap-4 justify-between items-center">
        {/* Brand with Dropdown Menu */}
        <NavbarMenu
          currentModule={currentModule}
          setModule={setModule}
          censusViewMode={censusViewMode}
          visibleModules={visibleModules}
        />
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,.csv"
          onChange={onImportJSON}
        />

        {/* Main Navigation Tabs */}
        <NavbarTabs
          currentModule={currentModule}
          onModuleChange={handleModuleChange}
          visibleModules={visibleModules}
          censusViewMode={censusViewMode}
          setCensusViewMode={setCensusViewMode}
        />

        {/* Status Indicators & User Menu */}
        <div className="flex items-center gap-4 py-2 ml-auto">
          {runtimeIndicatorSlot}

          {userEmail && onLogout && (
            <UserMenu
              userEmail={userEmail}
              role={role}
              isFirebaseConnected={isFirebaseConnected}
              remoteSyncStatus={remoteSyncStatus}
              avatarUrl={avatarUrl}
              onOpenAvatarSettings={currentUser?.uid ? () => setIsAvatarModalOpen(true) : undefined}
              onLogout={onLogout}
            />
          )}
        </div>
      </div>
      {userEmail && currentUser?.uid && isAvatarModalOpen && (
        <React.Suspense fallback={null}>
          <UserAvatarModal
            isOpen={isAvatarModalOpen}
            userEmail={userEmail}
            avatarUrl={avatarUrl}
            isSaving={userAvatar.isSaving}
            onClose={() => setIsAvatarModalOpen(false)}
            onUpload={async file => {
              try {
                await userAvatar.uploadAvatar(file);
                const feedback = buildUserAvatarFeedback('saved');
                success(feedback.title, feedback.message);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'No se pudo guardar la foto de perfil.';
                notifyError('No se pudo guardar la foto', message);
                throw error;
              }
            }}
            onRemove={async () => {
              try {
                await userAvatar.removeAvatar();
                const feedback = buildUserAvatarFeedback('removed');
                success(feedback.title, feedback.message);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'No se pudo eliminar la foto de perfil.';
                notifyError('No se pudo eliminar la foto', message);
                throw error;
              }
            }}
          />
        </React.Suspense>
      )}
    </nav>
  );
};
