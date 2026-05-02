/**
 * NavbarTabs - Main navigation tabs component
 * Clinical modules shown as tabs, utility modules in dropdown.
 */

import React from 'react';
import { LayoutGrid, LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ModuleType, NavItemConfig } from '@/constants/navigationConfig';
import { useNavbarNavigation } from '@/hooks/useNavbarNavigation';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import { resolveIsNavbarItemActive } from '@/components/layout/navbar/navbarTabsController';

interface NavTabProps {
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onClick: () => void;
  testId?: string;
}

const NavTab: React.FC<NavTabProps> = ({ label, icon: Icon, isActive, onClick, testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={clsx(
      'flex items-center gap-2 px-4 py-1.5 transition-all duration-200 text-[13px] tracking-tight rounded-full ring-1 ring-transparent',
      isActive
        ? 'text-white font-semibold bg-white/[0.16] ring-white/18 shadow-sm shadow-black/10'
        : 'text-white/65 hover:text-white hover:bg-white/[0.08] hover:ring-white/12 font-medium'
    )}
  >
    <Icon size={15} /> {label}
  </button>
);

// Utility modules dropdown item
interface DropdownItemProps {
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const DropdownItem: React.FC<DropdownItemProps> = ({
  label,
  icon: Icon,
  isActive,
  onClick,
  disabled,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium transition-all',
      disabled
        ? 'text-slate-400 cursor-not-allowed'
        : isActive
          ? 'text-accent-600 bg-accent-50'
          : 'text-slate-700 hover:bg-slate-50'
    )}
  >
    <Icon size={18} className={disabled ? 'text-slate-300' : ''} />
    <span>{label}</span>
    {disabled && <span className="ml-auto text-xs text-slate-400">(próximamente)</span>}
  </button>
);

interface NavbarTabsProps {
  currentModule: ModuleType;
  onModuleChange: (mod: ModuleType) => void;
  visibleModules: readonly ModuleType[];
  censusViewMode: 'REGISTER' | 'ANALYTICS';
  setCensusViewMode: (mode: 'REGISTER' | 'ANALYTICS') => void;
}

export const NavbarTabs: React.FC<NavbarTabsProps> = ({
  currentModule,
  onModuleChange,
  visibleModules,
  censusViewMode,
  setCensusViewMode,
}) => {
  const { isOpen: isUtilityMenuOpen, menuRef, toggle, close } = useDropdownMenu();

  const { clinicalTabs, utilityItems, isUtilityActive } = useNavbarNavigation(
    currentModule,
    visibleModules,
    censusViewMode
  );

  const handleItemClick = (item: NavItemConfig) => {
    if (item.actionType === 'MODULE_CHANGE') {
      if (item.module) {
        onModuleChange(item.module);
        if (item.censusMode) setCensusViewMode(item.censusMode);
      }
    }
    close();
  };

  return (
    <div className="flex gap-1 items-center">
      {/* Clinical Modules - Prominent tabs */}
      {clinicalTabs.map(item => (
        <NavTab
          key={item.id}
          label={item.label}
          icon={item.icon}
          isActive={resolveIsNavbarItemActive({
            currentModule,
            itemModule: item.module,
            censusViewMode,
            itemCensusMode: item.censusMode,
          })}
          onClick={() => handleItemClick(item)}
          testId={`nav-tab-${item.id}`}
        />
      ))}

      {/* Utility Modules Dropdown - Subtle icon */}
      {utilityItems.length > 0 && (
        <div className="relative ml-2" ref={menuRef}>
          <button
            onClick={toggle}
            className={clsx(
              'flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200',
              isUtilityActive || currentModule === 'CUDYR'
                ? 'bg-white/[0.16] text-white ring-1 ring-white/20 shadow-sm shadow-black/10'
                : 'text-white/55 hover:bg-white/[0.08] hover:text-white'
            )}
            title="Más módulos"
          >
            <LayoutGrid size={20} />
          </button>

          {/* Dropdown Menu */}
          {isUtilityMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl ring-1 ring-black/[0.04] border border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="py-1">
                {utilityItems.map(item => (
                  <DropdownItem
                    key={item.id}
                    label={item.label}
                    icon={item.icon}
                    isActive={resolveIsNavbarItemActive({
                      currentModule,
                      itemModule: item.module,
                      censusViewMode,
                      itemCensusMode: item.censusMode,
                    })}
                    onClick={() => handleItemClick(item)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
