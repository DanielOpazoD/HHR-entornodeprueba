import { doc, getDoc, collection, query, where, getDocs, type Firestore } from 'firebase/firestore';
import { getFirebaseServer } from './lib/firebase-server';
import { mapMasterPatientToFhir, mapEncounterToFhir } from '../../services/utils/fhirMappers';
import { MasterPatient, DailyRecord } from '../../types';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const hospitalId = 'hanga_roa'; // Could be dynamic via headers in future

interface NetlifyEvent {
    httpMethod: string;
    path: string;
    headers: Record<string, string | undefined>;
    [key: string]: unknown;
}

export const handler = async (event: NetlifyEvent) => {
    // 1. CORS Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'Method not allowed' }] })
        };
    }

    // 2. Parse Path
    const pathParts = event.path.split('/').filter(Boolean);
    // Find where the FHIR part starts
    const fhirIndex = pathParts.findIndex(p => p === 'fhir-api');
    const resourceType = pathParts[fhirIndex + 1];
    const resourceId = pathParts[fhirIndex + 2];

    try {
        const { db } = getFirebaseServer();

        // 3. Routing
        if (resourceType === 'Patient') {
            return await handlePatientRead(db, resourceId);
        } else if (resourceType === 'Encounter') {
            return await handleEncounterRead(db, resourceId);
        } else if (resourceType === 'metadata' || !resourceType) {
            return handleCapabilityStatement();
        }

        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code: 'not-found', diagnostics: `Resource type '${resourceType}' not supported or not found` }]
            })
        };

    } catch (error: unknown) {
        console.error('[FHIR API] Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code: 'exception', diagnostics: error instanceof Error ? error.message : String(error) }]
            })
        };
    }
};

async function handlePatientRead(db: Firestore, id: string) {
    if (!id) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'required', diagnostics: 'Patient ID (RUT) is required' }] })
        };
    }

    const patientRef = doc(db, `hospitals/${hospitalId}/patients`, id);
    const snap = await getDoc(patientRef);

    if (!snap.exists()) {
        const patientsColl = collection(db, `hospitals/${hospitalId}/patients`);
        const q = query(patientsColl, where('rut', '==', id));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
            const data = qSnap.docs[0].data() as MasterPatient;
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/fhir+json' },
                body: JSON.stringify(mapMasterPatientToFhir(data))
            };
        }
    }

    if (snap.exists()) {
        const data = snap.data() as MasterPatient;
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/fhir+json' },
            body: JSON.stringify(mapMasterPatientToFhir(data))
        };
    }

    return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: `Patient with ID '${id}' not found` }] })
    };
}

async function handleEncounterRead(db: Firestore, id: string) {
    if (!id || !id.startsWith('enc-')) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Invalid Encounter ID format. Expected enc-YYYY-MM-DD-{bedId}' }] })
        };
    }

    const parts = id.split('-');
    if (parts.length < 5) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Invalid Encounter ID format.' }] })
        };
    }

    const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
    const bedId = parts.slice(4).join('-');

    const recordRef = doc(db, `hospitals/${hospitalId}/dailyRecords`, date);
    const snap = await getDoc(recordRef);

    if (snap.exists()) {
        const record = snap.data() as DailyRecord;
        const patient = record.beds[bedId];

        if (patient && patient.patientName) {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/fhir+json' },
                body: JSON.stringify(mapEncounterToFhir(patient, hospitalId))
            };
        }
    }

    return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: `Encounter with ID '${id}' not found` }] })
    };
}

function handleCapabilityStatement() {
    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/fhir+json' },
        body: JSON.stringify({
            resourceType: 'CapabilityStatement',
            status: 'active',
            date: new Date().toISOString(),
            kind: 'instance',
            software: { name: 'HHR Hospital Tracker FHIR API', version: '1.0.0' },
            implementation: { description: 'FHIR R4 Endpoint for Hospital Hanga Roa' },
            fhirVersion: '4.0.1',
            format: ['application/fhir+json'],
            rest: [{
                mode: 'server',
                resource: [
                    { type: 'Patient', interaction: [{ code: 'read' }] },
                    { type: 'Encounter', interaction: [{ code: 'read' }] }
                ]
            }]
        })
    };
}
