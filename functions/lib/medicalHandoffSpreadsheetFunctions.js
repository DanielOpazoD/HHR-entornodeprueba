const functions = require('firebase-functions/v1');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');

const HANDOFF_SPREADSHEET_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);
const MAX_ROWS = 80;
const APPS_SCRIPT_TIMEOUT_MS = 50_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STABLE_KEY_PATTERN = /^[A-Za-z0-9:._-]+$/;
const SPREADSHEET_URL_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:\/.*)?$/;

const FIELD_LIMITS = Object.freeze({
  stableKey: 180,
  bed: 50,
  patientName: 180,
  age: 40,
  diagnosis: 600,
  specialty: 120,
  treatingPhysician: 180,
});

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const parseTextField = (value, fieldName, { required = false } = {}) => {
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `El campo ${fieldName} debe ser texto.`
    );
  }

  const normalized = value.trim();
  if (required && !normalized) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `El campo ${fieldName} es obligatorio.`
    );
  }

  if (normalized.length > FIELD_LIMITS[fieldName]) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `El campo ${fieldName} supera el largo permitido.`
    );
  }

  return normalized;
};

const parseRows = rawRows => {
  if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > MAX_ROWS) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `La planilla debe contener entre 1 y ${MAX_ROWS} pacientes.`
    );
  }

  const stableKeys = new Set();
  return rawRows.map((rawRow, index) => {
    if (!isPlainObject(rawRow)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `La fila ${index + 1} no es válida.`
      );
    }

    const row = {
      stableKey: parseTextField(rawRow.stableKey, 'stableKey', { required: true }),
      bed: parseTextField(rawRow.bed, 'bed', { required: true }),
      patientName: parseTextField(rawRow.patientName, 'patientName', { required: true }),
      age: parseTextField(rawRow.age, 'age'),
      diagnosis: parseTextField(rawRow.diagnosis, 'diagnosis'),
      specialty: parseTextField(rawRow.specialty, 'specialty'),
      treatingPhysician: parseTextField(rawRow.treatingPhysician, 'treatingPhysician'),
    };

    if (!STABLE_KEY_PATTERN.test(row.stableKey)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `La fila ${index + 1} contiene un identificador no válido.`
      );
    }

    if (stableKeys.has(row.stableKey)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `La fila ${index + 1} repite un identificador de paciente.`
      );
    }
    stableKeys.add(row.stableKey);
    return row;
  });
};

const parseDate = value => {
  const date = typeof value === 'string' ? value.trim() : '';
  if (!DATE_PATTERN.test(date)) {
    throw new functions.https.HttpsError('invalid-argument', 'La fecha del censo no es válida.');
  }

  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new functions.https.HttpsError('invalid-argument', 'La fecha del censo no es válida.');
  }
  return date;
};

const parseAppsScriptUrl = value => {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_error) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'La integración institucional de Google Sheets no está configurada.'
    );
  }

  const isAppsScriptDeployment =
    url.protocol === 'https:' &&
    url.hostname === 'script.google.com' &&
    /^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname);

  if (!isAppsScriptDeployment) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'La URL configurada para Google Sheets no corresponde a un despliegue de Apps Script.'
    );
  }

  return url.toString();
};

const parseGatewayResponse = rawResponse => {
  if (!isPlainObject(rawResponse) || rawResponse.ok !== true) {
    throw new functions.https.HttpsError(
      'unavailable',
      'Google Sheets no pudo preparar la entrega médica. Reintenta en unos segundos.'
    );
  }

  const spreadsheetUrl = String(rawResponse.spreadsheetUrl || '').trim();
  if (!SPREADSHEET_URL_PATTERN.test(spreadsheetUrl)) {
    throw new functions.https.HttpsError(
      'unavailable',
      'Google Sheets devolvió una dirección de planilla no válida.'
    );
  }

  const rowCount = Number(rawResponse.rowCount);
  return {
    spreadsheetUrl,
    created: rawResponse.created === true,
    rowCount: Number.isInteger(rowCount) && rowCount >= 0 ? rowCount : 0,
  };
};

const defaultReadConfig = () => ({
  appsScriptUrl: process.env.MEDICAL_HANDOFF_APPS_SCRIPT_URL,
  sharedSecret: process.env.MEDICAL_HANDOFF_SHARED_SECRET,
});

const createMedicalHandoffSpreadsheetFunctions = ({
  resolveRoleForEmail,
  fetchImpl = global.fetch,
  readConfig = defaultReadConfig,
  auditLogger = console.info,
}) => ({
  openMedicalHandoffSpreadsheet: functions
    .runWith({
      timeoutSeconds: 60,
      memory: '256MB',
      secrets: ['MEDICAL_HANDOFF_APPS_SCRIPT_URL', 'MEDICAL_HANDOFF_SHARED_SECRET'],
    })
    .https.onCall(async (data, context) => {
      const email = requireAuthenticatedEmail(context);
      const role = await resolveRoleForEmail(email);
      if (!HANDOFF_SPREADSHEET_ALLOWED_ROLES.has(role)) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Tu perfil no puede crear planillas de entrega médica.'
        );
      }

      const date = parseDate(data?.date);
      const rows = parseRows(data?.rows);
      const config = readConfig();
      const appsScriptUrl = parseAppsScriptUrl(config?.appsScriptUrl);
      const sharedSecret = String(config?.sharedSecret || '').trim();
      if (sharedSecret.length < 24) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'La integración institucional de Google Sheets no está configurada.'
        );
      }
      if (typeof fetchImpl !== 'function') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'El entorno no permite conectar con Google Sheets.'
        );
      }

      let response;
      try {
        response = await fetchImpl(appsScriptUrl, {
          method: 'POST',
          redirect: 'follow',
          signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'openOrCreate',
            secret: sharedSecret,
            date,
            rows,
          }),
        });
      } catch (_error) {
        throw new functions.https.HttpsError(
          'unavailable',
          'No fue posible conectar con Google Sheets. Reintenta en unos segundos.'
        );
      }

      if (!response?.ok) {
        throw new functions.https.HttpsError(
          'unavailable',
          'Google Sheets no respondió correctamente. Revisa el despliegue institucional.'
        );
      }

      let gatewayResponse;
      try {
        gatewayResponse = JSON.parse(await response.text());
      } catch (_error) {
        throw new functions.https.HttpsError(
          'unavailable',
          'Google Sheets devolvió una respuesta inesperada.'
        );
      }

      const result = parseGatewayResponse(gatewayResponse);
      auditLogger({
        event: 'MEDICAL_HANDOFF_SHEET_EXPORTED',
        actorUid: context.auth?.uid || null,
        date,
        rowCount: result.rowCount,
        created: result.created,
      });

      return {
        ...result,
        date,
      };
    }),
});

module.exports = {
  createMedicalHandoffSpreadsheetFunctions,
};
