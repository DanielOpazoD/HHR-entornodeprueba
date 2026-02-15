import { AuditLogEntry } from '@/types/audit';

export interface ClinicalData {
    bedHistory: { bedId: string; from: Date; to: Date | null; days: number }[];
    totalUpcDays: number;
    diagnosisHistory: { date: Date; pathology: string }[];
    devicesHistory: { date: Date; name: string; action: 'INSTALL' | 'REMOVE'; details: string }[];
    firstAdmission?: string;
    lastDischarge?: string;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const toDate = (value: string): Date => new Date(value);

const getPathology = (details: AuditLogEntry['details']): string | undefined => {
    const directPathology = details.pathology;
    if (typeof directPathology === 'string' && directPathology.length > 0) {
        return directPathology;
    }

    const changes = details.changes;
    if (!isRecord(changes)) return undefined;

    const pathologyChange = changes.pathology;
    if (!isRecord(pathologyChange)) return undefined;

    const newValue = pathologyChange.new;
    return typeof newValue === 'string' && newValue.length > 0 ? newValue : undefined;
};

const getUpcChange = (details: AuditLogEntry['details']): boolean | undefined => {
    const changes = details.changes;
    if (isRecord(changes)) {
        const isUpc = changes.isUPC;
        if (isRecord(isUpc) && typeof isUpc.new === 'boolean') {
            return isUpc.new;
        }

        const clinicalFlagIsUpc = changes['clinicalFlags.isUPC'];
        if (isRecord(clinicalFlagIsUpc) && typeof clinicalFlagIsUpc.new === 'boolean') {
            return clinicalFlagIsUpc.new;
        }
    }

    return typeof details.isUPC === 'boolean' ? details.isUPC : undefined;
};

type DeviceChange = { name: string; newValue: unknown };

const getDeviceChanges = (details: AuditLogEntry['details']): DeviceChange[] => {
    const changes = details.changes;
    if (!isRecord(changes)) return [];

    const deviceDetails = changes.deviceDetails;
    if (!isRecord(deviceDetails)) return [];

    return Object.entries(deviceDetails).flatMap(([name, delta]) => {
        if (!isRecord(delta)) return [];
        return [{ name, newValue: delta.new }];
    });
};

const getInstallationDetails = (newValue: unknown): string => {
    if (!isRecord(newValue)) return 'Retirado';
    const installationDate = newValue.installationDate;
    if (typeof installationDate === 'string' && installationDate.length > 0) {
        return `Instalado el ${installationDate}`;
    }
    return 'Retirado';
};

const computeDays = (from: Date, to: Date): number =>
    Math.max(1, Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY));

export const buildClinicalData = (
    searchRut: string,
    chronologicalLogs: AuditLogEntry[],
    admissions: AuditLogEntry[],
    discharges: AuditLogEntry[]
): ClinicalData => {
    if (!searchRut || chronologicalLogs.length === 0) {
        return {
            bedHistory: [],
            totalUpcDays: 0,
            diagnosisHistory: [],
            devicesHistory: [],
            firstAdmission: undefined,
            lastDischarge: undefined,
        };
    }

    const bedHistory: ClinicalData['bedHistory'] = [];
    const diagnosisHistory: ClinicalData['diagnosisHistory'] = [];
    const devicesHistory: ClinicalData['devicesHistory'] = [];
    let totalUpcMs = 0;

    let currentBed: string | null = null;
    let lastBedChange: Date | null = null;
    let isCurrentlyUpc = false;
    let lastUpcChange: Date | null = null;

    for (const log of chronologicalLogs) {
        const timestamp = toDate(log.timestamp);
        const details = log.details;

        const bedId = details.bedId;
        if (bedId && bedId !== currentBed) {
            if (currentBed && lastBedChange) {
                bedHistory.push({
                    bedId: currentBed,
                    from: lastBedChange,
                    to: timestamp,
                    days: computeDays(lastBedChange, timestamp),
                });
            }
            currentBed = bedId;
            lastBedChange = timestamp;
        }

        const upcChange = getUpcChange(details);
        if (upcChange !== undefined && upcChange !== isCurrentlyUpc) {
            if (isCurrentlyUpc && lastUpcChange) {
                totalUpcMs += timestamp.getTime() - lastUpcChange.getTime();
            }
            isCurrentlyUpc = upcChange;
            lastUpcChange = timestamp;
        }

        const pathology = getPathology(details);
        if (pathology) {
            diagnosisHistory.push({ date: timestamp, pathology });
        }

        for (const deviceChange of getDeviceChanges(details)) {
            devicesHistory.push({
                date: timestamp,
                name: deviceChange.name,
                action: deviceChange.newValue ? 'INSTALL' : 'REMOVE',
                details: getInstallationDetails(deviceChange.newValue),
            });
        }
    }

    const lastDischarge = discharges[discharges.length - 1];
    const closingDate = lastDischarge ? toDate(lastDischarge.timestamp) : new Date();

    if (currentBed && lastBedChange) {
        bedHistory.push({
            bedId: currentBed,
            from: lastBedChange,
            to: lastDischarge ? closingDate : null,
            days: computeDays(lastBedChange, closingDate),
        });
    }

    if (isCurrentlyUpc && lastUpcChange) {
        totalUpcMs += closingDate.getTime() - lastUpcChange.getTime();
    }

    return {
        bedHistory: bedHistory.reverse(),
        totalUpcDays: Math.ceil(totalUpcMs / MS_PER_DAY),
        diagnosisHistory: diagnosisHistory.reverse(),
        devicesHistory: devicesHistory.reverse(),
        firstAdmission: admissions[0]?.timestamp,
        lastDischarge: lastDischarge?.timestamp,
    };
};
