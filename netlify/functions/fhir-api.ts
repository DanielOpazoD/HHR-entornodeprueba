import { safeErrorLog, safeErrorMessage } from './lib/safe-error-message';
import { doc, getDoc, collection, query, where, getDocs, type Firestore } from 'firebase/firestore';
import { getFirebaseServer } from './lib/firebase-server';
import { mapMasterPatientToFhir, mapEncounterToFhir } from '../../src/services/utils/fhirMappers';
import type { DailyRecord } from '../../src/types/domain/dailyRecord';
import type { MasterPatient } from '../../src/types/domain/patientMaster';
import {
  FhirCapabilityStatementSchema,
  FhirOperationOutcomeSchema,
} from '../../src/contracts/serverless';
import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { invokeWithTelemetry } from './lib/observability';

const hospitalId = 'hanga_roa'; // Could be dynamic via headers in future
const FHIR_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
]);

interface FhirApiDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
  getDoc: typeof getDoc;
  getDocs: typeof getDocs;
  doc: typeof doc;
  collection: typeof collection;
  query: typeof query;
  where: typeof where;
  mapMasterPatientToFhir: typeof mapMasterPatientToFhir;
  mapEncounterToFhir: typeof mapEncounterToFhir;
}

const buildFhirJsonResponse = (statusCode: number, body: unknown, requestOrigin?: string) =>
  buildJsonResponse(statusCode, body, {
    requestOrigin,
    contentType: 'application/fhir+json',
  });

const buildOperationOutcomeResponse = (
  statusCode: number,
  code: string,
  diagnostics: string,
  requestOrigin?: string
) =>
  buildFhirJsonResponse(
    statusCode,
    FhirOperationOutcomeSchema.parse({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code, diagnostics }],
    }),
    requestOrigin
  );

const resolveFhirRoute = (path: string | undefined) => {
  const pathParts = (path || '').split('/').filter(Boolean);
  const fhirIndex = pathParts.findIndex(p => p === 'fhir-api');

  return {
    resourceType: fhirIndex >= 0 ? pathParts[fhirIndex + 1] : undefined,
    resourceId: fhirIndex >= 0 ? pathParts[fhirIndex + 2] : undefined,
  };
};

