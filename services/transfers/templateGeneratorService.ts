import { ref, getDownloadURL, getBlob } from 'firebase/storage';
import { storage } from '@/firebaseConfig';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { TransferPatientData, QuestionnaireResponse, GeneratedDocument } from '@/types/transferDocuments';
import ExcelJS from 'exceljs';

/**
 * Maps system data and questionnaire responses to a flat object of template tags.
 */
export const mapDataToTags = (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse
): Record<string, any> => {
    const tags: Record<string, any> = {
        // Patient Data
        paciente_nombre: patientData.patientName,
        paciente_rut: patientData.rut,
        paciente_edad: patientData.birthDate ? calculateAge(patientData.birthDate) : 'N/A',
        paciente_diagnostico: patientData.diagnosis,
        paciente_cama: patientData.bedName,
        paciente_fecha_ingreso: patientData.admissionDate,

        // Context
        fecha_solicitud: new Date().toLocaleDateString('es-CL'),
        hospital_origen: patientData.originHospital,
    };

    // Add questionnaire responses to tags
    responses.responses.forEach(resp => {
        // Tag format: iaas_contacto_estrecho, iaas_sintomas, etc.
        // We replace dashes with underscores for better compatibility with templates
        const tagKey = resp.questionId.replace(/-/g, '_');

        // Format values for human readability in docs
        let value = resp.value;
        if (typeof value === 'boolean') {
            value = value ? 'Sí' : 'No';
        } else if (Array.isArray(value)) {
            value = value.join(', ');
        }

        tags[tagKey] = value || '';
    });

    return tags;
};

const calculateAge = (birthDateStr: string): string => {
    try {
        const birthDate = new Date(birthDateStr);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return `${age} años`;
    } catch (e) {
        return 'N/A';
    }
};

/**
 * Downloads a template from Firebase Storage.
 */
export const fetchTemplateFromStorage = async (templateName: string): Promise<Blob | null> => {
    try {
        const templateRef = ref(storage, `templates/${templateName}`);
        console.log(`[TemplateService] Fetching template: templates/${templateName}`);
        return await getBlob(templateRef);
    } catch (error) {
        console.warn(`[TemplateService] Template ${templateName} not found in Storage:`, error);
        return null;
    }
};

/**
 * Generates a DOCX document using a template and patient data.
 */
export const generateDocxFromTemplate = async (
    templateBlob: Blob,
    tags: Record<string, any>
): Promise<Blob> => {
    const arrayBuffer = await templateBlob.arrayBuffer();
    const zip = new PizZip(arrayBuffer);

    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
    });

    // Render the document (replace tags)
    doc.render(tags);

    // Output as Blob
    const out = doc.getZip().generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    return out;
};

/**
 * Generates an XLSX document using a template and patient data.
 * It searches for {{tag}} in all cells and replaces them.
 */
export const generateXlsxFromTemplate = async (
    templateBlob: Blob,
    tags: Record<string, any>
): Promise<Blob> => {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await templateBlob.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);

    workbook.eachSheet((sheet) => {
        sheet.eachRow((row) => {
            row.eachCell((cell) => {
                if (typeof cell.value === 'string') {
                    let cellText = cell.value;
                    let modified = false;

                    // Regex to find all {{tag}} patterns
                    const matches = cellText.match(/\{\{([^}]+)\}\}/g);
                    if (matches) {
                        matches.forEach(match => {
                            const key = match.replace(/\{\{|\}\}/g, '').trim();
                            if (tags[key] !== undefined) {
                                cellText = cellText.replace(match, String(tags[key]));
                                modified = true;
                            }
                        });
                    }

                    if (modified) {
                        cell.value = cellText;
                    }
                }
            });
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
