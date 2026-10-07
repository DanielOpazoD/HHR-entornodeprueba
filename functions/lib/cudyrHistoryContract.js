const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const { parseCapture } = require('./cudyrCaptureContract');

const fail = message => {
  throw new functions.https.HttpsError('invalid-argument', message);
};
const text = (value, field, max, optional = false) => {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Invalid ${field}.`);
  return value.trim();
};
const isoDate = value => {
  const date = text(value, 'date', 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    fail('Invalid calendar date.');
  }
  return date;
};
const zonedTime = value => {
  const date = text(value, 'recordedAt', 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(date) ||
    !Number.isFinite(Date.parse(date))
  )
    fail('recordedAt requires a valid timestamp with offset.');
  isoDate(date.slice(0, 10));
  return date;
};
const score = (value, max) => {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > max) fail('Invalid CUDYR score.');
  return value;
};

const parseEvaluation = value => {
  const category = text(value?.category, 'category', 2).toUpperCase();
  if (!/^[A-D][1-3]$/.test(category)) fail('Invalid CUDYR category.');
  if (value.source !== 'gestion_camas')
    fail('Only official Gestión de Camas history is supported.');
  const rawItems = value.items ?? [];
  if (!Array.isArray(rawItems) || rawItems.length > 14) fail('Invalid CUDYR items.');
  const items = rawItems
    .map(item => ({
      fieldId: text(item?.fieldId, 'fieldId', 80),
      label: text(item?.label, 'label', 300, true),
      typeId: score(item?.typeId, 2),
      value: text(item?.value, 'value', 100),
    }))
    .sort((a, b) => (a.fieldId < b.fieldId ? -1 : a.fieldId > b.fieldId ? 1 : 0));
  if (new Set(items.map(item => item.fieldId)).size !== items.length) fail('Duplicate item.');
  if (value.isDeleted !== undefined && typeof value.isDeleted !== 'boolean')
    fail('Invalid isDeleted.');
  return {
    clinicalEpisodeId: text(value.clinicalEpisodeId, 'clinicalEpisodeId', 120),
    sourceEvaluationId: text(value.sourceEvaluationId, 'sourceEvaluationId', 120),
    source: 'gestion_camas',
    recordedAt: zonedTime(value.recordedAt),
    category,
    authorId: text(value.authorId, 'authorId', 120, true),
    author: text(value.author, 'author', 200, true),
    authorRoleId: text(value.authorRoleId, 'authorRoleId', 80, true),
    authorRole: text(value.authorRole, 'authorRole', 100, true),
    sourceVersion: text(value.sourceVersion, 'sourceVersion', 160, true),
    isDeleted: value.isDeleted === true,
    dependencyScore: score(value.dependencyScore, 18),
    riskScore: score(value.riskScore, 24),
    items,
  };
};

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evaluationKey = (hospitalId, evaluation) =>
  digest([
    hospitalId,
    evaluation.clinicalEpisodeId,
    evaluation.source,
    evaluation.sourceEvaluationId,
  ]);
const observationKey = (hospitalId, evaluation) =>
  digest([evaluationKey(hospitalId, evaluation), evaluation]);

const parseArchiveRequest = value => {
  if (value?.schemaVersion !== 1) fail('Unsupported CUDYR history contract.');
  // The hospital is bound by the server runtime, never selected by the caller.
  if (value.hospitalId !== undefined) fail('hospitalId cannot be supplied.');
  if (
    !Array.isArray(value.evaluations) ||
    (!value.evaluations.length && !value.capture) ||
    value.evaluations.length > 32 ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > 500_000
  )
    fail('Invalid CUDYR history batch.');
  const evaluations = value.evaluations.map(parseEvaluation);
  const capture = parseCapture(value.capture, evaluations);
  if (new Set(evaluations.map(item => digest(item))).size !== evaluations.length)
    fail('Duplicate observation.');
  return {
    schemaVersion: 1,
    authorityDate: isoDate(value.authorityDate),
    runId: text(value.runId, 'runId', 120),
    evaluations,
    ...(capture ? { capture } : {}),
  };
};

const parseHistoryQuery = value => {
  if (value?.hospitalId !== undefined) fail('hospitalId cannot be supplied.');
  const from = isoDate(value?.from),
    to = isoDate(value?.to);
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 31)
    fail('Query up to 32 calendar days.');
  const limit = value.limit ?? 100;
  const kind = value.kind ?? 'observations';
  if (!['observations', 'captures'].includes(kind)) fail('Invalid history kind.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('Invalid page size.');
  let cursor;
  if (value.cursor) {
    const date = isoDate(value.cursor.date);
    const id = text(value.cursor.id, 'cursor id', 64);
    if (!/^[a-f0-9]{64}$/.test(id) || date < from || date > to) fail('Invalid cursor.');
    cursor = { date, id };
  }
  return { from, to, limit, cursor, kind };
};

/** Same owning-night convention as importedCudyr.ts; original source time remains untouched. */
const owningCensusDate = recordedAt => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(recordedAt))
      .map(part => [part.type, part.value])
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  if (seconds < 60 || seconds >= 43_200) return day;
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
};

module.exports = {
  parseArchiveRequest,
  parseHistoryQuery,
  evaluationKey,
  observationKey,
  owningCensusDate,
};
