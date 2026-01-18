

import { DailyRecord, PatientData } from '../../types';
import { BEDS, CSV_HEADERS } from '../../constants';
import { formatDateDDMMYYYY } from '../dataService';
import { validateBackupData } from '../../schemas';
import { getAllRecords, saveRecord } from '../storage/indexedDBService';

export const exportDataJSON = async () => {
    const data = await getAllRecords();
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `hanga_roa_respaldo_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const exportDataCSV = (record: DailyRecord | null) => {
    if (!record) return;

    const rows = [CSV_HEADERS.join(',')]; // Header row

    // Helper to generate a row string
    const generateRow = (bedId: string, bedName: string, bedType: string, p: PatientData, locationOverride?: string) => {
        const escape = (val: unknown): string => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        let nurseField = '';
        if (record.nurses && Array.isArray(record.nurses)) {
            nurseField = record.nurses.filter(n => n).join(' & ');
        } else if (record.nurseName) {
            nurseField = record.nurseName;
        }

        return [
            escape(bedId),                                          // ID Cama
            escape(bedName),                                        // Nombre Cama
            escape(locationOverride || p.location || ''),           // Ubicación
            escape(bedType),                                        // Tipo Cama
            escape(p.bedMode || 'Cama'),                            // Mobiliario
            escape(p.hasCompanionCrib ? 'SI' : 'NO'),               // Cuna RN Sano
            escape(p.isBlocked ? 'SI' : 'NO'),                      // Bloqueada
            escape(p.blockedReason || ''),                          // Motivo Bloqueo
            escape(p.patientName),                                  // Paciente
            escape(p.documentType || 'RUT'),                        // Tipo Doc
            escape(p.rut),                                          // RUT/Pasaporte
            escape(formatDateDDMMYYYY(p.birthDate)),                // F. Nacimiento
            escape(p.age),                                          // Edad
            escape(p.biologicalSex || ''),                          // Sexo
            escape(p.insurance || ''),                              // Previsión
            escape(p.admissionOrigin || ''),                        // Origen Ingreso
            escape(p.admissionOriginDetails || ''),                 // Detalle Origen
            escape(p.origin || ''),                                 // Cond. Permanencia
            escape(p.isRapanui ? 'SI' : 'NO'),                      // Rapanui
            escape(p.pathology),                                    // Diagnóstico
            escape(p.diagnosisComments || ''),                      // Comentarios Dx
            escape(p.specialty),                                    // Especialidad
            escape(p.status),                                       // Estado
            escape(formatDateDDMMYYYY(p.admissionDate)),            // F. Ingreso
            escape(p.hasWristband ? 'SI' : 'NO'),                   // Brazalete
            escape(p.devices.join('|')),                            // Dispositivos
            escape(formatDateDDMMYYYY(p.deviceDetails?.CUP?.installationDate)),  // CUP F.Instalación
            escape(formatDateDDMMYYYY(p.deviceDetails?.CUP?.removalDate)),       // CUP F.Retiro
            escape(formatDateDDMMYYYY(p.deviceDetails?.CVC?.installationDate)),  // CVC F.Instalación
            escape(formatDateDDMMYYYY(p.deviceDetails?.CVC?.removalDate)),       // CVC F.Retiro
            escape(formatDateDDMMYYYY(p.deviceDetails?.VMI?.installationDate)),  // VMI F.Inicio
            escape(formatDateDDMMYYYY(p.deviceDetails?.VMI?.removalDate)),       // VMI F.Término
            escape(p.surgicalComplication ? 'SI' : 'NO'),           // Comp. Qx
            escape(p.isUPC ? 'SI' : 'NO'),                          // UPC
            escape(p.handoffNote || ''),                            // Nota Entrega
            escape(nurseField)                                      // Enfermero/a
        ].join(',');
    };

    // 1. Beds 
    BEDS.forEach(bed => {
        const p = record.beds[bed.id];

        // Skip completely empty beds (unless blocked)
        const isMainOccupied = p.patientName && p.patientName.trim() !== '';
        const isClinicalCribOccupied = p.clinicalCrib && p.clinicalCrib.patientName;

        if (!p.isBlocked && !isMainOccupied && !isClinicalCribOccupied) {
            return;
        }

        // Export Main Patient
        if (p.isBlocked || isMainOccupied) {
            rows.push(generateRow(bed.id, bed.name, bed.type, p));
        }

        // Export Clinical Crib (Baby) if exists
        if (p.clinicalCrib && p.clinicalCrib.patientName) {
            // Note: We use the same Bed ID/Name but maybe append suffix or note type
            rows.push(generateRow(
                bed.id + '-C',
                bed.name + ' (Cuna Clínica)',
                'Cuna',
                p.clinicalCrib,
                p.location
            ));
        }
    });

    // 2. Discharges
    if (record.discharges && record.discharges.length > 0) {
        rows.push(`\n--- ALTAS ---`);
        rows.push("Cama,Tipo,Paciente,RUT,Diagnóstico,Estado,Edad,Previsión");
        record.discharges.forEach(d => {
            const escape = (val: unknown): string => val ? `"${String(val).replace(/"/g, '""')}"` : '';
            rows.push(`${d.bedName},${d.bedType},${escape(d.patientName)},${d.rut},${escape(d.diagnosis)},${d.status},${d.age || ''},${d.insurance || ''}`);
        });
    }

    // 3. Transfers
    if (record.transfers && record.transfers.length > 0) {
        rows.push(`\n--- TRASLADOS ---`);
        rows.push("Cama,Tipo,Paciente,RUT,Diagnóstico,Medio,Centro,Acompañante,Edad,Previsión");
        record.transfers.forEach(t => {
            const escape = (val: unknown): string => val ? `"${String(val).replace(/"/g, '""')}"` : '';
            const center = t.receivingCenter === 'Otro' ? t.receivingCenterOther : t.receivingCenter;
            rows.push(`${t.bedName},${t.bedType},${escape(t.patientName)},${t.rut},${escape(t.diagnosis)},${t.evacuationMethod},${escape(center)},${escape(t.transferEscort)},${t.age || ''},${t.insurance || ''}`);
        });
    }

    const csvString = rows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `Censo_HangaRoa_${record.date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const importDataJSON = async (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const data = JSON.parse(text);

                // Validate Schema with Zod using helper
                const validation = validateBackupData(data);

                if (!validation.success) {
                    console.error("Validation Errors:", validation.errors);
                    alert(`El archivo JSON no cumple con el formato requerido:\n${validation.errors?.slice(0, 5).join('\n')}`);
                    resolve(false);
                    return;
                }

                // Import each record to IndexedDB
                const records = Object.values(validation.data as Record<string, DailyRecord>);
                const promises = records.map(record => saveRecord(record));

                Promise.all(promises).then(() => {
                    console.log(`✅ Imported ${records.length} records to IndexedDB`);
                    resolve(true);
                }).catch(err => {
                    console.error("Import failed in DB stage", err);
                    resolve(false);
                });
            } catch (err) {
                console.error("Import failed", err);
                alert("Error al procesar el archivo JSON.");
                resolve(false);
            }
        };
        reader.onerror = () => resolve(false);
        reader.readAsText(file);
    });
};

export const importDataCSV = async (file: File): Promise<boolean> => {
    console.warn("CSV Import not fully implemented. Use JSON.");
    return Promise.resolve(false);
};