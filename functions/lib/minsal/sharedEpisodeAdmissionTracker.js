const normalizeDateOnly = value => {
  if (!value || typeof value !== 'string') return undefined;
  const datePart = value.split('T')[0].trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : undefined;
};

const normalizeRutKey = rut =>
  (rut || '')
    .replace(/[.\-\s]/g, '')
    .trim()
    .toUpperCase();

const normalizeEpisodeId = value => (typeof value === 'string' ? value.trim() : '');

const isObservedPatient = value => value && typeof value === 'object';

const resolveRutFromSubject = subject => (isObservedPatient(subject) ? subject.rut : subject);

const resolveFallbackAdmissionDate = (subject, fallbackAdmissionDate) =>
  normalizeDateOnly(fallbackAdmissionDate) ||
  normalizeDateOnly(isObservedPatient(subject) ? subject.admissionDate : undefined);

const resolveEpisodeStateKey = subject => {
  if (isObservedPatient(subject)) {
    const episodeId = normalizeEpisodeId(subject.clinicalEpisodeId);
    if (episodeId) return `episode:${episodeId}`;
  }

  const rutKey = normalizeRutKey(resolveRutFromSubject(subject));
  return rutKey ? `rut:${rutKey}` : '';
};

const matchesRut = (state, rutKey) => state.rutKey === rutKey;

const hasPatientIdentity = patient =>
  Boolean(
    patient &&
    !patient.isBlocked &&
    patient.patientName &&
    patient.patientName.trim() &&
    patient.rut &&
    patient.rut.trim()
  );

const resolveEpisodeAnchorDate = (recordDate, admissionDate) =>
  normalizeDateOnly(recordDate) || normalizeDateOnly(admissionDate) || '';

/**
 * Shared episode registry for census, statistics, and historical backfill.
 *
 * Business rule:
 * - A discharge or transfer closes the current episode for that RUT.
 * - While an episode is open, the first observed census day anchors the episode.
 * - Statistics, traceability, and backfill all read that same anchored day.
 * - A later correction may update the stored admission date on the first day of
 *   the episode, but not the episode boundary itself.
 */
const createEpisodeAdmissionTracker = () => {
  const statesByKey = new Map();

  const observePatient = (patient, recordDate) => {
    if (!hasPatientIdentity(patient)) return;

    const rutKey = normalizeRutKey(patient.rut);
    const stateKey = resolveEpisodeStateKey(patient);
    if (!rutKey || !stateKey) return;

    const nextAdmissionDate = resolveEpisodeAnchorDate(recordDate, patient.admissionDate);
    const currentState = statesByKey.get(stateKey);

    if (!currentState || !currentState.open) {
      statesByKey.set(stateKey, {
        rutKey,
        firstSeenDate: nextAdmissionDate,
        admissionDate: nextAdmissionDate,
        open: true,
      });
    }
  };

  const observeBed = (bed, recordDate) => {
    if (!bed) return;
    observePatient(bed, recordDate);
    observePatient(bed.clinicalCrib, recordDate);
  };

  const resolveAdmissionDate = (subject, fallbackAdmissionDate) => {
    const stateKey = resolveEpisodeStateKey(subject);
    if (stateKey) {
      const admissionDate = statesByKey.get(stateKey)?.admissionDate;
      if (admissionDate) return admissionDate;
    }

    return resolveFallbackAdmissionDate(subject, fallbackAdmissionDate);
  };

  const resolveEpisodeStartDate = (subject, fallbackAdmissionDate) => {
    const stateKey = resolveEpisodeStateKey(subject);
    if (stateKey) {
      const admissionDate = statesByKey.get(stateKey)?.firstSeenDate;
      if (admissionDate) return admissionDate;
    }

    return resolveFallbackAdmissionDate(subject, fallbackAdmissionDate);
  };

  const closeEpisode = subject => {
    const stateKey = resolveEpisodeStateKey(subject);
    if (stateKey && statesByKey.has(stateKey)) {
      statesByKey.get(stateKey).open = false;
      return;
    }

    const rutKey = normalizeRutKey(resolveRutFromSubject(subject));
    if (!rutKey) return;

    for (const state of statesByKey.values()) {
      if (matchesRut(state, rutKey)) {
        state.open = false;
      }
    }
  };

  return {
    observeBed,
    resolveAdmissionDate,
    resolveEpisodeStartDate,
    closeEpisode,
  };
};

module.exports = {
  createEpisodeAdmissionTracker,
};
