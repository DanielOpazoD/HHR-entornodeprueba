import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isValidRut, normalizeRut } from '../../src/utils/rutUtils.ts';

const NOTES = ['handoffNoteDayShift', 'handoffNoteNightShift'];
const normalized = value =>
  typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
    : '';
const nonblank = value => typeof value === 'string' && Boolean(value.trim());
const empty = value => value == null || (typeof value === 'string' && !value.trim());
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validDay = day =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day)) &&
  new Date(day).toISOString().slice(0, 10) === day;
const documentKey = patient => {
  const raw = typeof patient.rut === 'string' ? patient.rut.trim() : '';
  if (patient.documentType === 'Pasaporte') {
    const key = raw.replace(/[\s.-]/g, '').toUpperCase();
    return /^[A-Z0-9]{3,30}$/.test(key) ? `passport:${key}` : null;
  }
  return /^[\dKk.\s-]+$/.test(raw) && isValidRut(raw) && !/^0+[0-9K]$/.test(normalizeRut(raw))
    ? `rut:${normalizeRut(raw)}`
    : null;
};
const episode = patient => {
  const value =
    typeof patient.clinicalEpisodeId === 'string' ? patient.clinicalEpisodeId.trim() : '';
  return value && !/^(?:ep_|legacy_ep_)/.test(value) && value !== '0' ? value : null;
};
const neonatal = patient =>
  patient.bedMode === 'Cuna' ||
  nonblank(patient.neonatalMaternalRut) ||
  /^(?:rn\b|r\.n\.)/.test(normalized(patient.patientName)) ||
  /^(?:[0-9]|1[0-9]|2[0-8])\s*(?:d|dias?)$/.test(normalized(patient.age));

const adultAt = (patient, date) => {
  if (validDay(patient.birthDate)) {
    const years =
      Number(date.slice(0, 4)) -
      Number(patient.birthDate.slice(0, 4)) -
      (date.slice(5) < patient.birthDate.slice(5) ? 1 : 0);
    return years >= 18 && years <= 120;
  }
  const age = normalized(patient.age).match(/^(\d{1,3})(?:\s*(?:a|anos?))?$/);
  return Boolean(age && Number(age[1]) >= 18 && Number(age[1]) <= 120);
};

const occurrences = record => {
  const result = [];
  const walk = (patient, path, inCrib = false) => {
    if (!patient || typeof patient !== 'object' || Array.isArray(patient)) return;
    if (
      nonblank(patient.patientName) ||
      nonblank(patient.rut) ||
      nonblank(patient.neonatalMaternalRut) ||
      NOTES.some(key => key in patient)
    )
      result.push({ patient, path, neonatal: inCrib || neonatal(patient) });
    if (patient.clinicalCrib) walk(patient.clinicalCrib, [...path, 'clinicalCrib'], true);
  };
  for (const [bed, patient] of Object.entries(record.beds || {})) walk(patient, ['beds', bed]);
  for (const kind of ['discharges', 'transfers', 'cma'])
    for (const [index, movement] of (record[kind] || []).entries())
      if (!movement.deletedAt) walk(movement.originalData, [kind, index, 'originalData']);
  return result;
};
const compatible = (a, b) => {
  const left = episode(a),
    right = episode(b);
  if (left && right && left !== right) return false;
  if (validDay(a.birthDate) && validDay(b.birthDate) && a.birthDate !== b.birthDate) return false;
  if (
    !(left && left === right) &&
    (!validDay(a.admissionDate) ||
      !validDay(b.admissionDate) ||
      a.admissionDate !== b.admissionDate)
  )
    return false;
  return true;
};

