/**
 * NavbarMenu - Brand dropdown menu component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React from 'react';
import { ChevronDown, LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ModuleType, NavItemConfig } from '@/constants/navigationConfig';
import { useNavbarNavigation } from '@/hooks/useNavbarNavigation';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
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

interface NavbarMenuProps {
  // Module actions
  currentModule: ModuleType;
  setModule: (mod: ModuleType) => void;
  censusViewMode: 'REGISTER' | 'ANALYTICS';
  // File actions
  onOpenSettings: () => void;
  visibleModules: readonly ModuleType[];
  disabled?: boolean;
}

export const NavbarMenu: React.FC<NavbarMenuProps> = ({
  currentModule,
  setModule,
  censusViewMode,
  onOpenSettings,
  visibleModules,
  disabled = false,
}) => {
  const { isOpen, menuRef, toggle, close, setIsOpen } = useDropdownMenu();

  const { systemItems } = useNavbarNavigation(currentModule, visibleModules, censusViewMode);

  React.useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled, setIsOpen]);

  const handleItemClick = (item: NavItemConfig) => {
    const actionResolution = resolveNavbarMenuAction({ item });

    if (actionResolution.moduleToChange) {
      setModule(actionResolution.moduleToChange);
    }

    if (actionResolution.shouldOpenSettings) {
      onOpenSettings();
    }

    close();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={disabled ? undefined : toggle}
        className={clsx(
          'flex items-center gap-3 py-2 px-3 rounded-xl transition-all duration-200',
          !disabled && 'hover:bg-white/10'
        )}
        disabled={disabled}
      >
        <div className="bg-white p-1.5 rounded-xl shadow-sm">
          <img src="/images/logos/logo_HHR.svg" alt="HHR" className="w-7 h-7 object-contain" />
        </div>
        <div className="text-left">
          <h1 className="text-lg font-display font-bold leading-tight tracking-tight">
            Hospital Hanga Roa
          </h1>
          <p className="text-[10px] font-bold text-red-300 uppercase tracking-[0.2em]">
            {disabled ? 'Censo Compartido' : 'MODO PRUEBA'}
          </p>
        </div>
        {!disabled && (
          <ChevronDown
            size={16}
            className={clsx('text-white/50 transition-transform ml-1', isOpen && 'rotate-180')}
          />
        )}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={close} />

          {/* Menu */}
          <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden">
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
            </div>
          </div>
        </>
      )}
    </div>
  );
};
