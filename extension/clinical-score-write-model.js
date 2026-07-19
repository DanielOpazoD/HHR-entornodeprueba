/** Pure validation, payload and readback matching for Braden and Downton writes. */
(function (root) {
  'use strict';

  const invalidAnswers = instrument => ({
    error: 'Completa todas las respuestas de ' + instrument + ' con opciones válidas.',
  });

  const normalizeSelectedOptions = (field, rawValue, instrument) => {
    if (!rawValue && field.required === false) return { selected: [], value: '' };
    const selected = field.type === 7 ? rawValue.split(',').filter(Boolean) : [rawValue];
    if (!selected.length) return invalidAnswers(instrument);
    const options = selected.map(selectedId =>
      field.options.find(option => option.id === selectedId)
    );
    if (options.some(option => !option)) return invalidAnswers(instrument);
    if (options.some(option => !Number.isFinite(option.score))) {
      return {
        error: 'El esquema de ' + instrument + ' no informó el puntaje de una respuesta.',
      };
    }
    return {
      selected,
      value: rawValue,
      score: options.reduce((total, option) => total + option.score, 0),
    };
  };

  const prepareEvaluationSubmission = ({ definition, answers, instrument }) => {
    const values = {};
    let total = 0;
    for (const field of definition.fields) {
      const value = String(answers && answers[field.id] != null ? answers[field.id] : '').trim();
      if (!field.options.length) {
        if (!value && field.required !== false) {
          return { error: 'Completa todos los campos obligatorios de ' + instrument + '.' };
        }
        if (value) values[field.id] = value;
        continue;
      }
      const normalized = normalizeSelectedOptions(field, value, instrument);
      if (normalized.error) return normalized;
      if (!normalized.selected.length) continue;
      total += normalized.score;
      values[field.id] = normalized.value;
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
    return {
      total,
      result,
      metaCampList: Object.keys(values).map(id => ({ id, value: values[id] })),
    };
  };

  const buildEvaluationPayload = ({
    encId,
    definition,
    metaCampList,
    clinicalAge,
    administrativeSexId,
    info,
  }) => ({
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
  });

  const readCreatedIdentity = created => ({
    id: String(created && (created.id || created.data && created.data.id) || ''),
    guid: String(created && (created.guid || created.data && created.data.guid) || ''),
  });

  const valuesMatch = (form, expectedValues) => {
    const formValues = new Map((
      Array.isArray(form.metaCampList) ? form.metaCampList : []
    ).map(item => [
      String(item && (item.id || item.metaFieldName) || ''),
      String(item && (item.value != null ? item.value : item.VALUE) || ''),
    ]));
    return expectedValues.every(item => formValues.get(item.id) === item.value);
  };

  const matchesCreatedIdentity = (form, createdIdentity) => {
    if (createdIdentity.id && String(form.id || '') !== createdIdentity.id) return false;
    return !createdIdentity.guid || String(form.guid || '') === createdIdentity.guid;
  };

  const matchesPractitioner = (form, createdIdentity, practitionerId) => {
    const authorId = String(
      form.authorHealthCarePractitionerId || form.healthCarePractitionerId || ''
    );
    const hasCreatedIdentity = Boolean(createdIdentity.id || createdIdentity.guid);
    if (!hasCreatedIdentity && authorId !== String(practitionerId)) return false;
    return !authorId || authorId === String(practitionerId);
  };

  const matchesEvaluationForm = ({
    form,
    formId,
    createdIdentity,
    baselineContains,
    practitionerId,
    expectedValues,
    hasNewTimestamp,
  }) => {
    if (!form || String(form.formId || '') !== String(formId)) return false;
    if (baselineContains || !matchesCreatedIdentity(form, createdIdentity)) return false;
    if (!matchesPractitioner(form, createdIdentity, practitionerId)) return false;
    return valuesMatch(form, expectedValues) && hasNewTimestamp;
  };

  const buildEvaluationRecord = ({ form, total, result, fallbackAuthor, fallbackDateTime }) => ({
    total,
    severity: result.valueName,
    dateTime: form.createDateTime || form.startDateTime || fallbackDateTime,
    author: form.authorHealthCarePractitionerName || fallbackAuthor,
  });

  root.HhrClinicalScoreWriteModel = Object.freeze({
    buildEvaluationPayload,
    buildEvaluationRecord,
    matchesEvaluationForm,
    prepareEvaluationSubmission,
    readCreatedIdentity,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
