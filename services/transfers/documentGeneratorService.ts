/**
 * Document Generator Service
 * Generates DOCX, XLSX, and PDF documents for patient transfers
 */

import {
    HospitalConfig,
    QuestionnaireResponse,
    TransferPatientData,
    GeneratedDocument
} from '@/types/transferDocuments';
import {
    fetchTemplateFromStorage,
    mapDataToTags,
    generateDocxFromTemplate,
    generateXlsxFromTemplate
} from './templateGeneratorService';
import {
    generateTapaTraslado,
    generateEncuestaCovid,
    generateSolicitudCamaHDS,
    generateSolicitudAmbulancia,
    generateFormularioIAAS
} from './documentFallbacks';

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Generate all enabled documents for a transfer
 */
export const generateTransferDocuments = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    hospital: HospitalConfig
): Promise<GeneratedDocument[]> => {
    const documents: GeneratedDocument[] = [];
    const enabledTemplates = hospital.templates.filter(t => t.enabled);

    // Map data once for all templates
    const tags = mapDataToTags(patientData, responses);

    for (const template of enabledTemplates) {
        try {
            let doc: GeneratedDocument | null = null;

            // 1. Try to use Original Template from Firebase Storage
            const templateFileName = `${hospital.code}/${template.id}.${template.format}`;
            const templateBlob = await fetchTemplateFromStorage(templateFileName);

            if (templateBlob) {
                // console.info(`[DocumentGenerator] Using original template for ${template.id}`);
                let processedBlob: Blob;
                if (template.format === 'docx') {
                    processedBlob = await generateDocxFromTemplate(templateBlob, tags);
                } else if (template.format === 'xlsx') {
                    processedBlob = await generateXlsxFromTemplate(templateBlob, tags);
                } else {
                    processedBlob = templateBlob;
                }

                doc = {
                    templateId: template.id,
                    fileName: `${template.name}_${patientData.patientName.replace(/\s+/g, '_')}.${template.format}`,
                    mimeType: templateBlob.type,
                    blob: processedBlob,
                    generatedAt: new Date().toISOString()
                };
            }

            // 2. Fallback to Code-based generation if no template found or processing failed
            if (!doc) {
                console.warn(`[DocumentGenerator] Template ${template.id} not found in Storage, using code fallback`);
                doc = await generateFallbackDocument(template.id, patientData, responses, hospital);
            }

            if (doc) documents.push(doc);
        } catch (error) {
            console.error(`Error generating ${template.id}:`, error);
        }
    }

    return documents;
};

/**
 * Route to the correct fallback generator
 */
const generateFallbackDocument = async (
    templateId: string,
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    hospital: HospitalConfig
): Promise<GeneratedDocument | null> => {
    switch (templateId) {
        case 'tapa-traslado':
            return generateTapaTraslado(patientData, hospital);
        case 'encuesta-covid':
            return generateEncuestaCovid(patientData, responses, hospital);
        case 'solicitud-cama-hds':
            return generateSolicitudCamaHDS(patientData, responses, hospital);
        case 'solicitud-ambulancia':
            return generateSolicitudAmbulancia(patientData, responses, hospital);
        case 'formulario-iaas':
            return generateFormularioIAAS(patientData, responses, hospital);
        default:
            console.warn(`Unknown template: ${templateId}`);
            return null;
    }
};

/**
 * Download a single document
 */
export const downloadDocument = (doc: GeneratedDocument): void => {
    const url = URL.createObjectURL(doc.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = doc.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * Download all documents individually
 */
export const downloadAllDocuments = async (documents: GeneratedDocument[]): Promise<void> => {
    for (const doc of documents) {
        downloadDocument(doc);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
};
