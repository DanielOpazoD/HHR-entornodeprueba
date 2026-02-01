import { useState, useCallback } from 'react';
import { DailyRecordRepository } from '@/services/repositories/DailyRecordRepository';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { MasterPatient, DailyRecordPatch } from '@/types';
import { formatRut, isValidRut } from '@/utils/rutUtils';

export interface Conflict {
    rut: string;
    description: string;
    options: string[]; // List of different names found for this RUT
    records: string[]; // List of dates
    bedMap: Record<string, string>; // Mapping of date -> bedId for historical correction
}

export interface AnalysisResult {
    totalRecords: number;
    uniquePatients: number;
    validPatients: MasterPatient[];
    conflicts: Conflict[];
}

export const usePatientAnalysis = () => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);
    const [isHarmonizing, setIsHarmonizing] = useState(false);
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [migrationResult, setMigrationResult] = useState<{ successes: number, errors: number } | null>(null);

    const resolveConflict = useCallback(async (rut: string, correctName: string, harmonizeHistory: boolean = false) => {
        if (!analysis) return;

        const conflict = analysis.conflicts.find(c => c.rut === rut);
        if (!conflict) return;

        if (harmonizeHistory) {
            setIsHarmonizing(true);
            try {
                const { logAuditEvent } = await import('@/services/admin/auditService');
                const { getCurrentUserEmail } = await import('@/services/admin/utils/auditUtils');

                // Correct each historical day
                for (const date of conflict.records) {
                    const bedId = conflict.bedMap[date];
                    if (!bedId) continue;

                    await DailyRecordRepository.updatePartial(date, {
                        [`beds.${bedId}.patientName`]: correctName
                    } as DailyRecordPatch);

                    // Audit the correction
                    await logAuditEvent(
                        getCurrentUserEmail(),
                        'PATIENT_HARMONIZED',
                        'dailyRecord',
                        date,
                        {
                            rut,
                            correctName,
                            previousName: conflict.options.filter(o => o !== correctName).join(', '),
                            bedId,
                            automated: true
                        },
                        rut,
                        date
                    );
                }
            } catch (error) {
                console.error("Harmonization failed", error);
            } finally {
                setIsHarmonizing(false);
            }
        }

        setAnalysis(prev => {
            if (!prev) return null;

            // 1. Update the patient record in the validPatients list
            const updatedPatients = prev.validPatients.map(p => {
                if (p.rut === rut) {
                    return { ...p, fullName: correctName, updatedAt: Date.now() };
                }
                return p;
            });

            // 2. Remove the conflict from the list
            const updatedConflicts = prev.conflicts.filter(c => c.rut !== rut);

            return {
                ...prev,
                validPatients: updatedPatients,
                conflicts: updatedConflicts
            };
        });
    }, [analysis]);

    const runAnalysis = useCallback(async () => {
        setIsAnalyzing(true);
        setAnalysis(null);
        setMigrationResult(null);

        try {
            const dates = await DailyRecordRepository.getAllDates();
            const sortedDates = [...dates].sort();

            const patientsMap = new Map<string, MasterPatient>();
            const conflicts: Conflict[] = [];

            // Temporary map to track active events per RUT during the scan
            // Key: RUT, Value: Current Open Event
            const activeEvents = new Map<string, {
                startDate: string;
                lastSeen: string;
                bedId: string;
                diagnosis: string;
            }>();

            for (const date of sortedDates) {
                const record = await DailyRecordRepository.getForDate(date);
                if (!record) continue;

                // 1. Process active beds to detect admissions and ongoing stays
                const bedsWithPatients = Object.entries(record.beds).filter(([_, p]) =>
                    p.rut && isValidRut(p.rut) && p.patientName
                );

                const rutsInCensusToday = new Set<string>();

                for (const [bedId, p] of bedsWithPatients) {
                    const normalizedRut = formatRut(p.rut).toUpperCase();
                    rutsInCensusToday.add(normalizedRut);

                    let master = patientsMap.get(normalizedRut);

                    if (!master) {
                        master = {
                            rut: normalizedRut,
                            fullName: p.patientName,
                            birthDate: p.birthDate,
                            forecast: p.insurance,
                            gender: p.biologicalSex,
                            hospitalizations: [],
                            vitalStatus: 'Vivo',
                            lastAdmission: p.admissionDate || date,
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        };
                        patientsMap.set(normalizedRut, master);
                    }

                    // Conflict check (Names) - Only if truly different (not just case/space)
                    if (master.fullName.trim().toLowerCase() !== p.patientName.trim().toLowerCase()) {
                        const existingConflict = conflicts.find(c => c.rut === normalizedRut);
                        if (!existingConflict) {
                            conflicts.push({
                                rut: normalizedRut,
                                description: `Diferencia de nombres detectada`,
                                options: Array.from(new Set([master.fullName, p.patientName])),
                                records: [date],
                                bedMap: { [date]: bedId }
                            });
                        } else {
                            if (!existingConflict.records.includes(date)) {
                                existingConflict.records.push(date);
                            }
                            if (!existingConflict.options.includes(p.patientName)) {
                                existingConflict.options.push(p.patientName);
                            }
                            existingConflict.bedMap[date] = bedId;
                        }
                    }

                    // Event Tracking: Check if this is a new event or an extension
                    const active = activeEvents.get(normalizedRut);
                    if (!active) {
                        // NEW EVENT START detected by presence
                        activeEvents.set(normalizedRut, {
                            startDate: p.admissionDate || date,
                            lastSeen: date,
                            bedId,
                            diagnosis: p.pathology || 'Ingreso detected by presence'
                        });

                        master.hospitalizations?.push({
                            id: `${date}-ingreso-auto`,
                            type: 'Ingreso',
                            date: p.admissionDate || date,
                            diagnosis: p.pathology || 'Ingreso detectado',
                            bedName: bedId
                        });
                        master.lastAdmission = p.admissionDate || date;
                    } else {
                        // Update last seen for existing event
                        active.lastSeen = date;
                    }
                }

                // 2. Process explicit discharges/transfers
                const dischargesToday = record.discharges || [];
                const transfersToday = record.transfers || [];

                for (const d of dischargesToday) {
                    if (!d.rut || !isValidRut(d.rut)) continue;
                    const normalizedRut = formatRut(d.rut).toUpperCase();
                    const master = patientsMap.get(normalizedRut);
                    if (master) {
                        master.hospitalizations?.push({
                            id: `${date}-egreso`,
                            type: 'Egreso',
                            date: date,
                            diagnosis: d.diagnosis || 'S/D',
                            bedName: d.bedName
                        });
                        master.lastDischarge = date;
                        if (d.status === 'Fallecido') {
                            master.vitalStatus = 'Fallecido';
                            master.hospitalizations?.push({
                                id: `${date}-defuncion`,
                                type: 'Fallecimiento',
                                date: date,
                                diagnosis: d.diagnosis
                            });
                        }
                        // Explicitly end active event
                        activeEvents.delete(normalizedRut);
                    }
                }

                for (const t of transfersToday) {
                    if (!t.rut || !isValidRut(t.rut)) continue;
                    const normalizedRut = formatRut(t.rut).toUpperCase();
                    const master = patientsMap.get(normalizedRut);
                    if (master) {
                        master.hospitalizations?.push({
                            id: `${date}-traslado`,
                            type: 'Traslado',
                            date: date,
                            diagnosis: t.diagnosis || 'S/D',
                            bedName: t.bedName,
                            receivingCenter: t.receivingCenter
                        });
                        // Explicitly end active event
                        activeEvents.delete(normalizedRut);
                    }
                }

                // 3. Detect "Silent Discharges" (Gone from census today without explicit event)
                for (const [rut, active] of Array.from(activeEvents.entries())) {
                    if (!rutsInCensusToday.has(rut)) {
                        const master = patientsMap.get(rut);
                        if (master) {
                            master.hospitalizations?.push({
                                id: `${active.lastSeen}-egreso-auto`,
                                type: 'Egreso',
                                date: active.lastSeen,
                                diagnosis: active.diagnosis || 'Salida automática (no detectado en censo)',
                                bedName: active.bedId
                            });
                            master.lastDischarge = active.lastSeen;
                        }
                        activeEvents.delete(rut);
                    }
                }
            }

            setAnalysis({
                totalRecords: dates.length,
                uniquePatients: patientsMap.size,
                validPatients: Array.from(patientsMap.values()),
                conflicts: conflicts
            });

        } catch (error) {
            console.error("Analysis failed", error);
        } finally {
            setIsAnalyzing(false);
        }
    }, []);

    const runMigration = useCallback(async () => {
        if (!analysis || analysis.validPatients.length === 0) return;

        setIsMigrating(true);
        try {
            const { successes, errors } = await PatientMasterRepository.bulkUpsertPatients(analysis.validPatients);
            setMigrationResult({ successes, errors });
        } catch (error) {
            console.error("Migration failed", error);
        } finally {
            setIsMigrating(false);
        }
    }, [analysis]);

    return {
        isAnalyzing,
        isMigrating,
        isHarmonizing,
        analysis,
        migrationResult,
        runAnalysis,
        runMigration,
        resolveConflict
    };
};
