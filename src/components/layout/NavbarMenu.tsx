/**
 * NavbarMenu - Brand dropdown menu component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React from 'react';
import { ChevronDown, FileImage, FileUp, LucideIcon, QrCode } from 'lucide-react';
import clsx from 'clsx';
import { ModuleType, NavItemConfig } from '@/constants/navigationConfig';
import { useNavbarNavigation } from '@/hooks/useNavbarNavigation';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import { useAuth } from '@/context/AuthContext';
import { resolveNavbarMenuAction } from '@/components/layout/navbar/navbarMenuController';

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon: Icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-100 transition-colors text-left"
  >
    <Icon size={16} className="text-slate-500" />
    {label}
  </button>
);

interface MenuLinkProps {
  icon: LucideIcon;
  label: string;
  href: string;
  onNavigate: () => void;
}

const MenuLink: React.FC<MenuLinkProps> = ({ icon: Icon, label, href, onNavigate }) => (
  <a
    href={href}
    onClick={onNavigate}
    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-100 transition-colors text-left"
  >
    <Icon size={16} className="text-slate-500" />
    {label}
  </a>
);

interface NavbarMenuProps {
  // Module actions
  currentModule: ModuleType;
  setModule: (mod: ModuleType) => void;
  censusViewMode: 'REGISTER' | 'ANALYTICS';
  visibleModules: readonly ModuleType[];
}

export const NavbarMenu: React.FC<NavbarMenuProps> = ({
  currentModule,
  setModule,
  censusViewMode,
  visibleModules,
}) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();
  const auth = useAuth();
  const isAdmin = auth.role === 'admin';
  const canSeePrescriptionsVisor =
    isAdmin || auth.role === 'nurse_hospital' || auth.role === 'doctor_urgency' || auth.isEditor;
  const canSeePrescriptionsConfig = isAdmin || auth.role === 'nurse_hospital';

  const { systemItems } = useNavbarNavigation(currentModule, visibleModules, censusViewMode);

  const handleItemClick = (item: NavItemConfig) => {
    const actionResolution = resolveNavbarMenuAction({ item });

    if (actionResolution.moduleToChange) {
      setModule(actionResolution.moduleToChange);
    }

    close();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggle}
        className={clsx(
          'flex items-center gap-3 py-2 px-3 rounded-xl transition-all duration-200',
          'hover:bg-white/[0.07]'
        )}
      >
        <div className="bg-white/[0.1] p-1.5 rounded-xl backdrop-blur-sm ring-1 ring-white/[0.08]">
          <img src="/images/logos/logo_HHR.svg" alt="HHR" className="w-7 h-7 object-contain" />
        </div>
        <div className="text-left">
          <h1 className="text-[15px] font-display font-bold leading-tight tracking-tight text-white/95">
            Hospital Hanga Roa
          </h1>
        </div>
        <ChevronDown
          size={16}
          className={clsx('text-white/30 transition-transform ml-1', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={close} />

          {/* Menu */}
          <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 ring-1 ring-black/[0.04] z-50 overflow-hidden">
            <div className="py-1">
              {systemItems.length > 0 && <div className="h-px bg-slate-200 my-1" />}
              {systemItems.map(item => (
                <MenuItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => handleItemClick(item)}
                />
              ))}
              {(canSeePrescriptionsVisor || canSeePrescriptionsConfig) && (
                <>
                  <div className="h-px bg-slate-200 my-1" />
                  {canSeePrescriptionsVisor && (
                    <MenuLink
                      icon={FileUp}
                      label="Documentos — Pendientes Eloísa"
                      href="/documentos/pendientes"
                      onNavigate={close}
                    />
                  )}
                  {canSeePrescriptionsVisor && (
                    <MenuLink
                      icon={FileImage}
                      label="Recetas — Visor"
                      href="/recetas/visor"
                      onNavigate={close}
                    />
                  )}
                  {canSeePrescriptionsConfig && (
                    <MenuLink
                      icon={QrCode}
                      label="Recetas — Configuración (QR/PIN)"
                      href="/admin/recetas-config"
                      onNavigate={close}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
