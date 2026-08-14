/**
 * Google Apps Script owned by the institutional Hospitalizados account.
 *
 * Script properties:
 * - HHR_HANDOFF_SHARED_SECRET (required)
 * - HHR_HANDOFF_FOLDER_ID (optional; resolved automatically when absent)
 * - HHR_HANDOFF_EDITOR_EMAILS (optional comma-separated users or Google Groups)
 */

const HHR_HANDOFF_PROPERTY_PREFIX = 'HHR_MEDICAL_HANDOFF_';
const HHR_HANDOFF_SHEET_NAME = 'Entrega médica';
const HHR_HANDOFF_DEFAULT_FOLDER_NAME = 'Entrega de turno médicos';
const HHR_HANDOFF_DRIVE_RETRY_DELAYS_MS = [400, 800, 1200];
const HHR_HANDOFF_HASHED_EPISODE_KEY_PATTERN = /^episode-h1:[a-f0-9]{96}$/;
const HHR_HANDOFF_HEADERS = [
  'Cama',
  'Paciente',
  'Edad',
  'Diagnóstico',
  'Especialidad',
  'Médico tratante',
  'Entrega de turno',
  '_hhr_key',
];

function doPost(event) {
  try {
    const payload = parseHhrPayload_(event);
    assertHhrSecret_(payload.secret);
    if (payload.action !== 'openOrCreate') {
      throw new Error('Acción no soportada.');
    }

    const request = validateHhrRequest_(payload);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return jsonHhrResponse_(openOrCreateHhrHandoff_(request));
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error('medical-handoff doPost failed: ' + (error && error.message));
    return jsonHhrResponse_({
      ok: false,
      error: 'No fue posible preparar la planilla institucional.',
    });
  }
}

function parseHhrPayload_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error('Solicitud vacía.');
  }
  const parsed = JSON.parse(event.postData.contents);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Solicitud inválida.');
  }
  return parsed;
}

function assertHhrSecret_(candidate) {
  const expected = PropertiesService.getScriptProperties().getProperty('HHR_HANDOFF_SHARED_SECRET');
  if (!expected || !constantTimeEquals_(String(candidate || ''), expected)) {
    throw new Error('Acceso denegado.');
  }
}

function constantTimeEquals_(left, right) {
  let mismatch = left.length ^ right.length;
  const comparisonLength = Math.max(left.length, right.length);
  for (let index = 0; index < comparisonLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function validateHhrRequest_(payload) {
  const date = String(payload.date || '').trim();
  if (!isValidHhrDate_(date)) {
    throw new Error('Fecha inválida.');
  }
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 80) {
    throw new Error('Filas inválidas.');
  }

  const stableKeys = {};
  return {
    date,
    rows: payload.rows.map(function (row, index) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Fila inválida.');
      }
      const normalizedRow = {
        stableKey: canonicalHhrStableKey_(requireHhrText_(row.stableKey, 180)),
        bed: requireHhrText_(row.bed, 50),
        patientName: requireHhrText_(row.patientName, 180),
        age: optionalHhrText_(row.age, 40),
        diagnosis: optionalHhrText_(row.diagnosis, 600),
        specialty: optionalHhrText_(row.specialty, 120),
        treatingPhysician: optionalHhrText_(row.treatingPhysician, 180),
      };
      if (!/^[A-Za-z0-9:._-]+$/.test(normalizedRow.stableKey)) {
        throw new Error('Identificador inválido en la fila ' + (index + 1) + '.');
      }
      if (stableKeys[normalizedRow.stableKey]) {
        throw new Error('Identificador repetido en la fila ' + (index + 1) + '.');
      }
      stableKeys[normalizedRow.stableKey] = true;
      return normalizedRow;
    }),
  };
}

function isValidHhrDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return (
    parsed.getUTCFullYear() === parts[0] &&
    parsed.getUTCMonth() === parts[1] - 1 &&
    parsed.getUTCDate() === parts[2]
  );
}

function requireHhrText_(value, maxLength) {
  const normalized = optionalHhrText_(value, maxLength);
  if (!normalized) throw new Error('Campo obligatorio vacío.');
  return normalized;
}

function optionalHhrText_(value, maxLength) {
  if (typeof value !== 'string') throw new Error('Campo de texto inválido.');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error('Campo demasiado extenso.');
  return normalized;
}

