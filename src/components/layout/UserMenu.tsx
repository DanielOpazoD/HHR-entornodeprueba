/**
 * UserMenu - User profile dropdown component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React from 'react';
import { LogOut } from 'lucide-react';
import { UserRole } from '@/hooks/useAuthState';
import { getRoleDisplayName } from '@/utils/permissions';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

interface UserMenuProps {
  userEmail: string;
  role: UserRole;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ userEmail, role, onLogout }) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white font-bold text-sm uppercase shadow-glass transition-transform active:scale-90"
        title={userEmail}
      >
        {userEmail.charAt(0)}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-52 bg-white text-slate-800 rounded-lg shadow-lg border border-slate-200 z-50 overflow-hidden text-sm">
          <div className="p-3 border-b border-slate-200">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Usuario
            </p>
            <p className="mt-1 font-semibold break-words text-slate-800 text-sm leading-snug">
              {userEmail}
            </p>
            <p className="mt-1.5 text-xs text-slate-600">
              Rol: <span className="font-semibold text-slate-800">{getRoleDisplayName(role)}</span>
            </p>
          </div>
          <div className="p-2">
            <button
              onClick={() => {
                onLogout();
                close();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
