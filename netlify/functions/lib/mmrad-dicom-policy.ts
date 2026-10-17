import { createHmac, timingSafeEqual } from 'node:crypto';

export const MMRAD_VIEWER = 'https://hhangaroavisor.mmrad.cl:4446';
const WADO_ROOT = 'http://172.16.20.110:1000/wado/HHANGAROA';
export const isDicomUid = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d+)+$/.test(value);

export const viewerStudyFromHtml = (html: string): string => {
  const src = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)/i)?.[1];
  if (!src) throw new Error('MMRAD no entregó un enlace al estudio DICOM.');
  const url = new URL(src.replace(/&amp;/g, '&'));
  const uid = url.pathname.match(/^\/viewer\/(\d+(?:\.\d+)+)\/?$/)?.[1];
  if (
    url.origin !== MMRAD_VIEWER ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isDicomUid(uid)
  )
    throw new Error('Dirección del visor MMRAD no permitida.');
  return uid;
};

export const validatedWadoServer = (
  raw: unknown,
  study: string,
  series: string,
  sop: string
): string => {
  if (typeof raw !== 'string') throw new Error('Falta el original DICOM.');
  // GetStudyMetadata returns root-relative WADO routes. Resolve against the fixed
  // viewer origin before applying the same destination, parameter and UID checks.
  const url = new URL(raw, MMRAD_VIEWER);
  if (
    url.origin !== MMRAD_VIEWER ||
    url.pathname !== '/__wado_proxy' ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Destino DICOM no permitido.');
  const query = url.searchParams;
  if ([...query.keys()].sort().join(',') !== 'serverId,url')
    throw new Error('Parámetros DICOM no permitidos.');
  const server = query.get('serverId') || '';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(server)) throw new Error('Servidor DICOM no válido.');
  const nested = new URL(query.get('url') || '');
  if (
    `${nested.origin}${nested.pathname}` !== WADO_ROOT ||
    nested.username ||
    nested.password ||
    nested.hash
  )
    throw new Error('Destino WADO no permitido.');
  const expected = {
    requestType: 'WADO',
    studyUID: study,
    seriesUID: series,
    objectUID: sop,
    contentType: 'application/dicom',
  };
  if (
    [...nested.searchParams.keys()].sort().join(',') !== Object.keys(expected).sort().join(',') ||
    Object.entries(expected).some(([key, value]) => nested.searchParams.get(key) !== value)
  )
    throw new Error('El original DICOM no corresponde al estudio solicitado.');
  return server;
};

interface InstanceTicket {
  subject: string;
  study: string;
  series: string;
  sop: string;
  server: string;
  expires: number;
}

const signature = (payload: string): Buffer => {
  const password = process.env.MMRAD_PASSWORD;
  if (!password) throw new Error('MMRAD no está configurado.');
  return createHmac('sha256', password).update('hhr-dicom-instance-v1\0').update(payload).digest();
};

export const issueInstanceTicket = (value: Omit<InstanceTicket, 'expires'>): string => {
  const payload = Buffer.from(
    JSON.stringify({ ...value, expires: Date.now() + 30 * 60_000 })
  ).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
};

export const verifyInstanceTicket = (ticket: unknown, subject: string): InstanceTicket => {
  if (typeof ticket !== 'string' || ticket.length > 1500)
    throw new Error('Acceso DICOM no válido.');
  const parts = ticket.split('.');
  if (parts.length !== 2) throw new Error('Acceso DICOM no válido.');
  const received = Buffer.from(parts[1], 'base64url');
  const expected = signature(parts[0]);
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new Error('Acceso DICOM no válido.');
  const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as InstanceTicket;
  if (
    value.subject !== subject ||
    !Number.isFinite(value.expires) ||
    value.expires <= Date.now() ||
    ![value.study, value.series, value.sop].every(isDicomUid) ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value.server)
  )
    throw new Error('El acceso al estudio venció. Vuelve a abrir el visor.');
  return value;
};

export const instanceWadoUrl = (value: InstanceTicket): string => {
  const inner = new URL(WADO_ROOT);
  inner.search = new URLSearchParams({
    requestType: 'WADO',
    studyUID: value.study,
    seriesUID: value.series,
    objectUID: value.sop,
    contentType: 'application/dicom',
  }).toString();
  return `${MMRAD_VIEWER}/__wado_proxy?${new URLSearchParams({ serverId: value.server, url: inner.href })}`;
};

export const readBoundedResponse = async (
  response: Response,
  limit: number
): Promise<Uint8Array> => {
  if (!response.ok || !response.body) throw new Error('MMRAD no pudo entregar el estudio.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit)
        throw new Error('El archivo DICOM supera el tamaño permitido por la conexión.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};
