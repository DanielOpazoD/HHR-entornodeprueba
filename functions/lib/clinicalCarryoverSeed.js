const documentKey = value =>
  String(value || '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();
const isoDay = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const clone = value => JSON.parse(JSON.stringify(value));
const seedPatient = (source, destination, sourceDate, date) => {
  if (
    !source ||
    !destination ||
    !isoDay(sourceDate) ||
    !isoDay(date) ||
    Date.parse(`${date}T00:00:00Z`) - Date.parse(`${sourceDate}T00:00:00Z`) !== 86400000 ||
    !isoDay(source.admissionDate) ||
    source.admissionDate > sourceDate ||
    !source.clinicalEpisodeId?.trim() ||
    source.clinicalEpisodeId.trim() !== destination.clinicalEpisodeId?.trim() ||
    !documentKey(source.rut) ||
    documentKey(source.rut) !== documentKey(destination.rut) ||
    (source.documentType || 'RUT') !== (destination.documentType || 'RUT') ||
    source.admissionDate !== destination.admissionDate ||
    (source.admissionTime || '') !== (destination.admissionTime || '')
  )
    return destination;
  const next = clone(destination);
  const history = (source.deviceInstanceHistory || []).filter(
    item =>
      (!item.clinicalEpisodeId || item.clinicalEpisodeId === source.clinicalEpisodeId) &&
      (!item.patientRut || documentKey(item.patientRut) === documentKey(source.rut))
  );
  next.deviceInstanceHistory = clone(history);
  next.devices = [
    ...new Set([
      ...(source.devices || []),
      ...history
        .filter(item => item.status === 'Active' && !item.removalDate)
        .map(item => item.type),
    ]),
  ].filter(type => {
    const instances = history.filter(item => item.type === type);
    const foreignOnly =
      (source.deviceInstanceHistory || []).some(item => item.type === type) && !instances.length;
    return (
      !foreignOnly &&
      (instances.length
        ? instances.some(item => item.status === 'Active' && !item.removalDate)
        : !source.deviceDetails?.[type]?.removalDate)
    );
  });
  next.deviceDetails = clone(
    Object.fromEntries(
      Object.entries(source.deviceDetails || {}).filter(([type]) => next.devices.includes(type))
    )
  );
  // Instance evidence takes precedence over the type summary after reinsertion.
  for (const type of next.devices) {
    const active = history.filter(
      item => item.type === type && item.status === 'Active' && !item.removalDate
    );
    if (active.length === 1) {
      next.deviceDetails[type] = {
        installationDate: active[0].installationDate,
        ...(active[0].note ? { note: active[0].note } : {}),
      };
    } else if (active.length > 1) {
      // Preserve all instances without assigning one installation to the whole type.
      delete next.deviceDetails[type];
    }
  }
  const readings = [
    ...(source.vitalSignsHistory || []),
    ...(source.vitalSigns ? [source.vitalSigns] : []),
  ].filter(item => {
    const stamp = Date.parse(`${item.recordedDate}T00:00:00Z`);
    if (
      !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== item.recordedDate ||
      item.recordedDate < source.admissionDate ||
      item.recordedDate > sourceDate
    )
      return false;
    if (item.recordedDate !== source.admissionDate || !source.admissionTime) return true;
    const time = item.recordedAt.match(/(?:T|\s)([0-2]\d:[0-5]\d)(?::\d{2})?(?:$|[.,Z+-])/)?.[1];
    return Boolean(time && Number(time.slice(0, 2)) < 24 && time >= source.admissionTime);
  });
  const unique = new Map(readings.map(item => [item.sourceEventId || JSON.stringify(item), item]));
  next.vitalSignsHistory = clone(
    [...unique.values()]
      .sort((a, b) =>
        `${b.recordedDate}|${b.recordedAt}`.localeCompare(`${a.recordedDate}|${a.recordedAt}`)
      )
      .slice(0, 48)
  );
  const glance = next.vitalSignsHistory.find(item =>
    [item.systolic, item.diastolic, item.heartRate, item.spo2, item.temperature].some(
      value => value != null
    )
  );
  if (glance) next.vitalSigns = clone(glance);
  else delete next.vitalSigns;
  delete next.clinicalSyncCheckpoint;
  if (next.vitalSignsHistory.length || next.devices.length || history.length)
    next.clinicalCarryover = {
      sourceDate,
      clinicalEpisodeId: source.clinicalEpisodeId,
      vitalsPending: next.vitalSignsHistory.length > 0,
      devicesPending: next.devices.length > 0,
    };
  return next;
};

/** Called only for today's missing destination inside the authority transaction. Client values
 * are never clinical evidence: the prior snapshot is re-read on every transaction retry. */
const applyTrustedClinicalCarryover = ({ candidate, requested, priorRecord }) => {
  if (!priorRecord) return candidate;
  const priorPatients = Object.values(priorRecord.beds || {});
  const find = (patient, crib) => {
    const matches = priorPatients
      .map(bed => (crib ? bed.clinicalCrib : bed))
      .filter(item => item && item.clinicalEpisodeId === patient?.clinicalEpisodeId);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const seedRequested = (patient, request, crib) => {
    if (request?.clinicalCarryover?.sourceDate !== priorRecord.date) return patient;
    return seedPatient(find(patient, crib), patient, priorRecord.date, candidate.date);
  };
  const next = clone(candidate);
  for (const [bedId, bed] of Object.entries(next.beds || {})) {
    next.beds[bedId] = seedRequested(bed, requested.beds?.[bedId], false);
    if (bed.clinicalCrib)
      next.beds[bedId].clinicalCrib = seedRequested(
        bed.clinicalCrib,
        requested.beds?.[bedId]?.clinicalCrib,
        true
      );
  }
  return next;
};
module.exports = { applyTrustedClinicalCarryover, seedPatient };
