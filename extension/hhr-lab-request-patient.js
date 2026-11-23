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

  const MANUAL_HINT = 'Completa solo los datos que quieras imprimir.';
  const LOADING_HINT = 'Cargando datos desde el episodio…';
  const NEW_PATIENT_HINT = 'Completa solo los datos que quieras imprimir.';

  const hasEpisode = encId => /^\d+$/.test(String(encId || ''));

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
            <div class="hhr-labreq-patient-source">
              <strong id="hhr-labreq-patient-title">Paciente</strong>
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="current" ${episode ? 'checked' : 'disabled'}>De Eloísa
              </label>
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="manual" ${episode ? '' : 'checked'}>Personalizados
              </label>
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="blank">Sin identificación
              </label>
            </div>
            <div class="hhr-labreq-patient-summary">${episode ? LOADING_HINT : NEW_PATIENT_HINT}</div>
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
    const localLabel = () => usesManualPatient() ? 'Datos personalizados' : 'Sin identificación';

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
      if (usesManualPatient()) return MANUAL_HINT;
      return episodePatient() ? '' : LOADING_HINT;
    };

    const refresh = () => {
      if (manualFields) manualFields.hidden = !usesManualPatient();
      if (summary) {
        summary.textContent = summaryText();
        summary.hidden = !summary.textContent;
      }
    };

    main.querySelectorAll(`input[name="${SOURCE_FIELD}"]`).forEach(input => {
      input.addEventListener('change', () => {
        refresh();
        if (typeof onChange === 'function') onChange();
      });
    });

    return { source, printablePatient, usesManualPatient, usesLocalPatient, localLabel, refresh, summaryText };
  };

  root.HhrLabRequestPatient = Object.freeze({ sectionHtml, createController, hasEpisode });
})(typeof globalThis !== 'undefined' ? globalThis : self);
