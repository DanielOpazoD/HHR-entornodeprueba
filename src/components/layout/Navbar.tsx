/**
 * Navbar - Main navigation bar component
 * Refactored to use smaller, specialized sub-components.
 */

import React, { useRef, useState } from 'react';
import { BellRing, WifiOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { NavbarMenu } from './NavbarMenu';
import { NavbarTabs } from './NavbarTabs';
import { MoaHelpButton } from './navbar/MoaHelpButton';
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
    <div className="flex items-center gap-2 sm:gap-3">
      {/* En teléfono el estado de sincronización sigue visible en la barra de fechas. */}
      <div className="hidden sm:block">
        <SyncStatusIndicator />
      </div>
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

  return (
    <nav
      data-app-top-bar
      aria-label="Navegación principal HHR"
      className="bg-[#102d43] text-white shadow-sm sticky top-0 z-[60] print:hidden h-[56px] flex items-center border-b border-white/10"
      style={{ transform: 'translateZ(0)' }}
    >
      <div className="w-full max-w-screen-2xl mx-auto px-3 sm:px-4 flex flex-nowrap min-w-0 gap-2 sm:gap-4 justify-between items-center">
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
        <div className="flex shrink-0 items-center gap-2 sm:gap-4 py-2 ml-auto">
          {runtimeIndicatorSlot}
          {!hideRuntimeIndicators && <MoaHelpButton />}

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