export const createFhirApiHandler =
  (
    dependencies: FhirApiDependencies = {
      getFirebaseServer,
      authorizeRoleRequest,
      extractBearerToken,
      getDoc,
      getDocs,
      doc,
      collection,
      query,
      where,
      mapMasterPatientToFhir,
      mapEncounterToFhir,
    }
  ) =>
  async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const corsHeaders = buildCorsHeaders(requestOrigin, {
      allowedHeaders: 'Content-Type, Authorization, Accept',
      allowedMethods: 'GET,OPTIONS',
    });

    if (!isOriginAllowed(requestOrigin)) {
      return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
    }

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
      return buildOperationOutcomeResponse(405, 'forbidden', 'Method not allowed', requestOrigin);
    }

    // Rate limit only the actual GET request, not the CORS preflight.
    const clientIp = getClientIp(event);
    if (isRateLimited(clientIp, { maxPerWindow: 20, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const { resourceType, resourceId } = resolveFhirRoute(event.path);

    try {
      const { db } = dependencies.getFirebaseServer();
      const authorizationHeader =
        typeof event.headers?.authorization === 'string'
          ? event.headers.authorization
          : typeof event.headers?.Authorization === 'string'
            ? event.headers.Authorization
            : undefined;

      try {
        dependencies.extractBearerToken(authorizationHeader);
      } catch (error) {
        return buildOperationOutcomeResponse(
          401,
          'login',
          safeErrorMessage(error, 'Authentication required.'),
          requestOrigin
        );
      }

      try {
        await dependencies.authorizeRoleRequest(db, authorizationHeader, FHIR_ALLOWED_ROLES);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'FHIR authorization failed.';
        const statusCode =
          message.includes('Access denied') || message.includes('no email claim') ? 403 : 401;
        const code = statusCode === 403 ? 'forbidden' : 'login';

        return buildOperationOutcomeResponse(
          statusCode,
          code,
          safeErrorMessage(message),
          requestOrigin
        );
      }

      if (resourceType === 'Patient') {
        return await invokeWithTelemetry({
          service: 'fhir',
          operation: 'read_patient',
          timeoutMs: 10_000,
          maxAttempts: 3,
          db,
          hospitalId,
          context: { resourceId: resourceId || '' },
          fn: () => handlePatientRead(dependencies, db, resourceId, requestOrigin),
        });
      }

      if (resourceType === 'Encounter') {
        return await invokeWithTelemetry({
          service: 'fhir',
          operation: 'read_encounter',
          timeoutMs: 10_000,
          maxAttempts: 3,
          db,
          hospitalId,
          context: { resourceId: resourceId || '' },
          fn: () => handleEncounterRead(dependencies, db, resourceId, requestOrigin),
        });
      }

      if (resourceType === 'metadata' || !resourceType) {
        return handleCapabilityStatement(requestOrigin);
      }

      return buildOperationOutcomeResponse(
        404,
        'not-found',
        `Resource type '${resourceType}' not supported or not found`,
        requestOrigin
      );
    } catch (error: unknown) {
      console.error('[FHIR API] Error:', safeErrorLog(error));
      return buildOperationOutcomeResponse(
        500,
        'exception',
        safeErrorMessage(error),
        requestOrigin
      );
    }
  };

async function handlePatientRead(
  dependencies: FhirApiDependencies,
  db: Firestore,
  id: string | undefined,
  requestOrigin?: string
) {
  if (!id) {
    return buildOperationOutcomeResponse(
      400,
      'required',
      'Patient ID (RUT) is required',
      requestOrigin
    );
  }

  const patientRef = dependencies.doc(db, `hospitals/${hospitalId}/patients`, id);
  const snap = await dependencies.getDoc(patientRef);

  if (!snap.exists()) {
    const patientsColl = dependencies.collection(db, `hospitals/${hospitalId}/patients`);
    const q = dependencies.query(patientsColl, dependencies.where('rut', '==', id));
    const qSnap = await dependencies.getDocs(q);
    if (!qSnap.empty) {
      const data = qSnap.docs[0].data() as MasterPatient;
      return buildFhirJsonResponse(200, dependencies.mapMasterPatientToFhir(data), requestOrigin);
    }
  }

  if (snap.exists()) {
    const data = snap.data() as MasterPatient;
    return buildFhirJsonResponse(200, dependencies.mapMasterPatientToFhir(data), requestOrigin);
  }

  return buildOperationOutcomeResponse(
    404,
    'not-found',
    `Patient with ID '${id}' not found`,
    requestOrigin
  );
}

async function handleEncounterRead(
  dependencies: FhirApiDependencies,
  db: Firestore,
  id: string | undefined,
  requestOrigin?: string
) {
  if (!id || !id.startsWith('enc-')) {
    return buildOperationOutcomeResponse(
      400,
      'invalid',
      'Invalid Encounter ID format. Expected enc-YYYY-MM-DD-{bedId}',
      requestOrigin
    );
  }

  const parts = id.split('-');
  if (parts.length < 5) {
    return buildOperationOutcomeResponse(
      400,
      'invalid',
      'Invalid Encounter ID format.',
      requestOrigin
    );
  }

  const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
  const bedId = parts.slice(4).join('-');

  const recordRef = dependencies.doc(db, `hospitals/${hospitalId}/dailyRecords`, date);
  const snap = await dependencies.getDoc(recordRef);

  if (snap.exists()) {
    const record = snap.data() as DailyRecord;
    const patient = record.beds[bedId];

    if (patient && patient.patientName) {
      return buildFhirJsonResponse(
        200,
        dependencies.mapEncounterToFhir(patient, hospitalId),
        requestOrigin
      );
    }
  }

  return buildOperationOutcomeResponse(
    404,
    'not-found',
    `Encounter with ID '${id}' not found`,
    requestOrigin
  );
}

function handleCapabilityStatement(requestOrigin?: string) {
  return buildFhirJsonResponse(
    200,
    FhirCapabilityStatementSchema.parse({
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      software: { name: 'HHR Hospital Tracker FHIR API', version: '1.0.0' },
      implementation: { description: 'FHIR R4 Endpoint for Hospital Hanga Roa' },
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      rest: [
        {
          mode: 'server',
          resource: [
            { type: 'Patient', interaction: [{ code: 'read' }] },
            { type: 'Encounter', interaction: [{ code: 'read' }] },
          ],
        },
      ],
    }),
    requestOrigin
  );
}

export const handler = createFhirApiHandler();
