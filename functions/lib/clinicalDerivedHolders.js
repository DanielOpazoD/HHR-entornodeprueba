/**
 * Where the phase 1a moved fields live inside a day record: each bed patient and its clinical crib
 * ("holders"), and how clinicalDerivedStore copies, settles or locates them. Pure helpers.
 */
'use strict';

const {
  CLINICAL_DERIVED_MOVED_FIELDS,
  collectClinicalDerivedEpisodes,
} = require('./clinicalDerivedContract');

const MOVED_FIELDS = new Set(CLINICAL_DERIVED_MOVED_FIELDS);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const clonePlainValue = value => {
  if (Array.isArray(value)) return value.map(clonePlainValue);
  if (value instanceof Date || typeof value?.toDate === 'function') return value;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, clonePlainValue(nested)])
    );
  }
  return value;
};

const holderKey = (bedId, target) => `${bedId}|${target}`;

const holderPath = (bedId, target) =>
  target === 'bed' ? `beds.${bedId}` : `beds.${bedId}.clinicalCrib`;

const holderOf = (record, bedId, target) => {
  const bed = isPlainObject(record?.beds) ? record.beds[bedId] : undefined;
  const holder = target === 'bed' ? bed : isPlainObject(bed) ? bed.clinicalCrib : undefined;
  return isPlainObject(holder) ? holder : undefined;
};

/** Copy of `record` with `settle(holder, bedId, target)` applied to every bed and clinical crib. */
const mapHolders = (record, settle) => {
  if (!isPlainObject(record?.beds)) return record;
  const beds = {};
  Object.entries(record.beds).forEach(([bedId, bed]) => {
    if (!isPlainObject(bed)) {
      beds[bedId] = bed;
      return;
    }
    const next = settle(bed, bedId, 'bed');
    beds[bedId] = isPlainObject(bed.clinicalCrib)
      ? { ...next, clinicalCrib: settle(bed.clinicalCrib, bedId, 'clinicalCrib') }
      : next;
  });
  return { ...record, beds };
};

/** Copy of `holder` whose moved fields are those of `source`; absent there, absent here. */
const withMovedFieldsOf = (holder, source) => {
  const next = { ...holder };
  CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
    if (isPlainObject(source) && hasOwn(source, field))
      next[field] = clonePlainValue(source[field]);
    else delete next[field];
  });
  return next;
};

/** Both moved fields, always present: null stands for "no value" (D2). */
const movedValues = holder =>
  Object.fromEntries(
    CLINICAL_DERIVED_MOVED_FIELDS.map(field => [
      field,
      isPlainObject(holder) && holder[field] !== undefined ? clonePlainValue(holder[field]) : null,
    ])
  );

const embedsMovedField = holder =>
  isPlainObject(holder) && CLINICAL_DERIVED_MOVED_FIELDS.some(field => holder[field] !== undefined);

/** Holders that may own an episode document: a valid id active only once in the day. */
const splittableHolders = record =>
  new Map(
    collectClinicalDerivedEpisodes(record).episodes.map(episode => [
      holderKey(episode.bedId, episode.target),
      episode,
    ])
  );

/** `beds.<bedId>[.clinicalCrib].<moved field>[...]`, else null. */
const parseMovedFieldPath = path => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts[0] !== 'beds' || !parts[1]) return null;
  const target = parts[2] === 'clinicalCrib' ? 'clinicalCrib' : 'bed';
  const fieldIndex = target === 'bed' ? 2 : 3;
  if (!MOVED_FIELDS.has(parts[fieldIndex])) return null;
  return {
    key: holderKey(parts[1], target),
    field: parts[fieldIndex],
    whole: parts.length === fieldIndex + 1,
  };
};

module.exports = {
  clonePlainValue,
  embedsMovedField,
  hasOwn,
  holderKey,
  holderOf,
  holderPath,
  isPlainObject,
  mapHolders,
  movedValues,
  parseMovedFieldPath,
  splittableHolders,
  withMovedFieldsOf,
};
