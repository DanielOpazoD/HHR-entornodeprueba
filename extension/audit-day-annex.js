/**
 * audit-day-annex.js (extension — importScripts in the SW, require() in tests)
 *
 * Eloísa's official history report cannot be generated for a day mainland Chile skipped midnight
 * (see audit-history-segments.js). Ficha Médico's clinical history JSON still holds that day's
 * records, so this builds an annex that reproduces them, labelled as made by HHR and not official.
 *
 * Values are copied as Eloísa gives them; nothing is summarised. The JSON writes times without an
 * offset, and each field keeps its own clock. Measured 2026-11-02 against the official history,
 * which prints Rapa Nui time (52 stay-days, chance 2.7 %):
 * - mainland, converted: scale labels (100 % at -2 h), evolutions (66 %), medication
 *   administrations (56 %), diagnoses and general orders, shift changes (31 % of 13);
 * - already Rapa Nui, unchanged: vital signs (66 % at 0 h of 2001), and the actual administration
 *   time, which the official pharmacological report prints unchanged (281 of 281);
 * - UTC: medication orders, as the prescription center reads them (compared with an official time).
 * Every time is shown in Rapa Nui (TIME-02). Records are chosen by the date Ficha Médico wrote,
 * which is what the report server uses to cut its segments.
 */
