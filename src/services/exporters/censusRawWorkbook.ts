import type { Workbook } from 'exceljs';
import { DailyRecord, PatientData } from '@/types';
import { BEDS } from '@/constants';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import { createWorkbook } from './excelUtils';
import { getBedTypeForRecord } from '../../utils/bedTypeUtils';

const getRawHeader = () => [
    'FECHA', 'CAMA', 'TIPO_CAMA', 'UBICACION', 'MODO_CAMA', 'TIENE_ACOMPANANTE',
    'BLOQUEADA', 'MOTIVO_BLOQUEO',
    'PACIENTE', 'RUT', 'EDAD', 'SEXO', 'PREVISION', 'ORIGEN', 'ORIGEN_INGRESO', 'ES_RAPANUI',
    'DIAGNOSTICO', 'ESPECIALIDAD', 'ESTADO', 'FECHA_INGRESO',
    'BRAZALETE', 'DISPOSITIVOS', 'COMP_QUIRURGICA', 'UPC',
    'ENFERMEROS', 'ULTIMA_ACTUALIZACION'
];

const generateRawRow = (
    date: string,
    bedId: string,
    bedType: string,
    p: PatientData,
    nurses: string[],
    lastUpdated: string,
    locationOverride?: string
) => {
    return [
        date,
        bedId,
        bedType,
        locationOverride || p.location || '',
        p.bedMode || 'Cama',
        p.hasCompanionCrib ? 'SI' : 'NO',
        p.isBlocked ? 'SI' : 'NO',
        p.blockedReason || '',
        p.patientName || '',
        p.rut || '',
        p.age || '',
        p.biologicalSex || '',
        p.insurance || '',
        p.origin || '',
        p.admissionOrigin || '',
        p.isRapanui ? 'SI' : 'NO',
        p.pathology || '',
        p.specialty || '',
        p.status || '',
        formatDateDDMMYYYY(p.admissionDate),
        p.hasWristband ? 'SI' : 'NO',
        p.devices?.join(', ') || '',
        p.surgicalComplication ? 'SI' : 'NO',
        p.isUPC ? 'SI' : 'NO',
        nurses.join(' & '),
        new Date(lastUpdated).toLocaleString()
    ];
};

/** Type for a single row of census data */
type CensusRawRow = (string | boolean | number)[];

export const extractRowsFromRecord = (record: DailyRecord): CensusRawRow[] => {
    const rows: CensusRawRow[] = [];
    const nurses = record.nurses || (record.nurseName ? [record.nurseName] : []);
    const date = record.date;
    const activeExtras = record.activeExtraBeds || [];

    BEDS.forEach(bed => {
        if (bed.isExtra && !activeExtras.includes(bed.id)) return;

        const p = record.beds[bed.id];
        if (!p) return;

        const isOccupied = p.patientName && p.patientName.trim() !== '';
        const isBlocked = p.isBlocked;
        const hasClinicalCrib = p.clinicalCrib && p.clinicalCrib.patientName;

        const realBedType = getBedTypeForRecord(bed, record);

        if (isOccupied || isBlocked) {
            rows.push(generateRawRow(date, bed.id, realBedType, p, nurses, record.lastUpdated));
        }

        if (hasClinicalCrib && p.clinicalCrib) {
            rows.push(generateRawRow(
                date,
                bed.id + '-C',
                'Cuna',
                p.clinicalCrib,
                nurses,
                record.lastUpdated,
                p.location
            ));
        }
    });

    return rows;
};

export const buildCensusDailyRawWorkbook = async (record: DailyRecord): Promise<Workbook> => {
    const workbook = await createWorkbook();
    const sheet = workbook.addWorksheet('Censo Diario');

    sheet.addRow(getRawHeader());

    const rows = extractRowsFromRecord(record);
    rows.forEach(r => sheet.addRow(r));

    sheet.columns.forEach(column => {
        column.width = 20;
    });

    return workbook;
};

export const buildCensusDailyRawBuffer = async (record: DailyRecord) => {
    const workbook = await buildCensusDailyRawWorkbook(record);
    return workbook.xlsx.writeBuffer();
};

export const getCensusRawHeader = getRawHeader;
