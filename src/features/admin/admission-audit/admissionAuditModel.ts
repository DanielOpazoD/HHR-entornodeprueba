import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  encounterWallClockInRapaNui,
  parseClinicalPanel,
  type ClinicalPanelEntry,
  type RayenClinicalPanelEvent,
} from '@/features/rayen-import/admission-audit';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

export interface AdmissionPeriod {
  from: string;
  to: string;
}
export interface AdmissionCandidate {
  key: string;
  episodeId: string;
  patientName: string;
  document: string;
  admissionDate: string;
  admissionTime: string;
}
export type IndicationScope = 'first-day' | 'first-set';
export type AdmissionIndication = Pick<
  ClinicalPanelEntry,
  'id' | 'kind' | 'title' | 'text' | 'author' | 'publishedAt'
>;
export interface AdmissionAuditEntry {
  patient: AdmissionCandidate;
  notes: ClinicalPanelEntry[];
  indications: AdmissionIndication[];
  vital: PatientVitalSigns | null;
  doctor: string;
  issues: string[];
  readError?: string;
  vitalReadError?: string;
}
export const UNATTRIBUTED_DOCTOR = 'Sin atribuir';
export const auditClock = encounterWallClockInRapaNui;
const dayOf = (value: string) => auditClock(value)?.split('T').at(0) ?? '';
const sourceClock = (value: string | undefined) =>
  value && /[T\s]\d{1,2}:\d{2}/.test(value) ? auditClock(value) : null;