(function (root) {
  'use strict';

  const MAINLAND = 'America/Santiago';
  const RAPA_NUI = 'Pacific/Easter';
  /** Mainland wall clock without offset, as the history JSON writes it. */
  const NAIVE_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
  /** "dd-mm-yyyy - HH:MM - author - role", used by scales and physical exams. */
  const PUBLISHED_LABEL = /^(\d{2})-(\d{2})-(\d{4})\s+-\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+-\s+(.+?)(?:\s+-\s+(.+))?$/;

  const text = value => (value == null ? '' : String(value).replace(/\r\n?/g, '\n').trim());
  const list = value => (Array.isArray(value) ? value : []);
  const flag = value => value === true || value === 1 || /^(?:true|1)$/i.test(text(value));
  const pad = value => String(value).padStart(2, '0');

  const formatters = new Map();
  const zoneParts = (zone, instant) => {
    if (!formatters.has(zone)) {
      formatters.set(zone, new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    }
    const parts = {};
    formatters.get(zone).formatToParts(instant).forEach(part => { parts[part.type] = Number(part.value); });
    return parts;
  };
  const zoneOffsetMs = (zone, instant) => {
    const p = zoneParts(zone, instant);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
  };
  const zonedInstant = (zone, y, m, d, h, mi, s) => {
    const wall = Date.UTC(y, m - 1, d, h, mi, s);
    if (zone === 'UTC') return wall;
    const first = wall - zoneOffsetMs(zone, wall);
    return wall - zoneOffsetMs(zone, first);
  };
  const mainlandInstant = (y, m, d, h, mi, s) => zonedInstant(MAINLAND, y, m, d, h, mi, s);

  /** { instant, recordDay } for a JSON time written in `zone`, or null when it cannot be read. */
  const readTime = (value, zone = MAINLAND) => {
    const raw = text(value);
    const naive = NAIVE_WALL_CLOCK.exec(raw);
    if (naive) {
      const [, y, m, d, h, mi, s] = naive.map(Number);
      return { instant: zonedInstant(zone, y, m, d, h, mi, s || 0), recordDay: `${naive[1]}-${naive[2]}-${naive[3]}` };
    }
    const instant = Date.parse(raw);
    if (!raw || !Number.isFinite(instant)) return null;
    const p = zoneParts(MAINLAND, instant);
    return { instant, recordDay: `${p.year}-${pad(p.month)}-${pad(p.day)}` };
  };
  const readLabel = value => {
    const match = PUBLISHED_LABEL.exec(text(value));
    if (!match) return null;
    const [, d, m, y, h, mi, s] = match.map(Number);
    return {
      time: { instant: mainlandInstant(y, m, d, h, mi, s || 0), recordDay: `${match[3]}-${match[2]}-${match[1]}` },
      author: text(match[7]),
      role: text(match[8]),
    };
  };
  const rapaNuiClock = instant => {
    const p = zoneParts(RAPA_NUI, instant);
    return `${pad(p.day)}-${pad(p.month)}-${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
  };
  const rapaNuiTime = value => {
    const time = readTime(value);
    return time ? rapaNuiClock(time.instant) : '';
  };

  const authorOf = item => {
    const parts = ['HCP_FGN', 'HCP_NGN', 'HCP_FFN', 'HCP_SFN'].map(key => text(item[key])).filter(Boolean).join(' ');
    return parts || text(item.HCP_LEGAL) || text(item.HCP_NAME) || text(item.HCPNAME_START);
  };
  const roleOf = item => text(item.HCPR_NAME || item.HCP_ROLE || item.HCPR_ROLE || item.PRACTITIONER_ROLE || item.HCPR_START_NAME);
  const field = (label, value) => (text(value) ? `${label}: ${text(value)}` : '');
  const flagsOf = item => [
    flag(item.ARCHIVED) ? 'Archivado' : '',
    flag(item.IS_CROSSED_OUT) ? 'Tachado' : '',
    flag(item.OBE_AMENDED) ? 'Enmendado' : '',
    flag(item.SUSPENDED) ? 'Suspendido' : '',
  ].filter(Boolean);
  const labelValue = item => (text(item.LABEL) ? `${text(item.LABEL)}: ${text(item.VALUE)}` : text(item.VALUE));

  const TECHNICAL_FIELD = /(?:^ID$|_ID$|Id$|^id$|GUID|^ENC|^PAT_|ARCHIVED|^HCP|^HCPR|PREFERRED_IDENTIFIER|FACILITY|ORGANIZATION|timestamp|ORDER$|^IS_|^ALLOW_)/;
  const genericLines = item => Object.entries(item)
    .filter(([key, value]) => !TECHNICAL_FIELD.test(key) && value != null && typeof value !== 'object' && text(value))
    .map(([key, value]) => `${key}: ${typeof value === 'boolean' ? (value ? 'Sí' : 'No') : text(value)}`);

  const administration = item => {
    if (flag(item.PACT_PERFORMED)) return 'Administrado';
    if (flag(item.PACT_COULD_NOT_BE_PERFORMED)) return 'No administrado';
    return '';
  };

  /** Each list: its title, its own time field and the lines that reproduce one record. */
  const SECTIONS = [
    { list: 'evolutionResume', title: 'Evoluciones', time: 'OBE_PUBLISH_DATETIME',
      lines: item => [text(item.OBE_NOTES), field('Notas de protocolo', item.OBE_PROTOCOLE_NOTES)] },
    { list: 'shiftChangeResume', title: 'Entregas de turno', time: 'PUBLISH_DATETIME', lines: item => [text(item.OBSERVATION)] },
    { list: 'alertResume', title: 'Alertas', time: 'PUBLISH_DATETIME', lines: item => [text(item.OBSERVATION)] },
    { list: 'diagnosisResume', title: 'Diagnósticos', time: 'PUBLISH_DATETIME', lines: item => [
      [text(item.DIAGNOSIS), text(item.STANDAR_CODE) ? `(${text(item.STANDAR_CODE)})` : ''].filter(Boolean).join(' '),
      field('Texto libre', item.FREE_TEXT_DIAGNOSIS), field('Estado', item.STATUS),
      flag(item.IS_PRINCIPAL) ? 'Diagnóstico principal' : '', flag(item.IS_GES) ? 'GES' : '',
    ] },
    { list: 'patientPharmaIndicationResume', title: 'Indicaciones de medicamentos', time: 'PUBLISH_DATETIME', zone: 'UTC', lines: item => [
      text(item.VIRTUAL_MEDICAL_PRODUCT) || text(item.DESCRIPTOR), field('Posología', item.POSOLOGY),
      field('Vía', item.ROUTE_ADMINISTRATION), field('Nota de administración', item.MRE_ADMINISTRATION_NOTE),
      flag(item.IS_DISCHARGE) ? 'Indicación de alta' : '',
    ] },
    { list: 'patientFreeIndicationResume', title: 'Indicaciones generales', time: 'PUBLISH_DATETIME', lines: item => [text(item.INDICATION)] },
    { list: 'patientProcedureIndicationResume', title: 'Indicaciones de procedimientos', time: 'PUBLISH_DATETIME', lines: item => [
      text(item.PROCEDURE_NAME), field('Sesiones', item.SESSIONS_QUANTITY), field('Fundamentos', item.FUNDAMENTS),
      field('Derivado a', item.REFERRAL_HCPR),
    ] },
    { list: 'patientProcedureOrderResume', title: 'Solicitudes de procedimientos', time: 'PUBLISH_DATETIME', lines: item => [
      field('Motivo', item.PROCEDURE_ORDER_ENTRY_REASON), field('Instrucciones', item.INSTRUCTIONS),
      field('Fecha estimada', rapaNuiTime(item.ESTIMATED_DATE)),
    ] },
    { list: 'nutritionOrderResume', title: 'Régimen', time: 'PUBLISH_DATETIME', lines: item => [text(item.DIET_type), field('Observación', item.OBSERVATION)] },
    { list: 'restResume', title: 'Reposo', time: 'PUBLISH_DATETIME', lines: item => [text(item.rest_type), field('Observación', item.OBSERVATION)] },
    { list: 'pharmaPerformedActivityResume', title: 'Administración de medicamentos', time: 'PUBLISH_DATETIME', lines: item => [
      text(item.PERF_ACTIVITY_NAME), field('Posología', item.POSOLOGY), field('Dosis', item.DOSE), administration(item),
      field('Motivo', item.NOT_PERFORMED_MOTIVE),
      flag(item.PACT_PERFORMED_OUTSIDE_PLANNING) ? field('Fuera de lo planificado', item.OUTSIDE_PLANNING_OBSERVATION || 'Sí') : '',
      // Measured 2026-11-02: the official pharmacological report prints this value unchanged.
      field('Hora de administración (como en el reporte farmacológico oficial)', text(item.ACTUAL_PERFORMED_TIME).replace(/:\d{2}$/, '')),
      field('Notas', item.PERF_NOTES),
    ] },
    { list: 'vitalSignObsResume', title: 'Signos vitales', time: 'PUBLISH_DATE', zone: RAPA_NUI, grouped: true, lines: labelValue },
    { list: 'evaluationInstrumentsResume', title: 'Escalas y evaluaciones', label: 'PUBLISH_DATE_HCP_NAME', grouped: true,
      heading: item => text(item.FORM_NAME), lines: labelValue },
    { list: 'nurseGeneralPhysicalExamResume', title: 'Examen físico de enfermería', label: 'PUBLISH_DATE_HCP_NAME', grouped: true, lines: labelValue },
    { list: 'oeGeneralPhysicalExamResume', title: 'Examen físico', label: 'PUBLISH_DATE_HCP_NAME', grouped: true, lines: labelValue },
    { list: 'patientInvasiveDevicesResume', title: 'Dispositivos invasivos', time: 'PUBLISH_DATETIME', lines: item => [
      text(item.DEVICE_NAME), field('Ubicación', item.LOCATION), field('Medida', item.MEASURED_NUMBER),
      field('Instalación', rapaNuiTime(item.INSTALLATION_DATETIME)), field('Origen', item.ORIGIN), field('Notas', item.NOTES),
    ] },
    { list: 'examsRequestResume', title: 'Solicitudes de exámenes', time: 'PUBLISH_DATETIME', lines: item => [
      text(item.DIATGR_DIAGNOSIS_TEST_GROUP), field('Diagnóstico', item.DIAG_NAME || item.DIAGNOSIS),
      field('Observación', item.OBSERVATION), field('Fecha del examen', rapaNuiTime(item.DATETIME_TEST)),
    ] },
    { list: 'isolationResume', title: 'Aislamiento', time: 'PUBLISH_DATETIME', lines: item => [
      text(item.ISOTYPENAME), field('Microorganismo', item.MICRONAME), field('Inicio', rapaNuiTime(item.START_ISOLATION_DATETIME)),
      field('Término', rapaNuiTime(item.END_ISOLATION_DATETIME)), field('Notas', item.NOTES),
    ] },
    { list: 'operationTheaterResume', title: 'Pabellón', time: 'PUBLISH_DATETIME', lines: item => [
      text(item.REQUEST_TYPE), field('Estado', item.STATUS), field('Diagnóstico', item.DIAGNOSIS),
      field('Intervención', item.INTERVENTION), field('Fecha estimada', rapaNuiTime(item.ESTIMATE_DATE)),
    ] },
  ];
  const KNOWN = new Set(SECTIONS.map(section => section.list));

  const recordTime = (section, item, event) => {
    if (section.label) {
      const labelled = readLabel(item[section.label]);
      if (labelled) return labelled;
    }
    const own = section.time ? readTime(item[section.time], section.zone) : null;
    return { time: own || readTime(item.PUBLISH_DATETIME || item.PUBLISH_DATE) || readTime(event.publishDatetime), author: '', role: '' };
  };

  const keyOf = (list, item) => list + ':' + JSON.stringify(item);

  /** Records of the given mainland day, grouped in sections, in time order. */
  const buildModel = ({ events, day }) => {
    const sections = new Map();
    const seen = new Set();
    const add = (section, item, event) => {
      if (!item || typeof item !== 'object' || seen.has(keyOf(section.list, item))) return;
      const when = recordTime(section, item, event);
      if (!when.time || when.time.recordDay !== day) return;
      seen.add(keyOf(section.list, item));
      const author = when.author || authorOf(item);
      const role = when.role || roleOf(item);
      const entries = sections.get(section.title) || [];
      const groupKey = section.grouped ? `${when.time.instant}|${author}|${section.heading ? section.heading(item) : ''}` : null;
      const existing = groupKey && entries.find(entry => entry.groupKey === groupKey);
      const lines = [].concat(section.lines(item)).filter(Boolean);
      if (existing) {
        existing.lines.push(...lines);
        return;
      }
      entries.push({
        groupKey, instant: when.time.instant, time: rapaNuiClock(when.time.instant), author, role,
        heading: section.heading ? section.heading(item) : '', lines, flags: flagsOf(item),
      });
      sections.set(section.title, entries);
    };
    list(events).forEach(event => {
      if (!event || typeof event !== 'object') return;
      SECTIONS.forEach(section => list(event[section.list])
        .slice()
        .sort((left, right) => Number(left && left.ORDER || 0) - Number(right && right.ORDER || 0))
        .forEach(item => add(section, item, event)));
      Object.entries(event)
        .filter(([key, value]) => !KNOWN.has(key) && Array.isArray(value) && value.length)
        .forEach(([key, value]) => value.forEach(item => add({
          list: key, title: `Otros registros (${key})`, lines: genericLines,
        }, item, event)));
    });
    const ordered = [...SECTIONS.map(section => section.title), ...[...sections.keys()].filter(title => title.startsWith('Otros'))];
    return {
      day,
      sections: [...new Set(ordered)].filter(title => sections.has(title)).map(title => ({
        title,
        entries: sections.get(title).sort((left, right) => left.instant - right.instant),
      })),
    };
  };

  // Helvetica in jsPDF covers Latin-1, which holds Spanish; other characters are replaced.
  const latin1 = value => text(value)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/•/g, '-').replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?');

  const render = ({ JsPDF, model, patient, generatedAt }) => {
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const width = 180;
    const left = 15;
    let y = 18;
    const ensure = height => {
      if (y + height <= 280) return;
      doc.addPage();
      y = 18;
    };
    const write = (value, { size = 9, bold = false, indent = 0, gap = 1.2 } = {}) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(latin1(value), width - indent);
      const lineHeight = size * 0.42;
      lines.forEach(line => {
        ensure(lineHeight);
        doc.text(line, left + indent, y);
        y += lineHeight;
      });
      y += gap;
    };
    const [yy, mm, dd] = model.day.split('-');
    write(`Anexo HHR - registros de Eloísa del ${dd}-${mm}-${yy} (documento no oficial)`, { size: 13, bold: true, gap: 2 });
    write(`Paciente: ${patient.name || 'Sin nombre'} - RUT ${patient.run} - Episodio ${patient.encId}`, { size: 10 });
    write(
      `El informe oficial «Historial de hospitalización» de Eloísa no se puede generar para el ${dd}-${mm}-${yy}: ` +
      'su servidor falla en el día en que Chile continental adelantó la hora. Este anexo reproduce, sin resumir, los ' +
      `registros que Ficha Médico fechó el ${dd}-${mm}-${yy}, tal como los entrega. Todas las horas están en hora de ` +
      'Rapa Nui: Ficha Médico guarda la mayoría en hora continental y aquí se convierten; los signos vitales y la ' +
      'hora real de administración ya vienen en hora de Rapa Nui. Va acompañado del Resumen diario oficial del mismo día.',
      { size: 9, gap: 1 }
    );
    write(`Generado por HHR el ${rapaNuiClock(generatedAt)} (hora de Rapa Nui).`, { size: 8, gap: 4 });
    if (model.sections.length === 0) write('Ficha Médico no entregó registros para este día.', { size: 10, bold: true });
    model.sections.forEach(section => {
      ensure(14);
      write(section.title, { size: 11, bold: true, gap: 1.5 });
      section.entries.forEach(entry => {
        const who = [entry.author, entry.role ? `(${entry.role})` : ''].filter(Boolean).join(' ');
        const extra = [entry.heading, ...entry.flags].filter(Boolean).join(' - ');
        write(`${entry.time}${who ? ' - ' + who : ''}${extra ? ' - ' + extra : ''}`, { size: 9, bold: true, gap: 0.6 });
        entry.lines.forEach(line => write(line, { size: 9, indent: 4, gap: 0.6 }));
        y += 1.5;
      });
      y += 2;
    });
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(latin1(`Anexo HHR (no oficial) - ${dd}-${mm}-${yy} - página ${page} de ${pages}`), left, 290);
    }
    return doc.output('arraybuffer');
  };

  const api = Object.freeze({ buildModel, render });
  root.HhrAuditDayAnnex = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
