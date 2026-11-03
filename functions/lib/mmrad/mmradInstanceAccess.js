const { createDecipheriv, createHash, createHmac, timingSafeEqual } = require('node:crypto');

/**
 * Firebase copy of the instance access that `mmrad-dicom` (Netlify) issues. It must stay
 * byte-compatible with `issueInstanceTicket`/`verifyInstanceTicket` in
 * `netlify/functions/lib/mmrad-dicom-policy.ts` and `sealShareAccess`/`openShareAccess` in
 * `netlify/functions/lib/mmrad-universitas.ts`; `mmradDicomTicketParity.test.ts` checks both ways.
 * Only Universitas tickets are accepted here: the legacy viewer never reaches this function.
 */
const UNIVERSITAS_ORIGIN = 'https://visorammym.mmrad.cl';
const PUBLIC_SESSION = /^[a-f0-9]{16,128}$/i;
const SERVER = /^[a-zA-Z0-9_-]{1,100}$/;
const SEALED_SESSION = /^[A-Za-z0-9_-]{30,400}$/;

class InstanceAccessError extends Error {
  constructor() {
    super('Acceso DICOM no válido.');
  }
}

/** An authentic ticket of this very user whose time ran out; the browser may reopen the study. */
class InstanceTicketExpiredError extends Error {
  constructor() {
    super('El acceso al estudio venció.');
  }
}

const isDicomUid = value =>
  typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d+)+$/.test(value);

// The same secret as Netlify's MMRAD_PASSWORD, read as is (no trimming), with the same domains.
const mmradSecret = () => {
  const password = process.env.MMRAD_PASSWORD;
  if (!password) throw new InstanceAccessError();
  return password;
};

const signature = payload =>
  createHmac('sha256', mmradSecret()).update('hhr-dicom-instance-v1\0').update(payload).digest();

const shareKey = () =>
  createHash('sha256').update('hhr-dicom-share-session-v1\0').update(mmradSecret()).digest();

const verifyUniversitasTicket = (ticket, subject, now = Date.now()) => {
  if (typeof ticket !== 'string' || ticket.length > 1500) throw new InstanceAccessError();
  const parts = ticket.split('.');
  if (parts.length !== 2) throw new InstanceAccessError();
  const received = Buffer.from(parts[1], 'base64url');
  const expected = signature(parts[0]);
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new InstanceAccessError();
  let value;
  try {
    value = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  } catch {
    throw new InstanceAccessError();
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof subject !== 'string' ||
    !subject ||
    value.subject !== subject ||
    !Number.isFinite(value.expires) ||
    ![value.study, value.series, value.sop].every(isDicomUid) ||
    typeof value.server !== 'string' ||
    !SERVER.test(value.server) ||
    value.viewer !== 'universitas' ||
    typeof value.session !== 'string' ||
    !SEALED_SESSION.test(value.session)
  )
    throw new InstanceAccessError();
  // Expiry is checked last, so only a signed, well-formed ticket of this user reads as expired.
  if (value.expires <= now) throw new InstanceTicketExpiredError();
  return value;
};

const openShareAccess = sealed => {
  const raw = Buffer.from(String(sealed), 'base64url');
  if (raw.length < 29) throw new InstanceAccessError();
  let access;
  try {
    const decipher = createDecipheriv('aes-256-gcm', shareKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    access = JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()
    );
  } catch {
    throw new InstanceAccessError();
  }
  const session = typeof access?.session === 'string' ? access.session : '';
  const cookie = typeof access?.cookie === 'string' ? access.cookie : '';
  if (
    !PUBLIC_SESSION.test(session) ||
    !cookie.toLowerCase().startsWith(`cc_public_share_${session}=`.toLowerCase())
  )
    throw new InstanceAccessError();
  return { session, cookie };
};

/** The one URL this function fetches: the original on the Universitas host, with its cookie. */
const universitasInstanceRequest = ticket => {
  const access = openShareAccess(ticket.session);
  const query = new URLSearchParams({
    requestType: 'WADO',
    studyUID: ticket.study,
    seriesUID: ticket.series,
    objectUID: ticket.sop,
    contentType: 'application/dicom',
    shareSession: access.session,
  });
  return {
    url: `${UNIVERSITAS_ORIGIN}/api/public/wado/${encodeURIComponent(ticket.server)}?${query}`,
    cookie: access.cookie,
  };
};

module.exports = {
  UNIVERSITAS_ORIGIN,
  InstanceAccessError,
  InstanceTicketExpiredError,
  openShareAccess,
  universitasInstanceRequest,
  verifyUniversitasTicket,
};
