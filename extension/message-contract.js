/** Shared runtime-message contract for the HHR extension service worker and its callers. */
(function (root) {
  'use strict';

  const types = Object.freeze({
    EXTENSION_HEALTH_REQUEST: 'RAYEN_EXTENSION_HEALTH_REQUEST',
    GC_SESSION_CAPTURED: 'RAYEN_GC_SESSION_CAPTURED',
    GC_DOCUMENT_READY: 'RAYEN_GC_DOCUMENT_READY',
    GC_CONNECT_REQUEST: 'RAYEN_GC_CONNECT_REQUEST',
    GC_DISCONNECT_REQUEST: 'RAYEN_GC_DISCONNECT_REQUEST',
    SNAPSHOT_REQUEST: 'RAYEN_SNAPSHOT_REQUEST',
    OPEN_ENCOUNTER_REQUEST: 'RAYEN_OPEN_ENCOUNTER_REQUEST',
    EGRESO_LOOKUP_REQUEST: 'RAYEN_EGRESO_LOOKUP_REQUEST',
    EGRESO_REPORT_REQUEST: 'RAYEN_EGRESO_REPORT_REQUEST',
    EGRESO_REPORT_SAVE: 'RAYEN_EGRESO_REPORT_SAVE',
    DEVICE_REPORT_REQUEST: 'RAYEN_DEVICE_REPORT_REQUEST',
    DEVICE_REPORT_SAVE: 'RAYEN_DEVICE_REPORT_SAVE',
    SCALES_REPORT_REQUEST: 'RAYEN_SCALES_REPORT_REQUEST',
    PATIENT_HEADER_REQUEST: 'RAYEN_PATIENT_HEADER_REQUEST',
    CENSUS_LIST_REQUEST: 'RAYEN_CENSUS_LIST_REQUEST',
    VITALS_CENSUS_REQUEST: 'RAYEN_VITALS_CENSUS_REQUEST',
    IMAGING_FORM_PRINT_REQUEST: 'RAYEN_IMAGING_FORM_PRINT_REQUEST',
    HISTORY_SCALES_REQUEST: 'RAYEN_HISTORY_SCALES_REQUEST',
    CLINICAL_PANEL_REQUEST: 'RAYEN_CLINICAL_PANEL_REQUEST',
    LAB_SEARCH_REQUEST: 'RAYEN_LAB_SEARCH_REQUEST',
    SYSLAB_STATUS_REQUEST: 'RAYEN_SYSLAB_STATUS_REQUEST',
    SYSLAB_LOGIN_REQUEST: 'RAYEN_SYSLAB_LOGIN_REQUEST',
    LAB_DETAILS_REQUEST: 'RAYEN_LAB_DETAILS_REQUEST',
    LAB_PDF_OPEN_REQUEST: 'RAYEN_LAB_PDF_OPEN_REQUEST',
    PRESCRIPTION_OPTIONS_REQUEST: 'RAYEN_PRESCRIPTION_OPTIONS_REQUEST',
    PRESCRIPTION_PRINT_REQUEST: 'RAYEN_PRESCRIPTION_PRINT_REQUEST',
    EPICRISIS_CORRECTED_PRINT_REQUEST: 'RAYEN_EPICRISIS_CORRECTED_PRINT_REQUEST',
    NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST:
      'RAYEN_NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST',
    EXAM_REQUEST_COMBINE_PRINT_REQUEST: 'RAYEN_EXAM_REQUEST_COMBINE_PRINT_REQUEST',
    HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST:
      'RAYEN_HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST',
    HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST:
      'RAYEN_HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST',
    INDICATIONS_PRINT_REQUEST: 'RAYEN_INDICATIONS_PRINT_REQUEST',
    HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST:
      'RAYEN_HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST',
    HOSPITALIZED_INDICATIONS_PRINT_REQUEST:
      'RAYEN_HOSPITALIZED_INDICATIONS_PRINT_REQUEST',
    HOSPITALIZED_REGIMEN_OPTIONS_REQUEST: 'RAYEN_HOSPITALIZED_REGIMEN_OPTIONS_REQUEST',
    HOSPITALIZED_REGIMEN_PRINT_REQUEST: 'RAYEN_HOSPITALIZED_REGIMEN_PRINT_REQUEST',
    HANDOFF_OPTIONS_REQUEST: 'RAYEN_HANDOFF_OPTIONS_REQUEST',
    HANDOFF_SAVE_REQUEST: 'RAYEN_HANDOFF_SAVE_REQUEST',
    HANDOFF_REPORT_REQUEST: 'RAYEN_HANDOFF_REPORT_REQUEST',
    SCORES_OPTIONS_REQUEST: 'RAYEN_SCORES_OPTIONS_REQUEST',
    SCORE_FORM_REQUEST: 'RAYEN_SCORE_FORM_REQUEST',
    SCORE_SAVE_REQUEST: 'RAYEN_SCORE_SAVE_REQUEST',
    CLINICAL_WRITE_ACK: 'RAYEN_CLINICAL_WRITE_ACK',
    CLINICAL_WRITE_RECOVERY_REQUEST: 'RAYEN_CLINICAL_WRITE_RECOVERY_REQUEST',
    CUDYR_CATEGORIES_REQUEST: 'RAYEN_CUDYR_CATEGORIES_REQUEST',
  });

  const fieldRules = Object.freeze({
    [types.GC_SESSION_CAPTURED]: { info: 'object' },
    [types.GC_CONNECT_REQUEST]: { renew: 'boolean?' },
    [types.OPEN_ENCOUNTER_REQUEST]: { encId: 'id' },
    [types.EGRESO_LOOKUP_REQUEST]: { runs: 'array' },
    [types.EGRESO_REPORT_REQUEST]: { dateStart: 'string?', dateEnd: 'string?' },
    [types.EGRESO_REPORT_SAVE]: { dateStart: 'string?', dateEnd: 'string?' },
    [types.DEVICE_REPORT_REQUEST]: { encId: 'id', fecha: 'string?' },
    [types.DEVICE_REPORT_SAVE]: { encId: 'id', fecha: 'string?' },
    [types.SCALES_REPORT_REQUEST]: { encId: 'id' },
    [types.PATIENT_HEADER_REQUEST]: { encId: 'id' },
    [types.CENSUS_LIST_REQUEST]: { currentEncId: 'id?' },
    [types.VITALS_CENSUS_REQUEST]: { currentEncId: 'id?' },
    [types.IMAGING_FORM_PRINT_REQUEST]: {
      encId: 'id',
      doc: 'string',
      physician: 'string?',
      marks: 'array?',
    },
    [types.HISTORY_SCALES_REQUEST]: { encId: 'id' },
    [types.CLINICAL_PANEL_REQUEST]: { encId: 'id' },
    [types.LAB_SEARCH_REQUEST]: { encId: 'id' },
    [types.SYSLAB_LOGIN_REQUEST]: { username: 'string', password: 'string' },
    [types.LAB_DETAILS_REQUEST]: { batchId: 'string', examIds: 'array' },
    [types.LAB_PDF_OPEN_REQUEST]: { batchId: 'string', examId: 'id' },
    [types.PRESCRIPTION_OPTIONS_REQUEST]: { encId: 'id' },
    [types.PRESCRIPTION_PRINT_REQUEST]: {
      encId: 'id',
      selectionKey: 'string',
      printFormat: 'string?',
    },
    [types.EPICRISIS_CORRECTED_PRINT_REQUEST]: {
      pdfBase64: 'string',
      patientRun: 'string',
    },
    [types.NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST]: {
      encId: 'id?',
      patientRun: 'string',
    },
    [types.EXAM_REQUEST_COMBINE_PRINT_REQUEST]: {
      encId: 'id',
      diteIds: 'array',
      requests: 'array?',
    },
    [types.HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST]: { currentEncId: 'id?' },
    [types.HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST]: {
      batchId: 'string',
      encIds: 'array',
      printFormat: 'string?',
    },
    [types.INDICATIONS_PRINT_REQUEST]: { encId: 'id' },
    [types.HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST]: { currentEncId: 'id?' },
    [types.HOSPITALIZED_INDICATIONS_PRINT_REQUEST]: {
      batchId: 'string',
      encIds: 'array',
    },
    [types.HOSPITALIZED_REGIMEN_OPTIONS_REQUEST]: { currentEncId: 'id?' },
    [types.HANDOFF_OPTIONS_REQUEST]: { currentEncId: 'id?' },
    [types.HANDOFF_SAVE_REQUEST]: {
      batchId: 'string',
      encId: 'id',
      observation: 'string',
    },
    [types.HANDOFF_REPORT_REQUEST]: { nurseStationId: 'id' },
    [types.SCORES_OPTIONS_REQUEST]: { currentEncId: 'id?' },
    [types.SCORE_FORM_REQUEST]: { batchId: 'string', encId: 'id', instrument: 'string' },
    [types.SCORE_SAVE_REQUEST]: {
      batchId: 'string',
      encId: 'id',
      instrument: 'string',
      answers: 'object',
    },
    [types.CLINICAL_WRITE_ACK]: {
      key: 'string',
      generationId: 'string',
      receiptId: 'string',
    },
    [types.CLINICAL_WRITE_RECOVERY_REQUEST]: {
      key: 'string',
      generationId: 'string',
      phase: 'string',
      recoveryToken: 'string?',
    },
  });

  const knownTypes = new Set(Object.values(types));
  const cleanMessage = value => String(value || '').replace(/\s+/g, ' ').trim();

  const responses = Object.freeze({
    success: data => ({ ...(data && typeof data === 'object' ? data : {}), ok: true }),
    error: (message, code = '', data) => ({
      ...(data && typeof data === 'object' ? data : {}),
      ...(code ? { code } : {}),
      error: cleanMessage(message) || 'La operación de la extensión no pudo completarse.',
    }),
    uncertain: (message, data) => ({
      ...(data && typeof data === 'object' ? data : {}),
      state: 'uncertain',
      uncertain: true,
      error: cleanMessage(message) || 'El resultado de la operación no pudo verificarse.',
    }),
    sessionRequired: (message, data) => ({
      ...(data && typeof data === 'object' ? data : {}),
      state: 'requires-session',
      requiresLogin: true,
      error: cleanMessage(message) || 'La sesión requerida no está disponible.',
    }),
  });

  const fieldMatches = (value, descriptor) => {
    const optional = descriptor.endsWith('?');
    const kind = optional ? descriptor.slice(0, -1) : descriptor;
    if (value == null) return optional;
    if (kind === 'array') return Array.isArray(value);
    if (kind === 'object') return typeof value === 'object' && !Array.isArray(value);
    if (kind === 'string') return typeof value === 'string';
    if (kind === 'boolean') return typeof value === 'boolean';
    if (kind === 'id') {
      const normalized = cleanMessage(value);
      if (optional && !normalized) return true;
      return Boolean(
        (typeof value === 'string' || typeof value === 'number') && normalized
      );
    }
    return false;
  };

  const validateRuntimeMessage = message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return {
        ok: false,
        known: false,
        response: responses.error('El mensaje de la extensión no es válido.', 'INVALID_MESSAGE'),
      };
    }
    const type = cleanMessage(message.type);
    if (!knownTypes.has(type)) {
      return {
        ok: false,
        known: false,
        type,
        response: responses.error('El tipo de mensaje no está registrado.', 'UNKNOWN_MESSAGE'),
      };
    }
    const rules = fieldRules[type] || {};
    for (const [field, descriptor] of Object.entries(rules)) {
      if (!fieldMatches(message[field], descriptor)) {
        return {
          ok: false,
          known: true,
          type,
          response: responses.error(
            `El campo ${field} no es válido para ${type}.`,
            'INVALID_MESSAGE'
          ),
        };
      }
    }
    return { ok: true, known: true, type, message };
  };

  const respondAsync = (promise, sendResponse, fallbackMessage, logError = console.error) => {
    Promise.resolve(promise)
      .then(response => sendResponse(response || responses.error(fallbackMessage)))
      .catch(error => {
        if (typeof logError === 'function') {
          logError('[HHR] Falló una operación asíncrona de la extensión:', error);
        }
        sendResponse(
          responses.error(
            cleanMessage(fallbackMessage) +
              ' ' +
              cleanMessage(error && error.message ? error.message : error)
          )
        );
      });
    return true;
  };

  const createRuntimeRouter = routes => (message, sender, sendResponse) => {
    const validation = validateRuntimeMessage(message);
    if (!validation.known) return undefined;
    const route = routes && routes[validation.type];
    if (!route || typeof route.handle !== 'function') return undefined;
    if (!validation.ok) {
      return respondAsync(
        validation.response,
        sendResponse,
        'El mensaje de la extensión no es válido.'
      );
    }
    let operation;
    try {
      operation = route.handle(message, sender);
    } catch (error) {
      operation = Promise.reject(error);
    }
    return respondAsync(
      operation,
      sendResponse,
      route.fallback || 'La operación de la extensión no pudo completarse.'
    );
  };

  root.HhrRayenMessageContract = {
    createRuntimeRouter,
    respondAsync,
    responses,
    types,
    validateRuntimeMessage,
  };
})(typeof self !== 'undefined' ? self : globalThis);
