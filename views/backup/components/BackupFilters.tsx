/**
 * Backup Filters Component
 * Filters for the backup files list
 */

import React from 'react';
import { Search } from 'lucide-react';
import { BackupFilters as FilterType, BackupFileType, BackupShiftType, BACKUP_TYPE_CONFIG, SHIFT_TYPE_CONFIG } from '@/types/backup';

interface BackupFiltersProps {
    filters: FilterType;
    onFiltersChange: (filters: FilterType) => void;
}

export const BackupFilters: React.FC<BackupFiltersProps> = ({
    filters,
    onFiltersChange
}) => {
    const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value as BackupFileType | '';
        onFiltersChange({
            ...filters,
            type: value || undefined
        });
    };

    const handleShiftChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value as BackupShiftType | '';
        onFiltersChange({
            ...filters,
            shiftType: value || undefined
        });
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onFiltersChange({
            ...filters,
            searchQuery: e.target.value || undefined
        });
    };

    const clearFilters = () => {
        onFiltersChange({});
    };

    const hasActiveFilters = filters.type || filters.shiftType || filters.searchQuery;

    return (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
            <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar por fecha, enfermera..."
                        value={filters.searchQuery || ''}
                        onChange={handleSearchChange}
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>

                {/* Type filter */}
                <select
                    value={filters.type || ''}
                    onChange={handleTypeChange}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    <option value="">Todos los tipos</option>
                    {Object.entries(BACKUP_TYPE_CONFIG).map(([key, config]) => (
                        <option key={key} value={key}>
                            {config.icon} {config.label}
                        </option>
                    ))}
                </select>

                {/* Shift filter */}
                <select
                    value={filters.shiftType || ''}
                    onChange={handleShiftChange}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    <option value="">Todos los turnos</option>
                    {Object.entries(SHIFT_TYPE_CONFIG).map(([key, config]) => (
                        <option key={key} value={key}>
                            {config.label}
                        </option>
                    ))}
                </select>

                {/* Clear filters */}
                {hasActiveFilters && (
                    <button
                        onClick={clearFilters}
                        className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        Limpiar filtros
                    </button>
                )}
            </div>
        </div>
    );
};
