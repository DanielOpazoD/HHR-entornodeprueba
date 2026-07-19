/**
 * hhr-scores-presentation.js
 *
 * Pure presentation model for the Centro HHR Scores table. It normalizes
 * persisted score reads and derives labels/action state without touching DOM,
 * transport, or clinical-write recovery protocols.
 */
(() => {
  'use strict';

  const normalizeCudyrHistoryItem = item => ({
    total: item.category,
    dateTime: item.recordedAt,
    author: item.author || '',
    authorRole: item.authorRole || '',
    dependencyScore: item.dependencyScore,
    riskScore: item.riskScore,
  });

  const normalizeCudyrHistory = raw => {
    if (raw && Array.isArray(raw.history) && raw.history.length) {
      return raw.history.map(normalizeCudyrHistoryItem);
    }
    if (!raw || !raw.crdValue) return [];
    return [{
      total: raw.crdValue,
      dateTime: raw.crdDateTime,
      author: raw.author || '',
      authorRole: raw.authorRole || '',
    }];
  };

  const normalizeScoreHistory = ({ instrument, raw, unavailableReason }) => {
    if (unavailableReason) return [];
    if (instrument === 'CUDYR') return normalizeCudyrHistory(raw);
    return Array.isArray(raw) ? raw : [];
  };

  const latestValueLabel = (latest, unavailableReason) => {
    if (unavailableReason) return 'No verificable';
    if (!latest) return 'Sin aplicación';
    return String(latest.total) + (latest.severity ? ' · ' + latest.severity : '');
  };

  const latestDateLabel = (latest, unavailableReason, formatDateTimeLabel) => {
    if (unavailableReason || !latest) return '-';
    return formatDateTimeLabel(latest.dateTime) || '-';
  };

  const professionalPresentation = (latest, unavailableReason) => {
    if (unavailableReason || !latest) return { text: '-', role: '' };
    return {
      text: latest.author || latest.authorRole || '-',
      role: latest.author && latest.authorRole ? latest.authorRole : '',
    };
  };

  const historyCountLabel = (instrument, count) => {
    if (instrument === 'CUDYR') {
      return count + (count === 1 ? ' categorización' : ' categorizaciones');
    }
    return count + (count === 1 ? ' visible' : ' visibles') + ' · máx. 8/120 días';
  };

  const historyPresentation = ({ instrument, history, unavailableReason, uncertainWrite }) => {
    if (uncertainWrite) {
      return {
        label: 'Protegido · revisa el último valor',
        title: uncertainWrite.error ||
          'La escritura permanece protegida hasta confirmar su estado en Eloísa.',
      };
    }
    if (unavailableReason) {
      return { label: 'Lectura no disponible', title: unavailableReason };
    }
    return { label: historyCountLabel(instrument, history.length), title: '' };
  };

  const historyItemLabel = (item, formatDateTimeLabel) =>
    String(item.total) +
    (item.severity ? ' · ' + item.severity : '') + ' · ' +
    formatDateTimeLabel(item.dateTime) +
    (item.author ? ' · ' + item.author : '') +
    (item.authorRole ? ' (' + item.authorRole + ')' : '') +
    (item.dependencyScore != null && item.riskScore != null
      ? ' · Dependencia ' + item.dependencyScore + ' / Riesgo ' + item.riskScore
      : '');

  const recoveryActionPresentation = ({ persistedProtection, unavailableReason, recoveryReady }) => {
    const disabled = Boolean(
      unavailableReason || persistedProtection.error ||
        !persistedProtection.generationId || !recoveryReady
    );
    return {
      kind: 'recovery',
      text: recoveryReady ? 'Actualizar y revisar' : 'Espera y actualiza',
      disabled,
      title: disabled
        ? 'La lectura o la protección no pudo verificarse; actualiza antes de liberar.'
        : 'Libera únicamente después de revisar el último valor e historial visibles.',
    };
  };

  const registerActionPresentation = ({ canWriteInstrument, unavailableReason, uncertainWrite }) => ({
    kind: 'register',
    text: 'Registrar',
    disabled: !canWriteInstrument || Boolean(uncertainWrite) || Boolean(unavailableReason),
    title: uncertainWrite
      ? 'Revisa el estado en Eloísa antes de registrar otra aplicación.'
      : unavailableReason
        ? 'No se puede registrar mientras el historial completo no sea verificable.'
        : '',
  });

  const actionPresentation = options => options.persistedProtection
    ? recoveryActionPresentation(options)
    : registerActionPresentation(options);

  const scoreFieldInputType = type => {
    if (type === 3 || type === 6) return 'number';
    if (type === 4) return 'date';
    if (type === 5) return 'datetime-local';
    return 'text';
  };

  const scoreFieldPresentation = ({ field, index, encounterId, instrument }) => {
    const safeFieldId = String(field.id || index).replace(/[^a-z0-9_-]/gi, '-');
    const controlId = 'hhr-score-' + encounterId + '-' + instrument.toLowerCase() + '-' +
      safeFieldId + '-' + index;
    const view = {
      label: (index + 1) + '. ' + (field.label || field.id) +
        (field.required === false ? ' (opcional)' : ''),
      controlId,
      explanation: field.explanation || '',
      explanationId: field.explanation ? controlId + '-help' : '',
      required: field.required !== false,
      multiple: field.type === 7,
      inputType: scoreFieldInputType(field.type),
      options: Array.isArray(field.options) && field.options.length
        ? field.options.map(option => ({
            value: String(instrument === 'CUDYR' ? option.value : option.id),
            optionId: String(option.id),
            score: option.score == null ? '' : String(option.score),
            label: (instrument === 'CUDYR' ? '[' + option.value + '] ' : '') +
              option.description,
          }))
        : [],
    };
    const control = {
      tag: view.options.length ? 'select' : 'input',
      className: 'hhr-score-control',
      properties: {
        id: view.controlId,
        required: view.required,
        ...(view.options.length
          ? { multiple: view.multiple }
          : { type: view.inputType }),
      },
      attributes: view.explanationId
        ? { 'aria-describedby': view.explanationId }
        : {},
      dataset: {
        fieldId: field.id,
        typeId: field.typeId == null ? '' : String(field.typeId),
      },
      children: view.options.length
        ? [
            ...(view.multiple ? [] : [{ tag: 'option', properties: { value: '' }, text: 'Seleccionar…' }]),
            ...view.options.map(option => ({
              tag: 'option',
              properties: { value: option.value },
              dataset: { optionId: option.optionId, score: option.score },
              text: option.label,
            })),
          ]
        : [],
    };
    return {
      ...view,
      descriptor: {
        tag: 'div',
        className: 'hhr-score-field',
        children: [
          { tag: 'label', properties: { htmlFor: view.controlId }, text: view.label },
          ...(view.explanation
            ? [{
                tag: 'span',
                className: 'hhr-score-explanation',
                properties: { id: view.explanationId },
                text: view.explanation,
              }]
            : []),
          control,
        ],
      },
    };
  };

  const mergeSavedScore = ({ instrument, currentScore, record, currentProfessional }) => {
    if (instrument !== 'CUDYR') {
      return [record].concat(currentScore || []).slice(0, 8);
    }
    const savedHistoryEntry = {
      category: String(record.total),
      recordedAt: record.dateTime,
      author: currentProfessional || '',
      authorRole: 'Enfermería',
      dependencyScore: record.dependency,
      riskScore: record.risk,
      items: [],
    };
    return {
      crdValue: savedHistoryEntry.category,
      crdDateTime: savedHistoryEntry.recordedAt,
      author: savedHistoryEntry.author,
      authorRole: savedHistoryEntry.authorRole,
      source: 'ficha_medico',
      history: [savedHistoryEntry].concat(
        currentScore && Array.isArray(currentScore.history) ? currentScore.history : []
      ).slice(0, 20),
    };
  };

  const recoveryResultPresentation = result => {
    if (result && result.cancelled) {
      return {
        complete: false,
        text: 'Protegido',
        title: 'La protección se mantuvo porque no se confirmó la lectura fresca.',
      };
    }
    if (!result || result.error) {
      return {
        complete: false,
        text: 'No se liberó',
        title: String(result && result.error || 'No fue posible liberar la protección.'),
      };
    }
    return { complete: true, text: '', title: '' };
  };

  const cellDescriptor = (label, text = '', children = []) => ({
    tag: 'td',
    dataset: { label },
    text,
    children,
  });

  const rowCellDescriptors = ({ identity, latest, history }) => {
    const professionalChildren = latest.professional.role
      ? [{ tag: 'span', className: 'hhr-center-meta', text: latest.professional.role }]
      : [];
    const historyChildren = [{ tag: 'summary', text: history.label }];
    if (history.items.length) {
      historyChildren.push({
        tag: 'ol',
        children: history.items.map(text => ({ tag: 'li', text })),
      });
    }
    return [
      cellDescriptor('Cama', identity.bed),
      cellDescriptor('Paciente', '', [
        { tag: 'span', className: 'hhr-center-patient', text: identity.name },
        { tag: 'span', className: 'hhr-center-meta', text: identity.meta },
      ]),
      cellDescriptor('Último valor', latest.value),
      cellDescriptor('Última aplicación', latest.date),
      cellDescriptor('Profesional', latest.professional.text, professionalChildren),
      cellDescriptor('Historia', '', [{
        tag: 'details',
        className: 'hhr-history',
        title: history.title,
        children: historyChildren,
      }]),
    ];
  };

  const buildPatientPresentation = ({
    patient,
    instrument,
    unavailableReason,
    persistedProtection,
    uncertainWrite,
    canWriteInstrument,
    recoveryReady,
    formatDateTimeLabel,
  }) => {
    const raw = patient.scores && patient.scores[instrument];
    const history = normalizeScoreHistory({ instrument, raw, unavailableReason });
    const latest = history[0] || null;
    const historyState = historyPresentation({
      instrument,
      history,
      unavailableReason,
      uncertainWrite,
    });
    const identity = {
        bed: patient.bed || patient.room || '-',
        name: patient.name || 'Paciente sin nombre',
        meta: [patient.run, patient.service].filter(Boolean).join(' · '),
        search: [patient.name, patient.run, patient.bed, patient.room, patient.service].join(' '),
      };
    const latestPresentation = {
        value: latestValueLabel(latest, unavailableReason),
        date: latestDateLabel(latest, unavailableReason, formatDateTimeLabel),
        professional: professionalPresentation(latest, unavailableReason),
      };
    const historyView = {
        ...historyState,
        items: unavailableReason
          ? []
          : history.map(item => historyItemLabel(item, formatDateTimeLabel)),
      };
    return {
      identity,
      latest: latestPresentation,
      history: historyView,
      action: actionPresentation({
        canWriteInstrument,
        unavailableReason,
        uncertainWrite,
        persistedProtection,
        recoveryReady,
      }),
      rowCells: rowCellDescriptors({
        identity,
        latest: latestPresentation,
        history: historyView,
      }),
    };
  };

  globalThis.HhrScoresPresentation = Object.freeze({
    normalizeScoreHistory,
    buildPatientPresentation,
    scoreFieldPresentation,
    mergeSavedScore,
    recoveryResultPresentation,
  });
})();
