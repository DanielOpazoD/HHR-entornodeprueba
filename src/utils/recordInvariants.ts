import { DailyRecord, DailyRecordPatch } from '@/types';
import { BEDS, EXTRA_BEDS } from '@/constants';
import { createEmptyPatient } from '@/services/factories/patientFactory';

export const normalizeDailyRecordInvariants = (
    record: DailyRecord
): { record: DailyRecord; patches: DailyRecordPatch } => {
    // 1. Create a shallow copy of the record and its beds to ensure purity
    const patches: DailyRecordPatch = {};
    const extraBedIds = new Set(EXTRA_BEDS.map(bed => bed.id));

    const updatedBeds = record.beds ? { ...record.beds } : {};
    let bedsModified = !record.beds;

    // 2. Ensure all standard beds exist
    BEDS.forEach((bed) => {
        if (!updatedBeds[bed.id]) {
            const empty = createEmptyPatient(bed.id);
            updatedBeds[bed.id] = empty;
            patches[`beds.${bed.id}`] = empty;
            bedsModified = true;
        }
    });

    // 3. Check and repair patient invariants (bedId consistency)
    Object.entries(updatedBeds).forEach(([bedId, patient]) => {
        if (!patient) return;

        let patientModified = false;
        const updatedPatient = { ...patient };

        if (updatedPatient.bedId !== bedId) {
            updatedPatient.bedId = bedId;
            patches[`beds.${bedId}.bedId`] = bedId;
            patientModified = true;
        }

        if (updatedPatient.clinicalCrib) {
            if (updatedPatient.clinicalCrib.bedId !== bedId) {
                updatedPatient.clinicalCrib = {
                    ...updatedPatient.clinicalCrib,
                    bedId: bedId
                };
                patches[`beds.${bedId}.clinicalCrib.bedId`] = bedId;
                patientModified = true;
            }
        }

        if (patientModified) {
            updatedBeds[bedId] = updatedPatient;
            bedsModified = true;
        }
    });

    // 4. Validate extra beds
    let updatedActiveExtraBeds = record.activeExtraBeds;
    let extraBedsModified = false;

    if (Array.isArray(record.activeExtraBeds)) {
        const filtered = record.activeExtraBeds.filter(id => extraBedIds.has(id));
        if (filtered.length !== record.activeExtraBeds.length) {
            updatedActiveExtraBeds = filtered;
            patches['activeExtraBeds'] = filtered;
            extraBedsModified = true;
        }
    } else if (record.activeExtraBeds) {
        updatedActiveExtraBeds = [];
        patches['activeExtraBeds'] = [];
        extraBedsModified = true;
    }

    // 5. Construct final record only if modifications occurred
    if (!bedsModified && !extraBedsModified) {
        return { record, patches };
    }

    return {
        record: {
            ...record,
            beds: updatedBeds,
            activeExtraBeds: updatedActiveExtraBeds
        },
        patches
    };
};
