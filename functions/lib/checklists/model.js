const { HttpsError } = require('firebase-functions/v2/https');
const { isCalendarDay } = require('../hospitalCalendarDay');

/** @returns {never} */
const fail = (code, message) => {
  throw new HttpsError(code, message);
};
/** @returns {never} */
const invalid = message => fail('invalid-argument', message);
const keyPattern = /^[a-z][a-z0-9-]{0,59}$/;
const codePattern = /^PT-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = value =>
  typeof value === 'string' && keyPattern.test(value) && !Object.hasOwn(Object.prototype, value);
const label = (value, max = 160) =>
  typeof value === 'string' && value.trim() && value.length <= max && !/\p{Cc}/u.test(value);
const types = ['text', 'date', 'time', 'positive-integer', 'choice'];

function templateFrom(input) {
  if (
    !key(input?.id) ||
    !label(input.title) ||
    !Array.isArray(input.fields) ||
    !input.fields.length ||
    input.fields.length > 40
  )
    invalid('Revisa el título y los campos de la plantilla.');
  const fields = [];
  for (const raw of input.fields) {
    if (
      !key(raw?.id) ||
      fields.some(item => item.id === raw.id) ||
      !label(raw.label) ||
      !types.includes(raw.type) ||
      typeof raw.required !== 'boolean'
    )
      invalid('Cada campo necesita un identificador único, un título y un tipo.');
    const item = { id: raw.id, label: raw.label.trim(), type: raw.type, required: raw.required };
    if (typeof raw.shortCode === 'string' && /^[A-Z]{1,4}$/.test(raw.shortCode)) {
      item.shortCode = raw.shortCode;
    }
    if (raw.type === 'choice') {
      if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 30)
        invalid('Escribe entre 2 y 30 opciones.');
      const options = raw.options.map(option => {
        if (
          !label(option?.label) ||
          (option.points !== undefined &&
            (!Number.isInteger(option.points) || option.points < 0 || option.points > 1000))
        )
          invalid('Revisa las opciones y sus puntos.');
        return {
          label: option.label.trim(),
          ...(option.points !== undefined ? { points: option.points } : {}),
        };
      });
      if (
        new Set(options.map(option => option.label)).size !== options.length ||
        (options.some(option => option.points !== undefined) &&
          options.some(option => option.points === undefined))
      )
        invalid(
          'Usa opciones distintas. Si calificas un campo, asigna puntos a todas sus opciones.'
        );
      item.options = options;
    }
    if (raw.requiredWhen) {
      const earlier = fields.find(field => field.id === raw.requiredWhen.field);
      if (!earlier?.options?.some(option => option.label === raw.requiredWhen.equals))
        invalid('Revisa la condición de obligatoriedad.');
      item.requiredWhen = { field: earlier.id, equals: raw.requiredWhen.equals };
    }
    fields.push(item);
  }
  return { id: input.id, title: input.title.trim(), fields };
}

