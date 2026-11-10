import { safeErrorMessage } from './safe-error-message';
import { createVerify } from 'node:crypto';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

import authEmailUtilsModule from '../../../functions/lib/auth/authEmailUtils.js';

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const TOKEN_CLOCK_SKEW_SECONDS = 300;

type AuthEmailUtilsModule = {
  normalizeEmail?: (value: string) => string;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

export type FirebaseJwtPayload = {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  user_id?: string;
  [key: string]: unknown;
};

export type AuthorizedRoleRequest = {
  email: string;
  role: string;
  token: FirebaseJwtPayload;
};

type FetchLike = typeof fetch;
type RoleResolutionOptions = {
  bearerToken?: string;
  fetchImpl?: FetchLike;
  throwOnLookupError?: boolean;
};
type CallableRoleResponse = {
  role?: string | null;
};
type CallableEnvelope = {
  result?: CallableRoleResponse | null;
  data?: CallableRoleResponse | null;
  error?: {
    message?: string;
    status?: string;
  } | null;
};

const { normalizeEmail: normalizeImportedEmail } = authEmailUtilsModule as AuthEmailUtilsModule;

const normalizeEmail = (value: string): string => {
  if (typeof normalizeImportedEmail === 'function') {
    return normalizeImportedEmail(value);
  }

  return String(value || '')
    .trim()
    .toLowerCase();
};

const decodeBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
};

const parseJwt = (token: string) => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  const header = JSON.parse(decodeBase64Url(headerPart).toString('utf8')) as JwtHeader;
  const payload = JSON.parse(decodeBase64Url(payloadPart).toString('utf8')) as FirebaseJwtPayload;
  const signature = decodeBase64Url(signaturePart);

  return {
    header,
    payload,
    signature,
    signingInput: `${headerPart}.${payloadPart}`,
  };
};

const extractMaxAgeSeconds = (cacheControl: string | null): number | null => {
  if (!cacheControl) return null;

  const match = cacheControl.match(/max-age=(\d+)/i);
  return match ? Number(match[1]) : null;
};

let cachedFirebaseSigningKeys: {
  expiresAt: number;
  certificates: Record<string, string>;
} | null = null;

export const resetFirebaseSigningKeyCacheForTests = (): void => {
  cachedFirebaseSigningKeys = null;
};

const normalizeRoleAlias = (role: unknown): string => {
  if (role === 'viewer_census') {
    return 'viewer';
  }

  return typeof role === 'string' && role.trim() ? role : 'unauthorized';
};

const resolveFunctionsRegion = (): string => {
  const explicitRegion = String(process.env.FIREBASE_FUNCTIONS_REGION || '').trim();
  return explicitRegion || 'us-central1';
};

const buildCheckUserRoleCallableUrl = (): string => {
  const projectId = resolveFirebaseProjectId();
  const region = resolveFunctionsRegion();
  return `https://${region}-${projectId}.cloudfunctions.net/checkUserRole`;
};

const parseCallableRoleResponse = (payload: CallableEnvelope): string => {
  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }

  const resultRole = payload?.result?.role ?? payload?.data?.role;
  return normalizeRoleAlias(resultRole);
};

const resolveRoleViaCanonicalCallable = async (
  bearerToken: string,
  fetchImpl: FetchLike
): Promise<string> => {
  const response = await fetchImpl(buildCheckUserRoleCallableUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: {} }),
  });

  let payload: CallableEnvelope | null = null;
  try {
    payload = (await response.json()) as CallableEnvelope;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message || `Canonical role lookup failed (${response.status}).`;
    throw new Error(message);
  }

  return parseCallableRoleResponse(payload || {});
};

const fetchFirebaseSigningKeys = async (fetchImpl: FetchLike): Promise<Record<string, string>> => {
  if (cachedFirebaseSigningKeys && cachedFirebaseSigningKeys.expiresAt > Date.now()) {
    return cachedFirebaseSigningKeys.certificates;
  }

  const response = await fetchImpl(FIREBASE_CERTS_URL);
  if (!response.ok) {
    throw new Error(`Unable to fetch Firebase signing certificates (${response.status}).`);
  }

  const certificates = (await response.json()) as Record<string, string>;
  const maxAgeSeconds = extractMaxAgeSeconds(response.headers.get('cache-control')) ?? 3600;
  cachedFirebaseSigningKeys = {
    certificates,
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  };

  return certificates;
};

