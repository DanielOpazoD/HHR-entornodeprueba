const functions = require('firebase-functions/v1');
const { google } = require('googleapis');
const { Readable } = require('stream');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const EXPORT_ALLOWED_ROLES = new Set(['admin', 'doctor_urgency', 'doctor_specialist']);
const SPANISH_MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const DEFAULT_PROJECT_ID = 'hhr-pruebas';

const resolveConfiguredProjectId = () => {
  const explicitProjectId = String(process.env.GCLOUD_PROJECT || '').trim();
  if (explicitProjectId) {
    return explicitProjectId;
  }

  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (!firebaseConfig) {
    return DEFAULT_PROJECT_ID;
  }

  try {
    const parsedConfig = JSON.parse(firebaseConfig);
    const projectId = String(parsedConfig?.projectId || '').trim();
    return projectId || DEFAULT_PROJECT_ID;
  } catch (_error) {
    return DEFAULT_PROJECT_ID;
  }
};

const DOCUMENT_TYPE_FOLDER_MAPPING = {
  epicrisis: 'Epicrisis',
  evolucion: 'Evoluciones',
  informe_medico: 'Informes Médicos',
  epicrisis_traslado: 'Epicrisis de Traslado',
  otro: 'Otros Documentos',
};

const normalizeText = value =>
  String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const sanitizePathSegment = (value, fallback = 'SinDato') => {
  const normalized = normalizeText(value)
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : fallback;
};

const assertString = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }
  return value.trim();
};

const resolveCallerRole = async (context, resolveRoleForEmail) => {
  const callerEmail = normalizeText(context?.auth?.token?.email).toLowerCase();
  if (!callerEmail) return 'unauthorized';
  return resolveRoleForEmail(callerEmail);
};

const assertExportAccess = async (context, resolveRoleForEmail) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = await resolveCallerRole(context, resolveRoleForEmail);
  if (!EXPORT_ALLOWED_ROLES.has(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Insufficient permissions to export clinical documents to Drive.'
    );
  }
};

const decodeBase64Payload = payload => {
  const normalized = assertString(payload, 'contentBase64').replace(/\s+/g, '');
  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer || buffer.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid contentBase64 payload.');
  }
  return buffer;
};

const buildDriveMonthFolderName = date => {
  const monthName = SPANISH_MONTH_NAMES[date.getMonth()] || 'Mes';
  return `${monthName} ${date.getFullYear()}`;
};

const buildDriveClient = () => {
  const auth = new google.auth.GoogleAuth({ scopes: [DRIVE_SCOPE] });
  return google.drive({ version: 'v3', auth });
};

const resolveGoogleApiStatus = error => Number(error?.response?.status || error?.code || 0);

const resolveGoogleApiMessage = error =>
  String(error?.response?.data?.error?.message || error?.message || '').trim();

const mapDriveExportError = error => {
  if (error?.code && typeof error.code === 'string') {
    return error;
  }

  const status = resolveGoogleApiStatus(error);
  const message = resolveGoogleApiMessage(error);

  if (status === 404 || /file not found/i.test(message)) {
    return new functions.https.HttpsError(
      'failed-precondition',
      'No se pudo acceder a la carpeta raiz de Drive configurada para documentos clinicos. Verifica CLINICAL_DRIVE_ROOT_FOLDER_ID y que la cuenta de servicio tenga acceso a esa carpeta.'
    );
  }

  if (status === 403) {
    return new functions.https.HttpsError(
      'permission-denied',
      'La cuenta de servicio no tiene permisos suficientes para exportar documentos clinicos a Drive.'
    );
  }

  return new functions.https.HttpsError(
    'unavailable',
    'Drive no pudo completar la exportacion del documento clinico. Reintenta y revisa los logs si el problema persiste.'
  );
};

const findFolderByName = async (drive, folderName, parentId) => {
  const query = [
    `name='${folderName.replace(/'/g, "\\'")}'`,
    `mimeType='${FOLDER_MIME_TYPE}'`,
    'trashed=false',
    `'${parentId}' in parents`,
  ].join(' and ');

  const response = await drive.files.list({
    q: query,
    pageSize: 1,
    fields: 'files(id,name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0]?.id || null;
};

const createFolder = async (drive, folderName, parentId) => {
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentId],
    },
    fields: 'id,name',
    supportsAllDrives: true,
  });

  return response.data.id;
};