function canonicalHhrStableKey_(value) {
  const stableKey = String(value || '')
    .trim()
    .replace(/^'/, '');
  if (HHR_HANDOFF_HASHED_EPISODE_KEY_PATTERN.test(stableKey)) {
    return stableKey;
  }
  if (!stableKey.startsWith('episode:')) return stableKey;

  const legacyEpisodeId = stableKey.slice('episode:'.length);
  return legacyEpisodeId ? 'episode-h1:' + hashHhrText_(legacyEpisodeId) : stableKey;
}

function hashHhrText_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_384,
    value,
    Utilities.Charset.UTF_8
  );
  return digest
    .map(function (byte) {
      return ((byte + 256) % 256).toString(16).padStart(2, '0');
    })
    .join('');
}

function openOrCreateHhrHandoff_(request) {
  const properties = PropertiesService.getScriptProperties();
  const propertyKey = HHR_HANDOFF_PROPERTY_PREFIX + request.date.replace(/-/g, '_');
  let spreadsheet = openExistingHhrSpreadsheet_(properties.getProperty(propertyKey));
  let created = false;

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create(buildHhrSpreadsheetTitle_(request.date));
    properties.setProperty(propertyKey, spreadsheet.getId());
    created = true;
  }

  // Reconcile on every request so retries recover transient Drive failures and
  // existing daily spreadsheets also reach the configured institutional folder.
  moveHhrSpreadsheetToHandoffFolder_(spreadsheet.getId());
  grantConfiguredHhrEditors_(spreadsheet.getId());

  const sheet = resolveHhrSheet_(spreadsheet);
  upsertHhrRows_(sheet, request.rows);
  configureHhrSheet_(sheet);

  return {
    ok: true,
    created,
    spreadsheetUrl: spreadsheet.getUrl(),
    rowCount: request.rows.length,
  };
}

function openExistingHhrSpreadsheet_(spreadsheetId) {
  if (!spreadsheetId) return null;
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (_error) {
    return null;
  }
}

function buildHhrSpreadsheetTitle_(date) {
  const parts = date.split('-');
  return 'Entrega médica HHR - ' + parts[2] + '-' + parts[1] + '-' + parts[0];
}

function resolveHhrHandoffFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const configuredFolderId = String(properties.getProperty('HHR_HANDOFF_FOLDER_ID') || '').trim();
  if (configuredFolderId) {
    // An administrator-selected destination is authoritative. Let transient or
    // permission failures surface so a retry keeps the same folder contract.
    return DriveApp.getFolderById(configuredFolderId);
  }

  // This initializer is called only from openOrCreateHhrHandoff_, while doPost
  // owns the script lock. The property read/create/write sequence is therefore
  // serialized across concurrent web-app requests.
  // Do not recover by name: DriveApp may return a same-named folder shared by
  // an unrelated account. A newly created folder is private to the
  // institutional owner until grantConfiguredHhrEditors_ shares each file.
  const folder = DriveApp.createFolder(HHR_HANDOFF_DEFAULT_FOLDER_NAME);
  properties.setProperty('HHR_HANDOFF_FOLDER_ID', folder.getId());
  return folder;
}

function moveHhrSpreadsheetToHandoffFolder_(spreadsheetId) {
  // Resolve the destination first. This guarantees that the first request
  // creates the institutional folder even while Drive is still indexing the
  // newly created spreadsheet.
  const folder = resolveHhrHandoffFolder_();
  retryHhrDriveOperation_(function () {
    DriveApp.getFileById(spreadsheetId).moveTo(folder);
  });
}

function grantConfiguredHhrEditors_(spreadsheetId) {
  const rawEditors = PropertiesService.getScriptProperties().getProperty(
    'HHR_HANDOFF_EDITOR_EMAILS'
  );
  if (!rawEditors) return;
  const editors = rawEditors
    .split(',')
    .map(function (email) {
      return email.trim().toLowerCase();
    })
    .filter(Boolean);
  if (editors.length > 0) {
    retryHhrDriveOperation_(function () {
      DriveApp.getFileById(spreadsheetId).addEditors(editors);
    });
  }
}

