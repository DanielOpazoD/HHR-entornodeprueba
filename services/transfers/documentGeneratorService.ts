/**
 * Document Generator Service
 * Generates DOCX, XLSX, and PDF documents for patient transfers
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import ExcelJS from 'exceljs';
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
import { saveAs } from 'file-saver';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get response value by question ID
 */
const getResponse = (responses: QuestionnaireResponse, questionId: string): string => {
    const response = responses.responses.find(r => r.questionId === questionId);
    if (!response || response.value === null || response.value === undefined) return '';

    if (typeof response.value === 'boolean') {
        return response.value ? 'SÍ' : 'NO';
    }
    if (Array.isArray(response.value)) {
        return response.value.join(', ');
    }
    return String(response.value);
};

/**
 * Format date for display
 */
const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CL');
};

/**
 * Format current date
 */
const getCurrentDate = (): string => {
    return new Date().toLocaleDateString('es-CL');
};

// ============================================================================
// Document Generators
// ============================================================================

/**
 * Generate "Tapa de Traslado" DOCX
 */
export const generateTapaTraslado = async (
    patientData: TransferPatientData,
    hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 720, right: 720, bottom: 720, left: 720 }
                }
            },
            children: [
                createOfficialHeader('TRASLADO DE PACIENTE'),

                new Paragraph({
                    children: [
                        new TextRun({
                            text: `HOSPITAL DE DESTINO: ${hospital.name.toUpperCase()}`,
                            bold: true,
                            size: 28
                        })
                    ],
                    alignment: 'center',
                    spacing: { after: 400 }
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_1,
                    children: [
                        new TextRun({
                            text: '1. IDENTIFICACIÓN DEL PACIENTE',
                            bold: true,
                            size: 24
                        })
                    ],
                    spacing: { before: 400, after: 200 }
                }),

                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('Nombre Completo', patientData.patientName),
                        createTableRow('RUT / RUN', patientData.rut),
                        createTableRow('Fecha Nacimiento', formatDate(patientData.birthDate)),
                        createTableRow('Diagnóstico Ingreso', patientData.diagnosis || '-'),
                        createTableRow('Servicio / Cama Origen', `${patientData.originHospital} - ${patientData.bedName}`),
                    ]
                }),

                new Paragraph({
                    children: [
                        new TextRun({
                            text: `\nFecha de Emisión: ${getCurrentDate()}`,
                            italics: true,
                            size: 18
                        })
                    ],
                    alignment: 'right',
                    spacing: { before: 600 }
                })
            ]
        }]
    });

    const blob = await Packer.toBlob(doc);

    return {
        templateId: 'tapa-traslado',
        fileName: `Tapa_Traslado_${patientData.patientName.replace(/\s+/g, '_')}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob,
        generatedAt: new Date().toISOString()
    };
};

/**
 * Generate "Encuesta COVID" DOCX
 */
export const generateEncuestaCovid = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 720, right: 720, bottom: 720, left: 720 }
                }
            },
            children: [
                createOfficialHeader('ENCUESTA EPIDEMIOLÓGICA COVID-19'),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: 'I. IDENTIFICACIÓN', bold: true, size: 24 })],
                    spacing: { after: 200 }
                }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('NOMBRE COMPLETO', patientData.patientName),
                        createTableRow('RUN / PASAPORTE', patientData.rut),
                    ]
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: 'II. ANTECEDENTES EPIDEMIOLÓGICOS', bold: true, size: 24 })],
                    spacing: { before: 400, after: 200 }
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: '1. ¿Ha estado en contacto con persona COVID+ en últimas 48hrs?',
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `RESPUESTA: ${getResponse(responses, 'contactoCovid')}`,
                            color: '2563EB'
                        })
                    ],
                    spacing: { after: 200 }
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: '2. ¿Presenta alguno de estos síntomas (Fiebre, tos, mialgia, disnea)?',
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `RESPUESTA: ${getResponse(responses, 'sintomasCovid') || 'NINGUNO'}`,
                            color: '2563EB'
                        })
                    ],
                    spacing: { after: 400 }
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: 'III. RESPONSABLE DE LA ENCUESTA', bold: true, size: 24 })],
                    spacing: { after: 200 }
                }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('NOMBRE RESPONSABLE', getResponse(responses, 'responsableEncuesta')),
                        createTableRow('CARGO / FUNCIÓN', getResponse(responses, 'cargoResponsable')),
                        createTableRow('FECHA', getCurrentDate()),
                    ]
                })
            ]
        }]
    });

    const blob = await Packer.toBlob(doc);

    return {
        templateId: 'encuesta-covid',
        fileName: `Encuesta_COVID_${patientData.patientName.replace(/\s+/g, '_')}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob,
        generatedAt: new Date().toISOString()
    };
};