const getOrCreateFolder = async (drive, folderName, parentId) => {
  const existingId = await findFolderByName(drive, folderName, parentId);
  if (existingId) {
    return existingId;
  }
  return createFolder(drive, folderName, parentId);
};

const findFileByName = async (drive, fileName, parentId) => {
  const query = [
    `name='${fileName.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    'trashed=false',
  ].join(' and ');

  const response = await drive.files.list({
    q: query,
    pageSize: 1,
    fields: 'files(id,name,webViewLink)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0] || null;
};

const upsertPdfFile = async (drive, folderId, fileName, mimeType, bodyBuffer) => {
  const toMediaBody = () => Readable.from(bodyBuffer);
  const existing = await findFileByName(drive, fileName, folderId);
  if (existing?.id) {
    const updated = await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType,
        body: toMediaBody(),
      },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });
    return {
      id: updated.data.id,
      webViewLink: updated.data.webViewLink || '',
    };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: toMediaBody(),
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });

  return {
    id: created.data.id,
    webViewLink: created.data.webViewLink || '',
  };
};

const writeAuditEntry = async ({
  firestore,
  documentId,
  documentType,
  patientRut,
  episodeKey,
  caller,
}) => {
  if (!documentId) return;

  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await firestore
    .collection('hospitals')
    .doc(HOSPITAL_ID)
    .collection('auditLogs')
    .doc(auditId)
    .set({
      id: auditId,
      timestamp: new Date().toISOString(),
      userId: caller?.uid || null,
      userUid: caller?.uid || null,
      userDisplayName: caller?.name || caller?.email || 'Usuario',
      action: 'CLINICAL_DOCUMENT_DRIVE_EXPORTED',
      entityType: 'clinicalDocument',
      entityId: documentId,
      summary: `Exportó ${documentType} a Drive`,
      details: {
        documentId,
        documentType,
        patientRut,
        episodeKey,
        source: 'callable_backend',
      },
      recordDate: null,
    });
};

const createClinicalDocumentExportFunctions = ({
  firestore,
  resolveRoleForEmail,
  buildDriveClientOverride,
}) => ({
  exportClinicalDocumentPdfToDrive: functions
    .runWith({ timeoutSeconds: 300, memory: '1GB' })
    .https.onCall(async (data, context) => {
      await assertExportAccess(context, resolveRoleForEmail);

      const rootFolderId = process.env.CLINICAL_DRIVE_ROOT_FOLDER_ID;
      if (!rootFolderId) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'CLINICAL_DRIVE_ROOT_FOLDER_ID is not configured.'
        );
      }

      const fileName = assertString(data?.fileName, 'fileName');
      const documentType = assertString(data?.documentType, 'documentType');
      const patientName = assertString(data?.patientName, 'patientName');
      const patientRut = assertString(data?.patientRut, 'patientRut');
      const episodeKey = assertString(data?.episodeKey, 'episodeKey');
      const mimeType = typeof data?.mimeType === 'string' ? data.mimeType : 'application/pdf';
      const content = decodeBase64Payload(data?.contentBase64);

      const now = new Date();
      const year = now.getFullYear().toString();
      const monthFolderName = buildDriveMonthFolderName(now);
      const typeFolderName = DOCUMENT_TYPE_FOLDER_MAPPING[documentType] || 'Otros';

      const drive = buildDriveClientOverride ? buildDriveClientOverride() : buildDriveClient();

      let upload;
      try {
        // Navegacion jerarquica: Root -> Tipo -> Ano -> Mes Ano
        const typeFolderId = await getOrCreateFolder(drive, typeFolderName, rootFolderId);
        const yearFolderId = await getOrCreateFolder(drive, year, typeFolderId);
        const monthFolderId = await getOrCreateFolder(drive, monthFolderName, yearFolderId);

        upload = await upsertPdfFile(drive, monthFolderId, fileName, mimeType, content);
      } catch (error) {
        throw mapDriveExportError(error);
      }

      await writeAuditEntry({
        firestore,
        documentId: typeof data?.documentId === 'string' ? data.documentId : null,
        documentType,
        patientRut,
        episodeKey,
        caller: {
          uid: context.auth?.uid || null,
          email: context.auth?.token?.email || null,
          name: context.auth?.token?.name || null,
        },
      });

      return {
        fileId: upload.id,
        webViewLink: upload.webViewLink,
        folderPath: `${year}/${monthFolderName}`,
        usedBackend: true,
      };
    }),
});

module.exports = {
  createClinicalDocumentExportFunctions,
  resolveConfiguredProjectId,
};