function retryHhrDriveOperation_(operation) {
  let lastError;
  for (let attempt = 0; attempt <= HHR_HANDOFF_DRIVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (attempt < HHR_HANDOFF_DRIVE_RETRY_DELAYS_MS.length) {
        Utilities.sleep(HHR_HANDOFF_DRIVE_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastError;
}

function resolveHhrSheet_(spreadsheet) {
  const existing = spreadsheet.getSheetByName(HHR_HANDOFF_SHEET_NAME);
  if (existing) return existing;
  const sheets = spreadsheet.getSheets();
  const sheet = sheets[0];
  sheet.setName(HHR_HANDOFF_SHEET_NAME);
  return sheet;
}

function upsertHhrRows_(sheet, incomingRows) {
  const lastRow = sheet.getLastRow();
  const existingRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];
  const mergedRows = mergeHhrRows_(existingRows, incomingRows);

  const rowsToClear = Math.max(lastRow - 1, mergedRows.length);
  if (rowsToClear > 0) sheet.getRange(2, 1, rowsToClear, 8).clearContent();
  if (mergedRows.length > 0) {
    sheet.getRange(2, 1, mergedRows.length, 8).setValues(mergedRows);
  }
}

function mergeHhrRows_(existingRows, incomingRows) {
  const mergedRows = [];
  const rowIndexByKey = {};
  existingRows.forEach(function (existingRow) {
    const row = existingRow.slice();
    const stableKey = canonicalHhrStableKey_(row[7]);
    if (!stableKey) {
      mergedRows.push(row);
      return;
    }

    row[7] = safeHhrCell_(stableKey);
    const duplicateIndex = rowIndexByKey[stableKey];
    if (duplicateIndex === undefined) {
      rowIndexByKey[stableKey] = mergedRows.length;
      mergedRows.push(row);
      return;
    }

    row[6] = mergeHhrHandoffText_(mergedRows[duplicateIndex][6], row[6]);
    mergedRows[duplicateIndex] = row;
  });

  incomingRows.forEach(function (row) {
    const stableKey = canonicalHhrStableKey_(row.stableKey);
    const nextValues = [
      safeHhrCell_(row.bed),
      safeHhrCell_(row.patientName),
      safeHhrCell_(row.age),
      safeHhrCell_(row.diagnosis),
      safeHhrCell_(row.specialty),
      safeHhrCell_(row.treatingPhysician),
      '',
      safeHhrCell_(stableKey),
    ];
    const existingIndex = rowIndexByKey[stableKey];
    if (existingIndex === undefined) {
      rowIndexByKey[stableKey] = mergedRows.length;
      mergedRows.push(nextValues);
      return;
    }

    nextValues[6] = mergedRows[existingIndex][6];
    mergedRows[existingIndex] = nextValues;
  });

  return mergedRows;
}

function mergeHhrHandoffText_(firstValue, secondValue) {
  const first = String(firstValue || '').trim();
  const second = String(secondValue || '').trim();
  if (!first) return secondValue || '';
  if (!second || first === second) return firstValue;
  return firstValue + '\n\n---\n\n' + secondValue;
}

function safeHhrCell_(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function configureHhrSheet_(sheet) {
  sheet.getRange(1, 1, 1, 8).setValues([HHR_HANDOFF_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 240);
  sheet.setColumnWidth(3, 70);
  sheet.setColumnWidth(4, 320);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 180);
  sheet.setColumnWidth(7, 520);
  sheet.hideColumns(8);

  const lastRow = Math.max(sheet.getLastRow(), 2);
  sheet.getRange(1, 1, 1, 8).setBackground('#0f766e').setFontColor('#ffffff').setFontWeight('bold');
  sheet
    .getRange(2, 1, lastRow - 1, 7)
    .setVerticalAlignment('top')
    .setWrap(true);
  sheet.getRange('G1').setNote('Espacio libre para la entrega de turno del equipo médico.');
  sheet.getRange(2, 7, lastRow - 1, 1).setBackground('#fffceb');

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  sheet.getRange(1, 1, lastRow, 7).createFilter();

  sheet
    .getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(function (protection) {
      return String(protection.getDescription() || '').indexOf('HHR_') === 0;
    })
    .forEach(function (protection) {
      protection.remove();
    });
  protectHhrRange_(sheet.getRange(1, 1, 1, 8), 'HHR_CABECERA');
  protectHhrRange_(sheet.getRange(2, 1, sheet.getMaxRows() - 1, 6), 'HHR_DATOS_CENSO');
  protectHhrRange_(sheet.getRange(2, 8, sheet.getMaxRows() - 1, 1), 'HHR_IDENTIFICADOR');
}

function protectHhrRange_(range, description) {
  const protection = range.protect().setDescription(description);
  const editors = protection.getEditors();
  if (editors.length > 0) protection.removeEditors(editors);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function jsonHhrResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
