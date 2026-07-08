const {
  buildReportingSpecialtyTraceFields,
  createEmptySpecialtyBucket,
  resolveReportingSpecialty,
} = require('./minsalSpecialty');
const {
  buildStaySummary,
  calculateDischargeStayDays,
  sumStayDurations,
} = require('./minsalStaySummary');
const { createEpisodeAdmissionTracker } = require('./minsalEpisodeTracker');
const { normalizeMovementReportingSnapshot } = require('./sharedMovementCompatibility');

const resolveTraceabilityDiagnosis = value => {
  if (typeof value !== 'string') return undefined;
  const diagnosis = value.trim();
  return diagnosis || undefined;
};

const resolveAdmissionDateForEvent = (tracker, patient, fallbackAdmissionDate) =>
  tracker.resolveAdmissionDate(patient, fallbackAdmissionDate);

const resolveMovementAdmissionDate = (tracker, movement) =>
  resolveAdmissionDateForEvent(tracker, movement, movement && movement.admissionDate);

const resolveMovementDiagnosis = movement =>
  resolveTraceabilityDiagnosis(movement && movement.diagnosis);

const isActiveMovement = movement => !(movement && movement.deletedAt);

const getActiveMovements = movements =>
  Array.isArray(movements) ? movements.filter(isActiveMovement) : [];

const createEmptyCmaBucket = () => ({
  total: 0,
  cirugiaMayorAmbulatoria: 0,
  procedimientoMedicoAmbulatorio: 0,
  pacientesList: [],
});

const createEmptyCmaStats = () => ({
  total: 0,
  cirugiaMayorAmbulatoria: 0,
  procedimientoMedicoAmbulatorio: 0,
  porEspecialidad: [],
  pacientesList: [],
});

