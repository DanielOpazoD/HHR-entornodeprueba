/**
 * NavbarTabs - Main navigation tabs component
 * Clinical modules shown as tabs, utility modules in dropdown.
 */

import React, { useId, useRef } from 'react';
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
    type="button"
    aria-current={isActive ? 'page' : undefined}
    onClick={onClick}
    data-testid={testId}
    aria-label={label}
    title={label}
    className={clsx(
      'flex shrink-0 items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-1.5 transition-all duration-200 text-[13px] tracking-tight rounded-lg ring-1 ring-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none',
      isActive
        ? 'text-white font-semibold bg-white/[0.16] ring-white/18 underline underline-offset-4 decoration-2'
        : 'text-white/85 hover:text-white hover:bg-white/[0.08] hover:ring-white/12 font-medium'
    )}
  >
    <Icon size={15} aria-hidden="true" />
    <span>{label}</span>
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
    type="button"
    aria-current={isActive ? 'page' : undefined}
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-700 motion-reduce:transition-none',
      disabled
        ? 'text-slate-400 cursor-not-allowed'
        : isActive
          ? 'text-accent-600 bg-accent-50'
          : 'text-slate-700 hover:bg-slate-50'
    )}
  >
    <Icon size={18} aria-hidden="true" className={disabled ? 'text-slate-300' : ''} />
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
  const utilityTriggerRef = useRef<HTMLButtonElement>(null);
  const utilityPanelId = useId();

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
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* Clinical Modules - Prominent tabs */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto p-1">
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
      </div>

      {/* Utility Modules Dropdown - Subtle icon */}
      {utilityItems.length > 0 && (
        <div
          className="relative ml-1 shrink-0"
          ref={menuRef}
          onKeyDown={event => {
            if (event.key === 'Escape' && isUtilityMenuOpen) {
              event.stopPropagation();
              close();
              utilityTriggerRef.current?.focus();
            }
          }}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) close();
          }}
        >
          <button
            type="button"
            ref={utilityTriggerRef}
            aria-expanded={isUtilityMenuOpen}
            aria-controls={isUtilityMenuOpen ? utilityPanelId : undefined}
            onClick={toggle}
            aria-label="Abrir módulos utilitarios"
            data-testid="navbar-utility-menu-button"
            className={clsx(
              'flex items-center justify-center gap-1.5 min-w-8 h-8 px-2 rounded-lg transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none',
              isUtilityActive || currentModule === 'CUDYR'
                ? 'bg-white/[0.16] text-white ring-1 ring-white/20 shadow-sm shadow-black/10'
                : 'text-white/85 hover:bg-white/[0.08] hover:text-white'
            )}
            title="Más módulos"
          >
            <LayoutGrid size={16} aria-hidden="true" />
            <span className="hidden md:inline text-[13px] font-medium">Más</span>
          </button>

          {/* Dropdown Menu */}
          {isUtilityMenuOpen && (
            <div
              id={utilityPanelId}
              data-testid="navbar-utility-menu"
              className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl ring-1 ring-black/[0.04] border border-slate-100 max-h-[calc(100vh-80px)] overflow-y-auto z-50"
            >
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
