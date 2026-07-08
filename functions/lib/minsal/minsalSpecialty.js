const GYN_OBSTETRIC_NAMES = [
  'Obstetricia',
  'Ginecología',
  'Ginecologia',
  'Obstetricia y Ginecología',
  'Ginecología y Obstetricia',
];

const KNOWN_REPORTING_SPECIALTIES = new Set([
  'Med Interna',
  'Cirugía',
  'Traumatología',
  'Ginecobstetricia',
  'Psiquiatría',
  'Pediatría',
  'Odontología',
  'Otro',
]);

const createEmptySpecialtyBucket = () => ({
  pacientes: 0,
  egresos: 0,
  fallecidos: 0,
  traslados: 0,
  diasOcupados: 0,
  stayDurations: [],
  diasOcupadosList: [],
  egresosList: [],
  trasladosList: [],
  fallecidosList: [],
});

const normalizeSpecialty = specialty => {
  if (!specialty) return 'Sin Especialidad';
  const normalized = specialty.trim();
  if (GYN_OBSTETRIC_NAMES.some(name => normalized.toLowerCase() === name.toLowerCase())) {
    return 'Ginecobstetricia';
  }
  return normalized || 'Sin Especialidad';
};

const findManualReclassification = ({ movementKind, movementId, date, options }) => {
  if (!movementKind || !movementId) return undefined;
  return ((options && options.specialtyReclassifications) || []).find(item => {
    if (item.movementKind !== movementKind || item.movementId !== movementId) {
      return false;
    }
    return !item.date || !date || item.date === date;
  });
};

const resolveReportingSpecialty = ({ specialty, movementKind, movementId, date, options }) => {
  const originalSpecialty = normalizeSpecialty(specialty);
  const manual = findManualReclassification({ movementKind, movementId, date, options });
  if (manual) {
    return {
      originalSpecialty,
      reportingSpecialty: normalizeSpecialty(manual.specialty),
      reportingSpecialtySource: 'manual',
    };
  }

  if (
    options &&
    options.specialtyGroupingMode === 'group-other' &&
    originalSpecialty !== 'Sin Especialidad' &&
    !KNOWN_REPORTING_SPECIALTIES.has(originalSpecialty)
  ) {
    return {
      originalSpecialty,
      reportingSpecialty: 'Otro',
      reportingSpecialtySource: 'grouped',
    };
  }

  return {
    originalSpecialty,
    reportingSpecialty: originalSpecialty,
    reportingSpecialtySource: 'original',
  };
};

const buildReportingSpecialtyTraceFields = resolution => ({
  originalSpecialty: resolution.originalSpecialty,
  reportingSpecialty: resolution.reportingSpecialty,
  reportingSpecialtySource: resolution.reportingSpecialtySource,
});

module.exports = {
  createEmptySpecialtyBucket,
  buildReportingSpecialtyTraceFields,
  normalizeSpecialty,
  resolveReportingSpecialty,
};
