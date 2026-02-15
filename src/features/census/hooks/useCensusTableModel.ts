import { useCallback, useMemo } from 'react';
import { BEDS } from '@/constants';
import { TableColumnConfig } from '@/context/TableConfigContext';
import { getTodayISO } from '@/utils/dateUtils';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';
import {
    buildCensusBedRows,
    buildVisibleBeds,
    resolveVisibleBedTypes
} from '@/features/census/controllers/censusTableViewController';
import {
    executeResetDayController,
    resolveResetDayPermission
} from '@/features/census/controllers/censusResetDayController';
import type { BedTypesById, OccupiedBedRow } from '@/features/census/types/censusTableTypes';
import type { BedDefinition, PatientData } from '@/types';

interface UseCensusTableModelParams {
    currentDateString: string;
    role: string | undefined;
    beds: Record<string, PatientData> | null | undefined;
    activeExtraBeds: string[];
    overrides: Record<string, string> | null | undefined;
    columns: TableColumnConfig;
    resetDay: () => void;
    confirm: (descriptor: ControllerConfirmDescriptor) => Promise<boolean>;
    warning: (title: string, message: string) => void;
}

interface UseCensusTableModelResult {
    canDeleteRecord: boolean;
    resetDayDeniedMessage: string;
    occupiedRows: OccupiedBedRow[];
    emptyBeds: BedDefinition[];
    bedTypes: BedTypesById;
    totalWidth: number;
    handleClearAll: () => Promise<void>;
}

export const useCensusTableModel = ({
    currentDateString,
    role,
    beds,
    activeExtraBeds,
    overrides,
    columns,
    resetDay,
    confirm,
    warning
}: UseCensusTableModelParams): UseCensusTableModelResult => {
    const isToday = currentDateString === getTodayISO();

    const resetDayPermission = useMemo(() => {
        return resolveResetDayPermission({
            role,
            isToday
        });
    }, [isToday, role]);

    const visibleBeds = useMemo(() => {
        return buildVisibleBeds({
            allBeds: BEDS,
            activeExtraBeds
        });
    }, [activeExtraBeds]);

    const { occupiedRows, emptyBeds } = useMemo(() => {
        return buildCensusBedRows({
            visibleBeds,
            beds
        });
    }, [beds, visibleBeds]);

    const bedTypes = useMemo(() => {
        return resolveVisibleBedTypes({
            visibleBeds,
            overrides
        });
    }, [overrides, visibleBeds]);

    const totalWidth = useMemo(() => {
        return Object.values(columns).reduce((sum, width) => sum + width, 0);
    }, [columns]);

    const handleClearAll = useCallback(async () => {
        const result = await executeResetDayController(resetDayPermission, {
            warning,
            confirm,
            resetDay
        });

        if (!result.ok) {
            warning('No se pudo reiniciar', result.error.message);
        }
    }, [confirm, resetDay, resetDayPermission, warning]);

    return {
        canDeleteRecord: resetDayPermission.canDeleteRecord,
        resetDayDeniedMessage: resetDayPermission.denialMessage,
        occupiedRows,
        emptyBeds,
        bedTypes,
        totalWidth,
        handleClearAll
    };
};