const verifyFirebaseSignature = (
  signingInput: string,
  signature: Buffer,
  certificate: string
): boolean => {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(certificate, signature);
};

const resolveFirebaseProjectId = (): string => {
  const explicitProjectId = String(process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (explicitProjectId) return explicitProjectId;

  const firebaseConfig = String(process.env.FIREBASE_CONFIG || '').trim();
  if (!firebaseConfig) {
    throw new Error('Missing Firebase project ID for token verification.');
  }

  try {
    const parsed = JSON.parse(firebaseConfig) as { projectId?: string };
    if (!parsed.projectId) {
      throw new Error('FIREBASE_CONFIG has no projectId.');
    }
    return parsed.projectId;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid FIREBASE_CONFIG: ${error.message}`
        : 'Invalid FIREBASE_CONFIG.'
    );
  }
};

export const extractBearerToken = (authorizationHeader: string | undefined): string => {
  if (!authorizationHeader) {
    throw new Error('Missing Authorization bearer token.');
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Authorization header must use Bearer token.');
  }

  return token;
};

export const verifyFirebaseIdToken = async (
  token: string,
  options?: { fetchImpl?: FetchLike; nowMs?: number }
): Promise<FirebaseJwtPayload> => {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const nowSeconds = Math.floor((options?.nowMs ?? Date.now()) / 1000);
  const projectId = resolveFirebaseProjectId();
  const { header, payload, signature, signingInput } = parseJwt(token);

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    throw new Error('Unsupported Firebase token header.');
  }

  const certificates = await fetchFirebaseSigningKeys(fetchImpl);
  const certificate = certificates[header.kid];
  if (!certificate) {
    throw new Error('Unknown Firebase signing key.');
  }

  if (!verifyFirebaseSignature(signingInput, signature, certificate)) {
    throw new Error('Invalid Firebase token signature.');
  }

  if (payload.aud !== projectId) {
    throw new Error('Invalid Firebase token audience.');
  }

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Invalid Firebase token issuer.');
  }

  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
    throw new Error('Invalid Firebase token subject.');
  }

  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds - TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error('Expired Firebase token.');
  }

  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error('Invalid Firebase token issued-at time.');
  }

  return payload;
};

export const resolveRoleForEmail = async (
  db: Firestore,
  email: string | undefined,
  options?: RoleResolutionOptions
): Promise<string> => {
  const cleanEmail = normalizeEmail(email || '');
  if (!cleanEmail) {
    return 'unauthorized';
  }

  if (options?.bearerToken) {
    try {
      return await resolveRoleViaCanonicalCallable(options.bearerToken, options.fetchImpl ?? fetch);
    } catch (error) {
      console.warn(
        `[NetlifyAuth] canonical role lookup failed for ${cleanEmail}:`,
        safeErrorMessage(error)
      );
      if (options.throwOnLookupError) {
        throw new Error(
          error instanceof Error && error.message
            ? safeErrorMessage(error)
            : 'Canonical role lookup unavailable.'
        );
      }
      return 'unauthorized';
    }
  }

  try {
    const roleDoc = await getDoc(doc(db, 'config', 'roles'));
    if (roleDoc.exists()) {
      const rolesMap = (roleDoc.data() || {}) as Record<string, unknown>;
      return normalizeRoleAlias(rolesMap[cleanEmail]);
    }
  } catch (error) {
    console.warn(
      `[NetlifyAuth] resolveRoleForEmail failed for ${cleanEmail}:`,
      safeErrorMessage(error)
    );
  }

  return 'unauthorized';
};

export const authorizeRoleRequest = async (
  db: Firestore,
  authorizationHeader: string | undefined,
  allowedRoles: ReadonlySet<string>,
  options?: Pick<RoleResolutionOptions, 'fetchImpl'>
): Promise<AuthorizedRoleRequest> => {
  const token = extractBearerToken(authorizationHeader);
  const decodedToken = await verifyFirebaseIdToken(token);
  const email = normalizeEmail(typeof decodedToken.email === 'string' ? decodedToken.email : '');
  if (!email) {
    throw new Error('Authenticated user has no email claim.');
  }

  const role = await resolveRoleForEmail(db, email, {
    bearerToken: token,
    fetchImpl: options?.fetchImpl,
    throwOnLookupError: true,
  });
  if (!allowedRoles.has(role)) {
    throw new Error(`Access denied for role '${role}'.`);
  }

  return {
    email,
    role,
    token: decodedToken,
  };
};
