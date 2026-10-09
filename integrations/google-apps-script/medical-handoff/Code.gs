/**
 * Google Apps Script owned by the institutional Hospitalizados account.
 *
 * Script properties:
 * - HHR_HANDOFF_SHARED_SECRET (required)
 * - HHR_HANDOFF_FOLDER_ID (optional; resolved automatically when absent)
 * - HHR_HANDOFF_EDITOR_EMAILS (optional comma-separated users or Google Groups)
 * - HHR_HANDOFF_SPECIALIST_EMAILS (frozen specialist roster, independent of Drive roles)
 */

const HHR_HANDOFF_PROPERTY_PREFIX = 'HHR_MEDICAL_HANDOFF_';
const HHR_HANDOFF_SHEET_NAME = 'Entrega médica';
const HHR_HANDOFF_DEFAULT_FOLDER_NAME = 'Entrega de turno médicos';
const HHR_HANDOFF_DRIVE_RETRY_DELAYS_MS = [400, 800, 1200];
const HHR_HANDOFF_ERROR_CODES = {
  FOLDER_UNAVAILABLE: 'folder_unavailable',
  OPERATION_BUSY: 'operation_busy',
  REQUEST_REJECTED: 'request_rejected',
  SHEET_UPDATE_FAILED: 'sheet_update_failed',
};
const HHR_HANDOFF_HASHED_EPISODE_KEY_PATTERN = /^episode-h1:[a-f0-9]{96}$/;
const HHR_HANDOFF_NOTES_KEY = '__hhr_shared_notes__';
const HHR_HANDOFF_NOTES_ROWS = 12;
const HHR_HANDOFF_ADMISSIONS_KEY = '__hhr_new_admissions__';
const HHR_HANDOFF_ADMISSIONS_ROWS = 5;
const HHR_HANDOFF_SPECIALTIES = [
  'Med Interna',
  'Cirugía',
  'Traumatología',
  'Ginecobstetricia',
  'Psiquiatría',
  'Pediatría',
  'Odontología',
  'Otro',
];
const HHR_HANDOFF_HEADERS = [
  'Cama',
  'Paciente',
  'Fecha de ingreso',
  'Diagnóstico',
  'Especialidad',
  'Médico tratante',
  'Entrega de turno',
  'Observaciones',
  'Indicaciones médicas',
  '_hhr_key',
];
const HHR_HANDOFF_COLUMN_WIDTHS_PX = [63, 138, 92, 140, 120, 133, 354, 210, 161];

function doPost(event) {
  try {
    const request = parseValidatedHhrRequest_(event);
    const lock = acquireHhrScriptLock_();
    try {
      return jsonHhrResponse_(openOrCreateHhrHandoff_(request));
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    const errorCode = resolveHhrSafeErrorCode_(error);
    console.error('medical-handoff doPost failed: ' + errorCode);
    return jsonHhrResponse_({
      ok: false,
      errorCode,
      error: resolveHhrSafeErrorMessage_(errorCode),
    });
  }
}

function createHhrOperationalError_(errorCode) {
  const error = new Error(errorCode);
  error.hhrCode = errorCode;
  return error;
}

function resolveHhrSafeErrorCode_(error) {
  const errorCode = error && error.hhrCode;
  if (errorCode === HHR_HANDOFF_ERROR_CODES.FOLDER_UNAVAILABLE) return errorCode;
  if (errorCode === HHR_HANDOFF_ERROR_CODES.OPERATION_BUSY) return errorCode;
  if (errorCode === HHR_HANDOFF_ERROR_CODES.REQUEST_REJECTED) return errorCode;
  if (errorCode === HHR_HANDOFF_ERROR_CODES.SHEET_UPDATE_FAILED) return errorCode;
  return HHR_HANDOFF_ERROR_CODES.SHEET_UPDATE_FAILED;
}

function parseValidatedHhrRequest_(event) {
  try {
    const payload = parseHhrPayload_(event);
    assertHhrSecret_(payload.secret);
    if (payload.action !== 'openOrCreate') {
      throw new Error('Acción no soportada.');
    }
    return validateHhrRequest_(payload);
  } catch (_error) {
    throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.REQUEST_REJECTED);
  }
}

