/**
 * hhr-lab-request-patient.js
 *
 * Origen del paciente en la solicitud de exámenes: el episodio abierto en Eloísa o un
 * paciente nuevo escrito a mano (consultas y pacientes sin episodio hospitalario).
 *
 * Vive aparte del Centro de Laboratorio porque es la única parte de esa pantalla que
 * decide QUÉ paciente se imprime. Mantenerla separada evita que el marcado y la regla de
 * habilitación del botón queden comprimidos dentro del controlador para caber en su
 * presupuesto de tamaño, que fue justo lo que ocurrió antes.
 *
 * No normaliza ni valida el RUT: la solicitud es un formulario que se imprime y firma en
 * papel, no una escritura clínica en Rayen.
 */
(function (root) {
  'use strict';

  const SOURCE_FIELD = 'hhr-labreq-patient-source';
  const MANUAL_FIELDS = [
    { key: 'name', label: 'Nombre y apellidos *', type: 'text', maxLength: 160, wide: true },
    { key: 'run', label: 'RUT', type: 'text', maxLength: 16 },
    { key: 'birthDate', label: 'Fecha de nacimiento', type: 'date' },
    { key: 'ficha', label: 'Ficha', type: 'text', maxLength: 40 },
    { key: 'diagnosis', label: 'Diagnóstico', type: 'text', maxLength: 180, wide: true },
  ];

  const MANUAL_HINT = 'Ingresa al menos el nombre. Puedes imprimir la orden sin marcar exámenes.';
  const LOADING_HINT = 'Cargando datos desde el episodio…';
  const NEW_PATIENT_HINT = 'Ingresa los datos del paciente nuevo.';

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
  const sectionHtml = encId => {
    const episode = hasEpisode(encId);
    return `
          <section class="hhr-labreq-patient" aria-labelledby="hhr-labreq-patient-title">
            <div class="hhr-labreq-patient-source">
              <strong id="hhr-labreq-patient-title">Datos del paciente</strong>
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="current" ${episode ? 'checked' : 'disabled'}>Paciente de Eloísa
              </label>
              <label class="hhr-labreq-chip">
                <input type="radio" name="${SOURCE_FIELD}" value="manual" ${episode ? '' : 'checked'}>Paciente nuevo
              </label>
            </div>
            <div class="hhr-labreq-patient-summary">${episode ? LOADING_HINT : NEW_PATIENT_HINT}</div>
            <div class="hhr-labreq-manual-fields" ${episode ? 'hidden' : ''}>
              ${MANUAL_FIELDS.map(manualFieldHtml).join('\n              ')}
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

    const usesManualPatient = () =>
      main.querySelector(`input[name="${SOURCE_FIELD}"]:checked`)?.value === 'manual';

    const manualPatient = () => {
      const name = manualValue('name');
      if (!name) return null;
      return {
        name,
        run: manualValue('run'),
        birthDate: manualValue('birthDate'),
        diagnosis: manualValue('diagnosis'),
        ficha: manualValue('ficha'),
      };
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
    const printablePatient = () => (usesManualPatient() ? manualPatient() : episodePatient());

    const summaryText = () => {
      if (usesManualPatient()) return MANUAL_HINT;
      const patient = episodePatient();
      if (!patient) return LOADING_HINT;
      return `${patient.name || 'Paciente'} · ${patient.run || 'RUT no informado'}`;
    };

    const refresh = () => {
      if (manualFields) manualFields.hidden = !usesManualPatient();
      if (summary) summary.textContent = summaryText();
    };

    main.querySelectorAll(`input[name="${SOURCE_FIELD}"]`).forEach(input => {
      input.addEventListener('change', () => {
        refresh();
        if (typeof onChange === 'function') onChange();
      });
    });

    return { printablePatient, usesManualPatient, refresh, summaryText };
  };

  root.HhrLabRequestPatient = Object.freeze({ sectionHtml, createController, hasEpisode });
})(typeof globalThis !== 'undefined' ? globalThis : self);