function applicationFrom(template, answers) {
  if (
    !answers ||
    typeof answers !== 'object' ||
    Array.isArray(answers) ||
    Object.keys(answers).some(id => !template.fields.some(field => field.id === id))
  )
    invalid('Las respuestas no corresponden a esta versión.');
  const rows = [];
  const subscores = {};
  let points = 0,
    maximum = 0,
    scored = false;
  for (const field of template.fields) {
    const raw = answers[field.id] ?? '';
    if (
      typeof raw !== 'string' ||
      raw.length > 2000 ||
      /\p{Cc}/u.test(raw.replace(/[\t\r\n]/g, ''))
    )
      invalid('Revisa la respuesta de ' + field.label + '.');
    const value = raw.trim();
    const required =
      field.required ||
      (field.requiredWhen &&
        rows.some(
          row => row.field === field.requiredWhen.field && row.value === field.requiredWhen.equals
        ));
    if (!value) {
      if (required) invalid('Completa el campo «' + field.label + '».');
      continue;
    }
    let selectedPoints;
    if (field.type === 'choice') {
      const selected = field.options.find(option => option.label === value);
      if (!selected) invalid('Opción inválida en «' + field.label + '».');
      if (selected.points !== undefined) {
        scored = true;
        selectedPoints = selected.points;
        points += selected.points;
        maximum += Math.max(...field.options.map(option => option.points));
        if (field.shortCode) subscores[field.shortCode] = selected.points;
      }
    }
    if (field.type === 'date' && !isCalendarDay(value))
      invalid('Fecha inválida en «' + field.label + '».');
    if (field.type === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      invalid('Hora inválida.');
    if (field.type === 'positive-integer' && !/^[1-9]\d{0,5}$/.test(value))
      invalid('Se necesita un número entero positivo.');
    rows.push({
      field: field.id,
      ...(field.shortCode ? { shortCode: field.shortCode } : {}),
      label: field.label,
      value,
      ...(selectedPoints !== undefined ? { points: selectedPoints } : {}),
    });
  }
  if (!rows.length) invalid('Completa al menos un campo.');
  const score = scored ? { points, maximum } : null;
  if (score && Object.keys(subscores).length) score.subscores = subscores;
  if (template.riskBands && score) {
    const { highMax, moderateMax } = template.riskBands;
    const band = points <= highMax ? 'alto' : points <= moderateMax ? 'moderado' : 'bajo';
    score.risk = band;
    score.reassess = { alto: 'Cada 24 h', moderado: 'Cada 72 h', bajo: 'Cada 7 días' }[band];
    const carePlan = template.carePlans?.[band];
    if (Array.isArray(carePlan) && carePlan.length) score.carePlan = [...carePlan];
  }
  return { rows, score };
}

function patientForEncounter(record, episode, identifier) {
  const entries = Object.values(record?.beds ?? {}).flatMap(bed => [bed, bed?.clinicalCrib]);
  const matches = entries.filter(person => person && String(person.clinicalEpisodeId) === episode);
  if (matches.length === 0)
    fail(
      'failed-precondition',
      'Este episodio no figura en el censo vigente de HHR. Sincroniza el censo en HHR y vuelve a intentar.'
    );
  if (matches.length > 1)
    fail(
      'failed-precondition',
      'El censo vigente tiene más de un registro con ese episodio. Revisa el censo en HHR antes de aplicar la pauta.'
    );
  const person = matches[0];
  const normalize = value => {
    const text = String(value ?? '')
      .trim()
      .toUpperCase();
    return person?.documentType === 'Pasaporte' ? text : text.replace(/[.\s-]/g, '');
  };
  if (
    person.isBlocked ||
    !person.patientName?.trim() ||
    !['RUT', 'Pasaporte'].includes(person.documentType || 'RUT') ||
    !(person.documentType === 'Pasaporte'
      ? normalize(identifier).length >= 2
      : /^\d{6,9}[\dK]$/.test(normalize(identifier))) ||
    normalize(person.rut) !== normalize(identifier)
  )
    fail(
      'failed-precondition',
      'El censo vigente no confirma un único paciente con ese episodio y documento.'
    );
  return { name: person.patientName.trim(), document: person.rut, episode };
}

function evolutionText(record) {
  const when = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Pacific/Easter',
  }).format(new Date(record.savedAt));
  const subscoreLine =
    record.score?.subscores && Object.keys(record.score.subscores).length
      ? 'Subpuntajes: ' +
        Object.entries(record.score.subscores)
          .map(([shortCode, pts]) => shortCode + ' ' + pts)
          .join(' · ')
      : null;
  const riskLabel = record.score?.risk
    ? record.score.risk.charAt(0).toUpperCase() + record.score.risk.slice(1)
    : null;
  return [
    (record.template?.scaleGroup === 'braden'
      ? 'Valoración de riesgo de lesiones por presión · '
      : 'Aplicación pauta ') + record.template.title,
    when + ' · ' + record.authorName,
    ...(subscoreLine ? [subscoreLine] : []),
    ...record.rows.map(row => row.label + ': ' + row.value),
    ...(record.score ? ['Puntaje: ' + record.score.points + ' / ' + record.score.maximum] : []),
    ...(record.score?.risk
      ? [
          'Riesgo de LPP según escala: ' + riskLabel + ' (' + record.score.risk + ')',
          'Reevaluar: ' +
            record.score.reassess +
            ' (o antes ante cambios en la condición clínica).',
        ]
      : []),
    ...(Array.isArray(record.score?.carePlan) && record.score.carePlan.length
      ? ['Cuidados planeados según riesgo:', ...record.score.carePlan.map(item => '• ' + item)]
      : []),
    'Código de verificación: ' + record.code,
  ].join('\n');
}

module.exports = {
  applicationFrom,
  codePattern,
  evolutionText,
  fail,
  key,
  patientForEncounter,
  templateFrom,
};
