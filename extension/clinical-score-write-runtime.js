/**
 * Clinical Scores write/recovery owner for the MV3 background worker.
 *
 * Owns verified CUDYR, Braden and Downton writes plus score recovery reads. Shared identity,
 * claims, hospitalization and write-protection policy stay injected by background.js.
 */
(function (root) {
  'use strict';

  const isScoreWriteModel = model => Boolean(
    model && typeof model.prepareEvaluationSubmission === 'function' &&
    typeof model.buildEvaluationPayload === 'function' &&
    typeof model.readCreatedIdentity === 'function' &&
    typeof model.matchesEvaluationForm === 'function' &&
    typeof model.buildEvaluationRecord === 'function'
  );

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
      scoreWriteModel,
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

    const requiredFunctions = [
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
      wait,
    ];
    if (
      !isScoreWriteModel(scoreWriteModel) || requiredFunctions.some(item => typeof item !== 'function') ||
      !prescriptionPrint || typeof prescriptionPrint.calculateCudyrCategory !== 'function' ||
      typeof prescriptionPrint.deriveScaleHistory !== 'function'
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

    const readEvaluationBaseline = async ({ encId, instrument, definition, info }) => {
      const [history, forms] = await Promise.all([
        fetchScaleHistoryEvents(encId, info, 120),
        fetchEvaluationForms(encId, info),
      ]);
      if (history.error || forms.error) {
        return {
          error: 'No se pudo establecer el historial completo previo de ' + instrument +
            '; no se guardó. ' + [history.error, forms.error].filter(Boolean).join(' '),
        };
      }
      const matchingForms = forms.forms.filter(form =>
        form && String(form.formId || '') === String(definition.formId)
      );
      const formKey = form => clinicalRecordKey(
        'evaluation-form',
        form,
        form && (form.createDateTime || form.startDateTime || ''),
        [
          form && form.formId,
          form && (form.authorHealthCarePractitionerId || form.healthCarePractitionerId),
        ]
      );
      return {
        baselineKeys: new Set(matchingForms.map(formKey)),
        formKey,
        timestampBaseline: collectClinicalTimestampBaseline(
          matchingForms,
          form => form && (form.createDateTime || form.startDateTime || '')
        ),
      };
    };

    const postEvaluationScale = async ({ encId, instrument, payload, info, writeGuard }) => {
      const begun = await writeGuard.beginWrite();
      if (begun.error) return { terminalResult: begun };
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
            body: JSON.stringify(payload),
          }
        );
        const message = 'Eloísa respondió HTTP ' + response.status +
          ' al guardar ' + instrument + '.';
        if (!response.ok && response.status >= 400 && response.status < 500 &&
            response.status !== 408) {
          return { terminalResult: { error: message, definitelyNotApplied: true } };
        }
        if (!response.ok) return { postAcknowledged: false, uncertainPostError: message };
        return {
          postAcknowledged: true,
          created: await parseJsonResponseSafely(response),
          uncertainPostError: '',
        };
      } catch (error) {
        return {
          postAcknowledged: false,
          uncertainPostError: 'Se perdió la confirmación al guardar ' + instrument + ': ' +
            String((error && error.message) || error),
        };
      }
    };

    const verifyEvaluationScale = async ({
      encId,
      instrument,
      definition,
      submission,
      baseline,
      writeResult,
      info,
      startedAt,
    }) => {
      const createdIdentity = scoreWriteModel.readCreatedIdentity(writeResult.created);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) await wait(250 * attempt);
        const refreshed = await fetchEvaluationForms(encId, info);
        if (refreshed.error) continue;
        const matches = writeResult.postAcknowledged
          ? refreshed.forms.filter(form => scoreWriteModel.matchesEvaluationForm({
              form,
              formId: definition.formId,
              createdIdentity,
              baselineContains: baseline.baselineKeys.has(baseline.formKey(form)),
              practitionerId: info.practitionerId,
              expectedValues: submission.metaCampList,
              hasNewTimestamp: hasNewClinicalTimestamp(
                form && (form.createDateTime || form.startDateTime || ''),
                baseline.timestampBaseline,
                startedAt
              ),
            }))
          : [];
        if (writeResult.postAcknowledged && matches.length === 1) {
          return {
            ok: true,
            verified: true,
            record: scoreWriteModel.buildEvaluationRecord({
              form: matches[0],
              total: submission.total,
              result: submission.result,
              fallbackAuthor: info.fullName,
              fallbackDateTime: new Date().toISOString(),
            }),
          };
        }
      }
      return {
        error: (writeResult.uncertainPostError ? writeResult.uncertainPostError + ' ' : '') +
          instrument + ' pudo haberse guardado, pero Eloísa aún no permitió verificarlo. ' +
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
      const submission = scoreWriteModel.prepareEvaluationSubmission({
        definition,
        answers,
        instrument,
      });
      if (submission.error) return submission;
      const clinicalAge = buildClinicalAge(patient.birthDate);
      const administrativeSexId = Number(patient.administrativeSexId || 0);
      if (!clinicalAge || !Number.isFinite(administrativeSexId) || administrativeSexId <= 0) {
        return {
          error: 'Eloísa no informó edad o sexo administrativo; no se guardó el instrumento.',
        };
      }
      const baseline = await readEvaluationBaseline({ encId, instrument, definition, info });
      if (baseline.error) return baseline;
      const payload = scoreWriteModel.buildEvaluationPayload({
        encId,
        definition,
        metaCampList: submission.metaCampList,
        clinicalAge,
        administrativeSexId,
        info,
      });
      const startedAt = Date.now();
      const writeResult = await postEvaluationScale({
        encId,
        instrument,
        payload,
        info,
        writeGuard,
      });
      if (writeResult.terminalResult) return writeResult.terminalResult;
      return verifyEvaluationScale({
        encId,
        instrument,
        definition,
        submission,
        baseline,
        writeResult,
        info,
        startedAt,
      });
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
