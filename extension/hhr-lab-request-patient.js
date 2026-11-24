/** Patient source and optional identity fields shared by laboratory and imaging orders. */
(function (root) {
  'use strict';

  const SOURCE_FIELD = 'hhr-labreq-patient-source';
  const MANUAL_FIELDS = [
    { key: 'name', label: 'Nombre y apellidos', type: 'text', maxLength: 160, wide: true },
    { key: 'run', label: 'RUT o pasaporte', type: 'text', maxLength: 16 },
    { key: 'birthDate', label: 'Fecha de nacimiento', type: 'date' },
    { key: 'ficha', label: 'Ficha', type: 'text', maxLength: 40 },
    { key: 'diagnosis', label: 'Diagnóstico', type: 'text', maxLength: 180, wide: true },
  ];

  const MANUAL_HINT = 'Completa un campo para imprimir.';
  const LOADING_HINT = 'Cargando datos desde el episodio…';

  const hasEpisode = encId => /^\d+$/.test(String(encId || ''));
  const routeNoticeHtml = '<span class="hhr-patientbar-route" hidden>Distinto al episodio abierto en Eloísa</span>';
  const pickerButtonHtml = (pressed = null) => `<button type="button" class="hhr-labreq-chip hhr-census-trigger"
    aria-haspopup="dialog" aria-expanded="false"${pressed === null ? '' : ' aria-pressed="' + pressed + '"'}>De Eloísa <span aria-hidden="true">▾</span></button>`;

  // Both order types keep the printable identity beside the primary action.
  const printActionsHtml = (kind, copiesLimit) => `
    <div class="hhr-center-toolbar-actions hhr-request-actions">
      <div class="hhr-request-details" aria-live="polite" aria-atomic="true">
        <span class="hhr-request-source" hidden></span>
        <span class="hhr-request-id" hidden></span>
        ${kind === 'lab' ? '<span class="hhr-labreq-count" hidden>0 exámenes</span>' : ''}
        ${routeNoticeHtml}
      </div>
      ${kind === 'lab' ? `<label class="hhr-labreq-copies">Copias<input type="number" value="1" min="1" max="${copiesLimit}" step="1" required title="De 1 a ${copiesLimit} copias"></label>` : ''}
      <button class="hhr-center-action hhr-center-action-primary ${kind === 'lab' ? 'hhr-labreq-print' : 'hhr-imaging-print'}" type="button" disabled>Imprimir</button>
    </div>`;

  const manualFieldHtml = field => {
    const attributes = [
      `data-manual="${field.key}"`,
      `type="${field.type}"`,
      ...(field.maxLength ? [`maxlength="${field.maxLength}"`] : []),
      ...(field.type === 'text' ? ['autocomplete="off"'] : []),
    ].join(' ');
    return `<label${field.wide ? ' class="is-wide"' : ''}>${field.label}<input ${attributes}></label>`;
  };

  /** Marcado de la sección; el episodio decide qué origen viene marcado y si hay campos. */
  const sectionHtml = (encId, imaging = false) => {
    const episode = hasEpisode(encId);
    return `
          <section class="hhr-labreq-patient" aria-labelledby="hhr-labreq-patient-title">
            <div class="hhr-labreq-patient-source hhr-census-anchor">
              <strong id="hhr-labreq-patient-title">Paciente</strong>
              <input type="radio" name="${SOURCE_FIELD}" value="current" hidden ${episode ? 'checked' : 'disabled'}>
              ${pickerButtonHtml(episode)}
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="manual" ${episode ? '' : 'checked'}>Personalizados
              </label>
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="blank">Sin identificación
              </label>
            </div>
            <div class="hhr-labreq-patient-summary">${episode ? LOADING_HINT : MANUAL_HINT}</div>
            <div class="hhr-labreq-manual-fields" ${episode ? 'hidden' : ''}>
              ${MANUAL_FIELDS.filter(field => !imaging || field.key !== 'ficha').map(manualFieldHtml).join('\n              ')}
            </div>
          </section>`;
  };

  /**
   * Controlador de la sección. `readEpisodePatient` entrega los datos ya cargados desde
   * Eloísa (o null mientras no existan), de modo que este módulo no consulta la red.
   */
  const createController = ({ main, readEpisodePatient, onChange }) => {
    const printSource = main.querySelector('.hhr-request-source');
    const identifier = main.querySelector('.hhr-request-id');
    const pickerButton = main.querySelector('.hhr-census-trigger');
    const summary = main.querySelector('.hhr-labreq-patient-summary');
    const manualFields = main.querySelector('.hhr-labreq-manual-fields');

    // Un selector que no encuentra su campo devolvería undefined y rompería al leer
    // `.value`: se trata como vacío y el botón simplemente no se habilita.
    const manualValue = key => {
      const field = main.querySelector(`[data-manual="${key}"]`);
      return field ? String(field.value || '').trim() : '';
    };

    const source = () => main.querySelector(`input[name="${SOURCE_FIELD}"]:checked`)?.value;
    const usesManualPatient = () => source() === 'manual';
    const usesLocalPatient = () => usesManualPatient() || source() === 'blank';

    const manualPatient = () => {
      const patient = {
        name: manualValue('name'),
        run: manualValue('run'),
        birthDate: manualValue('birthDate'),
        diagnosis: manualValue('diagnosis'),
        ficha: manualValue('ficha'),
      };
      return Object.values(patient).some(Boolean) ? patient : null;
    };

    const episodePatient = () => {
      const loaded = typeof readEpisodePatient === 'function' ? readEpisodePatient() : null;
      if (!loaded || !loaded.patient) return null;
      const { patient, view } = loaded;
      return {
        name: patient.name || '',
        run: patient.formattedRun || patient.run || '',
        birthDate: view ? view.nacimiento : '',
        diagnosis: patient.diagnosis || '',
        ficha: '',
      };
    };

    /** Paciente que se imprimiría ahora mismo, o null si aún no hay datos suficientes. */
    const printablePatient = () => {
      if (source() === 'blank') return {};
      if (usesManualPatient()) return manualPatient();
      return source() === 'current' ? episodePatient() : null;
    };

    const summaryText = () => {
      if (source() === 'blank') return '';
      if (usesManualPatient()) return manualPatient() ? '' : MANUAL_HINT;
      return episodePatient() ? '' : LOADING_HINT;
    };

    const refreshSummary = () => {
      if (!summary) return;
      const hint = summaryText();
      if (summary.textContent !== hint) summary.textContent = hint;
      summary.hidden = !hint;
    };

    const refresh = () => {
      const current = source() === 'current';
      const patient = current ? episodePatient() : null;
      pickerButton?.setAttribute('aria-pressed', String(current));
      if (printSource) {
        const label = source() === 'blank' ? 'Sin identificación' : patient?.name || '';
        if (printSource.textContent !== label) printSource.textContent = label;
        printSource.hidden = !label;
      }
      if (identifier) {
        const id = patient?.run || '';
        if (identifier.textContent !== id) identifier.textContent = id;
        identifier.hidden = !id;
      }
      if (manualFields) manualFields.hidden = !usesManualPatient();
      refreshSummary();
    };

    manualFields?.addEventListener('input', refreshSummary);
    main.querySelectorAll(`input[name="${SOURCE_FIELD}"]`).forEach(input => {
      input.addEventListener('change', () => {
        refresh();
        if (typeof onChange === 'function') onChange();
      });
    });

    return { source, printablePatient, usesManualPatient, usesLocalPatient, refresh, summaryText };
  };

  root.HhrLabRequestPatient = Object.freeze({ sectionHtml, printActionsHtml, pickerButtonHtml, routeNoticeHtml, createController, hasEpisode });
})(typeof globalThis !== 'undefined' ? globalThis : self);