/** Conservative first lane: adult notes only. RN and all identity ambiguity remain review cases. */
export const planNursingRecovery = ({ source, target }) => {
  if (
    !source ||
    !target ||
    typeof source !== 'object' ||
    typeof target !== 'object' ||
    Array.isArray(source) ||
    Array.isArray(target)
  )
    throw new Error('invalid_nursing_input');
  for (const records of [source, target])
    for (const [date, record] of Object.entries(records))
      if (
        !validDay(date) ||
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        record.date !== date
      )
        throw new Error('invalid_nursing_day');
  // Context spans the supplied batch: a maternal document reused by an RN on
  // another day still cannot serve as an unambiguous person key here.
  const sharedNeonatal = new Set(
    Object.values(source)
      .concat(Object.values(target))
      .flatMap(occurrences)
      .filter(item => item.neonatal)
      .flatMap(({ patient }) => [
        documentKey(patient),
        documentKey({ rut: patient.neonatalMaternalRut }),
      ])
      .filter(Boolean)
  );
  const patches = [],
    cases = [];
  for (const [date, record] of Object.entries(source)) {
    const old = occurrences(record),
      current = target[date] ? occurrences(target[date]) : [];
    const byDocument = new Map();
    for (const item of old) {
      const key = documentKey(item.patient);
      const group = key ? `document:${key}` : `unverified:${byDocument.size}`;
      if (!byDocument.has(group)) byDocument.set(group, []);
      byDocument.get(group).push(item);
    }
    for (const group of byDocument.values()) {
      const key = documentKey(group[0].patient);
      const candidates = current.filter(item => key && documentKey(item.patient) === key);
      const ids = new Set(
        [...group, ...candidates].map(item => episode(item.patient)).filter(Boolean)
      );
      const births = new Set(
        [...group, ...candidates].map(item => item.patient.birthDate).filter(validDay)
      );
      // A single bed representation may coexist with copied movement records. Without
      // a shared real episode, multiple representations stay held for a later lane.
      const sourceUnique =
        group.length === 1 ||
        (ids.size === 1 && group.every(item => episode(item.patient) === [...ids][0]));
      const unique =
        candidates.length === 1 ||
        (candidates.length > 1 &&
          ids.size === 1 &&
          [...group, ...candidates].every(item => episode(item.patient) === [...ids][0]));
      const safe =
        key &&
        key.startsWith('rut:') &&
        !sharedNeonatal.has(key) &&
        ![...group, ...candidates].some(item => item.neonatal) &&
        [...group, ...candidates].every(item => adultAt(item.patient, date)) &&
        sourceUnique &&
        unique &&
        ids.size <= 1 &&
        births.size <= 1 &&
        group.every(a => candidates.every(b => compatible(a.patient, b.patient)));
      for (const field of NOTES) {
        const values = group.map(item => item.patient[field]).filter(value => !empty(value));
        if (!values.length) continue;
        const row = {
          date,
          shift: field === NOTES[0] ? 'day' : 'night',
          status: 'review',
          reason: 'identity_or_episode_not_confirmed',
          plannedFields: 0,
        };
        if (!values.every(value => typeof value === 'string') || new Set(values).size !== 1)
          row.reason = 'conflicting_source_text';
        else if (safe) {
          const value = values[0];
          if (candidates.some(item => !empty(item.patient[field]) && item.patient[field] !== value))
            row.reason = 'preserve_destination_text';
          else {
            for (const item of candidates.filter(item => empty(item.patient[field]))) {
              patches.push({
                date,
                path: [...item.path, field],
                expectedValue: item.patient[field],
                value,
              });
              row.plannedFields++;
            }
            row.status = row.plannedFields ? 'candidate' : 'already_equal';
            row.reason = row.plannedFields ? 'verified_document_day_shift' : 'unchanged';
          }
        }
        cases.push(row);
      }
    }
  }
  return {
    patches,
    report: {
      schemaVersion: 1,
      cases,
      plannedFields: patches.length,
      sourceDigest: digest(source),
      targetDigest: digest(target),
      cloudWrites: 0,
      authorizesMigration: false,
    },
  };
};