function resolveHhrSafeErrorMessage_(errorCode) {
  if (errorCode === HHR_HANDOFF_ERROR_CODES.FOLDER_UNAVAILABLE) {
    return 'Google Drive no permitió preparar la carpeta institucional.';
  }
  if (errorCode === HHR_HANDOFF_ERROR_CODES.REQUEST_REJECTED) {
    return 'La integración institucional rechazó la solicitud.';
  }
  if (errorCode === HHR_HANDOFF_ERROR_CODES.OPERATION_BUSY) {
    return 'La entrega médica está procesando otra solicitud.';
  }
  return 'La planilla diaria existe, pero no se pudo actualizar.';
}

function acquireHhrScriptLock_() {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    return lock;
  } catch (_error) {
    throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.OPERATION_BUSY);
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
        patientName: requireHhrText_(row.patientName, 240),
        age: optionalHhrText_(row.age, 40),
        admissionDate: optionalHhrText_(row.admissionDate, 10),
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
  const storageStatus = moveHhrSpreadsheetToHandoffFolder_(spreadsheet.getId());
  grantConfiguredHhrEditors_(spreadsheet.getId());

  const sheet = resolveHhrSheet_(spreadsheet);
  ensureHhrSheetColumnCapacity_(sheet);
  const dataLastRow = upsertHhrRows_(sheet, request.rows);
  configureHhrSheet_(sheet, dataLastRow);

  return {
    ok: true,
    created,
    spreadsheetUrl: spreadsheet.getUrl(),
    rowCount: request.rows.length,
    storageStatus,
  };
}

function openExistingHhrSpreadsheet_(spreadsheetId) {
  if (!spreadsheetId) return null;
  try {
    return retryHhrDriveOperation_(function () {
      return SpreadsheetApp.openById(spreadsheetId);
    });
  } catch (_error) {
    // Never replace a registered daily sheet after a transient read failure:
    // that could split or hide notes already written by the medical team.
    throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.SHEET_UPDATE_FAILED);
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
    let recoveryAttempted = false;
    try {
      return retryHhrDriveOperation_(function () {
        const configuredFolder = DriveApp.getFolderById(configuredFolderId);
        // Force Drive to verify that the executing institutional account can
        // still read the configured destination before it is reused.
        configuredFolder.getName();
        if (configuredFolder.isTrashed()) {
          // Restore the same destination so every historical daily sheet and
          // its existing sharing policy remain attached to the configured ID.
          recoveryAttempted = true;
          configuredFolder.setTrashed(false);
        }
        return {
          folder: configuredFolder,
          storageStatus: recoveryAttempted ? 'recovered' : 'configured',
        };
      });
    } catch (_error) {
      // Timeouts, quotas and generic Drive outages are ambiguous. Preserve the
      // administrator-selected destination so a transient failure cannot
      // silently redirect institutional files to a new private folder.
      throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.FOLDER_UNAVAILABLE);
    }
  }

  // This initializer is called only from openOrCreateHhrHandoff_, while doPost
  // owns the script lock. The property read/create/write sequence is therefore
  // serialized across concurrent web-app requests.
  // Do not recover by name: DriveApp may return a same-named folder shared by
  // an unrelated account. A newly created folder is private to the
  // institutional owner until grantConfiguredHhrEditors_ shares each file.
  return createAndRememberHhrHandoffFolder_(properties, 'created');
}

