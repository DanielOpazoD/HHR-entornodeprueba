import { ref, getBlob } from 'firebase/storage';
import { storage } from '@/firebaseConfig';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { TransferPatientData, QuestionnaireResponse } from '@/types/transferDocuments';
// import ExcelJS from 'exceljs'; // Removed static import

/**
 * Maps system data and questionnaire responses to a flat object of template tags.
 */
export const mapDataToTags = (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse
): Record<string, any> => {
    const today = new Date();
    const fechaActual = today.toLocaleDateString('es-CL');

    // Calculate age: use direct age field if available, otherwise calculate from birthDate
    const ageStr = patientData.age !== undefined
        ? `${patientData.age} años`
        : patientData.birthDate
            ? calculateAge(patientData.birthDate)
            : 'No registrada';

    // Format birth date for display
    const fechaNacimiento = patientData.birthDate
        ? new Date(patientData.birthDate).toLocaleDateString('es-CL')
        : 'No registrada';

    // Use diagnosis from responses if available (it allows editing in the modal), otherwise fallback to patientData
    const currentDiagnosis = responses.diagnosis || patientData.diagnosis || 'No especificado';

    const tags: Record<string, any> = {
        // Patient Data - multiple variations for flexibility
        paciente_nombre: patientData.patientName,
        NOMBRE: patientData.patientName,
        Nombre: patientData.patientName,
        nombre: patientData.patientName,

        paciente_rut: patientData.rut,
        RUT: patientData.rut,
        rut: patientData.rut,

        paciente_edad: ageStr,
        EDAD: ageStr,
        edad: ageStr,

        paciente_fecha_nacimiento: fechaNacimiento,
        fecha_nacimiento: fechaNacimiento,
        F_NACIMIENTO: fechaNacimiento,

        paciente_diagnostico: currentDiagnosis,
        DIAGNOSTICO: currentDiagnosis,
        diagnostico: currentDiagnosis,

        paciente_cama: patientData.bedName,
        CAMA: patientData.bedName,
        cama: patientData.bedName,

        paciente_fecha_ingreso: patientData.admissionDate
            ? new Date(patientData.admissionDate).toLocaleDateString('es-CL')
            : 'No registrado',

        // Dates - multiple variations
        fecha_solicitud: fechaActual,
        fecha_actual: fechaActual,
        FECHA: fechaActual,
        fecha: fechaActual,

        // Hospital/Context
        hospital_origen: patientData.originHospital,
        HOSPITAL_ORIGEN: patientData.originHospital,

        // Staff - Nurse and Physician
        Nombre_enfermero: responses.completedBy || 'Enfermero/a de Turno',
        nombre_enfermero: responses.completedBy || 'Enfermero/a de Turno',
        ENFERMERO: responses.completedBy || 'Enfermero/a de Turno',

        medico_tratante: responses.attendingPhysician || 'No especificado',
        MEDICO_TRATANTE: responses.attendingPhysician || 'No especificado',
        medico: responses.attendingPhysician || 'No especificado',
    };

    // Add questionnaire responses to tags
    responses.responses.forEach(resp => {
        // Tag format: iaas_contacto_estrecho, iaas_sintomas, etc.
        // We replace dashes with underscores for better compatibility with templates
        const tagKey = resp.questionId.replace(/-/g, '_');

        // Format values for human readability in docs
        let value = resp.value;
        if (typeof value === 'boolean') {
            const boolVal = value;
            value = boolVal ? 'Sí' : 'No';
            // Add _si and _no variants for checkboxes/marks
            tags[`${tagKey}_si`] = boolVal ? 'X' : '';
            tags[`${tagKey}_no`] = !boolVal ? 'X' : '';
        } else if (Array.isArray(value)) {
            value = value.join(', ');
        }

        tags[tagKey] = value || '';
    });

    // Special logic for COVID symptoms and contact
    // (Translating technical IDs to requested user tags)

    // 1. Contact
    const contactResp = responses.responses.find(r => r.questionId === 'contactoCovid');
    const hasContact = !!contactResp?.value;
    tags.covid_contacto_48h = hasContact ? 'Sí' : 'No';
    tags.covid_contacto_48h_si = hasContact ? 'X' : '';
    tags.covid_contacto_48h_no = !hasContact ? 'X' : '';

    // 2. Symptoms
    const symptomsResp = responses.responses.find(r => r.questionId === 'sintomasCovid');
    const selectedSymptoms = Array.isArray(symptomsResp?.value) ? symptomsResp.value : [];

    // General presence of symptoms (Si if list is not empty and doesn't only contain 'Ninguno')
    const hasSymptoms = selectedSymptoms.length > 0 && !selectedSymptoms.includes('Ninguno');
    tags.covid_sintomas_presenta = hasSymptoms ? 'Sí' : 'No';
    tags.covid_sintomas_presenta_si = hasSymptoms ? 'X' : '';
    tags.covid_sintomas_presenta_no = !hasSymptoms ? 'X' : '';

    // Individual symptoms for checkboxes
    const symptomMap = {
        tos: 'Tos',
        fiebre: 'Fiebre',
        anosmia: 'Ausencia de gusto/olfato',
        cefalea: 'Cefalea',
        ninguno: 'Ninguno'
    };

    Object.entries(symptomMap).forEach(([key, label]) => {
        const present = selectedSymptoms.includes(label);
        tags[`covid_${key}`] = present ? 'Sí' : 'No';
        tags[`covid_${key}_si`] = present ? 'X' : '';
        tags[`covid_${key}_no`] = !present ? 'X' : '';
    });

    // 3. IAAS Specific Mappings
    const booleanIaasQuestions = {
        precaucionesAdicionales: 'iaas_precauciones_adicionales',
        ambienteProtegido: 'iaas_ambiente_protegido',
        estudioPortacion: 'iaas_estudio_portacion',
        estudioMicrobiologico: 'iaas_estudio_microbiologico',
        carbapenemasas: 'iaas_carbapenemasas',
        enterococcusVR: 'iaas_enterococcus_vr'
    };

    Object.entries(booleanIaasQuestions).forEach(([qid, tagBase]) => {
        const resp = responses.responses.find(r => r.questionId === qid);
        const val = !!resp?.value;
        tags[tagBase] = val ? 'Sí' : 'No';
        tags[`${tagBase}_si`] = val ? 'X' : '';
        tags[`${tagBase}_no`] = !val ? 'X' : '';
    });

    const microResult = responses.responses.find(r => r.questionId === 'resultadosMicrobiologicos');
    if (microResult) {
        tags.iaas_resultados_microbiologicos = microResult.value || '';
    }

    const precaucionesResp = responses.responses.find(r => r.questionId === 'tipoPrecauciones');
    const selectedPrecauciones = Array.isArray(precaucionesResp?.value) ? precaucionesResp.value : [];

    const precauciones = {
        contacto: 'Contacto',
        gotas: 'Gotas',
        aereo: 'Aéreo'
    };

    Object.entries(precauciones).forEach(([key, label]) => {
        const present = selectedPrecauciones.includes(label);
        tags[`iaas_precaucion_${key}`] = present ? 'Sí' : 'No';
        tags[`iaas_precaucion_${key}_si`] = present ? 'X' : '';
        tags[`iaas_precaucion_${key}_no`] = !present ? 'X' : '';
    });

    const unidadesResp = responses.responses.find(r => r.questionId === 'unidadesHospitalizacion');
    const selectedUnidades = Array.isArray(unidadesResp?.value) ? unidadesResp.value : [];

    // Check for 'Cama básica'
    const isBasica = selectedUnidades.includes('Cama básica');
    tags.iaas_unidad_basica = isBasica ? 'X' : '';
    tags.iaas_unidad_basica_si = isBasica ? 'X' : '';
    tags.iaas_unidad_basica_no = !isBasica ? 'X' : '';

    // Check for UPC (Either 'UPC (UCI/UTI)' or legacy 'UCI'/'Intermedio' for compatibility)
    const isUPC = selectedUnidades.some(u =>
        u === 'UPC (UCI/UTI)' || u === 'UCI' || u === 'Intermedio'
    );
    tags.iaas_unidad_upc = isUPC ? 'X' : '';
    tags.iaas_unidad_upc_si = isUPC ? 'X' : '';
    tags.iaas_unidad_upc_no = !isUPC ? 'X' : '';

    // 4. Admission Date Alias for IAAS
    tags.iaas_fecha_ingreso = tags.paciente_fecha_ingreso;

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
    } catch (_e) {
        return 'N/A';
    }
};

/**
 * Downloads a template from Firebase Storage.
 */
export const fetchTemplateFromStorage = async (templateName: string): Promise<Blob | null> => {
    try {
        const templateRef = ref(storage, `templates/${templateName}`);
        // console.debug(`[TemplateService] Fetching template: templates/${templateName}`);
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
        delimiters: {
            start: '{{',
            end: '}}'
        }
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
    // Dynamic import
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
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
