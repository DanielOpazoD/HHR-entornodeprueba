// Fast NT 234 Braden adulto / Braden Q pediátrico matrix view and live scoring helpers.
(root => {
  'use strict';
  const HOSPITAL_TIME_ZONE = 'Pacific/Easter';
  const DEFAULT_CARE_PLANS = Object.freeze({
    bajo: ['Cuidados básicos de enfermería.'],
    moderado: [
      'Posición: cada 4 h con SEMP adecuada; sin ella, cada 2 h.',
      'Proteger prominencias óseas; mantener piel seca e hidratada.',
    ],
    alto: [
      'Posición: cada 3 h con SEMP adecuada; sin ella, cada 2 h.',
      'Proteger prominencias óseas; mantener piel seca e hidratada.',
      'SEMP adecuada: colchón antiescaras/viscoelástico según indicación.',
    ],
  });
  const REASSESS_BY_RISK = Object.freeze({
    alto: 'Cada 24 h',
    moderado: 'Cada 72 h',
    bajo: 'Cada 7 días',
  });
  const RISK_TITLE = Object.freeze({
    alto: 'Alto',
    moderado: 'Moderado',
    bajo: 'Bajo',
  });

  const make = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  };

  function hospitalDateTimeNow(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: HOSPITAL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const part = type => parts.find(entry => entry.type === type)?.value || '';
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}`,
    };
  }

  function isBradenTemplate(template) {
    if (!template) return false;
    return (
      template.scaleGroup === 'braden' ||
      Boolean(template.riskBands) ||
      String(template.id || '').startsWith('hhr-lpp-braden')
    );
  }

  function parseAgeYears(patientAge, patientBirthDate, now = new Date()) {
    const isoMatch = String(patientBirthDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const today = hospitalDateTimeNow(now).date.split('-').map(Number);
      const birth = [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])];
      let years = today[0] - birth[0];
      if (today[1] < birth[1] || (today[1] === birth[1] && today[2] < birth[2])) years -= 1;
      if (Number.isFinite(years) && years >= 0 && years < 130) return years;
    }
    const text = String(patientAge || '').trim().toLowerCase();
    const yearMatch = text.match(/(\d+)\s*(?:a(?:no|ño)?s?\b)/i);
    if (yearMatch) return Number(yearMatch[1]);
    if (/\b(?:mes(?:es)?|d[ií]as?|semanas?|rn)\b/i.test(text)) return 0;
    const bare = text.match(/^(\d{1,3})$/);
    return bare ? Number(bare[1]) : null;
  }

  function suggestBradenTemplate(templates, catalog, now = new Date()) {
    const braden = (templates || []).filter(isBradenTemplate);
    if (!braden.length) return { templateId: null, reason: '' };
    const adult = braden.find(item => item.id === 'hhr-lpp-braden-adulto') || braden[0];
    const pediatric = braden.find(item => item.id === 'hhr-lpp-braden-q');
    const years = parseAgeYears(catalog?.patientAge, catalog?.patientBirthDate, now);
    if (years === null) return { templateId: adult.id, reason: '' };
    if (years < 15 && pediatric) {
      return {
        templateId: pediatric.id,
        reason: `Sugerida por edad (${catalog?.patientAge || years + ' años'})`,
      };
    }
    return {
      templateId: adult.id,
      reason: `Sugerida por edad (${catalog?.patientAge || years + ' años'})`,
    };
  }

  function scoredFieldsOf(template) {
    return (template?.fields || []).filter(
      field => field.type === 'choice' && Array.isArray(field.options) && field.options.some(opt => Number.isInteger(opt.points))
    );
  }

  function stripLeadingScore(label) {
    return String(label || '').replace(/^\d+\s*·\s*/, '').trim();
  }

  function shortCodeOf(field) {
    if (field.shortCode) return field.shortCode;
    const match = String(field.label || '').match(/^([A-Z]{1,3})\s*·/);
    if (match) return match[1];
    return String(field.id || '').slice(0, 2).toUpperCase();
  }

  function evaluateDraft(template, answers) {
    const scoredFields = scoredFieldsOf(template);
    const subscores = [];
    let points = 0;
    let maximum = 0;
    for (const field of scoredFields) {
      maximum += Math.max(...field.options.map(option => Number(option.points || 0)));
      const value = answers?.[field.id] || '';
      const selected = field.options.find(option => option.label === value);
      if (selected) {
        points += selected.points;
        subscores.push({ code: shortCodeOf(field), label: field.label, value: selected.label, points: selected.points });
      }
    }
    const complete = scoredFields.length > 0 && subscores.length === scoredFields.length;
    if (!complete) {
      return {
        complete: false,
        answeredCount: subscores.length,
        totalDimensions: scoredFields.length,
        points,
        maximum,
        subscores,
        risk: null,
        riskLabel: '',
        reassess: '',
        carePlan: [],
      };
    }
    const bands = template.riskBands || (scoredFields.length >= 7 ? { highMax: 16, moderateMax: 21 } : { highMax: 12, moderateMax: 15 });
    const risk = points <= bands.highMax ? 'alto' : points <= bands.moderateMax ? 'moderado' : 'bajo';
    const carePlan = template.carePlans?.[risk] || DEFAULT_CARE_PLANS[risk] || [];
    return {
      complete: true,
      answeredCount: subscores.length,
      totalDimensions: scoredFields.length,
      points,
      maximum,
      subscores,
      risk,
      riskLabel: RISK_TITLE[risk],
      reassess: REASSESS_BY_RISK[risk],
      carePlan,
    };
  }

  function buildDraftEvolutionText(template, answers, authorName, now = new Date()) {
    const summary = evaluateDraft(template, answers);
    if (!summary.complete) return '';
    const stamp = hospitalDateTimeNow(now);
    const fecha = answers?.fecha || stamp.date;
    const hora = answers?.hora || stamp.time;
    const notes = String(answers?.piel || '').trim();
    const lines = [
      'Valoración de riesgo de lesiones por presión · ' + template.title,
      `${fecha} ${hora} · ${authorName || 'Evaluador'}`,
      'Subpuntajes: ' + summary.subscores.map(item => `${item.code} ${item.points}`).join(' · '),
      ...summary.subscores.map(item => `${item.label}: ${item.value}`),
      ...(notes ? ['Observaciones de piel e intervenciones: ' + notes] : []),
      `Puntaje: ${summary.points} / ${summary.maximum}`,
      `Riesgo de LPP según escala: ${summary.riskLabel} (${summary.risk})`,
      `Reevaluar: ${summary.reassess} (o antes ante cambios en la condición clínica).`,
      ...(summary.carePlan.length
        ? ['Cuidados planeados según riesgo:', ...summary.carePlan.map(item => '• ' + item)]
        : []),
    ];
    return lines.join('\n');
  }

  function prefillDateTime(template, answers, now = new Date()) {
    const stamp = hospitalDateTimeNow(now);
    for (const field of template?.fields || []) {
      if (field.type === 'date' && !answers[field.id]) answers[field.id] = stamp.date;
      if (field.type === 'time' && !answers[field.id]) answers[field.id] = stamp.time;
    }
  }

  function renderSummaryPanel(container, template, answers, authorName, onCopyText) {
    container.replaceChildren();
    const summary = evaluateDraft(template, answers);
    const bar = make('div', '', 'hhr-braden-summary' + (summary.risk ? ' is-' + summary.risk : ''));
    if (!summary.complete) {
      const pending = summary.totalDimensions - summary.answeredCount;
      bar.append(
        make(
          'p',
          `Completa ${pending} ${pending === 1 ? 'dimensión' : 'dimensiones'} para calcular el riesgo y los cuidados (${summary.answeredCount}/${summary.totalDimensions}).`,
          'hhr-braden-pending'
        )
      );
      container.append(bar);
      return;
    }
    const top = make('div', '', 'hhr-braden-summary-head');
    top.append(
      make('span', `Total: ${summary.points} / ${summary.maximum}`, 'hhr-braden-total'),
      make('span', `Riesgo ${summary.riskLabel}`, 'hhr-braden-risk-pill is-' + summary.risk),
      make('span', `Reevaluar: ${summary.reassess}`, 'hhr-braden-reassess')
    );
    const chips = make(
      'p',
      summary.subscores.map(item => `${item.code} ${item.points}`).join(' · '),
      'hhr-braden-subscores'
    );
    const list = make('ul', '', 'hhr-braden-care-list');
    for (const item of summary.carePlan) list.append(make('li', item));
    bar.append(top, chips, list);
    container.append(bar);

    const previewText = buildDraftEvolutionText(template, answers, authorName);
    const previewWrap = make('div', '', 'hhr-braden-preview-wrap');
    const previewHead = make('div', '', 'hhr-braden-preview-head');
    previewHead.append(make('span', 'Texto para evolución (vista previa)', 'hhr-braden-preview-title'));
    const copyBtn = make('button', 'Copiar texto', 'hhr-braden-copy-inline');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', () => onCopyText(previewText));
    previewHead.append(copyBtn);
    const pre = make('pre', previewText, 'hhr-checklist-preview');
    previewWrap.append(previewHead, pre);
    container.append(previewWrap);
  }

  function renderMatrix({
    container,
    template,
    bradenTemplates,
    suggestedId,
    suggestedReason,
    answers,
    authorName,
    onSwitchTemplate,
    onAnswerChange,
    onCopyText,
  }) {
    container.replaceChildren();
    prefillDateTime(template, answers);

    if (bradenTemplates.length > 1) {
      const switcher = make('div', '', 'hhr-braden-switcher');
      for (const item of bradenTemplates) {
        const pill = make(
          'button',
          item.id === 'hhr-lpp-braden-q' ? 'Braden Q pediátrico (<15 años)' : 'Braden adulto (≥15 años)',
          'hhr-braden-tab' + (item.id === template.id ? ' is-active' : '')
        );
        pill.type = 'button';
        pill.setAttribute('aria-pressed', String(item.id === template.id));
        pill.addEventListener('click', () => {
          if (item.id !== template.id) onSwitchTemplate(item.id);
        });
        switcher.append(pill);
      }
      if (suggestedReason && suggestedId === template.id) {
        switcher.append(make('span', suggestedReason, 'hhr-braden-age-hint'));
      }
      container.append(switcher);
    }

    const summaryHost = make('div', '', 'hhr-braden-summary-host');
    const refreshSummary = () => renderSummaryPanel(summaryHost, template, answers, authorName, onCopyText);

    const tableWrap = make('div', '', 'hhr-braden-table-wrap');
    const table = make('table', '', 'hhr-braden-table');
    const thead = make('thead');
    const headRow = make('tr');
    for (const heading of ['Dimensión', '1 punto', '2 puntos', '3 puntos', '4 puntos']) {
      headRow.append(make('th', heading));
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = make('tbody');
    const scoredFields = scoredFieldsOf(template);
    for (const field of scoredFields) {
      const tr = make('tr');
      const dimCell = make('th', field.label, 'hhr-braden-dim');
      dimCell.scope = 'row';
      tr.append(dimCell);
      const rowButtons = [];
      for (let points = 1; points <= 4; points++) {
        const td = make('td');
        const option = field.options.find(item => item.points === points);
        if (!option) {
          td.append(make('span', 'No aplica', 'hhr-braden-na'));
        } else {
          const btn = make('button', stripLeadingScore(option.label), 'hhr-braden-cell');
          btn.type = 'button';
          btn.dataset.field = field.id;
          btn.dataset.points = String(points);
          const syncSelected = () => {
            const active = answers[field.id] === option.label;
            btn.classList.toggle('is-selected', active);
            btn.setAttribute('aria-pressed', String(active));
          };
          btn.addEventListener('click', () => {
            answers[field.id] = option.label;
            rowButtons.forEach(fn => fn());
            onAnswerChange();
            refreshSummary();
          });
          rowButtons.push(syncSelected);
          syncSelected();
          td.append(btn);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
    container.append(tableWrap);

    const extraFields = (template.fields || []).filter(field => !scoredFields.includes(field));
    if (extraFields.length) {
      const meta = make('div', '', 'hhr-braden-meta');
      for (const field of extraFields) {
        const label = make('label', field.label, field.type === 'text' ? 'is-wide' : '');
        const input = field.type === 'text' ? make('textarea') : make('input');
        if (field.type === 'text') {
          input.rows = 2;
          input.maxLength = 2000;
          input.placeholder = 'Opcional: piel íntegra, prominencias óseas, SEMP o cuidados aplicados…';
        } else {
          input.type = field.type === 'positive-integer' ? 'number' : field.type;
        }
        input.name = field.id;
        input.required = Boolean(field.required);
        input.value = answers[field.id] || '';
        input.addEventListener('input', () => {
          answers[field.id] = input.value;
          onAnswerChange();
          refreshSummary();
        });
        label.append(input);
        meta.append(label);
      }
      container.append(meta);
    }

    container.append(summaryHost);
    refreshSummary();
  }

  root.HhrChecklistBraden = Object.freeze({
    isBradenTemplate,
    hospitalDateTimeNow,
    parseAgeYears,
    suggestBradenTemplate,
    evaluateDraft,
    buildDraftEvolutionText,
    prefillDateTime,
    renderMatrix,
  });
})(globalThis);