function createAndRememberHhrHandoffFolder_(properties, storageStatus) {
  let folder;
  try {
    // Folder creation is not idempotent. Never retry this mutation: Drive can
    // commit it and still return an ambiguous timeout to the caller.
    folder = DriveApp.createFolder(HHR_HANDOFF_DEFAULT_FOLDER_NAME);
  } catch (_error) {
    throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.FOLDER_UNAVAILABLE);
  }

  try {
    properties.setProperty('HHR_HANDOFF_FOLDER_ID', folder.getId());
    return { folder, storageStatus };
  } catch (_error) {
    // Avoid leaving an untracked institutional destination if the property
    // registry cannot record the newly created folder.
    try {
      folder.setTrashed(true);
    } catch (_cleanupError) {
      // Best effort only; the original configuration failure is authoritative.
    }
    throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.FOLDER_UNAVAILABLE);
  }
}

function moveHhrSpreadsheetToHandoffFolder_(spreadsheetId) {
  // Resolve the destination first. This guarantees that the first request
  // creates the institutional folder even while Drive is still indexing the
  // newly created spreadsheet.
  const destination = resolveHhrHandoffFolder_();
  try {
    retryHhrDriveOperation_(function () {
      DriveApp.getFileById(spreadsheetId).moveTo(destination.folder);
    });
  } catch (_error) {
    throw createHhrOperationalError_(HHR_HANDOFF_ERROR_CODES.FOLDER_UNAVAILABLE);
  }
  return destination.storageStatus;
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

function ensureHhrSheetColumnCapacity_(sheet) {
  const requiredColumns = HHR_HANDOFF_HEADERS.length;
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function trimHhrSheetToCurrentSchema_(sheet) {
  const requiredColumns = HHR_HANDOFF_HEADERS.length;
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns > requiredColumns) {
    sheet.deleteColumns(requiredColumns + 1, currentColumns - requiredColumns);
  }
}

function upsertHhrRows_(sheet, incomingRows) {
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), 8);
  const existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const schemaIsCurrent = isCurrentHhrSchema_(existingHeaders);
  const rawExistingRows =
    lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];
  const keyColumnIndex = findHhrHeaderIndex_(existingHeaders, '_hhr_key');
  const notesIndex = rawExistingRows.findIndex(function (row) {
    return keyColumnIndex >= 0 && row[keyColumnIndex] === HHR_HANDOFF_NOTES_KEY;
  });
  const patientRows = (
    notesIndex >= 0 ? rawExistingRows.slice(0, notesIndex) : rawExistingRows
  ).slice();
  // Blank separator rows belong to the shared notes area, not the patient table.
  while (
    patientRows.length &&
    patientRows[patientRows.length - 1].every(function (value) {
      return value === '' || value === null;
    })
  ) {
    patientRows.pop();
  }
  const existingRows = normalizeExistingHhrRows_(existingHeaders, patientRows);
  const mergedRows = mergeHhrRows_(existingRows, incomingRows);

  if (notesIndex >= 0) {
    const notesRow = notesIndex + 2;
    const extraRows = mergedRows.length + 4 - notesRow;
    if (extraRows > 0) sheet.insertRowsBefore(notesRow, extraRows);
  }

  const rowsToClear = Math.max(existingRows.length, mergedRows.length);
  if (rowsToClear > 0) {
    sheet.getRange(2, 1, rowsToClear, 4).clearContent();
    sheet.getRange(2, 10, rowsToClear, 1).clearContent();
  }
  if (mergedRows.length > 0) {
    sheet.getRange(2, 1, mergedRows.length, 4).setValues(
      mergedRows.map(function (row) {
        return row.slice(0, 4);
      })
    );
    sheet.getRange(2, 10, mergedRows.length, 1).setValues(
      mergedRows.map(function (row) {
        return [row[9]];
      })
    );

    mergedRows.forEach(function (row, index) {
      const existingRow = existingRows[index];
      const keepsSameEpisode =
        existingRow && canonicalHhrStableKey_(existingRow[9]) === canonicalHhrStableKey_(row[9]);
      // Do not rewrite editable cells for a stable episode: someone may be typing
      // in Sheets while the census request is in flight.
      for (let columnIndex = 4; columnIndex <= 8; columnIndex += 1) {
        const keepsSameValue =
          existingRow && String(existingRow[columnIndex] || '') === String(row[columnIndex] || '');
        if (!schemaIsCurrent || !keepsSameEpisode || !keepsSameValue) {
          sheet.getRange(index + 2, columnIndex + 1, 1, 1).setValue(row[columnIndex]);
        }
      }
    });
  }

  const surplusRows = rowsToClear - mergedRows.length;
  if (surplusRows > 0) {
    sheet.getRange(mergedRows.length + 2, 5, surplusRows, 5).clearContent();
  }
  return Math.max(mergedRows.length + 1, 2);
}

