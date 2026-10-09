import type { CudyrReportRow, CudyrReportStatus } from '@/types/domain/cudyrReport';
import type { CudyrCaptureReceipt } from '@/types/domain/cudyrCapture';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export const cudyrCaptureState = (
  receipts: CudyrCaptureReceipt[]
): {
  latest?: CudyrCaptureReceipt;
  status: CudyrReportStatus;
  warnings: string[];
} => {
  if (!receipts.length) return { status: 'sin_captura', warnings: [] };
  const dated = receipts.map(receipt => ({ receipt, at: Date.parse(receipt.capture.observedAt) }));
  if (dated.some(item => !Number.isFinite(item.at)))
    return { status: 'fuente_no_disponible', warnings: ['Captura con hora no verificable.'] };
  const latestAt = Math.max(...dated.map(item => item.at));
  const candidates = dated.filter(item => item.at === latestAt).map(item => item.receipt);
  const states = [
    ...new Map(candidates.map(item => [item.censusDate + ':' + item.capture.id, item])).values(),
  ].map(latest => {
    const parts = candidates.filter(
      item => item.capture.id === latest.capture.id && item.censusDate === latest.censusDate
    );
    const expected = new Set(parts.map(item => item.capture.totalParts));
    const complete =
      expected.size === 1 &&
      new Set(parts.map(item => item.capture.part)).size === latest.capture.totalParts;
    const unavailable = parts.some(item =>
      ['unavailable', 'legacy_extension'].includes(item.capture.status)
    );
    const status: CudyrReportStatus = !complete
      ? 'captura_incompleta'
      : unavailable
        ? 'fuente_no_disponible'
        : 'sin_registro_observado';
    const representative = [...parts].sort(
      (a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id)
    )[0];
    return {
      latest: representative,
      status,
      priority: !complete ? 2 : unavailable ? 1 : 0,
      warnings: [
        ...(!complete ? ['Faltan partes del guardado de la última captura.'] : []),
        ...(parts.some(item => item.capture.metadataStatus === 'partial')
          ? ['La última captura contiene metadatos incompletos.']
          : []),
      ],
    };
  });
  states.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.latest.receivedAt.localeCompare(a.latest.receivedAt) ||
      a.latest.id.localeCompare(b.latest.id)
  );
  const selected = states[0];
  return {
    latest: selected.latest,
    status: selected.status,
    warnings: [
      ...new Set(states.flatMap(item => item.warnings)),
      ...(states.length > 1
        ? ['Hay capturas simultáneas; se conserva la cobertura menos concluyente.']
        : []),
    ],
  };
};

/** Source egreso, its later entry timestamp, epicrisis and verified physical departure are distinct facts. */
export const reconcileCudyrDischarge = (row: CudyrReportRow): CudyrReportRow => {
  const reference =
    row.referenceAt && Number.isFinite(Date.parse(row.referenceAt))
      ? calendarStampInClinicalTimeZone(new Date(row.referenceAt))
      : null;
  const actual = row.correction?.actualDischarge;
  // HHR transfers are external evacuations/egresos (receivingCenter + evacuationMethod).
  // Internal bed/service changes live in placement intervals, not this movement collection.
  const discharges = row.movements.filter(item =>
    ['discharges', 'transfers'].includes(item.section)
  );
  const dates = new Map(
    discharges.filter(item => item.date).map(item => [item.date + ':' + item.time, item])
  );
  const warnings = [...row.warnings];
  const review = (reason: string) => ({
    ...row,
    eligibility:
      row.eligibility === 'no_elegible' ? ('no_elegible' as const) : ('por_revisar' as const),
    eligibilityReason: row.eligibility === 'no_elegible' ? row.eligibilityReason : reason,
    warnings: [...warnings, reason],
  });
  if (!actual && discharges.some(item => !item.date))
    return review(
      'Egreso sin fecha efectiva; no se puede confirmar permanencia al momento de referencia.'
    );
  if (!actual && dates.size > 1)
    return review('Egresos del sistema con fechas u horas contradictorias.');
  const departure = actual || [...dates.values()][0];
  if (!departure) return row;
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(departure.date) &&
    Number.isFinite(Date.parse(departure.date + 'T12:00:00Z')) &&
    new Date(departure.date + 'T12:00:00Z').toISOString().slice(0, 10) === departure.date;
  if (!dateValid) return review('Fecha de egreso inválida.');
  const timeValid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(departure.time || '');
  const source = actual ? 'Alta real verificada' : 'Egreso del sistema';
  // A manual correction alone is still a visible exception. If a formal departure
  // independently resolves the case too, it remains hidden from the daily list.
  const resolvedSystemDeparture =
    !actual ||
    reconcileCudyrDischarge({ ...row, correction: undefined, resolvedSystemDeparture: false })
      .resolvedSystemDeparture === true;
  // The census night excludes all effective departures on/before its calendar day,
  // even if an evaluation was recorded earlier that day. Later days stay independent.
  if (departure.date <= row.date)
    return {
      ...row,
      eligibility: 'no_elegible',
      eligibilityReason: source + ': salida en el día censal o antes.',
      resolvedSystemDeparture,
      warnings,
    };
  if (!reference) return row;
  if (departure.date === reference.iso && !timeValid)
    return review(source + ': falta hora para resolver el día.');
  if (
    departure.date < reference.iso ||
    (departure.date === reference.iso && departure.time! <= reference.hhmm)
  )
    return {
      ...row,
      eligibility: 'no_elegible',
      eligibilityReason: source + ' anterior o igual al momento de referencia.',
      resolvedSystemDeparture,
      warnings,
    };
  return row;
};