/**
 * Generate "Solicitud Cama HDS" DOCX
 */
export const generateSolicitudCamaHDS = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 720, right: 720, bottom: 720, left: 720 }
                }
            },
            children: [
                createOfficialHeader('SOLICITUD DE CAMA HOSPITALARIA'),

                new Paragraph({
                    children: [
                        new TextRun({ text: 'Santiago, ', size: 22 }),
                        new TextRun({ text: getCurrentDate(), underline: {}, size: 22 })
                    ],
                    alignment: 'right',
                    spacing: { after: 300 }
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: '1. ANTECEDENTES DEL PACIENTE', bold: true, size: 24 })],
                    spacing: { after: 200 }
                }),

                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('Nombre Completo', patientData.patientName),
                        createTableRow('RUT / Cédula', patientData.rut),
                        createTableRow('Edad', String(calculateAge(patientData.birthDate))),
                        createTableRow('Previsión', 'FONASA / Isapre'), // Generic
                        createTableRow('Diagnóstico', patientData.diagnosis || '-'),
                        createTableRow('Motivo Transferencia', getResponse(responses, 'observaciones') || 'Continuidad de cuidados'),
                    ]
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: '2. ANTECEDENTES DE ORIGEN', bold: true, size: 24 })],
                    spacing: { before: 400, after: 200 }
                }),

                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('Centro Derivador', patientData.originHospital),
                        createTableRow('Médico Solicitante', getResponse(responses, 'medicoTratante')),
                        createTableRow('Especialidad Requerida', 'Medicina Interna / Cirugía'),
                    ]
                }),

                new Paragraph({
                    children: [
                        new TextRun({ text: '\n\n\n__________________________', bold: true }),
                        new TextRun({ text: '\nFirma y Timbre Médico Solicitante', size: 18 })
                    ],
                    alignment: 'center',
                    spacing: { before: 800 }
                })
            ]
        }]
    });

    const blob = await Packer.toBlob(doc);

    return {
        templateId: 'solicitud-cama-hds',
        fileName: `Solicitud_Cama_HDS_${patientData.patientName.replace(/\s+/g, '_')}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob,
        generatedAt: new Date().toISOString()
    };
};

/**
 * Helper to create an official header for DOCX
 */
function createOfficialHeader(title: string): Paragraph {
    return new Paragraph({
        children: [
            new TextRun({
                text: 'SERVICIO DE SALUD METROPOLITANO ORIENTE\n',
                bold: true,
                size: 20
            }),
            new TextRun({
                text: 'HOSPITAL DEL SALVADOR\n',
                bold: true,
                size: 20
            }),
            new TextRun({
                text: 'UNIDAD DE GESTIÓN CENTRALIZADA DE CAMAS (UGCC)\n',
                size: 16
            }),
            new TextRun({
                text: `\n${title}\n`,
                bold: true,
                size: 32,
                color: '2563EB'
            })
        ],
        alignment: 'center',
        spacing: { after: 400 }
    });
}

/**
 * Helper to calculate age if birthDate is provided
 */
function calculateAge(birthDate?: string): number | string {
    if (!birthDate) return 'No especificada';
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

/**
 * Generate "Solicitud Ambulancia" DOCX
 */
export const generateSolicitudAmbulancia = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 720, right: 720, bottom: 720, left: 720 }
                }
            },
            children: [
                createOfficialHeader('SOLICITUD DE TRASLADO / MOVILIZACIÓN'),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: '1. IDENTIFICACIÓN', bold: true, size: 24 })],
                    spacing: { after: 200 }
                }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('Nombre Paciente', patientData.patientName),
                        createTableRow('Rut', patientData.rut),
                        createTableRow('Diagnóstico', patientData.diagnosis || '-'),
                        createTableRow('Médico Tratante', getResponse(responses, 'medicoTratante')),
                    ]
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: '2. CONDICIONES CLÍNICAS', bold: true, size: 24 })],
                    spacing: { before: 400, after: 200 }
                }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('Posición Traslado', getResponse(responses, 'posicionTraslado')),
                        createTableRow('Acompañante HHR', getResponse(responses, 'requiereAcompanante')),
                        createTableRow('Oxígeno / Soporte', getResponse(responses, 'requiereOxigeno')),
                        createTableRow('Observaciones', getResponse(responses, 'otrasCondiciones') || '-'),
                    ]
                }),

                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    children: [new TextRun({ text: '3. ITINERARIO DE TRASLADO', bold: true, size: 24 })],
                    spacing: { before: 400, after: 200 }
                }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        createTableRow('Línea Aérea / Empresa', getResponse(responses, 'lineaAerea')),
                        createTableRow('Número de Vuelo / Móvil', getResponse(responses, 'numeroVuelo')),
                        createTableRow('ETD (Salida)', getResponse(responses, 'horaDespegue')),
                        createTableRow('ETA (Llegada)', getResponse(responses, 'horaArribo')),
                    ]
                }),

                new Paragraph({
                    children: [
                        new TextRun({ text: `\n\nEnfermera/o Responsable: ${getResponse(responses, 'enfermeraResponsable')}`, bold: true }),
                        new TextRun({ text: `\n${patientData.originHospital}` })
                    ],
                    spacing: { before: 600 }
                })
            ]
        }]
    });

    const blob = await Packer.toBlob(doc);

    return {
        templateId: 'solicitud-ambulancia',
        fileName: `Solicitud_Ambulancia_${patientData.patientName.replace(/\s+/g, '_')}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob,
        generatedAt: new Date().toISOString()
    };
};