const calculateMinsalStatistics = ({
  records,
  hospitalCapacity,
  startDate,
  endDate,
  options = {},
}) => {
  if (!records || records.length === 0) {
    return {
      periodStart: startDate,
      periodEnd: endDate,
      totalDays: 0,
      diasCamaDisponibles: 0,
      diasCamaOcupados: 0,
      egresosTotal: 0,
      egresosVivos: 0,
      egresosFallecidos: 0,
      egresosTraslados: 0,
      tasaOcupacion: 0,
      promedioDiasEstada: 0,
      mortalidadHospitalaria: 0,
      indiceRotacion: 0,
      pacientesActuales: 0,
      camasOcupadas: 0,
      camasBloqueadas: 0,
      camasDisponibles: hospitalCapacity,
      camasLibres: hospitalCapacity,
      tasaOcupacionActual: 0,
      porEspecialidad: [],
      cma: createEmptyCmaStats(),
      promedioDiasEstadaMinima: 0,
      promedioDiasEstadaMaxima: 0,
      message: 'No records found for the given range.',
    };
  }

  const orderedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const episodeTracker = createEpisodeAdmissionTracker();

  let totalDiasCamaDisponibles = 0;
  let totalDiasCamaOcupados = 0;
  let totalEgresosVivos = 0;
  let totalEgresosFallecidos = 0;
  let totalEgresosTraslados = 0;
  const totalStayDurations = [];

  const specialtyData = new Map();
  const cmaData = new Map();
  const cmaPatientsList = [];

  orderedRecords.forEach(record => {
    const closedEpisodes = [];

    Object.values(record.beds || {}).forEach(bed => {
      episodeTracker.observeBed(bed, record.date);
    });

    const beds = record.beds || {};
    let ocupadas = 0;
    let bloqueadas = 0;

    Object.keys(beds).forEach(bedId => {
      const bed = beds[bedId];
      if (bed.isBlocked) {
        bloqueadas++;
        return;
      }
      if (!(bed.patientName && bed.patientName.trim())) {
        return;
      }

      ocupadas++;
      const specialtyResolution = resolveReportingSpecialty({
        specialty: bed.specialty,
        options,
      });
      const specialty = specialtyResolution.reportingSpecialty;
      const existing = specialtyData.get(specialty) || createEmptySpecialtyBucket();
      existing.diasOcupados++;
      existing.diasOcupadosList.push({
        name: bed.patientName,
        rut: bed.rut,
        diagnosis: resolveTraceabilityDiagnosis(bed.pathology),
        date: record.date,
        bedName: bed.bedName,
        admissionDate: episodeTracker.resolveAdmissionDate(bed, bed.admissionDate),
        ...buildReportingSpecialtyTraceFields(specialtyResolution),
      });
      specialtyData.set(specialty, existing);

      if (bed.clinicalCrib && bed.clinicalCrib.patientName && bed.clinicalCrib.patientName.trim()) {
        ocupadas++;
        const cribSpecialtyResolution = resolveReportingSpecialty({
          specialty: bed.clinicalCrib.specialty,
          options,
        });
        const cribSpecialty = cribSpecialtyResolution.reportingSpecialty;
        const cribExisting = specialtyData.get(cribSpecialty) || createEmptySpecialtyBucket();
        cribExisting.diasOcupados++;
        cribExisting.diasOcupadosList.push({
          name: bed.clinicalCrib.patientName,
          rut: bed.clinicalCrib.rut,
          diagnosis: resolveTraceabilityDiagnosis(bed.clinicalCrib.pathology),
          date: record.date,
          bedName: bed.clinicalCrib.bedName || bed.bedName,
          admissionDate: episodeTracker.resolveAdmissionDate(
            bed.clinicalCrib,
            bed.clinicalCrib.admissionDate
          ),
          ...buildReportingSpecialtyTraceFields(cribSpecialtyResolution),
        });
        specialtyData.set(cribSpecialty, cribExisting);
      }
    });

    totalDiasCamaDisponibles += hospitalCapacity - bloqueadas;
    totalDiasCamaOcupados += ocupadas;

    const activeDischarges = getActiveMovements(record.discharges);
    const activeTransfers = getActiveMovements(record.transfers);
    const activeCma = getActiveMovements(record.cma);

    if (activeDischarges.length) {
      activeDischarges.forEach(discharge => {
        const normalizedDischarge = normalizeMovementReportingSnapshot(discharge);
        const specialtyResolution = resolveReportingSpecialty({
          specialty: normalizedDischarge && normalizedDischarge.specialty,
          movementKind: 'discharge',
          movementId: discharge.id,
          date: record.date,
          options,
        });
        const specialty = specialtyResolution.reportingSpecialty;
        const existing = specialtyData.get(specialty) || createEmptySpecialtyBucket();
        existing.egresos++;
        const resolvedAdmissionDate = resolveMovementAdmissionDate(
          episodeTracker,
          normalizedDischarge
        );
        const stayDays = calculateDischargeStayDays(resolvedAdmissionDate, record.date);
        if (stayDays !== null) {
          existing.stayDurations.push(stayDays);
          totalStayDurations.push(stayDays);
        }

        const traceData = {
          name: discharge.patientName,
          rut: discharge.rut,
          diagnosis: resolveMovementDiagnosis(normalizedDischarge),
          date: record.date,
          bedName: discharge.bedName,
          admissionDate: resolvedAdmissionDate,
          movementKind: 'discharge',
          movementId: discharge.id,
          eventTime: discharge.time,
          ...buildReportingSpecialtyTraceFields(specialtyResolution),
        };
        existing.egresosList.push(traceData);
        if (discharge.status === 'Fallecido') {
          totalEgresosFallecidos++;
          existing.fallecidos++;
          existing.fallecidosList.push(traceData);
        } else {
          totalEgresosVivos++;
        }
        if (discharge.rut) {
          closedEpisodes.push(discharge);
        }
        specialtyData.set(specialty, existing);
      });
    }

    if (activeTransfers.length) {
      totalEgresosTraslados += activeTransfers.length;
      activeTransfers.forEach(transfer => {
        const normalizedTransfer = normalizeMovementReportingSnapshot(transfer);
        const specialtyResolution = resolveReportingSpecialty({
          specialty: normalizedTransfer && normalizedTransfer.specialty,
          movementKind: 'transfer',
          movementId: transfer.id,
          date: record.date,
          options,
        });
        const specialty = specialtyResolution.reportingSpecialty;
        const existing = specialtyData.get(specialty) || createEmptySpecialtyBucket();
        existing.traslados++;
        const resolvedAdmissionDate = resolveMovementAdmissionDate(
          episodeTracker,
          normalizedTransfer
        );
        const stayDays = calculateDischargeStayDays(resolvedAdmissionDate, record.date);
        if (stayDays !== null) {
          existing.stayDurations.push(stayDays);
          totalStayDurations.push(stayDays);
        }

        existing.trasladosList.push({
          name: transfer.patientName,
          rut: transfer.rut,
          diagnosis: resolveMovementDiagnosis(normalizedTransfer),
          date: record.date,
          bedName: transfer.bedName,
          admissionDate: resolvedAdmissionDate,
          movementKind: 'transfer',
          movementId: transfer.id,
          eventTime: transfer.time,
          ...buildReportingSpecialtyTraceFields(specialtyResolution),
        });
        if (transfer.rut) {
          closedEpisodes.push(transfer);
        }
        specialtyData.set(specialty, existing);
      });
    }

    activeCma.forEach(item => {
      const specialtyResolution = resolveReportingSpecialty({
        specialty: item.specialty,
        movementKind: 'cma',
        movementId: item.id,
        date: record.date,
        options,
      });
      const specialty = specialtyResolution.reportingSpecialty;
      const existing = cmaData.get(specialty) || createEmptyCmaBucket();
      const isCma = item.interventionType === 'Cirugía Mayor Ambulatoria';
      const traceData = {
        name: item.patientName,
        rut: item.rut,
        diagnosis: resolveMovementDiagnosis(item),
        date: record.date,
        bedName: item.bedName,
        dischargeDate: record.date,
        movementKind: 'cma',
        movementId: item.id,
        interventionType: item.interventionType,
        eventTime: item.dischargeTime,
        ...buildReportingSpecialtyTraceFields(specialtyResolution),
      };

      existing.total++;
      if (isCma) {
        existing.cirugiaMayorAmbulatoria++;
      } else {
        existing.procedimientoMedicoAmbulatorio++;
      }
      existing.pacientesList.push(traceData);
      cmaPatientsList.push(traceData);
      cmaData.set(specialty, existing);
    });

    closedEpisodes.forEach(episode => episodeTracker.closeEpisode(episode));
  });

  const egresosTotal = totalEgresosVivos + totalEgresosFallecidos + totalEgresosTraslados;
  const tasaOcupacion =
    totalDiasCamaDisponibles > 0 ? (totalDiasCamaOcupados / totalDiasCamaDisponibles) * 100 : 0;
  const totalStayDays = sumStayDurations(totalStayDurations);
  const promedioDiasEstada =
    totalStayDurations.length > 0 ? totalStayDays / totalStayDurations.length : 0;
  const totalDaysInRange = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24) + 1;
  const avgAvailableBeds =
    records.length > 0 ? totalDiasCamaDisponibles / records.length : hospitalCapacity;
  const indiceRotacion =
    avgAvailableBeds > 0 && totalDaysInRange > 0
      ? (egresosTotal / avgAvailableBeds) * (30 / totalDaysInRange)
      : 0;

  const porEspecialidad = Array.from(specialtyData.entries())
    .map(([specialty, bucket]) => {
      const egresosEsp = bucket.egresos || 0;
      const specialtyStayDays = sumStayDurations(bucket.stayDurations);
      const staySummary = buildStaySummary(bucket.stayDurations);
      return {
        specialty,
        egresos: bucket.egresos,
        fallecidos: bucket.fallecidos,
        traslados: bucket.traslados,
        diasOcupados: bucket.diasOcupados,
        diasOcupadosList: bucket.diasOcupadosList,
        egresosList: bucket.egresosList,
        trasladosList: bucket.trasladosList,
        fallecidosList: bucket.fallecidosList,
        contribucionRelativa:
          totalDiasCamaOcupados > 0 ? (bucket.diasOcupados / totalDiasCamaOcupados) * 100 : 0,
        tasaMortalidad: egresosEsp > 0 ? (bucket.fallecidos / egresosEsp) * 100 : 0,
        promedioDiasEstada:
          bucket.stayDurations.length > 0 ? specialtyStayDays / bucket.stayDurations.length : 0,
        promedioDiasEstadaMinima: staySummary.minimum,
        promedioDiasEstadaMaxima: staySummary.maximum,
      };
    })
    .sort((a, b) => b.diasOcupados - a.diasOcupados);

  const totalStaySummary = buildStaySummary(totalStayDurations);
  const cma =
    cmaData.size === 0
      ? createEmptyCmaStats()
      : {
          total: Array.from(cmaData.values()).reduce((sum, item) => sum + item.total, 0),
          cirugiaMayorAmbulatoria: Array.from(cmaData.values()).reduce(
            (sum, item) => sum + item.cirugiaMayorAmbulatoria,
            0
          ),
          procedimientoMedicoAmbulatorio: Array.from(cmaData.values()).reduce(
            (sum, item) => sum + item.procedimientoMedicoAmbulatorio,
            0
          ),
          porEspecialidad: Array.from(cmaData.entries())
            .map(([specialty, bucket]) => ({
              specialty,
              total: bucket.total,
              cirugiaMayorAmbulatoria: bucket.cirugiaMayorAmbulatoria,
              procedimientoMedicoAmbulatorio: bucket.procedimientoMedicoAmbulatorio,
              pacientesList: bucket.pacientesList,
            }))
            .sort(
              (a, b) => b.total - a.total || String(a.specialty).localeCompare(String(b.specialty))
            ),
          pacientesList: cmaPatientsList,
        };

  return {
    periodStart: startDate,
    periodEnd: endDate,
    totalDays: records.length,
    diasCamaDisponibles: totalDiasCamaDisponibles,
    diasCamaOcupados: totalDiasCamaOcupados,
    egresosTotal,
    egresosVivos: totalEgresosVivos,
    egresosFallecidos: totalEgresosFallecidos,
    egresosTraslados: totalEgresosTraslados,
    tasaOcupacion: Math.round(tasaOcupacion * 10) / 10,
    promedioDiasEstada,
    mortalidadHospitalaria:
      egresosTotal > 0 ? Math.round((totalEgresosFallecidos / egresosTotal) * 1000) / 10 : 0,
    indiceRotacion: Math.round(indiceRotacion * 10) / 10,
    pacientesActuales: 0,
    camasLibres: 0,
    promedioDiasEstadaMinima: totalStaySummary.minimum,
    promedioDiasEstadaMaxima: totalStaySummary.maximum,
    porEspecialidad,
    cma,
  };
};

module.exports = {
  calculateMinsalStatistics,
};
