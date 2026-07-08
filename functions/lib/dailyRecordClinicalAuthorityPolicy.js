const normalizeText = value =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeEpisodeId = value => String(value || '').trim();

const isMovementDeleted = movement => Boolean(String(movement?.deletedAt || '').trim());

const hasActivePatientIdentity = patient =>
  Boolean(
    patient &&
    !patient.isBlocked &&
    (normalizeEpisodeId(patient.clinicalEpisodeId) ||
      normalizeText(patient.rut) ||
      normalizeText(patient.patientName) ||
      normalizeText(patient.admissionDate))
  );

const buildLegacyEpisodeKey = patient => {
  const identity = patient?.rut || patient?.patientName || 'sin-rut';
  const admissionDate = patient?.firstSeenDate || patient?.admissionDate || 'sin-ingreso';
  const admissionTime = String(patient?.admissionTime || '').trim();
  return admissionTime
    ? `${identity}__${admissionDate}__${admissionTime}`
    : `${identity}__${admissionDate}`;
};

const resolvePatientEpisodeKey = patient =>
  normalizeEpisodeId(patient?.clinicalEpisodeId) || buildLegacyEpisodeKey(patient);

const resolveMovementEpisodeKey = movement => {
  const episodeId = normalizeEpisodeId(movement?.clinicalEpisodeId);
  if (episodeId) return episodeId;

  const originalData = movement?.originalData || {};
  const admissionDate =
    movement?.admissionDate ||
    originalData.firstSeenDate ||
    originalData.admissionDate ||
    'sin-ingreso';
  const identity = movement?.rut || movement?.patientName || 'sin-rut';
  const admissionTime = String(originalData.admissionTime || '').trim();
  return admissionTime
    ? `${identity}__${admissionDate}__${admissionTime}`
    : `${identity}__${admissionDate}`;
};

const collectActiveEpisodeEntries = record => {
  const entries = [];

  Object.entries(record?.beds || {}).forEach(([bedId, patient]) => {
    if (hasActivePatientIdentity(patient)) {
      entries.push({
        bedId,
        path: `beds.${bedId}`,
        episodeKey: resolvePatientEpisodeKey(patient),
      });
    }

    if (hasActivePatientIdentity(patient?.clinicalCrib)) {
      entries.push({
        bedId,
        path: `beds.${bedId}.clinicalCrib`,
        episodeKey: resolvePatientEpisodeKey(patient.clinicalCrib),
      });
    }
  });

  return entries.filter(entry => Boolean(entry.episodeKey));
};

const collectClosedMovementEpisodeKeys = record => {
  const keys = new Set();
  const append = movement => {
    if (!movement || isMovementDeleted(movement)) return;
    const key = resolveMovementEpisodeKey(movement);
    if (key) keys.add(key);
  };

  (record?.discharges || []).forEach(append);
  (record?.transfers || []).forEach(append);
  (record?.cma || []).forEach(append);
  return keys;
};

const evaluateDailyRecordClinicalAuthority = record => {
  const activeEpisodes = collectActiveEpisodeEntries(record);
  const closedMovementEpisodeKeys = collectClosedMovementEpisodeKeys(record);
  const seen = new Map();
  const violations = [];

  activeEpisodes.forEach(entry => {
    const previous = seen.get(entry.episodeKey);
    if (!previous) {
      seen.set(entry.episodeKey, entry);
    } else {
      violations.push({
        type: 'duplicate_active_episode',
        path: entry.path,
        bedId: entry.bedId,
        episodeKey: entry.episodeKey,
        message: `Episodio clinico activo duplicado en ${previous.path} y ${entry.path}.`,
      });
    }

    if (closedMovementEpisodeKeys.has(entry.episodeKey)) {
      violations.push({
        type: 'closed_episode_active_in_bed',
        path: entry.path,
        bedId: entry.bedId,
        episodeKey: entry.episodeKey,
        message: `Episodio clinico ${entry.episodeKey} permanece activo en cama pese a movimiento de cierre.`,
      });
    }
  });

  return {
    status: violations.length > 0 ? 'blocked' : 'ok',
    violations,
  };
};

const collectClinicalEpisodeCoverage = record => {
  const snapshot = {
    activePatients: 0,
    canonicalEpisodeIds: 0,
    fallbackEpisodeKeys: 0,
    degenerateFallbackEpisodeKeys: 0,
  };

  const visit = patient => {
    if (!hasActivePatientIdentity(patient)) return;

    snapshot.activePatients += 1;
    if (normalizeEpisodeId(patient.clinicalEpisodeId)) {
      snapshot.canonicalEpisodeIds += 1;
      return;
    }

    snapshot.fallbackEpisodeKeys += 1;
    if (!normalizeText(patient.rut) || !String(patient.admissionTime || '').trim()) {
      snapshot.degenerateFallbackEpisodeKeys += 1;
    }
  };

  Object.values(record?.beds || {}).forEach(patient => {
    visit(patient);
    visit(patient?.clinicalCrib);
  });

  return snapshot;
};

module.exports = {
  collectClinicalEpisodeCoverage,
  evaluateDailyRecordClinicalAuthority,
};
