/**
 * UserMenu - User profile dropdown component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React from 'react';
import { Camera, LogOut } from 'lucide-react';
import { UserRole } from '@/hooks/useAuthState';
import type { AuthContextType } from '@/context/AuthContext';
import { getRoleDisplayLabel } from '@/shared/access/operationalAccessPolicy';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

interface UserMenuProps {
  userEmail: string;
  role: UserRole;
  isFirebaseConnected?: boolean;
  remoteSyncStatus?: AuthContextType['remoteSyncStatus'];
  avatarUrl?: string | null;
  onOpenAvatarSettings?: () => void;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  userEmail,
  role,
  isFirebaseConnected = false,
  remoteSyncStatus,
  avatarUrl,
  onOpenAvatarSettings,
  onLogout,
}) => {
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
  const userInitial = userEmail.charAt(0);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggle}
        className="relative w-9 h-9 overflow-hidden rounded-full bg-white/[0.08] backdrop-blur-sm border border-white/[0.12] flex items-center justify-center text-white/90 font-bold text-sm uppercase shadow-glass transition-transform active:scale-90"
        title={userEmail}
        aria-label={`Usuario ${userEmail}. Rol ${roleLabel}. Firebase ${connectionLabel}`}
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
            alt={`Foto de perfil de ${userEmail}`}
            className="absolute inset-0 h-full w-full rounded-full object-cover"
            loading="eager"
            decoding="async"
            draggable={false}
          />
        )}
        <span
          className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border border-[#0a1628] ${isRemoteReady ? 'bg-emerald-400' : 'bg-rose-400'}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-64 origin-top-right bg-white text-slate-800 rounded-xl shadow-xl border border-slate-200/80 ring-1 ring-black/[0.04] z-50 overflow-hidden"
          data-testid="user-profile-menu-panel"
        >
          <div className="px-4 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div
                className="relative h-16 w-16 shrink-0 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200 shadow-inner flex items-center justify-center overflow-hidden text-xl font-bold uppercase text-slate-500"
                data-testid="user-profile-menu-preview"
              >
                <span
                  className="flex h-full w-full items-center justify-center"
                  data-testid="user-profile-preview-initial-fallback"
                >
                  {userInitial}
                </span>
                {avatarUrl && (
                  <img
                    src={avatarUrl}
                    alt={`Foto de perfil de ${userEmail}`}
                    className="absolute inset-0 h-full w-full rounded-full object-cover"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-700">{userEmail}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[10px] font-semibold text-slate-500">{roleLabel}</span>
                  <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${isRemoteReady ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    />
                    {connectionLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="p-1.5">
            {onOpenAvatarSettings && (
              <button
                onClick={() => {
                  onOpenAvatarSettings();
                  close();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                aria-label="Cambiar foto de perfil"
              >
                <Camera size={14} />
                Cambiar foto
              </button>
            )}
            <button
              onClick={() => {
                onLogout();
                close();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
