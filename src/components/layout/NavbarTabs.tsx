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
import {
  resolveAnalyticsToggleTarget,
  resolveIsNavbarItemActive,
} from '@/components/layout/navbar/navbarTabsController';
import { useDeferredCensusModeUpdate } from '@/components/layout/navbar/useDeferredCensusModeUpdate';

interface NavTabProps {
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onClick: () => void;
}

const NavTab: React.FC<NavTabProps> = ({ label, icon: Icon, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={clsx(
      'flex items-center gap-2 px-4 py-3 border-b-2 transition-all duration-300 font-medium text-sm tracking-tight',
      isActive
        ? 'border-white text-white drop-shadow-sm scale-105'
        : 'border-transparent text-medical-200 hover:text-white hover:border-medical-400'
    )}
  >
    <Icon size={16} /> {label}
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
          ? 'text-medical-600 bg-medical-50'
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
  const { schedule: scheduleDeferredModeUpdate } = useDeferredCensusModeUpdate({
    onUpdate: setCensusViewMode,
  });

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
    } else if (item.actionType === 'ANALYTICS_TOGGLE') {
      const analyticsTarget = resolveAnalyticsToggleTarget({ currentModule, censusViewMode });
      if (analyticsTarget.moduleToChange) {
        onModuleChange(analyticsTarget.moduleToChange);
      }

      if (analyticsTarget.deferCensusModeUpdate) {
        scheduleDeferredModeUpdate(analyticsTarget.censusModeToSet);
      } else {
        setCensusViewMode(analyticsTarget.censusModeToSet);
      }
    }
    close();
  };

  return (
    <div className="flex gap-1 self-end items-center">
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
        />
      ))}

      {/* Utility Modules Dropdown - Subtle icon */}
      {utilityItems.length > 0 && (
        <div className="relative ml-2" ref={menuRef}>
          <button
            onClick={toggle}
            className={clsx(
              'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200',
              isUtilityActive || currentModule === 'CUDYR'
                ? 'bg-white/20 text-white ring-2 ring-white/30'
                : 'text-medical-200 hover:bg-white/10 hover:text-white'
            )}
            title="Más módulos"
          >
            <LayoutGrid size={20} />
          </button>

          {/* Dropdown Menu */}
          {isUtilityMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
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