/**
 * Generate "Formulario IAAS" XLSX
 */
export const generateFormularioIAAS = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Formulario IAAS');

    // Title
    sheet.mergeCells('A1:B1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'HOSPITAL DEL SALVADOR - FORMULARIO IAAS';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    // Patient data header
    sheet.mergeCells('A2:B2');
    const patientHeader = sheet.getCell('A2');
    patientHeader.value = 'IDENTIFICACIÓN DEL PACIENTE';
    patientHeader.font = { bold: true, size: 11 };
    patientHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    sheet.getRow(2).height = 20;

    // Patient data rows
    const patientRows = [
        ['Nombre:', patientData.patientName],
        ['Rut:', patientData.rut],
        ['Fecha Ingreso:', formatDate(patientData.admissionDate)],
        ['Fecha Emisión:', getCurrentDate()]
    ];

    patientRows.forEach((row, i) => {
        const r = sheet.getRow(i + 3);
        r.values = row;
        r.getCell(1).font = { bold: true };
    });

    // IAAS questions header
    sheet.mergeCells('A8:B8');
    const iaasHeader = sheet.getCell('A8');
    iaasHeader.value = 'ANTECEDENTES IAAS Y MICROBIOLÓGICOS';
    iaasHeader.font = { bold: true, size: 11 };
    iaasHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

    // IAAS questions
    const questions = [
        ['¿Precauciones adicionales?', getResponse(responses, 'precaucionesAdicionales')],
        ['Tipo de precauciones:', getResponse(responses, 'tipoPrecauciones') || '-'],
        ['¿Ambiente protegido?', getResponse(responses, 'ambienteProtegido')],
        ['¿Estudio microbiológico?', getResponse(responses, 'estudioMicrobiologico')],
        ['Resultados:', getResponse(responses, 'resultadosMicrobiologicos') || '-'],
        ['¿Carbapenemasas?', getResponse(responses, 'carbapenemasas')],
        ['¿Enterococcus VR?', getResponse(responses, 'enterococcusVR')],
        ['¿Estudio de portación?', getResponse(responses, 'estudioPortacion')],
        ['Unidades hospitalizadas:', getResponse(responses, 'unidadesHospitalizacion')]
    ];

    questions.forEach((q, i) => {
        const r = sheet.getRow(i + 9);
        r.values = q;
        r.getCell(1).font = { bold: true };
        r.getCell(2).font = { color: { argb: 'FF1E40AF' } };
    });

    // Derivating center contact info
    const contactRowIndex = 9 + questions.length + 1;
    sheet.mergeCells(`A${contactRowIndex}:B${contactRowIndex}`);
    const contactHeader = sheet.getCell(`A${contactRowIndex}`);
    contactHeader.value = 'DATOS DEL CENTRO DERIVADOR';
    contactHeader.font = { bold: true, size: 11 };
    contactHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

    sheet.getCell(`A${contactRowIndex + 1}`).value = 'Centro:';
    sheet.getCell(`B${contactRowIndex + 1}`).value = 'Hospital Hanga Roa';
    sheet.getCell(`A${contactRowIndex + 2}`).value = 'Teléfono / Anexo:';
    sheet.getCell(`B${contactRowIndex + 2}`).value = '+56 32 210xxxx';
    sheet.getCell(`A${contactRowIndex + 3}`).value = 'Email Contacto:';
    sheet.getCell(`B${contactRowIndex + 3}`).value = 'traslados@hospitalhangaroa.cl';

    [1, 2, 3].forEach(offset => {
        sheet.getCell(`A${contactRowIndex + offset}`).font = { bold: true };
    });

    // Apply borders to all data cells
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 0 && rowNumber <= contactRowIndex + 3) {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        }
    });

    // Style columns
    sheet.getColumn('A').width = 40;
    sheet.getColumn('B').width = 50;
    sheet.getColumn('A').font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    return {
        templateId: 'formulario-iaas',
        fileName: `Formulario_IAAS_${patientData.patientName.replace(/\s+/g, '_')}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        blob,
        generatedAt: new Date().toISOString()
    };
};

// ============================================================================
// Table Helper
// ============================================================================

function createTableRow(label: string, value: string): TableRow {
    return new TableRow({
        children: [
            new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                children: [
                    new Paragraph({
                        children: [
                            new TextRun({ text: label, bold: true })
                        ]
                    })
                ],
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 1 },
                    bottom: { style: BorderStyle.SINGLE, size: 1 },
                    left: { style: BorderStyle.SINGLE, size: 1 },
                    right: { style: BorderStyle.SINGLE, size: 1 },
                }
            }),
            new TableCell({
                width: { size: 70, type: WidthType.PERCENTAGE },
                children: [
                    new Paragraph({
                        children: [
                            new TextRun({ text: value || '-' })
                        ]
                    })
                ],
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 1 },
                    bottom: { style: BorderStyle.SINGLE, size: 1 },
                    left: { style: BorderStyle.SINGLE, size: 1 },
                    right: { style: BorderStyle.SINGLE, size: 1 },
                }
            })
        ]
    });
}

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
            const templateFileName = `${template.id}.${template.format}`;
            const templateBlob = await fetchTemplateFromStorage(templateFileName);

            if (templateBlob) {
                console.log(`[DocumentGenerator] Using original template for ${template.id}`);
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
                console.log(`[DocumentGenerator] Template ${template.id} not found in Storage, using code fallback`);
                switch (template.id) {
                    case 'tapa-traslado':
                        doc = await generateTapaTraslado(patientData, hospital);
                        break;
                    case 'encuesta-covid':
                        doc = await generateEncuestaCovid(patientData, responses, hospital);
                        break;
                    case 'solicitud-cama-hds':
                        doc = await generateSolicitudCamaHDS(patientData, responses, hospital);
                        break;
                    case 'solicitud-ambulancia':
                        doc = await generateSolicitudAmbulancia(patientData, responses, hospital);
                        break;
                    case 'formulario-iaas':
                        doc = await generateFormularioIAAS(patientData, responses, hospital);
                        break;
                    default:
                        console.warn(`Unknown template: ${template.id}`);
                        continue;
                }
            }

            if (doc) documents.push(doc);
        } catch (error) {
            console.error(`Error generating ${template.id}:`, error);
        }
    }

    return documents;
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
 * Download all documents as a ZIP file
 */
export const downloadAllDocuments = async (documents: GeneratedDocument[]): Promise<void> => {
    // For simplicity, download each file individually
    // In a future iteration, could bundle into a ZIP
    for (const doc of documents) {
        downloadDocument(doc);
        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 300));
    }
};
