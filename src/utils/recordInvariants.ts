import { DailyRecord, DailyRecordPatch, PatientData } from '@/types';
import { BEDS, EXTRA_BEDS } from '@/constants';
import { createEmptyPatient } from '@/services/factories/patientFactory';

export const normalizeDailyRecordInvariants = (
    record: DailyRecord
): { record: DailyRecord; patches: DailyRecordPatch } => {
    const patches: DailyRecordPatch = {};
    const extraBedIds = new Set(EXTRA_BEDS.map(bed => bed.id));

    if (!record.beds) {
        record.beds = {};
    }

    BEDS.forEach((bed) => {
        if (!record.beds[bed.id]) {
            const empty = createEmptyPatient(bed.id);
            record.beds[bed.id] = empty;
            patches[`beds.${bed.id}`] = empty;
        }
    });

    Object.entries(record.beds).forEach(([bedId, patient]) => {
        if (!patient) return;
        if (patient.bedId !== bedId) {
            patient.bedId = bedId;
            patches[`beds.${bedId}.bedId`] = bedId;
        }
        if (patient.clinicalCrib) {
            const crib = patient.clinicalCrib as PatientData;
            if (crib.bedId !== bedId) {
                crib.bedId = bedId;
                patches[`beds.${bedId}.clinicalCrib.bedId`] = bedId;
            }
        }
    });

    if (Array.isArray(record.activeExtraBeds)) {
        const filtered = record.activeExtraBeds.filter(id => extraBedIds.has(id));
        if (filtered.length !== record.activeExtraBeds.length) {
            record.activeExtraBeds = filtered;
            patches['activeExtraBeds'] = filtered;
        }
    } else if (record.activeExtraBeds) {
        record.activeExtraBeds = [];
        patches['activeExtraBeds'] = [];
    }

    return { record, patches };
};
