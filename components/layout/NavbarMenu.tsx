/**
 * NavbarMenu - Brand dropdown menu component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React from 'react';
import { LayoutList, BarChart2, FileJson, Upload, Settings, ShieldCheck, MessageSquare, FileSpreadsheet, ChevronDown, LucideIcon, Bug, Activity } from 'lucide-react';
import clsx from 'clsx';
import { ModuleType } from './Navbar';

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
    isOpen: boolean;
    onToggle: () => void;
    onClose: () => void;
    // Module actions
    currentModule: ModuleType;
    setModule: (mod: ModuleType) => void;
    censusViewMode: 'REGISTER' | 'ANALYTICS';
    setCensusViewMode: (mode: 'REGISTER' | 'ANALYTICS') => void;
    // File actions
    onExportJSON: () => void;
    onImportClick: () => void;
    onOpenSettings: () => void;
    isUserAdmin: boolean;
    visibleModules: readonly ModuleType[];
    disabled?: boolean;
}

export const NavbarMenu: React.FC<NavbarMenuProps> = ({
    isOpen,
    onToggle,
    onClose,
    currentModule,
    setModule,
    censusViewMode,
    setCensusViewMode,
    onExportJSON,
    onImportClick,
    onOpenSettings,
    isUserAdmin,
    visibleModules,
    disabled = false
}) => {
    const handleModuleChange = (mod: ModuleType) => {
        setModule(mod);
        onClose();
    };

    return (
        <div className="relative">
            <button
                onClick={disabled ? undefined : onToggle}
                className={clsx(
                    "flex items-center gap-3 py-2 px-3 rounded-xl transition-all duration-200",
                    !disabled && "hover:bg-white/10"
                )}
                disabled={disabled}
            >
                <div className="bg-white p-1.5 rounded-xl shadow-sm">
                    <img
                        src="/images/logos/logo_HHR.png"
                        alt="HHR"
                        className="w-7 h-7 object-contain"
                    />
                </div>
                <div className="text-left">
                    <h1 className="text-lg font-display font-bold leading-tight tracking-tight">Hospital Hanga Roa</h1>
                    <p className="text-[10px] font-bold text-red-300 uppercase tracking-[0.2em]">{disabled ? 'Censo Compartido' : 'MODO PRUEBA'}</p>
                </div>
                {!disabled && <ChevronDown size={16} className={clsx("text-white/50 transition-transform ml-1", isOpen && "rotate-180")} />}
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={onClose}
                    />

                    {/* Menu */}
                    <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden">
                        <div className="py-1">
                            <MenuItem
                                icon={BarChart2}
                                label="Estadística"
                                onClick={() => {
                                    if (currentModule !== 'CENSUS') {
                                        setModule('CENSUS');
                                        setCensusViewMode('ANALYTICS');
                                    } else {
                                        setCensusViewMode(censusViewMode === 'ANALYTICS' ? 'REGISTER' : 'ANALYTICS');
                                    }
                                    onClose();
                                }}
                            />


                            {isUserAdmin && (
                                <>
                                    <div className="h-px bg-slate-200 my-1" />
                                    <MenuItem
                                        icon={FileJson}
                                        label="Exportar Respaldo (JSON)"
                                        onClick={() => { onExportJSON(); onClose(); }}
                                    />
                                    <MenuItem
                                        icon={Upload}
                                        label="Importar Respaldo"
                                        onClick={onImportClick}
                                    />
                                    <div className="h-px bg-slate-200 my-1" />
                                    <MenuItem
                                        icon={Settings}
                                        label="Configuración"
                                        onClick={() => { onOpenSettings(); onClose(); }}
                                    />
                                    <div className="h-px bg-slate-200 my-1" />
                                    <MenuItem
                                        icon={ShieldCheck}
                                        label="Auditoría"
                                        onClick={() => handleModuleChange('AUDIT')}
                                    />
                                    <MenuItem
                                        icon={MessageSquare}
                                        label="WhatsApp"
                                        onClick={() => handleModuleChange('WHATSAPP')}
                                    />
                                    <MenuItem
                                        icon={Bug}
                                        label="Monitor de Errores"
                                        onClick={() => handleModuleChange('ERRORS')}
                                    />
                                    <MenuItem
                                        icon={Activity}
                                        label="Dev Health"
                                        onClick={() => handleModuleChange('DEV_DASHBOARD')}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