function normalizeHhrHeader_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function findHhrHeaderIndex_(headers, expectedHeader) {
  const normalizedExpected = normalizeHhrHeader_(expectedHeader);
  return headers.findIndex(function (header) {
    return normalizeHhrHeader_(header) === normalizedExpected;
  });
}

function isCurrentHhrSchema_(headers) {
  return HHR_HANDOFF_HEADERS.every(function (header, index) {
    return normalizeHhrHeader_(headers[index]) === normalizeHhrHeader_(header);
  });
}

function normalizeExistingHhrRows_(headers, rows) {
  const indexes = {
    bed: findHhrHeaderIndex_(headers, 'Cama'),
    patientName: findHhrHeaderIndex_(headers, 'Paciente'),
    age: findHhrHeaderIndex_(headers, 'Edad'),
    admissionDate: findHhrHeaderIndex_(headers, 'Fecha de ingreso'),
    diagnosis: findHhrHeaderIndex_(headers, 'Diagnóstico'),
    specialty: findHhrHeaderIndex_(headers, 'Especialidad'),
    treatingPhysician: findHhrHeaderIndex_(headers, 'Médico tratante'),
    handoff: findHhrHeaderIndex_(headers, 'Entrega de turno'),
    observations: findHhrHeaderIndex_(headers, 'Observaciones'),
    instructions: findHhrHeaderIndex_(headers, 'Indicaciones médicas'),
    stableKey: findHhrHeaderIndex_(headers, '_hhr_key'),
  };
  const hasKnownHeaders = indexes.bed >= 0 && indexes.patientName >= 0 && indexes.stableKey >= 0;

  return rows.map(function (row) {
    if (!hasKnownHeaders) {
      return [
        row[0],
        formatHhrPatientName_(row[1], row[2]),
        '',
        row[3],
        row[4],
        row[5],
        row[6],
        '',
        '',
        row[7],
      ];
    }
    const valueAt = function (index) {
      return index >= 0 ? row[index] : '';
    };
    return [
      valueAt(indexes.bed),
      formatHhrPatientName_(valueAt(indexes.patientName), valueAt(indexes.age)),
      valueAt(indexes.admissionDate),
      valueAt(indexes.diagnosis),
      valueAt(indexes.specialty),
      valueAt(indexes.treatingPhysician),
      valueAt(indexes.handoff),
      valueAt(indexes.observations),
      valueAt(indexes.instructions),
      valueAt(indexes.stableKey),
    ];
  });
}

function formatHhrPatientName_(patientName, age) {
  const normalizedName = String(patientName || '').trim();
  const normalizedAge = String(age || '').trim();
  if (!normalizedAge || normalizedName.endsWith('(' + normalizedAge + ')')) return normalizedName;
  return normalizedName + ' (' + normalizedAge + ')';
}