const rootNameMatch = (left, right) => {
  const words = value =>
    normalized(value)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const a = words(left),
    b = words(right);
  if (a.length < 2 || b.length < 2) return null;
  if ([a, b].some(tokens => tokens.some(token => token.length === 1 && token !== 'y'))) return null;
  if (normalized(left) === normalized(right)) return 'exact_name';
  if (a.join(' ') === b.join(' ')) return 'punctuation_only';
  const connectors = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
  if (a[0] !== b[0] || [a, b].some(tokens => tokens.filter(t => !connectors.has(t)).length < 3))
    return null;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  let index = 0;
  for (const token of longer) if (token === shorter[index]) index++;
  return index === shorter.length ? 'ordered_name_extension' : null;
};

/** Explicit, bounded adult root-note selection. Patches remain private in memory. */
export const selectNursingRootBatch = ({ source, target, dates, throughDate }) => {
  if (
    !validDay(throughDate) ||
    !Array.isArray(dates) ||
    dates.length < 1 ||
    dates.length > 3 ||
    new Set(dates).size !== dates.length ||
    dates.some(date => !validDay(date) || date < '2026-07-01' || date > throughDate)
  )
    throw new Error('invalid_nursing_batch_scope');
  // Use the full supplied context, including RN/maternal identifiers on other days.
  const plan = planNursingRecovery({ source, target });
  const patches = [],
    excluded = {},
    matches = {},
    days = [];
  const hold = reason => {
    excluded[reason] = (excluded[reason] || 0) + 1;
  };
  for (const date of [...dates].sort()) {
    const patients = new Set();
    let selectedFields = 0;
    for (const patch of plan.patches.filter(item => item.date === date)) {
      if (patch.path.length !== 3 || patch.path[0] !== 'beds' || patch.path[1].startsWith('C-')) {
        hold('movement_or_crib_path');
        continue;
      }
      const patient = target[date].beds[patch.path[1]];
      const key = documentKey(patient);
      const old = occurrences(source[date]).filter(item => documentKey(item.patient) === key);
      const current = occurrences(target[date]).filter(item => documentKey(item.patient) === key);
      if (
        old.length !== 1 ||
        current.length !== 1 ||
        [...old, ...current].some(
          item =>
            item.path.length !== 2 ||
            item.path[0] !== 'beds' ||
            item.neonatal ||
            item.patient.clinicalCrib != null
        )
      ) {
        hold('ambiguous_or_linked_representation');
        continue;
      }
      const previous = old[0].patient;
      if (
        !validDay(patient.birthDate) ||
        previous.birthDate !== patient.birthDate ||
        !validDay(patient.admissionDate) ||
        previous.admissionDate !== patient.admissionDate
      ) {
        hold('additional_identity_or_episode_evidence');
        continue;
      }
      const match = rootNameMatch(previous.patientName, patient.patientName);
      if (!match) {
        hold('name_requires_review');
        continue;
      }
      if ((!patients.has(key) && patients.size === 4) || selectedFields === 8) {
        hold('batch_budget');
        continue;
      }
      patients.add(key);
      selectedFields++;
      patches.push(patch);
      matches[match] = (matches[match] || 0) + 1;
    }
    days.push({ date, patients: patients.size, noteFields: selectedFields });
  }
  return {
    patches,
    report: {
      schemaVersion: 1,
      policy: 'verified-adult-root-notes-v2',
      throughDate,
      days,
      selectedFields: patches.length,
      excludedFields: excluded,
      identityEvidenceKinds: matches,
      selectionFingerprints: patches.map(patch => digest([patch.date, patch.path, patch.value])),
      sourceDigest: plan.report.sourceDigest,
      targetDigest: plan.report.targetDigest,
      cloudWrites: 0,
      authorizesMigration: false,
    },
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('no_arguments_supported');
    const { report } = planNursingRecovery(JSON.parse(readFileSync(0, 'utf8')));
    console.log(JSON.stringify(report));
  } catch {
    console.error('Plan detenido. Revise formato, fechas e identidad; no se modificaron datos.');
    process.exitCode = 1;
  }
}
