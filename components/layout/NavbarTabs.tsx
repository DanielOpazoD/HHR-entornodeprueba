/**
 * NavbarTabs - Main navigation tabs component
 * Clinical modules shown as tabs, utility modules in dropdown.
 */

import React, { useState, useRef, useEffect } from 'react';
import { LayoutList, MessageSquare, Stethoscope, Truck, FolderArchive, LayoutGrid, BarChart3, LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ModuleType } from './Navbar';

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
            "flex items-center gap-2 px-4 py-3 border-b-2 transition-all duration-300 font-medium text-sm tracking-tight",
            isActive
                ? "border-white text-white drop-shadow-sm scale-105"
                : "border-transparent text-medical-200 hover:text-white hover:border-medical-400"
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

const DropdownItem: React.FC<DropdownItemProps> = ({ label, icon: Icon, isActive, onClick, disabled }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={clsx(
            "flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium transition-all",
            disabled
                ? "text-slate-400 cursor-not-allowed"
                : isActive
                    ? "text-medical-600 bg-medical-50"
                    : "text-slate-700 hover:bg-slate-50"
        )}
    >
        <Icon size={18} className={disabled ? "text-slate-300" : ""} />
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
    setCensusViewMode
}) => {
    const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsUtilityMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const isUtilityModuleActive = currentModule === 'BACKUP_FILES' || (currentModule === 'CENSUS' && censusViewMode === 'ANALYTICS');
    const hasUtilityModules = true; // Always show utility menu now as it contains Statistics

    return (
        <div className="flex gap-1 self-end items-center">
            {/* Clinical Modules - Prominent tabs */}
            {visibleModules.includes('CENSUS') && (
                <NavTab
                    label="Censo Diario"
                    icon={LayoutList}
                    isActive={currentModule === 'CENSUS'}
                    onClick={() => onModuleChange('CENSUS')}
                />
            )}
            {visibleModules.includes('NURSING_HANDOFF') && (
                <NavTab
                    label="Entrega Turno Enfermería"
                    icon={MessageSquare}
                    isActive={currentModule === 'NURSING_HANDOFF'}
                    onClick={() => onModuleChange('NURSING_HANDOFF')}
                />
            )}
            {visibleModules.includes('MEDICAL_HANDOFF') && (
                <NavTab
                    label="Entrega Turno Médicos"
                    icon={Stethoscope}
                    isActive={currentModule === 'MEDICAL_HANDOFF'}
                    onClick={() => onModuleChange('MEDICAL_HANDOFF')}
                />
            )}
            {visibleModules.includes('TRANSFER_MANAGEMENT') && (
                <NavTab
                    label="Gestión Traslados"
                    icon={Truck}
                    isActive={currentModule === 'TRANSFER_MANAGEMENT'}
                    onClick={() => onModuleChange('TRANSFER_MANAGEMENT')}
                />
            )}

            {/* Utility Modules Dropdown - Subtle icon */}
            {hasUtilityModules && (
                <div className="relative ml-2" ref={menuRef}>
                    <button
                        onClick={() => setIsUtilityMenuOpen(!isUtilityMenuOpen)}
                        className={clsx(
                            "flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200",
                            isUtilityModuleActive
                                ? "bg-white/20 text-white ring-2 ring-white/30"
                                : "text-medical-200 hover:bg-white/10 hover:text-white"
                        )}
                        title="Más módulos"
                    >
                        <LayoutGrid size={20} />
                    </button>

                    {/* Dropdown Menu */}
                    {isUtilityMenuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="py-1">
                                <DropdownItem
                                    label="Estadística"
                                    icon={BarChart3}
                                    isActive={currentModule === 'CENSUS' && censusViewMode === 'ANALYTICS'}
                                    onClick={() => {
                                        if (currentModule !== 'CENSUS') {
                                            onModuleChange('CENSUS');
                                            // Handle the specific order so it stays in ANALYTICS
                                            setTimeout(() => setCensusViewMode('ANALYTICS'), 0);
                                        } else {
                                            setCensusViewMode(censusViewMode === 'ANALYTICS' ? 'REGISTER' : 'ANALYTICS');
                                        }
                                        setIsUtilityMenuOpen(false);
                                    }}
                                />
                                {visibleModules.includes('BACKUP_FILES') && (
                                    <DropdownItem
                                        label="Archivos"
                                        icon={FolderArchive}
                                        isActive={currentModule === 'BACKUP_FILES'}
                                        onClick={() => {
                                            onModuleChange('BACKUP_FILES');
                                            setIsUtilityMenuOpen(false);
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
