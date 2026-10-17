import { randomInt, randomBytes } from 'node:crypto';
import { fetchWithHeaders, loginToMMRAD, MMRAD_BASE_URL } from './mmrad-session';
import {
  MMRAD_VIEWER,
  viewerStudyFromHtml,
  isDicomUid,
  validatedWadoServer,
  issueInstanceTicket,
  readBoundedResponse,
} from './mmrad-dicom-policy';
import {
  normalizeDicomPatientId,
  type DicomStudy,
  type DicomSeries,
} from '../../../src/services/radiology/dicomTypes';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, limit = 180): string =>
  typeof value === 'string' ? value.slice(0, limit) : '';
const number = (value: unknown, fallback = 0): number => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

export const sockJsMessages = (body: string): Record<string, unknown>[] => {
  const messages: Record<string, unknown>[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('c')) throw new Error('MMRAD cerró la conexión del visor.');
    if (!line.startsWith('a')) continue;
    const frames: unknown = JSON.parse(line.slice(1));
    if (!Array.isArray(frames)) throw new Error('Respuesta de MMRAD no válida.');
    for (const frame of frames) {
      const message = object(typeof frame === 'string' ? JSON.parse(frame) : null);
      messages.push(message);
    }
  }
  return messages;
};

/** No RIS cookies or credentials are forwarded to the separate viewer host. */
export const loadVendorStudyMetadata = async (
  link: string,
  signal: AbortSignal
): Promise<{ uid: string; metadata: unknown }> => {
  const { cookies, searchActionUrl } = await loginToMMRAD(signal);
  if (!searchActionUrl) throw new Error('No se pudo iniciar sesión en MMRAD.');
  const page = await fetchWithHeaders(link, {
    signal,
    headers: { Cookie: cookies, Referer: `${MMRAD_BASE_URL}/group/hhangaroa` },
  });
  const uid = viewerStudyFromHtml(
    new TextDecoder('latin1').decode(await readBoundedResponse(page, 1_000_000))
  );
  const transport = `${MMRAD_VIEWER}/sockjs/${String(randomInt(1000)).padStart(3, '0')}/${randomBytes(8).toString('hex')}`;
  const request = async (url: string, body?: string): Promise<string> => {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      redirect: 'error',
      signal,
      headers: {
        Referer: `${MMRAD_VIEWER}/viewer/${uid}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    });
    if (response.status === 204) return '';
    return new TextDecoder().decode(await readBoundedResponse(response, 8_000_000));
  };
  const send = (message: object) =>
    request(`${transport}/xhr_send`, JSON.stringify([JSON.stringify(message)]));
  await request(`${MMRAD_VIEWER}/sockjs/info`);
  await request(`${transport}/xhr`, '');
  await send({ msg: 'connect', version: '1', support: ['1', 'pre2', 'pre1'] });
  let connected = false;
  for (let attempt = 0; attempt < 12 && !connected; attempt++) {
    const messages = sockJsMessages(await request(`${transport}/xhr`, ''));
    for (const message of messages) {
      if (message.msg === 'ping') await send({ msg: 'pong', id: message.id });
      if (message.msg === 'connected') connected = true;
    }
  }
  if (!connected) throw new Error('MMRAD no confirmó la conexión del visor.');
  await send({ msg: 'method', method: 'GetStudyMetadata', params: [uid], id: '1' });
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const message of sockJsMessages(await request(`${transport}/xhr`, ''))) {
      if (message.msg === 'ping') await send({ msg: 'pong', id: message.id });
      if (message.msg !== 'result' || message.id !== '1') continue;
      if (message.error || !message.result) throw new Error('MMRAD no autorizó el estudio DICOM.');
      return { uid, metadata: message.result };
    }
  }
  throw new Error('Se agotó el tiempo de conexión con el visor MMRAD.');
};

export const normalizeVendorStudy = (
  input: unknown,
  uid: string,
  patientId: string,
  subject: string
): DicomStudy => {
  const study = object(input);
  if (study.studyInstanceUid !== uid || !isDicomUid(uid))
    throw new Error('MMRAD devolvió otro estudio.');
  // MMRAD's patientId is an internal portal ID, not the RUT in DICOM PatientID.
  // Carry only the requested context. Every original must match that document before display.
  if (!patientId) throw new Error('Falta el documento del paciente seleccionado.');
  if (!Array.isArray(study.seriesList) || study.seriesList.length > 100)
    throw new Error('Series DICOM no válidas.');
  const seen = new Set<string>();
  const series: DicomSeries[] = [];
  for (const raw of study.seriesList) {
    const item = object(raw);
    if (!isDicomUid(item.seriesInstanceUid) || !Array.isArray(item.instances))
      throw new Error('Serie DICOM no válida.');
    const seriesUid = item.seriesInstanceUid;
    if (series.some(candidate => candidate.uid === seriesUid))
      throw new Error('Serie DICOM duplicada.');
    const instances = item.instances
      .map((rawInstance: unknown) => {
        const instance = object(rawInstance);
        const sop = instance.sopInstanceUid;
        if (!isDicomUid(sop) || seen.has(sop) || seen.size >= 8000)
          throw new Error('Instancia DICOM no válida o duplicada.');
        seen.add(sop);
        const server = validatedWadoServer(instance.wadouri, uid, seriesUid, sop);
        return {
          uid: sop,
          number: number(instance.instanceNumber),
          frames: Math.max(1, number(instance.numberOfFrames, 1)),
          ticket: issueInstanceTicket({ subject, study: uid, series: seriesUid, sop, server }),
        };
      })
      .sort((a, b) => a.number - b.number || a.uid.localeCompare(b.uid));
    if (!instances.length) continue;
    const first = object(item.instances[0]);
    series.push({
      uid: seriesUid,
      number: number(item.seriesNumber),
      description: text(item.seriesDescription),
      modality: text(item.modality || first.modality, 10),
      rows: number(first.rows),
      columns: number(first.columns),
      instances,
    });
  }
  if (!series.length) throw new Error('El estudio no contiene imágenes DICOM.');
  return {
    uid,
    patientId: normalizeDicomPatientId(patientId),
    date: text(study.studyDate, 30),
    series: series.sort((a, b) => a.number - b.number),
  };
};
