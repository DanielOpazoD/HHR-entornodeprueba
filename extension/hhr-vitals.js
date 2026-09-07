/**
 * hhr-vitals.js (ISOLATED world + service worker)
 *
 * Port of HHR's vital-signs pipeline (src/features/rayen-import/mapping/parseVitalSigns.ts and
 * src/features/census/controllers/vitalSignsView.ts). Parses Ficha Médico `VITAL_SIGNS` forms
 * (the encounter-form-entry payload already served by RAYEN_SCALES_REPORT_REQUEST) into
 * measurement records, and grades each reading against the screening thresholds HHR uses.
 */
(() => {
  'use strict';
  if (globalThis.HhrVitals) return;

  const RAPA_NUI_TZ = 'Pacific/Easter';
  const str = value => (value == null ? '' : String(value)).trim();
  const pad2 = value => String(value).padStart(2, '0');

  const num = raw => {
    const value = String(raw || '').trim();
    if (value === '') return null;
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const rapaNuiDayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: RAPA_NUI_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const rapaNuiDay = epoch => rapaNuiDayFormatter.format(new Date(epoch));

  const rapaNuiClockFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: RAPA_NUI_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const rapaNuiClock = epoch => {
    const parts = {};
    for (const part of rapaNuiClockFormatter.formatToParts(new Date(epoch))) parts[part.type] = part.value;
    return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`;
  };

  // Rayen's "DD-MM-YYYY H:mm:ss [±HH:MM]" — offset present → resolvable to an instant.
  const parseRayenDateTime = raw => {
    const m = String(raw || '').match(
      /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T]+(\d{1,2}):(\d{2}):(\d{2})\s*([+-]\d{2}):?(\d{2})?)?/
    );
    if (!m) return null;
    const [, dd, mm, yyyy, hh, mi, ss, offH, offM] = m;
    const printedIso = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
    if (offH == null) return { printedIso, epoch: null };
    const epoch = Date.parse(`${printedIso}T${pad2(hh)}:${mi}:${ss}${offH}:${offM || '00'}`);
    return { printedIso, epoch: Number.isNaN(epoch) ? null : epoch };
  };

  const effectiveWhen = (form, campos) => {
    const candidates = [
      ...campos.map(c => str(c.createDatetime)),
      str(form.createDateTime),
      str(form.startDateTime),
    ].filter(Boolean);
    let bestInstant = null;
    let bestPrinted = null;
    for (const raw of candidates) {
      const parsed = parseRayenDateTime(raw);
      if (!parsed) continue;
      if (parsed.epoch != null) {
        if (!bestInstant || parsed.epoch > bestInstant.epoch) {
          bestInstant = { iso: rapaNuiDay(parsed.epoch), raw, epoch: parsed.epoch };
        }
      } else if (!bestPrinted && !bestInstant) {
        bestPrinted = { iso: parsed.printedIso, raw };
      }
    }
    const best = bestInstant || bestPrinted;
    return best
      ? { iso: best.iso, raw: best.raw, epoch: bestInstant ? bestInstant.epoch : null }
      : { iso: '', raw: str(form.startDateTime), epoch: null };
  };

  // Naive clinical stamps are UTC. Reject instants after their offset-aware record metadata.
  const measurementEpoch = (raw, recordedEpoch) => {
    const m = String(raw || '')
      .trim()
      .match(/^(\d{1,2})-(\d{1,2})-(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?/);
    if (!m) return null;
    const [, dd, mm, yyyy, hh, mi, ss, off] = m;
    const offset = !off || off === 'Z' ? '+00:00' : off.includes(':') ? off : `${off.slice(0, 3)}:${off.slice(3)}`;
    const epoch = Date.parse(`${yyyy}-${pad2(mm)}-${pad2(dd)}T${pad2(hh)}:${mi}:${ss || '00'}${offset}`);
    return Number.isNaN(epoch) || (recordedEpoch != null && epoch > recordedEpoch) ? null : epoch;
  };

  const FIELD_IDS = {
    systolic: ['global_PASSent'],
    diastolic: ['global_PADSent'],
    heartRate: ['global_Pulso'],
    spo2: ['exa_Fisic_G_SaturacionO2'],
    temperature: ['global_TempAxilar', 'Global_TempBucal', 'global_TempOido', 'global_TempRectal'],
    respiratoryRate: ['exa_Fisic_Frecuencia_Respiratoria'],
    painEva: ['global_EscalaDolorEVA'],
    hgt: ['global_Rexa_Hemoglucotest'],
    insulinUnits: ['exam_Fis_Adm_InsulinaUIC', 'exam_Fis_Adm_InsulinaSent'],
  };
  const OBS_IDS = ['global_Observaciones'];
  const INSULIN_QUADRANT_IDS = ['exam_Fis_Adm_InsulinaSentCUAD'];
  const TIME_IDS = ['SIGNS_FechaHora', 'global_FechaHoraSapu'];

  /** Parse every `VITAL_SIGNS` form into a vitals record, most-recent-first. */
  const parseVitalSigns = raw => {
    const forms = Array.isArray(raw) ? raw : [];
    const parsed = [];
    for (const form of forms) {
      if (!form) continue;
      if (str(form.formCodigo).toUpperCase() !== 'VITAL_SIGNS') continue;
      if (form.archived === true) continue;
      const campos = Array.isArray(form.metaCampList) ? form.metaCampList : [];
      const byId = new Map();
      for (const campo of campos) {
        const id = str(campo.id).toLowerCase();
        if (id && !byId.has(id)) byId.set(id, str(campo.value));
      }
      const get = ids => {
        for (const id of ids) {
          const value = byId.get(id.toLowerCase());
          if (value != null && value !== '') return value;
        }
        return '';
      };
      const when = effectiveWhen(form, campos);
      if (!when.iso) continue;
      const clinicalStamp = get(TIME_IDS);
      const epoch = measurementEpoch(clinicalStamp, when.epoch) ?? when.epoch;
      const record = {
        recordedDate: epoch != null ? rapaNuiDay(epoch) : when.iso,
        recordedAt: epoch != null ? rapaNuiClock(epoch) : clinicalStamp || when.raw,
        systolic: num(get(FIELD_IDS.systolic)),
        diastolic: num(get(FIELD_IDS.diastolic)),
        heartRate: num(get(FIELD_IDS.heartRate)),
        spo2: num(get(FIELD_IDS.spo2)),
        temperature: num(get(FIELD_IDS.temperature)),
        respiratoryRate: num(get(FIELD_IDS.respiratoryRate)),
        painEva: num(get(FIELD_IDS.painEva)),
        hgt: num(get(FIELD_IDS.hgt)),
        insulinUnits: num(get(FIELD_IDS.insulinUnits)),
        insulinQuadrant: get(INSULIN_QUADRANT_IDS) || null,
        observations: get(OBS_IDS) || null,
        author: str(form.authorHealthCarePractitionerName),
        authorRole: str(form.authorHealthCarePractitionerRoleName),
      };
      const hasReading =
        record.systolic != null || record.diastolic != null || record.heartRate != null ||
        record.spo2 != null || record.temperature != null || record.respiratoryRate != null ||
        record.painEva != null || record.hgt != null || record.insulinUnits != null ||
        !!record.insulinQuadrant;
      if (!hasReading) continue;
      parsed.push({ key: Number(form.encounterEventId) || 0, epoch, record });
    }
    return parsed.sort((a, b) => (b.epoch ?? 0) - (a.epoch ?? 0) || b.key - a.key).map(entry => entry.record);
  };

  // --- Screening thresholds (adult), identical to HHR's vitalSignsView.ts ---
  const band = (value, alertLow, warnLow, warnHigh, alertHigh) => {
    if (value <= alertLow || value >= alertHigh) return 'alert';
    if (value < warnLow || value > warnHigh) return 'warn';
    return 'normal';
  };
  const STATUS_FN = {
    systolic: v => band(v, 90, 100, 160, 181),
    heartRate: v => band(v, 40, 50, 100, 130),
    spo2: v => (v < 90 ? 'alert' : v < 94 ? 'warn' : 'normal'),
    temperature: v => band(v, 35, 35.5, 37.7, 39),
    respiratoryRate: v => band(v, 8, 12, 20, 25),
    painEva: v => (v >= 7 ? 'alert' : v >= 4 ? 'warn' : 'normal'),
    hgt: v => band(v, 54, 70, 180, 400),
  };
  /** Screening status for a reading; non-adult cohorts are explicit 'ungraded'. */
  const statusFor = (metric, value, cohort = 'adult') => {
    if (cohort !== 'adult') return 'ungraded';
    if (value == null || !STATUS_FN[metric]) return 'normal';
    return STATUS_FN[metric](value);
  };

  const ageCohort = (birthDate, referenceDate = new Date()) => {
    const parts = String(birthDate || '').slice(0, 10).split('-');
    if (parts.length !== 3) return 'unknown';
    const [year, month, day] = parts[0].length === 4 && parts[2].length === 2
      ? parts.map(Number)
      : parts[0].length === 2 && parts[2].length === 4
        ? [Number(parts[2]), Number(parts[1]), Number(parts[0])]
        : [];
    if (!year || !month || !day) return 'unknown';
    const birth = new Date(year, month - 1, day);
    if (
      Number.isNaN(referenceDate.getTime()) ||
      birth.getFullYear() !== year ||
      birth.getMonth() !== month - 1 ||
      birth.getDate() !== day
    ) return 'unknown';
    let age = referenceDate.getFullYear() - year;
    if (
      referenceDate.getMonth() < month - 1 ||
      (referenceDate.getMonth() === month - 1 && referenceDate.getDate() < day)
    ) age -= 1;
    return age >= 18 ? 'adult' : age >= 0 ? 'pediatric' : 'unknown';
  };

  /** Column/tile catalog: key, short label, unit, how to read the value from a record. */
  const VITAL_METRICS = [
    { key: 'pa', label: 'PA', unit: 'mmHg', text: r => (r.systolic != null ? r.systolic + (r.diastolic != null ? '/' + r.diastolic : '') : ''), status: (r, cohort) => statusFor('systolic', r.systolic, cohort), series: r => r.systolic },
    { key: 'heartRate', label: 'FC', unit: 'lpm', text: r => (r.heartRate != null ? String(r.heartRate) : ''), status: (r, cohort) => statusFor('heartRate', r.heartRate, cohort), series: r => r.heartRate },
    { key: 'spo2', label: 'SatO₂', unit: '%', text: r => (r.spo2 != null ? String(r.spo2) : ''), status: (r, cohort) => statusFor('spo2', r.spo2, cohort), series: r => r.spo2 },
    { key: 'temperature', label: 'T°', unit: '°C', text: r => (r.temperature != null ? String(r.temperature) : ''), status: (r, cohort) => statusFor('temperature', r.temperature, cohort), series: r => r.temperature },
    { key: 'respiratoryRate', label: 'FR', unit: 'rpm', text: r => (r.respiratoryRate != null ? String(r.respiratoryRate) : ''), status: (r, cohort) => statusFor('respiratoryRate', r.respiratoryRate, cohort), series: r => r.respiratoryRate },
    { key: 'painEva', label: 'EVA', unit: '', text: r => (r.painEva != null ? String(r.painEva) : ''), status: (r, cohort) => statusFor('painEva', r.painEva, cohort), series: r => r.painEva },
    { key: 'hgt', label: 'HGT', unit: 'mg/dL', text: r => (r.hgt != null ? String(r.hgt) : ''), status: (r, cohort) => statusFor('hgt', r.hgt, cohort), series: r => r.hgt },
    { key: 'insulin', label: 'Ins/Cuad', unit: 'UI', text: r => (r.insulinUnits != null ? r.insulinUnits + (r.insulinQuadrant ? ' ' + r.insulinQuadrant : '') : (r.insulinQuadrant || '')), status: () => 'normal', series: () => null },
  ];

  globalThis.HhrVitals = { parseVitalSigns, statusFor, ageCohort, VITAL_METRICS };
})();