/** Same elapsed-day bound as the extension's history window; reject before monthly census reads. */
export const withinAdmissionHistory = (from: string, now = Date.now()) =>
  Boolean(auditClock(from)) &&
  Math.max(14, Math.ceil((now - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 2) <= 4000;

const anonymousOrder = (n: ClinicalPanelEntry) =>
  n.kind === 'diet' || n.kind === 'rest' || /^(pharma|free)-\d+$/.test(n.id);
const anonymousPublicationKey = (n: ClinicalPanelEntry) =>
  `${n.kind}:${sourceClock(n.publishedAt)}`;

const orderKey = (n: ClinicalPanelEntry) =>
  n.kind === 'diet' || n.kind === 'rest'
    ? `${n.kind}:${n.text}`
    : `${n.kind}:${n.id}${/^(pharma|free)-\d+$/.test(n.id) ? `:${n.title}:${n.text}` : ''}`;

/** The daily-sheet parser keeps the latest daily version; audit each source row independently. */
const sourceIndications = (events: RayenClinicalPanelEvent[]) =>
  events.flatMap(event =>
    (
      [
        'patientPharmaIndicationResume',
        'patientFreeIndicationResume',
        'nutritionOrderResume',
        'restResume',
      ] as const
    ).flatMap(field =>
      event[field].flatMap(row =>
        parseClinicalPanel([
          {
            ...event,
            validationDatetime: undefined,
            evolutionResume: [],
            shiftChangeResume: [],
            patientPharmaIndicationResume: [],
            patientFreeIndicationResume: [],
            nutritionOrderResume: [],
            restResume: [],
            [field]: [row],
          },
        ])
          .indicationDays.flatMap(day => [...day.active, ...day.suspended])
          .map(order => ({ ...order, sourceObservedAt: sourceClock(event.publishDatetime) }))
      )
    )
  );

/** Resolve source-note versions before validity/chronology; never guess between tied revisions. */
const currentEvolutions = (
  events: RayenClinicalPanelEvent[],
  panels: ReturnType<typeof parseClinicalPanel>[]
) => {
  const versions = new Map<string, { note: ClinicalPanelEntry; observed: string | null }>();
  panels.forEach((panel, i) => {
    const observed = sourceClock(events[i]?.publishDatetime);
    for (const note of panel.evolutions) {
      if (note.kind !== 'evolution') continue;
      const key = /^evolution-\d+$/.test(note.id)
        ? `${note.id}:${note.author}:${note.publishedAt}:${note.text}`
        : note.id;
      const prior = versions.get(key);
      if (
        prior &&
        (note.profession === 'medical' || prior.note.profession === 'medical') &&
        JSON.stringify(prior.note) !== JSON.stringify(note) &&
        (!observed || !prior.observed || observed === prior.observed)
      )
        throw new Error('Hay versiones de una evolución sin orden de revisión verificable.');
      if (!prior || (observed && prior.observed && observed > prior.observed))
        versions.set(key, { note, observed });
    }
  });
  return [...versions.values()].map(v => v.note);
};

/** Latest available census snapshot per person/episode; a transfer is never a new admission. */
export const collectAdmissionCandidates = (
  records: DailyRecord[],
  period: AdmissionPeriod
): AdmissionCandidate[] => {
  const found = new Map<string, AdmissionCandidate>();
  for (const record of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
    const add = (p: {
      patientName: string;
      rut: string;
      clinicalEpisodeId?: string;
      admissionDate?: string;
      admissionTime?: string;
      documentType?: string;
    }) => {
      const episodeId = p.clinicalEpisodeId?.trim();
      if (!episodeId || !p.patientName.trim()) return;
      const admissionDate = p.admissionDate ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(admissionDate) || !auditClock(admissionDate)) return;
      const document = p.rut.trim();
      const identity =
        p.documentType === 'Pasaporte'
          ? `passport:${document.toLocaleUpperCase('es')}`
          : isValidRut(document)
            ? normalizeRut(document)
            : document;
      const key = `${identity}:${episodeId}`;
      found.set(key, {
        key,
        episodeId,
        patientName: p.patientName.trim(),
        document: p.rut.trim(),
        admissionDate,
        admissionTime:
          p.admissionTime?.trim() ||
          (found.get(key)?.admissionDate === admissionDate ? found.get(key)?.admissionTime : '') ||
          '',
      });
    };
    for (const p of Object.values(record.beds)) {
      add(p);
      if (p.clinicalCrib) add(p.clinicalCrib);
    }
    for (const m of [...record.discharges, ...record.transfers]) {
      if (m.deletedAt) continue;
      add({
        ...m.originalData,
        patientName: m.patientName,
        rut: m.rut,
        clinicalEpisodeId: m.clinicalEpisodeId || m.originalData?.clinicalEpisodeId,
        admissionDate: m.admissionDate || m.originalData?.admissionDate,
      });
    }
  }
  return [...found.values()]
    .filter(p => p.admissionDate >= period.from && p.admissionDate <= period.to)
    .sort(
      (a, b) =>
        a.admissionDate.localeCompare(b.admissionDate) ||
        a.patientName.localeCompare(b.patientName, 'es')
    );
};

/** Source entries only: no current-state medication projection or synthesized validation days. */
export const buildAdmissionAuditEntry = (
  patient: AdmissionCandidate,
  events: RayenClinicalPanelEvent[],
  vitals: PatientVitalSigns[] | null,
  scope: IndicationScope
): AdmissionAuditEntry => {
  const lower = auditClock(`${patient.admissionDate}T${patient.admissionTime || '00:00'}`);
  if (!lower) throw new Error('La fecha u hora de ingreso no es válida.');
  const parsed = events.map(event =>
    parseClinicalPanel([{ ...event, validationDatetime: undefined }])
  );
  const medical = currentEvolutions(events, parsed).filter(
    n => n.kind === 'evolution' && n.profession === 'medical' && !n.archived && !n.crossedOut
  );
  if (medical.some(n => !sourceClock(n.publishedAt)))
    throw new Error(
      'Hay evoluciones médicas sin fecha verificable; no se puede determinar la primera.'
    );
  const ordered = medical
    .filter(n => (sourceClock(n.publishedAt) ?? '') >= lower)
    .sort((a, b) =>
      (sourceClock(a.publishedAt) ?? '').localeCompare(sourceClock(b.publishedAt) ?? '')
    );
  const firstAt = ordered[0] ? sourceClock(ordered[0].publishedAt) : null;
  const notes = [
    ...new Map(
      ordered
        .filter(n => sourceClock(n.publishedAt) === firstAt)
        .map(n => [`${n.id}:${n.author}:${n.publishedAt}:${n.text}`, n])
    ).values(),
  ];
  const authors = [...new Set(notes.map(n => n.author.trim()).filter(Boolean))];
  const doctor =
    authors.length === 1 && notes.every(n => n.author.trim())
      ? (authors[0] ?? UNATTRIBUTED_DOCTOR)
      : UNATTRIBUTED_DOCTOR;
  const sourceOrders = sourceIndications(events);
  const undatedOrders = sourceOrders.some(n => !sourceClock(n.publishedAt));
  // A content change must not create a new identity for an identifier-less source record.
  const anonymousPublications = new Map<string, string>();
  const anonymousConflicts = new Set<string>();
  for (const order of sourceOrders.filter(anonymousOrder)) {
    const key = anonymousPublicationKey(order);
    const content = JSON.stringify([order.title, order.text, order.author]);
    const prior = anonymousPublications.get(key);
    if (prior !== undefined && prior !== content) anonymousConflicts.add(key);
    else anonymousPublications.set(key, content);
  }
  const ambiguousKinds = new Set(
    sourceOrders
      .filter(n => anonymousOrder(n) && (sourceClock(n.publishedAt) ?? '') < lower)
      .map(n => n.kind)
  );
  // Deduplicate before the admission fence: a later revision cannot become a new admission order.
  const firstVersions = new Map<string, (typeof sourceOrders)[number]>();
  const conflictingKeys = new Set<string>();
  for (const order of [...sourceOrders].sort(
    (a, b) =>
      (sourceClock(a.publishedAt) ?? '').localeCompare(sourceClock(b.publishedAt) ?? '') ||
      (a.sourceObservedAt ?? '').localeCompare(b.sourceObservedAt ?? '')
  )) {
    const key = orderKey(order);
    const prior = firstVersions.get(key);
    if (!prior) firstVersions.set(key, order);
    else if (
      sourceClock(prior.publishedAt) === sourceClock(order.publishedAt) &&
      (!prior.sourceObservedAt ||
        !order.sourceObservedAt ||
        prior.sourceObservedAt === order.sourceObservedAt) &&
      (prior.text !== order.text || prior.title !== order.title || prior.author !== order.author)
    )
      conflictingKeys.add(key);
  }
  const orders = (undatedOrders ? [] : [...firstVersions.values()])
    .filter(
      n =>
        n.validitySource !== 'daily-validation' &&
        !(anonymousOrder(n) && ambiguousKinds.has(n.kind)) &&
        sourceClock(n.publishedAt) &&
        (sourceClock(n.publishedAt) ?? '') >= lower
    )
    .sort((a, b) =>
      (sourceClock(a.publishedAt) ?? '').localeCompare(sourceClock(b.publishedAt) ?? '')
    );
  const firstOrder = orders[0];
  const initial = firstOrder
    ? orders.filter(n =>
        scope === 'first-day'
          ? dayOf(n.publishedAt) === dayOf(firstOrder.publishedAt)
          : sourceClock(n.publishedAt) === auditClock(firstOrder.publishedAt)
      )
    : [];
  const ambiguousInitial = initial.some(
    n =>
      conflictingKeys.has(orderKey(n)) ||
      (anonymousOrder(n) && anonymousConflicts.has(anonymousPublicationKey(n)))
  );
  const indications: AdmissionIndication[] = (ambiguousInitial ? [] : initial).map(
    ({ id, kind, title, text, author, publishedAt }) => ({
      id,
      kind,
      title,
      text,
      author,
      publishedAt,
    })
  );
  const undatedVitals = (vitals ?? []).some(v => !sourceClock(v.recordedAt));
  const firstVitals = (undatedVitals ? [] : (vitals ?? []))
    .filter(v => sourceClock(v.recordedAt) && (sourceClock(v.recordedAt) ?? '') >= lower)
    .sort((a, b) =>
      (sourceClock(a.recordedAt) ?? '').localeCompare(sourceClock(b.recordedAt) ?? '')
    );
  const issues = [];
  if (undatedVitals)
    issues.push(
      'Hay tomas de signos vitales sin fecha verificable; no se puede determinar la primera.'
    );
  if (ambiguousInitial)
    issues.push(
      'Las indicaciones iniciales tienen identidades o versiones discrepantes sin orden verificable; no se selecciona una arbitrariamente.'
    );
  if (ambiguousKinds.size)
    issues.push(
      'Hay órdenes sin identificador estable anteriores al ingreso; sus posibles revisiones no se clasifican como indicaciones iniciales.'
    );
  if (undatedOrders)
    issues.push(
      'Hay indicaciones sin fecha verificable; no se puede determinar cuáles fueron las primeras.'
    );
  if (!patient.admissionTime)
    issues.push('Hora de ingreso no informada: selección desde el inicio de ese día.');
  if (notes[0] && dayOf(notes[0].publishedAt) !== patient.admissionDate)
    issues.push('La primera evolución disponible es posterior al día del ingreso.');
  if (!notes.length) issues.push('Sin evolución médica vigente disponible desde el ingreso.');
  if (authors.length > 1)
    issues.push('Primeras evoluciones simultáneas de distintos autores: ingreso sin atribuir.');
  if (!notes.every(n => n.author.trim()))
    issues.push('Autor de la primera evolución no informado.');
  if (
    vitals !== null &&
    !undatedVitals &&
    (!firstVitals[0] || firstVitals[0].recordedDate !== patient.admissionDate)
  )
    issues.push(
      firstVitals[0]
        ? 'La primera toma disponible es posterior al día del ingreso.'
        : 'No hay toma de signos vitales verificable desde el ingreso.'
    );
  return {
    patient,
    notes,
    doctor,
    indications,
    vital: firstVitals[0] ?? null,
    issues,
  };
};

export const groupAdmissionAuthors = (entries: AdmissionAuditEntry[]) =>
  [...new Set(entries.map(e => e.doctor))]
    .map(name => ({
      name,
      count: entries.filter(e => e.doctor === name && e.notes.length > 0 && !e.readError).length,
      total: entries.filter(e => e.doctor === name).length,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
