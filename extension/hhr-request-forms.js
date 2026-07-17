/**
 * hhr-request-forms.js (ISOLATED world + service worker)
 *
 * Port of HHR's exam-request panels: the imaging request set (Solicitud de Imágenes,
 * Encuesta Medio Contraste, Consentimiento Informado — PNG preview with % overlays on
 * screen, pdf-lib template fill on print) and the laboratory request form (pure HTML,
 * printed via a dedicated tab). Sources: imagingViewerController.ts,
 * imagingRequestPdfCoordinates.ts, examCategories.ts, clinicalUtils.ts.
 */
(() => {
  'use strict';
  if (globalThis.HhrRequestForms) return;

  // --- Clinical utils (ported verbatim from clinicalUtils.ts) ---
  const splitPatientName = fullName => {
    if (!fullName) return ['', '', ''];
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length === 1) return [parts[0], '', ''];
    if (parts.length === 2) return [parts[0], parts[1], ''];
    if (parts.length === 3) return [parts[0], parts[1], parts[2]];
    const secApe = parts.pop() || '';
    const primApe = parts.pop() || '';
    return [parts.join(' '), primApe, secApe];
  };

  const calculateAge = birthDate => {
    if (!birthDate) return '';
    const parts = String(birthDate).includes('-') ? String(birthDate).slice(0, 10).split('-') : [];
    if (parts.length !== 3) return '';
    const [year, month, day] = parts[0].length === 4
      ? parts.map(Number)
      : parts[2].length === 4
        ? [Number(parts[2]), Number(parts[1]), Number(parts[0])]
        : [];
    if (!year || !month || !day) return '';
    const birth = new Date(year, month - 1, day);
    if (
      birth.getFullYear() !== year ||
      birth.getMonth() !== month - 1 ||
      birth.getDate() !== day
    ) return '';
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return `${age} años`;
  };

  const formatDateCL = dateStr => {
    if (!dateStr) return '';
    const value = String(dateStr);
    if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, m, d] = value.slice(0, 10).split('-');
      return `${d}-${m}-${y}`;
    }
    return value;
  };

  const todayCL = () => {
    const date = new Date();
    return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
  };

  /**
   * Normalized field view for the imaging documents. `patient` is the background's
   * patientHeaderData shape ({name, run, birthDate, diagnosis, ...}); `formattedRun`
   * comes from HhrPrescriptionPrint.formatRun (module-11 validated).
   */
  const buildPatientView = (patient, formattedRun) => {
    const [nombres, primerApellido, segundoApellido] = splitPatientName(patient && patient.name);
    return {
      nombres,
      primerApellido,
      segundoApellido,
      rut: formattedRun || (patient && patient.run) || '',
      edad: calculateAge(patient && patient.birthDate),
      nacimiento: formatDateCL(patient && patient.birthDate),
      diagnostico: (patient && patient.diagnosis) || '',
      hoy: todayCL(),
    };
  };

  // --- Imaging documents: screen overlays (%) + PDF coordinates (origin bottom-left) ---
  const SOLICITUD_FIELD_COORDS = {
    nombres: { x: 117.57, y: 766.71, maxWidth: 78.58 },
    primerApellido: { x: 201.1, y: 766.71, maxWidth: 69.16 },
    segundoApellido: { x: 275.46, y: 766.71, maxWidth: 88.68 },
    rut: { x: 60.47, y: 750.58, maxWidth: 135.01 },
    edad: { x: 229.74, y: 750.58, maxWidth: 52.39 },
    fechaNacimiento: { x: 472.95, y: 750.58, maxWidth: 88.68 },
    diagnostico: { x: 131.64, y: 733.82, maxWidth: 206.24 },
    fechaSolicitud: { x: 139.04, y: 786.2, maxWidth: 59.79 },
    medicoTratante: { x: 315.0, y: 108.0, maxWidth: 145.33 },
  };
  const ENCUESTA_FIELD_COORDS = {
    nombres: { x: 99.57, y: 646.73, maxWidth: 50.58 },
    primerApellido: { x: 166.44, y: 646.73, maxWidth: 69.16 },
    segundoApellido: { x: 255.46, y: 646.73, maxWidth: 66.01 },
    edad: { x: 359.08, y: 646.73, maxWidth: 52.39 },
    rut: { x: 423.13, y: 646.73, maxWidth: 135.01 },
    fechaNacimiento: { x: 164.95, y: 586.44, maxWidth: 88.68 },
    diagnostico: { x: 112.31, y: 486.26, maxWidth: 206.24 },
    medicoTratante: { x: 409.0, y: 615.4, maxWidth: 150.02 },
  };
  const CONSENTIMIENTO_FIELD_COORDS = {
    nombres: { x: 188.4, y: 649.0, maxWidth: 76.43 },
    primerApellido: { x: 289.71, y: 649.0, maxWidth: 67.26 },
    segundoApellido: { x: 373.35, y: 649.0, maxWidth: 86.25 },
    rut: { x: 130.87, y: 624.51, maxWidth: 131.31 },
    edad: { x: 314.21, y: 624.51, maxWidth: 50.95 },
    diagnostico: { x: 142.75, y: 595.5, maxWidth: 200.6 },
    fecha: { x: 415.53, y: 690.05, maxWidth: 58.16 },
    medicoTratante: { x: 145.52, y: 155.19, maxWidth: 152.03 },
  };

  const IMAGING_DOCUMENTS = {
    solicitud: {
      id: 'solicitud',
      title: 'Formulario Solicitud',
      image: 'forms/solicitud_imagenologia.png',
      pdf: 'forms/solicitud-imagen.pdf',
      aspectRatio: '612 / 936',
      coords: SOLICITUD_FIELD_COORDS,
      overlays: (view, physician) => [
        { text: view.nombres, left: '19.21%', top: '16.87%' },
        { text: view.primerApellido, left: '32.86%', top: '16.87%' },
        { text: view.segundoApellido, left: '45.01%', top: '16.87%' },
        { text: view.rut, left: '9.88%', top: '18.38%' },
        { text: view.edad, left: '37.54%', top: '18.38%' },
        { text: view.nacimiento, left: '77.28%', top: '18.38%' },
        { text: view.diagnostico, left: '21.51%', top: '20.24%', bold: true },
        { text: view.hoy, left: '22.72%', top: '14.71%' },
        { text: physician, left: '51.47%', top: '85.61%', bold: true },
      ],
      pdfFields: (view, physician) => [
        { coord: SOLICITUD_FIELD_COORDS.nombres, text: view.nombres },
        { coord: SOLICITUD_FIELD_COORDS.primerApellido, text: view.primerApellido },
        { coord: SOLICITUD_FIELD_COORDS.segundoApellido, text: view.segundoApellido },
        { coord: SOLICITUD_FIELD_COORDS.rut, text: view.rut },
        { coord: SOLICITUD_FIELD_COORDS.edad, text: view.edad },
        { coord: SOLICITUD_FIELD_COORDS.fechaNacimiento, text: view.nacimiento },
        { coord: SOLICITUD_FIELD_COORDS.diagnostico, text: view.diagnostico },
        { coord: SOLICITUD_FIELD_COORDS.fechaSolicitud, text: view.hoy },
        { coord: SOLICITUD_FIELD_COORDS.medicoTratante, text: physician },
      ],
    },
    encuesta: {
      id: 'encuesta',
      title: 'Encuesta Medio Contraste',
      image: 'forms/encuesta_imagenologia.png',
      pdf: 'forms/encuesta-contraste.pdf',
      aspectRatio: '612 / 792',
      coords: ENCUESTA_FIELD_COORDS,
      overlays: (view, physician) => [
        { text: view.nombres, left: '16.27%', top: '17.12%' },
        { text: view.primerApellido, left: '27.20%', top: '17.12%' },
        { text: view.segundoApellido, left: '41.74%', top: '17.12%' },
        { text: view.rut, left: '69.14%', top: '17.12%' },
        { text: view.edad, left: '58.67%', top: '17.12%' },
        { text: view.nacimiento, left: '26.95%', top: '24.52%' },
        { text: view.diagnostico, left: '18.35%', top: '37.24%', bold: true },
        { text: physician, left: '66.83%', top: '20.80%', bold: true },
      ],
      pdfFields: (view, physician) => [
        { coord: ENCUESTA_FIELD_COORDS.nombres, text: view.nombres },
        { coord: ENCUESTA_FIELD_COORDS.primerApellido, text: view.primerApellido },
        { coord: ENCUESTA_FIELD_COORDS.segundoApellido, text: view.segundoApellido },
        { coord: ENCUESTA_FIELD_COORDS.edad, text: view.edad },
        { coord: ENCUESTA_FIELD_COORDS.rut, text: view.rut },
        { coord: ENCUESTA_FIELD_COORDS.fechaNacimiento, text: view.nacimiento },
        { coord: ENCUESTA_FIELD_COORDS.diagnostico, text: view.diagnostico },
        { coord: ENCUESTA_FIELD_COORDS.medicoTratante, text: physician },
      ],
    },
    consentimiento: {
      id: 'consentimiento',
      title: 'Consentimiento Informado',
      image: 'forms/consentimiento.png',
      pdf: 'forms/consentimiento.pdf',
      aspectRatio: '612 / 842',
      coords: CONSENTIMIENTO_FIELD_COORDS,
      overlays: (view, physician) => [
        { text: view.nombres, left: '31.65%', top: '21.7%', small: true },
        { text: view.primerApellido, left: '48.67%', top: '21.7%', small: true },
        { text: view.segundoApellido, left: '62.72%', top: '21.7%', small: true },
        { text: view.rut, left: '21.99%', top: '24.4%', small: true },
        { text: view.edad, left: '52.79%', top: '24.4%', small: true },
        { text: view.diagnostico, left: '23.98%', top: '27.92%', small: true, bold: true },
        { text: view.hoy, left: '69.81%', top: '16.76%', small: true },
        { text: physician, left: '24.45%', top: '80.07%', small: true, bold: true },
      ],
      pdfFields: (view, physician) => [
        { coord: CONSENTIMIENTO_FIELD_COORDS.nombres, text: view.nombres },
        { coord: CONSENTIMIENTO_FIELD_COORDS.primerApellido, text: view.primerApellido },
        { coord: CONSENTIMIENTO_FIELD_COORDS.segundoApellido, text: view.segundoApellido },
        { coord: CONSENTIMIENTO_FIELD_COORDS.rut, text: view.rut },
        { coord: CONSENTIMIENTO_FIELD_COORDS.edad, text: view.edad },
        { coord: CONSENTIMIENTO_FIELD_COORDS.diagnostico, text: view.diagnostico },
        { coord: CONSENTIMIENTO_FIELD_COORDS.fecha, text: view.hoy },
        { coord: CONSENTIMIENTO_FIELD_COORDS.medicoTratante, text: physician },
      ],
    },
  };

  // --- Laboratory request form (Hospital Hanga Roa official layout) ---
  const EXAM_CATEGORIES = [
    { id: 'bioquimica', name: 'BIOQUIMICA', tube: 'TUBO AMARILLO – ROJO', exams: [
      'GLICEMIA', 'P.T.G.O', 'UREMIA', 'CREATININA', 'FOSFATASA ALCALINA', 'GOT – GPT', 'GGT',
      'AMILASA', 'PROTEINA TOTAL', 'ALBUMINA', 'BILIRRUBINA DIRECTA Y TOTAL', 'LDH', 'LIPASA',
      'URICEMIA', 'COLESTEROL', 'COLESTEROL HDL', 'TRIGLICERIDOS', 'CK', 'CK-MB',
      'GASES ARTERIALES (JERINGA HEPARINIZADA)', 'GASES VENOSOS (JERINGA HEPARINIZADA)',
    ] },
    { id: 'hematologia', name: 'HEMATOLOGIA', tube: 'TUBO LILA', exams: [
      'HEMOGRAMA', 'VHS', 'RCTO.LEUCOCITOS', 'RCTO. PLAQUETAS', 'HEMATOCRITO', 'HEMOGLOBINA',
      'HEMOGLOBINA GLICOSILADA', 'GRUPO SANGUINEO ABO-RH',
    ] },
    { id: 'coagulacion', name: 'COAGULACION', tube: 'TUBO CELESTE', exams: [
      'PROTROMBINA/ INR', 'TTPK', 'TIEMPO DE SANGRÍA', 'FIBRINOGENO', 'DIMERO - D',
    ] },
    { id: 'hormonas', name: 'HORMONAS', tube: 'TUBO AMARILLO – ROJO', exams: [
      'H. TIROESTIMULANTE (TSH)', 'TIROXINA LIBRE (T4L)', 'TROPONINA', 'ANT. PROST-ESPECIF. (PSA)',
      'SUB. UND Β- HCG',
    ] },
    { id: 'microbiologicos', name: 'MICROBIOLOGICOS', exams: [
      'UROCULTIVO', 'HEMOCULTIVO', 'COPROCULTIVO', 'MYCOPLASMA-UREAPLASMA', 'FLUJO VAGINAL',
      'TINCION BAAR', 'SECRECIONES',
    ] },
    { id: 'orina', name: 'ORINA', exams: ['SEDIMENTO URINARIO', 'ORINA COMPLETA', 'TEST DE EMBARAZO'] },
    { id: 'parasitologia', name: 'PARASITOLOGIA', exams: ['COPROPARASITARO', 'TEST DE GRAHAM', 'ACAROTEST'] },
    { id: 'virologia', name: 'VIROLOGIA', exams: ['ROTAVIRUS', 'ADENOVIRUS', 'SARS-COV-2', 'DENGUE/ZIKA/CHIKUNGUNYA'] },
    { id: 'inmunologia', name: 'INMUNOLOGIA/SEROLOGÍA', tube: 'TUBO AMARILLO – ROJO', exams: [
      'PROTEINA C REACTIVA', 'FACTOR REUMATOIDEO', 'R.P.R.', 'IGM DENGUE',
    ] },
    { id: 'tubo-verde', name: 'TUBO VERDE', exams: ['ELECTROLITOS PLASMATICOS', 'LACTATO'] },
    { id: 'otros-panel', name: 'OTROS', exams: [
      'TEST DE WEBER (HEMORRAGIAS OCULTAS)', 'CITOLOGICO (MICROTUBO LILA 0.5CC)',
      'FISICO QUIMICO (JERINGA)', 'LEUCOCITOS FECALES', 'MICOLOGICO DIRECTO',
    ] },
  ];
  const PROCEDENCIA_OPTIONS = ['Infantil', 'Adulto', 'Maternal', 'Policlínico', 'Hospitalización', 'Urgencia'];
  const FONASA_LEVELS = ['A', 'B', 'C', 'D'];
  /** Column layout of the printed form (category ids per column). */
  const LAB_FORM_COLUMNS = [
    ['bioquimica', 'tubo-verde'],
    ['hematologia', 'coagulacion', 'microbiologicos'],
    ['hormonas', 'orina', 'parasitologia', 'virologia', 'inmunologia', 'otros-panel'],
  ];

  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * Printable HTML replica of the official laboratory request form, laid out to match the
   * PDF that the HHR app produces: cross checkmarks, TUBO VERDE nested inside
   * BIOQUIMICA, two-column HEMATOLOGIA, merged ORINA/PARÁSITOS and VIROLOGÍA/OTROS panels,
   * and the bottom INMUNOLOGIA + OTROS/MEDICO/FIRMA block. `state` carries
   * {patient:{name,run,birthDate}, diagnosis, ficha, procedencia, fonasaLevel, prais,
   *  selected:Set|Array, otros, medico, logoUrl}.
   */
  const buildLabRequestPrintHtml = state => {
    const selected = new Set(Array.isArray(state.selected) ? state.selected : Array.from(state.selected || []));
    const byId = Object.fromEntries(EXAM_CATEGORIES.map(category => [category.id, category]));
    const box = isOn => `<span class="box${isOn ? ' on' : ''}">${isOn ? '&times;' : ''}</span>`;
    const exam = (categoryId, label) =>
      `<div class="exam">${box(selected.has(categoryId + '|' + label))}<span>${escapeHtml(label)}</span></div>`;
    const examList = categoryIds => categoryIds
      .map(id => byId[id].exams.map(label => exam(id, label)).join(''))
      .join('');
    const header = (title, tube) =>
      `<div class="section-title">${escapeHtml(title)}${tube ? `<small>(${escapeHtml(tube)})</small>` : ''}</div>`;

    const col1 = `
      <div class="section">
        ${header('BIOQUIMICA', byId.bioquimica.tube)}
        ${examList(['bioquimica'])}
        <div class="subsection-title">TUBO VERDE</div>
        ${examList(['tubo-verde'])}
      </div>`;
    const col2 = `
      <div class="section">
        ${header('HEMATOLOGIA', byId.hematologia.tube)}
        <div class="two-cols">${examList(['hematologia'])}</div>
      </div>
      <div class="section">
        ${header('COAGULACION', byId.coagulacion.tube)}
        ${examList(['coagulacion'])}
      </div>
      <div class="section">
        ${header('MICROBIOLOGICOS')}
        ${examList(['microbiologicos'])}
      </div>`;
    const col3 = `
      <div class="section">
        ${header('HORMONAS', byId.hormonas.tube)}
        ${examList(['hormonas'])}
      </div>
      <div class="section">
        ${header('ORINA / PARÁSITOS')}
        ${examList(['orina', 'parasitologia'])}
      </div>
      <div class="section">
        ${header('VIROLOGÍA / OTROS')}
        ${examList(['virologia', 'otros-panel'])}
      </div>`;

    const procedencia = [
      ['Infantil', 'Policlínico'],
      ['Adulto', 'Hospitalización'],
      ['Maternal', 'Urgencia'],
    ].map(pair => `<span class="proc-pair">${pair.map(option =>
      `<span class="proc-item">${escapeHtml(option)} ${box(state.procedencia === option)}</span>`
    ).join('')}</span>`).join('');
    const fonasa = FONASA_LEVELS
      .map(level => `<span class="prev-item">${escapeHtml(level)} ${box(state.fonasaLevel === level)}</span>`)
      .join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Solicitud de Exámenes de Laboratorio</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 3mm 4mm; color: #111; font: 11px/1.3 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .head { display: flex; align-items: center; gap: 12px; padding-bottom: 6px; }
  .head img { width: 50px; height: 46px; object-fit: contain; }
  .head .brand { font-weight: 700; font-size: 12.5px; line-height: 1.15; white-space: nowrap; }
  .head .brand small { display: block; font-weight: 600; font-size: 8.5px; letter-spacing: .02em; }
  .head h1 { flex: 1; margin: 0; text-align: center; font-size: 18px; }
  .head .network { font-size: 8.5px; font-weight: 700; text-align: right; white-space: nowrap; }
  .box { display: inline-flex; align-items: center; justify-content: center; vertical-align: -1px; width: 11px; height: 11px; border: 1.2px solid #111; border-radius: 1px; color: #111; font-size: 13px; font-weight: 900; line-height: 1; }
  .box.on { background: #fff; border-color: #111; }
  .meta { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 5px 0; border-top: 2px solid #111; border-bottom: 1.5px solid #111; }
  .meta b { font-size: 9.5px; }
  .proc { display: flex; align-items: center; gap: 10px; }
  .proc-pair { display: inline-flex; flex-direction: column; gap: 2px; }
  .proc-item { display: inline-flex; align-items: center; gap: 4px; font-size: 9.8px; }
  .prev { font-size: 9.8px; text-align: right; }
  .prev-item { margin-left: 4px; }
  .patient { border-bottom: 1.5px solid #111; padding: 4px 0 7px; }
  .patient .row { display: flex; gap: 16px; margin-top: 5px; }
  .patient .field { flex: 1; display: flex; gap: 5px; align-items: baseline; }
  .patient .field b { font-size: 9px; white-space: nowrap; }
  .patient .field span { flex: 1; border-bottom: 1px solid #111; padding: 0 3px 1px; font-size: 12.2px; font-weight: 700; text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; padding-top: 7px; align-items: start; }
  .section { border: 2px solid #111; border-radius: 2px; margin-bottom: 7px; background: #fff; }
  .section-title { border-bottom: 1.5px solid #111; padding: 4px 5px 3px; text-align: center; font-weight: 800; font-size: 10.3px; letter-spacing: .02em; }
  .section-title small { display: block; font-weight: 600; font-size: 7px; }
  .subsection-title { margin: 6px 8px 3px; color: #0f766e; font-weight: 700; font-size: 8.5px; letter-spacing: .04em; text-decoration: underline; }
  .exam { display: flex; align-items: flex-start; gap: 6px; padding: 3px 7px; font-size: 10.2px; }
  .exam .box { flex: 0 0 auto; margin-top: 1px; }
  .two-cols { display: grid; grid-template-columns: 1fr 1fr; }
  .bottom { display: grid; grid-template-columns: 1fr 2fr; gap: 0; border: 2px solid #111; border-radius: 2px; margin-top: 2px; }
  .bottom .left { border-right: 1.5px solid #111; }
  .bottom .left .section-title { border-bottom: 1.5px solid #111; }
  .bottom .right { display: grid; align-content: space-evenly; gap: 9px; padding: 12px 14px; }
  .bottom .line { display: flex; gap: 6px; align-items: baseline; font-size: 10px; }
  .bottom .line b { white-space: nowrap; font-size: 9.5px; }
  .bottom .line span { flex: 1; border-bottom: 1px solid #111; min-height: 12px; padding: 0 3px; font-weight: 700; text-transform: uppercase; }
  @page { size: letter portrait; margin: 4mm; }
</style></head><body>
  <div class="head">
    ${state.logoUrl ? `<img src="${escapeHtml(state.logoUrl)}" alt="">` : ''}
    <div class="brand">HOSPITAL HANGA ROA<small>UNIDAD DE LABORATORIO</small></div>
    <h1>Solicitud de Exámenes de Laboratorio</h1>
    <div class="network">RED SALUD ORIENTE</div>
  </div>
  <div class="meta">
    <span class="proc"><b>PROCEDENCIA:</b>${procedencia}</span>
    <span class="prev"><b>PREVISION:</b> FONASA: ${fonasa}<br>ISAPRE ________ &nbsp; PRAIS ${box(Boolean(state.prais))}</span>
  </div>
  <div class="patient">
    <div class="row"><div class="field"><b>NOMBRES Y APELLIDOS:</b><span>${escapeHtml(state.patient.name || '')}</span></div><div class="field" style="max-width:140px"><b>FICHA:</b><span>${escapeHtml(state.ficha || '')}</span></div></div>
    <div class="row"><div class="field"><b>RUT:</b><span>${escapeHtml(state.patient.run || '')}</span></div><div class="field"><b>FECHA DE NACIMIENTO:</b><span>${escapeHtml(state.patient.birthDate || '')}</span></div><div class="field"><b>FECHA:</b><span>${escapeHtml(todayCL())}</span></div></div>
    <div class="row"><div class="field"><b>DIAGNOSTICO:</b><span>${escapeHtml(state.diagnosis || '')}</span></div></div>
  </div>
  <div class="grid">
    <div class="column">${col1}</div>
    <div class="column">${col2}</div>
    <div class="column">${col3}</div>
  </div>
  <div class="bottom">
    <div class="left">
      ${header('INMUNOLOGIA/SEROLOGÍA', byId.inmunologia.tube)}
      ${examList(['inmunologia'])}
    </div>
    <div class="right">
      <div class="line"><b>OTROS:</b><span>${escapeHtml(state.otros || '')}</span></div>
      <div class="line"><b>MEDICO TRATANTE:</b><span>${escapeHtml(state.medico || '')}</span></div>
      <div class="line"><b>FIRMA:</b><span></span></div>
    </div>
  </div>
</body></html>`;
  };

  globalThis.HhrRequestForms = {
    splitPatientName,
    calculateAge,
    formatDateCL,
    todayCL,
    buildPatientView,
    IMAGING_DOCUMENTS,
    EXAM_CATEGORIES,
    PROCEDENCIA_OPTIONS,
    FONASA_LEVELS,
    LAB_FORM_COLUMNS,
    buildLabRequestPrintHtml,
  };
})();