function mergeHhrRows_(existingRows, incomingRows) {
  const mergedRows = [];
  const rowIndexByKey = {};
  existingRows.forEach(function (existingRow) {
    const row = existingRow.slice();
    const stableKey = canonicalHhrStableKey_(row[9]);
    if (!stableKey) {
      mergedRows.push(row);
      return;
    }

    row[9] = safeHhrCell_(stableKey);
    const duplicateIndex = rowIndexByKey[stableKey];
    if (duplicateIndex === undefined) {
      rowIndexByKey[stableKey] = mergedRows.length;
      mergedRows.push(row);
      return;
    }

    row[6] = mergeHhrHandoffText_(mergedRows[duplicateIndex][6], row[6]);
    row[7] = mergeHhrHandoffText_(mergedRows[duplicateIndex][7], row[7]);
    row[8] = mergeHhrHandoffText_(mergedRows[duplicateIndex][8], row[8]);
    mergedRows[duplicateIndex] = row;
  });

  incomingRows.forEach(function (row) {
    const stableKey = canonicalHhrStableKey_(row.stableKey);
    const nextValues = [
      safeHhrCell_(row.bed),
      safeHhrCell_(formatHhrPatientName_(row.patientName, row.age)),
      safeHhrCell_(row.admissionDate),
      safeHhrCell_(row.diagnosis),
      safeHhrCell_(row.specialty),
      safeHhrCell_(row.treatingPhysician),
      '',
      '',
      '',
      safeHhrCell_(stableKey),
    ];
    const existingIndex = rowIndexByKey[stableKey];
    if (existingIndex === undefined) {
      rowIndexByKey[stableKey] = mergedRows.length;
      mergedRows.push(nextValues);
      return;
    }

    // A populated physician cell is owned by the sheet for this episode. HHR cannot
    // distinguish an institutional correction from an earlier export, so only an
    // explicitly cleared cell opts back into the physician supplied by HHR.
    nextValues[4] = preserveHhrManualValue_(mergedRows[existingIndex][4], nextValues[4]);
    nextValues[5] = preserveHhrManualValue_(mergedRows[existingIndex][5], nextValues[5]);
    nextValues[6] = mergedRows[existingIndex][6];
    nextValues[7] = mergedRows[existingIndex][7];
    nextValues[8] = mergedRows[existingIndex][8];
    mergedRows[existingIndex] = nextValues;
  });

  return mergedRows;
}

function preserveHhrManualValue_(existingValue, incomingValue) {
  return String(existingValue || '').trim() ? existingValue : incomingValue;
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

function configureHhrSheet_(sheet, dataLastRow) {
  trimHhrSheetToCurrentSchema_(sheet);
  sheet.getRange(1, 1, 1, 10).setValues([HHR_HANDOFF_HEADERS]);
  sheet.setFrozenRows(1);
  applyHhrColumnWidths_(sheet);
  sheet.showColumns(8, 2);
  sheet.hideColumns(10);

  const lastRow = Math.max(dataLastRow, 2);
  sheet
    .getRange(1, 1, 1, 10)
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet
    .getRange(2, 1, lastRow - 1, 9)
    .setVerticalAlignment('top')
    .setWrap(true);
  sheet.getRange('G1').setNote('Espacio libre para la entrega de turno del equipo médico.');
  sheet.getRange('H1').setNote('Observaciones del equipo médico.');
  sheet
    .getRange('I1')
    .setNote('Selecciona quién se hace cargo de evaluar y validar las indicaciones médicas.');
  sheet.getRange('E1').setNote('Selecciona la especialidad si falta o necesita corrección.');
  sheet.getRange(2, 7, lastRow - 1, 1).setBackground('#fffceb');
  sheet.getRange(2, 8, lastRow - 1, 1).setBackground('#eff6ff');
  sheet.getRange(2, 9, lastRow - 1, 1).setBackground('#eefaf5');
  configureHhrDropdown_(sheet.getRange(2, 5, lastRow - 1, 1), HHR_HANDOFF_SPECIALTIES);
  configureHhrDropdown_(sheet.getRange(2, 9, lastRow - 1, 1), ['EDF', 'Especialista']);
  const notesRow = configureHhrSharedNotes_(sheet, lastRow);

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  sheet.getRange(1, 1, lastRow, 9).createFilter();

  sheet
    .getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .concat(sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET))
    .filter(function (protection) {
      return String(protection.getDescription() || '').indexOf('HHR_') === 0;
    })
    .forEach(function (protection) {
      protection.remove();
    });
  protectHhrRange_(sheet.getRange(1, 1, 1, 10), 'HHR_CABECERA');
  protectHhrRange_(sheet.getRange(2, 10, sheet.getMaxRows() - 1, 1), 'HHR_IDENTIFICADOR');
  protectHhrRange_(sheet.getRange(notesRow, 1, 1, 9), 'HHR_LEYENDA');
  protectHhrRange_(sheet.getRange(notesRow + 1, 1, 2, 9), 'HHR_INGRESOS_CABECERA');
  protectHhrRange_(
    sheet.getRange(notesRow + HHR_HANDOFF_ADMISSIONS_ROWS + 4, 1, 1, 9),
    'HHR_NOTAS_CABECERA'
  );
  const specialists = getHhrSpecialistEmails_();
  const protection = sheet.protect().setDescription('HHR_TABLA_ESPECIALISTAS');
  restrictHhrProtection_(protection, specialists);
  const notesStart = notesRow + HHR_HANDOFF_ADMISSIONS_ROWS + 5;
  protection.setUnprotectedRanges([
    sheet.getRange(notesRow + 3, 1, HHR_HANDOFF_ADMISSIONS_ROWS, 9),
    sheet.getRange(notesStart, 1, sheet.getMaxRows() - notesStart + 1, 9),
  ]);
}

