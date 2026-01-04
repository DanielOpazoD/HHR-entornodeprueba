/**
 * NavbarTabs - Main navigation tabs component
 * Extracted from Navbar.tsx for better maintainability.
 */

import React from 'react';
import { LayoutList, ClipboardList, MessageSquare, Stethoscope, Truck, FolderArchive, LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ModuleType } from './Navbar';

interface NavTabProps {
    module: ModuleType;
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

interface NavbarTabsProps {
    currentModule: ModuleType;
    onModuleChange: (mod: ModuleType) => void;
    visibleModules: readonly ModuleType[];
}

export const NavbarTabs: React.FC<NavbarTabsProps> = ({
    currentModule,
    onModuleChange,
    visibleModules
}) => {
    return (
        <div className="flex gap-1 self-end">
            {visibleModules.includes('CENSUS') && (
                <NavTab
                    module="CENSUS"
                    label="Censo Diario"
                    icon={LayoutList}
                    isActive={currentModule === 'CENSUS'}
                    onClick={() => onModuleChange('CENSUS')}
                />
            )}
            {visibleModules.includes('NURSING_HANDOFF') && (
                <NavTab
                    module="NURSING_HANDOFF"
                    label="Entrega Turno Enfermería"
                    icon={MessageSquare}
                    isActive={currentModule === 'NURSING_HANDOFF'}
                    onClick={() => onModuleChange('NURSING_HANDOFF')}
                />
            )}
            {visibleModules.includes('MEDICAL_HANDOFF') && (
                <NavTab
                    module="MEDICAL_HANDOFF"
                    label="Entrega Turno Médicos"
                    icon={Stethoscope}
                    isActive={currentModule === 'MEDICAL_HANDOFF'}
                    onClick={() => onModuleChange('MEDICAL_HANDOFF')}
                />
            )}
            {visibleModules.includes('TRANSFER_MANAGEMENT') && (
                <NavTab
                    module="TRANSFER_MANAGEMENT"
                    label="Gestión Traslados"
                    icon={Truck}
                    isActive={currentModule === 'TRANSFER_MANAGEMENT'}
                    onClick={() => onModuleChange('TRANSFER_MANAGEMENT')}
                />
            )}
            {visibleModules.includes('BACKUP_FILES') && (
                <NavTab
                    module="BACKUP_FILES"
                    label="Archivos"
                    icon={FolderArchive}
                    isActive={currentModule === 'BACKUP_FILES'}
                    onClick={() => onModuleChange('BACKUP_FILES')}
                />
            )}
        </div>
    );
};
