import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { fetchWithHeaders, loginToMMRAD, MMRAD_BASE_URL } from './mmrad-session';
import { isDicomUid, issueInstanceTicket, readBoundedResponse } from './mmrad-dicom-policy';
import {
  normalizeDicomPatientId,
  type DicomSeries,
  type DicomStudy,
} from '../../../src/services/radiology/dicomTypes';

/**
 * MMRAD's current viewer, «Visualizador Universitas» (ClearCanvas PACS + Cornerstone3D), observed
 * 2026-11-02. The RIS menu item opens an `abrirestudio` portlet page that only redirects to a
 * short link; the short link answers 303 to `/?public=<session>` and sets an httpOnly cookie
 * `cc_public_share_<session>` that lives about 10 minutes. The manifest and every original
 * (`/api/public/wado/<AE>?…&shareSession=<session>`) need both; without the cookie they answer 401.
 * No RIS cookie travels to the viewer host.
 */
export const UNIVERSITAS_ORIGIN = 'https://visorammym.mmrad.cl';
const VIEWER_HOST = 'visorammym.mmrad.cl';
const SHORT_LINK = /https:\/\/visorammym\.mmrad\.cl\/s\/([A-Za-z0-9_-]{16,128})/g;
const PUBLIC_SESSION = /^[a-f0-9]{16,128}$/i;
const SERVER_AE = /^[A-Za-z0-9_-]{1,32}$/;

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

/** The RIS `abrirestudio` page of one exam, the only kind of link this viewer accepts. */
export const isUniversitasLink = (link: string): boolean => {
  try {
    const url = new URL(link);
    const params = [...url.searchParams.entries()];
    return (
      url.origin === MMRAD_BASE_URL &&
      params.some(([key, value]) => key.endsWith('_spage') && value.endsWith('/abrirestudio')) &&
      params.some(([key, value]) => key.endsWith('_idexamen') && /^\d{1,12}$/.test(value))
    );
  } catch {
    return false;
  }
};

/** The redirect page names one short link; none or two different ones is refused. */
export const universitasShortLinkFromHtml = (html: string): string => {
  const codes = new Set([...html.matchAll(SHORT_LINK)].map(match => match[1]));
  if (codes.size !== 1) throw new Error('MMRAD no entregó un enlace único al visor.');
  return [...codes][0];
};

export const publicSessionFromRedirect = (location: string | null): string => {
  if (!location) throw new Error('El visor MMRAD no entregó una sesión pública.');
  const url = new URL(location, UNIVERSITAS_ORIGIN);
  const session = url.searchParams.get('public') ?? '';
  if (url.hostname !== VIEWER_HOST || url.username || url.password || !PUBLIC_SESSION.test(session))
    throw new Error('El visor MMRAD devolvió una sesión no válida.');
  return session;
};

export interface UniversitasAccess {
  session: string;
  /** `cc_public_share_<session>=<value>`, as the viewer host set it. */
  cookie: string;
  /** Milliseconds the cookie said it lives. */
  ttlMs: number;
}

/** The share cookie must name this very session; anything else is refused. */
export const shareCookieFrom = (
  setCookies: string[],
  session: string
): { cookie: string; ttlMs: number } => {
  const match = setCookies
    .map(header =>
      /^(cc_public_share_[a-f0-9]{16,128})=([A-Za-z0-9._~%+/=-]{1,512})(?:;|$)/i.exec(header)
    )
    .find(found => found && found[1].toLowerCase() === `cc_public_share_${session}`.toLowerCase());
  if (!match) throw new Error('El visor MMRAD no entregó su cookie de acceso.');
  const header = setCookies.find(value => value.startsWith(`${match[1]}=`)) ?? '';
  const maxAge = Number(/Max-Age=(\d{1,6})/i.exec(header)?.[1] ?? 600);
  return { cookie: `${match[1]}=${match[2]}`, ttlMs: Math.max(60_000, (maxAge - 30) * 1000) };
};

export const loadUniversitasManifest = async (
  link: string,
  signal: AbortSignal
): Promise<{ access: UniversitasAccess; manifest: unknown }> => {
  const { cookies, searchActionUrl } = await loginToMMRAD(signal);
  if (!searchActionUrl) throw new Error('No se pudo iniciar sesión en MMRAD.');
  const page = await fetchWithHeaders(link, {
    signal,
    headers: { Cookie: cookies, Referer: `${MMRAD_BASE_URL}/group/hhangaroa/examenes` },
  });
  const code = universitasShortLinkFromHtml(
    new TextDecoder('latin1').decode(await readBoundedResponse(page, 200_000))
  );
  const redirect = await fetch(`${UNIVERSITAS_ORIGIN}/s/${code}`, { signal, redirect: 'manual' });
  const session = publicSessionFromRedirect(redirect.headers.get('location'));
  const { cookie, ttlMs } = shareCookieFrom(redirect.headers.getSetCookie(), session);
  const response = await fetch(
    `${UNIVERSITAS_ORIGIN}/api/public/manifest?${new URLSearchParams({ session })}`,
    { signal, headers: { Accept: 'application/json', Cookie: cookie } }
  );
  const manifest: unknown = JSON.parse(
    new TextDecoder().decode(await readBoundedResponse(response, 5_000_000))
  );
  return { access: { session, cookie, ttlMs }, manifest };
};

