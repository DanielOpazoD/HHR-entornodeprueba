import type { DischargeData, TransferData } from '@/types';

export interface StaffSelectorsState {
    nursesDayShift: string[];
    nursesNightShift: string[];
    tensDayShift: string[];
    tensNightShift: string[];
}

export interface MovementSummaryState {
    discharges: DischargeData[];
    transfers: TransferData[];
    cmaCount: number;
}

interface StaffInput {
    nursesDayShift?: string[] | null;
    nursesNightShift?: string[] | null;
    tensDayShift?: string[] | null;
    tensNightShift?: string[] | null;
}

interface MovementsInput {
    discharges?: DischargeData[] | null;
    transfers?: TransferData[] | null;
    cma?: Array<{ id: string }> | null;
}

const ensureStringArray = (value?: string[] | null): string[] =>
    Array.isArray(value) ? value : [];

export const resolveStaffSelectorsState = (input?: StaffInput | null): StaffSelectorsState => ({
    nursesDayShift: ensureStringArray(input?.nursesDayShift),
    nursesNightShift: ensureStringArray(input?.nursesNightShift),
    tensDayShift: ensureStringArray(input?.tensDayShift),
    tensNightShift: ensureStringArray(input?.tensNightShift)
});

export const resolveMovementSummaryState = (input?: MovementsInput | null): MovementSummaryState => ({
    discharges: input?.discharges || [],
    transfers: input?.transfers || [],
    cmaCount: input?.cma?.length || 0
});

export const resolveStaffSelectorsClassName = (readOnly: boolean): string =>
    readOnly ? 'pointer-events-none opacity-80' : '';