function getHhrSpecialistEmails_() {
  // Never infer specialists from current file editors: general physicians also
  // have file-level editing rights so they can use the two shared sections.
  const raw = PropertiesService.getScriptProperties().getProperty('HHR_HANDOFF_SPECIALIST_EMAILS');
  return Array.from(new Set(String(raw || '').split(',').map(function (email) {
    return email.trim().toLowerCase();
  }).filter(function (email) {
    return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email);
  })));
}

/** Owner-run migration: applies the template to existing handoffs, without a new census export. */
function applyHhrMedicalTeamPermissions() {
  if (getHhrSpecialistEmails_().length === 0) throw new Error('Configura la lista de especialistas primero.');
  const lock = acquireHhrScriptLock_();
  let updated = 0;
  let restricted = 0;
  try {
    const files = resolveHhrHandoffFolder_().folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const file = files.next();
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      const sheet = spreadsheet.getSheetByName(HHR_HANDOFF_SHEET_NAME);
      if (!sheet) continue;
      // Preflight before any writes: older workbooks can belong to another owner.
      if (!canMigrateHhrSheet_(sheet)) {
        restricted += 1;
        continue;
      }
      ensureHhrSheetColumnCapacity_(sheet);
      configureHhrSheet_(sheet, upsertHhrRows_(sheet, []));
      updated += 1;
    }
    SpreadsheetApp.flush();
    console.log('Entrega médica: ' + updated + ' planillas configuradas; ' + restricted + ' requieren permiso del propietario.');
  } finally {
    lock.releaseLock();
  }
}

function canMigrateHhrSheet_(sheet) {
  return sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .concat(sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET))
    .every(function (protection) { return protection.canEdit(); });
}

function configureHhrDropdown_(range, options) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(options, true)
      // Preserve free text already written in older daily workbooks.
      .setAllowInvalid(true)
      .build()
  );
}