const key = (): Buffer => {
  const password = process.env.MMRAD_PASSWORD;
  if (!password) throw new Error('MMRAD no está configurado.');
  return createHash('sha256').update('hhr-dicom-share-session-v1\0').update(password).digest();
};

/** The viewer session and cookie ride inside the signed ticket, encrypted for the browser. */
export const sealShareAccess = (access: Pick<UniversitasAccess, 'session' | 'cookie'>): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const plain = JSON.stringify({ session: access.session, cookie: access.cookie });
  const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url');
};

export const openShareAccess = (sealed: string): Pick<UniversitasAccess, 'session' | 'cookie'> => {
  const raw = Buffer.from(sealed, 'base64url');
  if (raw.length < 29) throw new Error('Acceso DICOM no válido.');
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const access = object(
    JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString())
  );
  const session = typeof access.session === 'string' ? access.session : '';
  const cookie = typeof access.cookie === 'string' ? access.cookie : '';
  if (
    !PUBLIC_SESSION.test(session) ||
    !cookie.toLowerCase().startsWith(`cc_public_share_${session}=`.toLowerCase())
  )
    throw new Error('Acceso DICOM no válido.');
  return { session, cookie };
};

/** URL and share cookie of one original, only on the viewer host. */
export const universitasInstanceRequest = (value: {
  server: string;
  study: string;
  series: string;
  sop: string;
  session: string;
}): { url: string; cookie: string } => {
  const access = openShareAccess(value.session);
  return {
    url: `${UNIVERSITAS_ORIGIN}/api/public/wado/${encodeURIComponent(value.server)}?${new URLSearchParams(
      {
        requestType: 'WADO',
        studyUID: value.study,
        seriesUID: value.series,
        objectUID: value.sop,
        contentType: 'application/dicom',
        shareSession: access.session,
      }
    )}`,
    cookie: access.cookie,
  };
};

/**
 * The manifest names the patient with its own ID; like before, only the requested document is
 * carried and every original must match it, with its three UIDs, before it is decoded.
 */
export const normalizeUniversitasStudy = (
  input: unknown,
  access: UniversitasAccess,
  patientId: string,
  subject: string
): DicomStudy => {
  const manifest = object(input);
  const study = object(manifest.study);
  const uid = study.studyInstanceUid;
  const server = manifest.serverAE;
  if (manifest.source !== 'public' || manifest.wadoRoot !== '/api/public/wado')
    throw new Error('MMRAD devolvió un manifiesto inesperado.');
  if (!isDicomUid(uid) || typeof server !== 'string' || !SERVER_AE.test(server))
    throw new Error('MMRAD devolvió un estudio no válido.');
  if (!patientId) throw new Error('Falta el documento del paciente seleccionado.');
  if (!Array.isArray(manifest.series) || manifest.series.length > 100)
    throw new Error('Series DICOM no válidas.');
  const sealed = sealShareAccess(access);
  const seen = new Set<string>();
  const series: DicomSeries[] = [];
  for (const raw of manifest.series) {
    const item = object(raw);
    const seriesUid = item.seriesInstanceUid;
    if (!isDicomUid(seriesUid) || !Array.isArray(item.instances))
      throw new Error('Serie DICOM no válida.');
    if (series.some(candidate => candidate.uid === seriesUid))
      throw new Error('Serie DICOM duplicada.');
    const instances = item.instances
      .map((rawInstance: unknown) => {
        const sop = object(rawInstance).sopInstanceUid;
        if (!isDicomUid(sop) || seen.has(sop) || seen.size >= 8000)
          throw new Error('Instancia DICOM no válida o duplicada.');
        seen.add(sop);
        const instance = object(rawInstance);
        return {
          uid: sop,
          number: number(instance.instanceNumber),
          frames: Math.max(1, number(instance.numberOfFrames, 1)),
          // The ticket ends when the share cookie does; the viewer then renews it by reopening.
          ticket: issueInstanceTicket(
            {
              subject,
              study: uid,
              series: seriesUid,
              sop,
              server,
              viewer: 'universitas',
              session: sealed,
            },
            access.ttlMs
          ),
        };
      })
      .sort((a, b) => a.number - b.number || a.uid.localeCompare(b.uid));
    if (!instances.length) continue;
    series.push({
      uid: seriesUid,
      number: number(item.seriesNumber),
      description: text(item.description),
      modality: text(item.modality, 10),
      rows: 0,
      columns: 0,
      instances,
    });
  }
  if (!series.length) throw new Error('El estudio no contiene imágenes DICOM.');
  return {
    uid,
    patientId: normalizeDicomPatientId(patientId),
    date: text(study.date, 30),
    series: series.sort((a, b) => a.number - b.number),
  };
};
