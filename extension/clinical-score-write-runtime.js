/**
 * Clinical Scores write/recovery owner for the MV3 background worker.
 *
 * Owns verified CUDYR, Braden and Downton writes plus score recovery reads. Shared identity,
 * claims, hospitalization and write-protection policy stay injected by background.js.
 */
(function (root) {
  'use strict';

  const buildClinicalAge = (birthDate, referenceDate = new Date()) => {
    const rawBirthDate = String(birthDate || '').trim();
    const dateOnly = rawBirthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const birth = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0)
      : new Date(rawBirthDate);
    if (Number.isNaN(birth.getTime())) return '';
    if (dateOnly && (
      birth.getFullYear() !== Number(dateOnly[1]) ||
      birth.getMonth() !== Number(dateOnly[2]) - 1 ||
      birth.getDate() !== Number(dateOnly[3])
    )) return '';
    const now = new Date(referenceDate.getTime());
    if (Number.isNaN(now.getTime())) return '';
    if (birth.getTime() > now.getTime()) return '';
    const addCalendarYearsClamped = (date, count) => {
      const result = new Date(date.getTime());
      const month = result.getMonth();
      const day = result.getDate();
      result.setDate(1);
      result.setFullYear(result.getFullYear() + count);
      result.setMonth(month);
      result.setDate(Math.min(day, new Date(result.getFullYear(), month + 1, 0).getDate()));
      return result;
    };
    const addCalendarMonthsClamped = (date, count) => {
      const result = new Date(date.getTime());
      const day = result.getDate();
      result.setDate(1);
      result.setMonth(result.getMonth() + count);
      result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
      return result;
    };
    let years = Math.max(0, now.getFullYear() - birth.getFullYear());
    let cursor = addCalendarYearsClamped(birth, years);
    if (cursor.getTime() > now.getTime()) {
      years = Math.max(0, years - 1);
      cursor = addCalendarYearsClamped(birth, years);
    }
    let months = Math.max(
      0,
      (now.getFullYear() - cursor.getFullYear()) * 12 + now.getMonth() - cursor.getMonth()
    );
    let monthCursor = addCalendarMonthsClamped(cursor, months);
    while (months > 0 && monthCursor.getTime() > now.getTime()) {
      months -= 1;
      monthCursor = addCalendarMonthsClamped(cursor, months);
    }
    const remainingMs = Math.max(0, now.getTime() - monthCursor.getTime());
    const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remainingMs - days * 24 * 60 * 60 * 1000) / (60 * 60 * 1000));
    return String(years) + String(months).padStart(2, '0') +
      String(days).padStart(2, '0') + String(hours).padStart(2, '0');
  };

  const create = dependencies => {
    const {
      fetchWithTimeout,
      getFichaFetchInfo,
      fetchFichaClaims,
      hasFichaClaim,
      verifyEncounterStillHospitalized,
      fetchCudyrDefinitions,
      fetchCudyrCategories,
      resolveCudyrFormId,
      getScaleDefinition,
      readScoresBatch,
      fetchScaleHistoryEvents,
      fetchEvaluationForms,
      withClinicalWriteLock,
      clinicalRecordKey,
      collectClinicalTimestampBaseline,
      hasNewClinicalTimestamp,
      prescriptionPrint,
      wait,
    } = dependencies || {};

    if (
      typeof fetchWithTimeout !== 'function' || typeof getFichaFetchInfo !== 'function' ||
      typeof fetchFichaClaims !== 'function' || typeof hasFichaClaim !== 'function' ||
      typeof verifyEncounterStillHospitalized !== 'function' ||
      typeof fetchCudyrDefinitions !== 'function' || typeof fetchCudyrCategories !== 'function' ||
      typeof resolveCudyrFormId !== 'function' || typeof getScaleDefinition !== 'function' ||
      typeof readScoresBatch !== 'function' || typeof fetchScaleHistoryEvents !== 'function' ||
      typeof fetchEvaluationForms !== 'function' || typeof withClinicalWriteLock !== 'function' ||
      typeof clinicalRecordKey !== 'function' ||
      typeof collectClinicalTimestampBaseline !== 'function' ||
      typeof hasNewClinicalTimestamp !== 'function' ||
      !prescriptionPrint || typeof prescriptionPrint.calculateCudyrCategory !== 'function' ||
      typeof prescriptionPrint.deriveScaleHistory !== 'function' || typeof wait !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime de escritura de Scores.');
    }

    const parseJsonResponseSafely = async response => {
      const raw = await response.text();
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_error) { return null; }
    };

    const handleCudyrSave = async ({ encId, answers, patient, info, writeGuard }) => {
      const definitionResult = await fetchCudyrDefinitions(info);
      if (definitionResult.error) return definitionResult;
      const departmentId = String(patient.hospitalDepartmentId || '');
      if (!/^\d+$/.test(departmentId)) {
        return { error: 'Eloísa no informó el servicio clínico; no se guardó CUDYR.' };
      }
      const formId = resolveCudyrFormId(departmentId);
      const fields = definitionResult.rows.filter(row => String(row.formId) === formId);
      if (fields.length !== 14) {
        return { error: 'El formulario CUDYR vigente cambió y no puede guardarse con seguridad.' };
      }
      const normalized = [];
      for (const field of fields) {
        const answerKey = String(field.id);
        if (!answers || !Object.prototype.hasOwnProperty.call(answers, answerKey) ||
            String(answers[answerKey]).trim() === '') {
          return { error: 'Completa todos los ítems CUDYR con una opción válida.' };
        }
        const value = Number(answers[answerKey]);
        const allowed = (
          Array.isArray(field.categorizationFormOptionList)
            ? field.categorizationFormOptionList
            : []
        ).some(option => Number(option.value) === value);
        if (!allowed) return { error: 'Completa todos los ítems CUDYR con una opción válida.' };
        normalized.push({ id: field.id, typeId: field.typeId, value });
      }
      const score = prescriptionPrint.calculateCudyrCategory(normalized);
      const baselineResult = await fetchCudyrCategories(info);
      if (baselineResult.error) {
        return {
          error: 'No se pudo establecer el estado previo de CUDYR; no se guardó. ' +
            baselineResult.error,
        };
      }
      const baselineItem = baselineResult.items.find(item => String(item.encId) === String(encId));
      const timestampBaseline = collectClinicalTimestampBaseline(
        baselineItem ? [baselineItem] : [],
        item => item && item.crdDateTime || ''
      );
      const startedAt = Date.now();
      let postAcknowledged = false;
      let uncertainPostError = '';
      const begun = await writeGuard.beginWrite();
      if (begun.error) return begun;
      try {
        const response = await fetchWithTimeout(`${info.apiOrigin}/api/categorizationForm/save`, {
          method: 'POST',
          headers: {
            Authorization: info.token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          credentials: 'omit',
          body: JSON.stringify({
            id: 0,
            formId: Number(formId),
            encounterId: String(encId),
            creationDate: new Date().toISOString(),
            value: score.value,
            healthCarePractitionerId: Number(info.practitionerId),
            healthCarePractitionerRoleId: Number(info.practitionerRoleId),
            isDeleted: false,
            isNew: false,
            categorizationFormDetailList: normalized.map(field => ({
              formRegistrationSummaryId: 0,
              fieldFormId: Number(field.id),
              value: field.value,
            })),
          }),
        });
        if (!response.ok) {
          const message = 'Eloísa respondió HTTP ' + response.status + ' al guardar CUDYR.';
          if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            return { error: message, definitelyNotApplied: true };
          }
          uncertainPostError = message;
        } else {
          postAcknowledged = true;
          await parseJsonResponseSafely(response);
        }
      } catch (error) {
        uncertainPostError = 'Se perdió la confirmación al guardar CUDYR: ' +
          String((error && error.message) || error);
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) await wait(250 * attempt);
        const refreshed = await fetchCudyrCategories(info);
        if (refreshed.error) continue;
        const item = refreshed.items.find(candidate => String(candidate.encId) === String(encId));
        if (postAcknowledged && item && item.crdValue === score.value &&
            hasNewClinicalTimestamp(item.crdDateTime, timestampBaseline, startedAt)) {
          return {
            ok: true,
            verified: true,
            record: {
              total: score.value,
              severity: '',
              dateTime: item.crdDateTime,
              author: info.fullName,
            },
          };
        }
      }
      return {
        error: (uncertainPostError ? uncertainPostError + ' ' : '') +
          'CUDYR pudo haberse guardado, pero Eloísa aún no permitió verificarlo. ' +
          'Actualiza antes de reintentar.',
        writeMayHaveSucceeded: true,
      };
    };

    const handleEvaluationScaleSave = async ({
      encId,
      instrument,
      answers,
      patient,
      info,
      writeGuard,
    }) => {
      const definitionResult = await getScaleDefinition(instrument, info);
      if (definitionResult.error) return definitionResult;
      const definition = definitionResult.definition;
      const values = {};
      let total = 0;
      for (const field of definition.fields) {
        const value = String(answers && answers[field.id] != null ? answers[field.id] : '').trim();
        const required = field.required !== false;
        if (field.options.length) {
          if (!value && !required) continue;
          const selected = field.type === 7 ? value.split(',').filter(Boolean) : [value];
          if (!selected.length || selected.some(
            selectedId => !field.options.some(option => option.id === selectedId)
          )) {
            return {
              error: 'Completa todas las respuestas de ' + instrument + ' con opciones válidas.',
            };
          }
          for (const selectedId of selected) {
            const option = field.options.find(item => item.id === selectedId);
            if (!Number.isFinite(option && option.score)) {
              return {
                error: 'El esquema de ' + instrument + ' no informó el puntaje de una respuesta.',
              };
            }
            total += option.score;
          }
          values[field.id] = value;
        } else {
          if (!value && required) {
            return { error: 'Completa todos los campos obligatorios de ' + instrument + '.' };
          }
          if (value) values[field.id] = value;
        }
      }
      const result = definition.results.find(item =>
        total >= item.minScore && total <= item.maxScore
      );
      if (!result) {
        return {
          error: 'El puntaje calculado no coincide con un rango oficial de ' + instrument + '.',
        };
      }
      values[definition.scoreFieldId] = String(total);
      values[definition.resultFieldId] = String(result.valueId);
      const metaCampList = Object.keys(values).map(id => ({ id, value: values[id] }));
      const clinicalAge = buildClinicalAge(patient.birthDate);
      const administrativeSexId = Number(patient.administrativeSexId || 0);
      if (!clinicalAge || !Number.isFinite(administrativeSexId) || administrativeSexId <= 0) {
        return {
          error: 'Eloísa no informó edad o sexo administrativo; no se guardó el instrumento.',
        };
      }
      const [historyBaselineResult, baselineResult] = await Promise.all([
        fetchScaleHistoryEvents(encId, info, 120),
        fetchEvaluationForms(encId, info),
      ]);
      if (historyBaselineResult.error || baselineResult.error) {
        return {
          error: 'No se pudo establecer el historial completo previo de ' + instrument +
            '; no se guardó. ' +
            [historyBaselineResult.error, baselineResult.error].filter(Boolean).join(' '),
        };
      }
      const baselineForms = baselineResult.forms.filter(form =>
        form && String(form.formId || '') === String(definition.formId)
      );
      const evaluationFormKey = form => clinicalRecordKey(
        'evaluation-form',
        form,
        form && (form.createDateTime || form.startDateTime || ''),
        [
          form && form.formId,
          form && (form.authorHealthCarePractitionerId || form.healthCarePractitionerId),
        ]
      );
      const baselineKeys = new Set(baselineForms.map(evaluationFormKey));
      const timestampBaseline = collectClinicalTimestampBaseline(
        baselineForms,
        form => form && (form.createDateTime || form.startDateTime || '')
      );
      const startedAt = Date.now();
      let created = null;
      let postAcknowledged = false;
      let uncertainPostError = '';
      const begun = await writeGuard.beginWrite();
      if (begun.error) return begun;
      try {
        const response = await fetchWithTimeout(
          `${info.apiOrigin}/api/encounter/entrySummary/encounterFormEntry/${encodeURIComponent(encId)}`,
          {
            method: 'POST',
            headers: {
              Authorization: info.token,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            credentials: 'omit',
            body: JSON.stringify({
              encounterFormEntryTransport: {
                administrativeSexId,
                age: clinicalAge,
                facilityId: Number(info.facId),
                healthCarePractitionerId: Number(info.practitionerId),
                healthCarePractitionerRoleId: Number(info.practitionerRoleId),
                metaFormId: Number(definition.metaFormId),
                formId: Number(definition.formId),
                metaCampList,
                isRedo: false,
                encounterEventTypeId: 2,
              },
              confidentialityLevelId: 4,
              encounterEventId: 0,
              healthCarePractitionerRoleId: Number(info.practitionerRoleId),
              authorHealthCarePractitionerId: Number(info.practitionerId),
              authorHealthCarePractitionerRoleId: Number(info.practitionerRoleId),
              healthCarePractitionerId: Number(info.practitionerId),
              encounterId: Number(encId),
            }),
          }
        );
        if (!response.ok) {
          const message = 'Eloísa respondió HTTP ' + response.status +
            ' al guardar ' + instrument + '.';
          if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            return { error: message, definitelyNotApplied: true };
          }
          uncertainPostError = message;
        } else {
          postAcknowledged = true;
          created = await parseJsonResponseSafely(response);
        }
      } catch (error) {
        uncertainPostError = 'Se perdió la confirmación al guardar ' + instrument + ': ' +
          String((error && error.message) || error);
      }
      const createdId = String(created && (created.id || created.data && created.data.id) || '');
      const createdGuid = String(
        created && (created.guid || created.data && created.data.guid) || ''
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) await wait(250 * attempt);
        const refreshed = await fetchEvaluationForms(encId, info);
        if (refreshed.error) continue;
        const matches = refreshed.forms.filter(form => {
          if (!postAcknowledged) return false;
          if (!form || String(form.formId || '') !== String(definition.formId)) return false;
          if (createdId && String(form.id || '') !== createdId) return false;
          if (createdGuid && String(form.guid || '') !== createdGuid) return false;
          if (baselineKeys.has(evaluationFormKey(form))) return false;
          const authorId = String(
            form.authorHealthCarePractitionerId || form.healthCarePractitionerId || ''
          );
          if (!createdId && !createdGuid && authorId !== String(info.practitionerId)) return false;
          if (authorId && authorId !== String(info.practitionerId)) return false;
          const formValues = new Map((
            Array.isArray(form.metaCampList) ? form.metaCampList : []
          ).map(item => [
            String(item && (item.id || item.metaFieldName) || ''),
            String(item && (item.value != null ? item.value : item.VALUE) || ''),
          ]));
          if (metaCampList.some(item => formValues.get(item.id) !== item.value)) return false;
          return hasNewClinicalTimestamp(
            form.createDateTime || form.startDateTime || '',
            timestampBaseline,
            startedAt
          );
        });
        if (matches.length === 1) {
          return {
            ok: true,
            verified: true,
            record: {
              total,
              severity: result.valueName,
              dateTime: matches[0].createDateTime || matches[0].startDateTime ||
                new Date().toISOString(),
              author: matches[0].authorHealthCarePractitionerName || info.fullName,
            },
          };
        }
      }
      return {
        error: (uncertainPostError ? uncertainPostError + ' ' : '') + instrument +
          ' pudo haberse guardado, pero Eloísa aún no permitió verificarlo. ' +
          'Actualiza antes de reintentar.',
        writeMayHaveSucceeded: true,
      };
    };

    const performScoreSaveRequest = async ({
      batchId,
      encId,
      instrument,
      answers,
    }, writeGuard) => {
      const normalizedInstrument = ['CUDYR', 'BRADEN', 'DOWNTON'].includes(
        String(instrument || '').toUpperCase()
      ) ? String(instrument).toUpperCase() : '';
      if (!normalizedInstrument) return { error: 'El instrumento no es válido.' };
      const batch = await readScoresBatch(batchId, encId);
      if (batch.error) return batch;
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      if (!info.identityVerified || !/enfermer/i.test(String(info.role || '')) ||
          !/^\d+$/.test(String(info.practitionerId || '')) ||
          !/^\d+$/.test(String(info.practitionerRoleId || ''))) {
        return { error: 'No se pudo verificar una sesión activa de enfermería.' };
      }
      const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
      if (activeEncounter.error) return activeEncounter;
      const currentPatient = { ...batch.patient };
      if (normalizedInstrument === 'CUDYR') {
        const currentDepartmentId = String(
          activeEncounter.encounter && activeEncounter.encounter.hospitalDepartmentId || ''
        );
        if (!/^\d+$/.test(currentDepartmentId)) {
          return { error: 'Eloísa no informó el servicio clínico actual; no se guardó CUDYR.' };
        }
        if (String(batch.patient.hospitalDepartmentId || '') !== currentDepartmentId) {
          return {
            error: 'El paciente cambió de servicio desde que abriste CUDYR. ' +
              'Cierra el formulario y vuelve a abrirlo.',
          };
        }
        currentPatient.hospitalDepartmentId = currentDepartmentId;
      }
      const claimsResult = await fetchFichaClaims(info);
      if (claimsResult.error) return claimsResult;
      if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
        return { error: 'El perfil no tiene permiso para ver instrumentos de evaluación.' };
      }
      if (!hasFichaClaim(claimsResult, 'Ingresar_Instrumento_Evaluacion')) {
        return { error: 'El perfil no tiene permiso para ingresar instrumentos de evaluación.' };
      }
      return normalizedInstrument === 'CUDYR'
        ? handleCudyrSave({ encId, answers, patient: currentPatient, info, writeGuard })
        : handleEvaluationScaleSave({
            encId,
            instrument: normalizedInstrument,
            answers,
            patient: currentPatient,
            info,
            writeGuard,
          });
    };

    const handleScoreSaveRequest = args => withClinicalWriteLock(
      'score:' + String(args && args.encId || '') + ':' +
        String(args && args.instrument || '').toUpperCase(),
      writeGuard => performScoreSaveRequest(args || {}, writeGuard)
    );

    const readRecoveryReview = async ({ encId, instrument, info }) => {
      if (instrument === 'CUDYR') {
        const refreshed = await fetchCudyrCategories(info);
        if (refreshed.error) return refreshed;
        const latest = refreshed.items.find(item =>
          String(item && item.encId || '') === String(encId)
        );
        return {
          review: {
            kind: 'score',
            instrument,
            present: Boolean(latest && latest.crdValue),
            value: String(latest && latest.crdValue || ''),
            classification: '',
            dateTime: String(latest && latest.crdDateTime || ''),
            author: '',
          },
        };
      }
      const [history, forms] = await Promise.all([
        fetchScaleHistoryEvents(encId, info, 120),
        fetchEvaluationForms(encId, info),
      ]);
      if (history.error || forms.error) {
        return { error: [history.error, forms.error].filter(Boolean).join(' ') };
      }
      const latest = prescriptionPrint.deriveScaleHistory(
        history.events,
        forms.forms,
        instrument
      )[0] || null;
      return {
        review: {
          kind: 'score',
          instrument,
          present: Boolean(latest),
          value: latest ? String(latest.total) : '',
          classification: String(latest && latest.severity || ''),
          dateTime: String(latest && latest.dateTime || ''),
          author: String(latest && latest.author || ''),
        },
      };
    };

    return Object.freeze({
      handleSaveRequest: handleScoreSaveRequest,
      readRecoveryReview,
    });
  };

  root.HhrClinicalScoreWriteRuntime = Object.freeze({ create, buildClinicalAge });
})(typeof globalThis !== 'undefined' ? globalThis : self);
