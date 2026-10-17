import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const own = (object, key) => Object.hasOwn(object, key);
const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const day = value =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checklists = {
  handoffDayChecklist: ['escalaBraden', 'escalaRiesgoCaidas', 'escalaRiesgoLPP'],
  handoffNightChecklist: [
    'estadistica',
    'categorizacionCudyr',
    'encuestaUTI',
    'encuestaMedias',
    'conteoMedicamento',
    'conteoNoControlados',
  ],
};
const dates = ['conteoNoControladosProximaFecha', 'conteoMedicamentoProximaFecha'];
const novedades = ['handoffNovedadesDayShift', 'handoffNovedadesNightShift'];

/** Only stored shift context. No patient, staffing, movement or CUDYR clinical patches. */
export const planHandoffContext = (
  { source, target, dates: selected, throughDate },
  now = new Date()
) => {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (
    !map(source) ||
    !map(target) ||
    !day(throughDate) ||
    throughDate >= today ||
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 3 ||
    new Set(selected).size !== selected.length ||
    selected.some(date => !day(date) || date < '2026-07-01' || date > throughDate)
  )
    throw new Error('invalid_handoff_context_scope');
  const patches = [],
    cases = [];
  for (const date of [...selected].sort()) {
    const old = source[date],
      current = target[date];
    if (!map(old) || !map(current) || old.date !== date || current.date !== date)
      throw new Error('handoff_context_day_missing_or_mismatched');
    const propose = (path, value, present, expected, kind) => {
      cases.push({ date, field: path.join('.'), state: 'candidate', kind });
      patches.push({ date, path, value, expectedPresent: present, expectedValue: expected });
    };
    for (const [group, keys] of Object.entries(checklists)) {
      if (!own(old, group)) continue;
      if (!map(old[group]) || (own(current, group) && !map(current[group]))) {
        cases.push({ date, field: group, state: 'review', kind: 'invalid_checklist_shape' });
        continue;
      }
      for (const key of [...keys, ...(group === 'handoffNightChecklist' ? dates : [])]) {
        if (!own(old[group], key)) continue;
        const value = old[group][key];
        const kind = keys.includes(key) ? 'checkbox' : 'scheduled_date';
        if (
          (kind === 'checkbox' && typeof value !== 'boolean') ||
          (kind === 'scheduled_date' && !day(value))
        ) {
          cases.push({
            date,
            field: group + '.' + key,
            state: 'review',
            kind: 'invalid_source_value',
          });
          continue;
        }
        // false, null and empty strings are explicit target values; none are overwritten.
        if (own(current[group] || {}, key)) {
          cases.push({
            date,
            field: group + '.' + key,
            state: current[group][key] === value ? 'equal' : 'preserve_target',
            kind,
          });
        } else propose([group, key], value, false, undefined, kind);
      }
    }
    for (const field of novedades) {
      if (typeof old[field] !== 'string' || !old[field].trim()) continue;
      const value = current[field];
      if (value == null || (typeof value === 'string' && !value.trim()))
        propose([field], old[field], own(current, field), value, 'novedades');
      else
        cases.push({
          date,
          field,
          state: value === old[field] ? 'equal' : 'preserve_target',
          kind: 'novedades',
        });
    }
  }
  return {
    patches,
    report: {
      schemaVersion: 1,
      dates: [...selected].sort(),
      throughDate,
      observedLocalDate: today,
      scopeDigest: hash([[...selected].sort(), throughDate]),
      cases,
      plannedFields: patches.length,
      sourceDigest: hash(source),
      targetDigest: hash(target),
      cloudWrites: 0,
      authorizesMigration: false,
    },
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('no_mutation_mode');
    const { report } = planHandoffContext(JSON.parse(readFileSync(0, 'utf8')));
    console.log(JSON.stringify(report));
  } catch {
    console.error('No se pudo preparar el contexto de enfermería. No se modificaron datos.');
    process.exitCode = 1;
  }
}