function configureHhrSharedNotes_(sheet, dataLastRow) {
  const lastRow = sheet.getLastRow();
  const keys = lastRow > 1 ? sheet.getRange(2, 10, lastRow - 1, 1).getValues() : [];
  const existingIndex = keys.findIndex(function (row) {
    return row[0] === HHR_HANDOFF_NOTES_KEY;
  });
  const isNew = existingIndex < 0;
  const notesRow = isNew ? dataLastRow + 3 : existingIndex + 2;
  const requiredRows = notesRow + HHR_HANDOFF_NOTES_ROWS + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }

  if (isNew) {
    sheet.getRange(notesRow, 10).setValue(HHR_HANDOFF_NOTES_KEY);
    sheet.getRange(notesRow, 1, 1, 9).merge();
    sheet.getRange(notesRow + 1, 1, 1, 9).merge();
    sheet
      .getRange(notesRow + 2, 1, HHR_HANDOFF_NOTES_ROWS, 9)
      .mergeAcross()
      .setBackground('#ffffff')
      .setWrap(true)
      .setVerticalAlignment('top');
    sheet.setRowHeights(notesRow + 2, HHR_HANDOFF_NOTES_ROWS, 30);
  }
  sheet
    .getRange(notesRow, 1)
    .setValue(
      'EDF: evaluación y validación de indicaciones a cargo del médico EDF. Especialista: evaluación y validación a cargo del especialista.'
    )
    .setFontSize(10)
    .setFontColor('#475569')
    .setWrap(true);
  sheet.setRowHeight(notesRow, 36);
  configureHhrNewAdmissions_(sheet, notesRow);
  sheet
    .getRange(notesRow + HHR_HANDOFF_ADMISSIONS_ROWS + 4, 1)
    .setValue('Notas compartidas · espacio libre para el equipo')
    .setFontWeight('bold')
    .setBackground('#f1f5f9');
  return notesRow;
}

function configureHhrNewAdmissions_(sheet, notesRow) {
  const admissionsRow = notesRow + 1;
  // Insert above existing notes: never replace text written in the earlier template.
  if (sheet.getRange(admissionsRow, 10).getValues()[0][0] !== HHR_HANDOFF_ADMISSIONS_KEY) {
    sheet.insertRowsBefore(admissionsRow, HHR_HANDOFF_ADMISSIONS_ROWS + 3);
    sheet.getRange(admissionsRow, 10).setValue(HHR_HANDOFF_ADMISSIONS_KEY);
    sheet.getRange(admissionsRow, 1, 1, 9).merge();
    for (let offset = 1; offset <= HHR_HANDOFF_ADMISSIONS_ROWS + 1; offset += 1) {
      sheet.getRange(admissionsRow + offset, 4, 1, 3).merge();
      sheet.getRange(admissionsRow + offset, 7, 1, 3).merge();
    }
    sheet
      .getRange(admissionsRow + 2, 1, HHR_HANDOFF_ADMISSIONS_ROWS, 9)
      .setBackground('#ffffff')
      .setWrap(true)
      .setVerticalAlignment('top');
    sheet.setRowHeights(admissionsRow + 2, HHR_HANDOFF_ADMISSIONS_ROWS, 30);
  }
  sheet
    .getRange(admissionsRow, 1)
    .setValue('Nuevos ingresos · registro del equipo')
    .setFontWeight('bold')
    .setBackground('#f1f5f9');
  sheet
    .getRange(admissionsRow + 1, 1, 1, 9)
    .setValues([
      ['Cama', 'Paciente', 'Fecha de ingreso', 'Diagnóstico', '', '', 'Entrega de turno', '', ''],
    ])
    .setFontWeight('bold')
    .setBackground('#eefaf5')
    .setWrap(true);
  sheet.setRowHeight(admissionsRow + 1, 36);
}

function applyHhrColumnWidths_(sheet) {
  HHR_HANDOFF_COLUMN_WIDTHS_PX.forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
}

function protectHhrRange_(range, description) {
  const protection = range.protect().setDescription(description);
  restrictHhrProtection_(protection, []);
}

function restrictHhrProtection_(protection, allowedEditors) {
  protection.setWarningOnly(false);
  // The deployment and migration execute as the spreadsheet owner. Google keeps
  // that owner implicitly; no additional account-profile OAuth scope is needed.
  const editors = protection.getEditors();
  if (editors.length > 0) protection.removeEditors(editors);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  if (allowedEditors.length > 0) protection.addEditors(allowedEditors);
}

function jsonHhrResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
