/**
 * UserMenu - User profile dropdown component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React, { lazy, Suspense, useState } from 'react';
const NursingPasswordDialog = lazy(() => import('./NursingPasswordDialog'));
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
const UserMenuPanel = lazy(() => import('./UserMenuPanel'));
import { UserRole } from '@/hooks/useAuthState';
import type { AuthContextType } from '@/context/AuthContext';
import { getRoleDisplayLabel } from '@/shared/access/operationalAccessPolicy';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

interface UserMenuProps {
  userEmail: string;
  displayName?: string | null;
  isIndividualAccount?: boolean;
  role: UserRole;
  isFirebaseConnected?: boolean;
  remoteSyncStatus?: AuthContextType['remoteSyncStatus'];
  avatarUrl?: string | null;
  onOpenAvatarSettings?: () => void;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  userEmail,
  displayName,
  isIndividualAccount = false,
  role,
  isFirebaseConnected = false,
  remoteSyncStatus,
  avatarUrl,
  onOpenAvatarSettings,
  onLogout,
}) => {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();
  const roleLabel = getRoleDisplayLabel(role);
  const connectionLabel =
    remoteSyncStatus === 'local_only'
      ? 'Local'
      : remoteSyncStatus === 'bootstrapping'
        ? 'Conectando'
        : isFirebaseConnected
          ? 'Online'
          : 'Offline';
  const isRemoteReady = remoteSyncStatus ? remoteSyncStatus === 'ready' : isFirebaseConnected;
  const userLabel = isIndividualAccount ? displayName || 'Enfermería' : userEmail;
  const userInitial = userLabel.charAt(0);

  const logoutFallback = (
    <button
      className="absolute right-0 mt-2 rounded-lg bg-white px-4 py-3 text-sm text-red-600 shadow-lg"
      onClick={() => {
        onLogout();
        close();
      }}
    >
      Cerrar sesión
    </button>
  );

  return (
    <div className="relative" ref={menuRef}>
      {passwordOpen && (
        <Suspense fallback={null}>
          <NursingPasswordDialog onClose={() => setPasswordOpen(false)} />
        </Suspense>
      )}
      <button
        onClick={toggle}
        aria-expanded={isOpen}
        className="relative w-8 h-8 overflow-hidden rounded-full bg-white/[0.16] backdrop-blur-sm border border-white/[0.12] flex items-center justify-center text-white/90 font-semibold text-sm uppercase shadow-glass transition-transform active:scale-90"
        title={userLabel}
        aria-label={`Usuario ${userLabel}. Rol ${roleLabel}. Firebase ${connectionLabel}`}
        data-testid="authenticated-user-menu-button"
      >
        <span
          className="flex h-full w-full items-center justify-center"
          data-testid="user-avatar-initial-fallback"
        >
          {userInitial}
        </span>
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt={`Foto de perfil de ${userLabel}`}
            className="absolute inset-0 h-full w-full rounded-full object-cover"
            loading="eager"
            decoding="async"
            draggable={false}
          />
        )}
        <span
          className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border border-[#3f74a5] ${isRemoteReady ? 'bg-emerald-400' : 'bg-rose-400'}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <GlobalErrorBoundary fallbackComponent={logoutFallback}>
          <Suspense fallback={null}>
            <UserMenuPanel
              userLabel={userLabel}
              userInitial={userInitial}
              roleLabel={roleLabel}
              connectionLabel={connectionLabel}
              isRemoteReady={isRemoteReady}
              isIndividualAccount={isIndividualAccount}
              avatarUrl={avatarUrl}
              onChangePassword={() => setPasswordOpen(true)}
              onOpenAvatarSettings={onOpenAvatarSettings}
              onLogout={onLogout}
              close={close}
            />
          </Suspense>
        </GlobalErrorBoundary>
      )}
    </div>
  );
};
