import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, WidthType } from 'docx';
// import ExcelJS from 'exceljs'; // Removed static import
import {
    HospitalConfig,
    QuestionnaireResponse,
    TransferPatientData,
    GeneratedDocument
} from '@/types/transferDocuments';
import {
    formatDate,
    getCurrentDate,
    createOfficialHeader,
    createTableRow,
    calculateAge,
    getResponse
} from './documentGeneratorUtils';

/**
 * Generate "Tapa de Traslado" DOCX Fallback
 */
export const generateTapaTraslado = async (
    patientData: TransferPatientData,
    hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
            children: [
                createOfficialHeader('TRASLADO DE PACIENTE'),
                new Paragraph({
                    children: [new TextRun({ text: `HOSPITAL DE DESTINO: ${hospital.name.toUpperCase()}`, bold: true, size: 28 })],
                    alignment: 'center',
                    spacing: { after: 400 }
                }),
                new Paragraph({
                    heading: HeadingLevel.HEADING_1,
                    children: [new TextRun({ text: '1. IDENTIFICACIÓN DEL PACIENTE', bold: true, size: 24 })],
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
                    children: [new TextRun({ text: `\nFecha de Emisión: ${getCurrentDate()}`, italics: true, size: 18 })],
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
 * Generate "Encuesta COVID" DOCX Fallback
 */
export const generateEncuestaCovid = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    _hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
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
                new Paragraph({ children: [new TextRun({ text: '1. ¿Ha estado en contacto con persona COVID+ en últimas 48hrs?', bold: true })] }),
                new Paragraph({ children: [new TextRun({ text: `RESPUESTA: ${getResponse(responses, 'contactoCovid')}`, color: '2563EB' })], spacing: { after: 200 } }),
                new Paragraph({ children: [new TextRun({ text: '2. ¿Presenta alguno de estos síntomas (Fiebre, tos, mialgia, disnea)?', bold: true })] }),
                new Paragraph({ children: [new TextRun({ text: `RESPUESTA: ${getResponse(responses, 'sintomasCovid') || 'NINGUNO'}`, color: '2563EB' })], spacing: { after: 400 } }),
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
 * Generate "Solicitud Cama HDS" DOCX Fallback
 */
export const generateSolicitudCamaHDS = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    _hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
            children: [
                createOfficialHeader('SOLICITUD DE CAMA HOSPITALARIA'),
                new Paragraph({
                    children: [new TextRun({ text: 'Santiago, ', size: 22 }), new TextRun({ text: getCurrentDate(), underline: {}, size: 22 })],
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
                        createTableRow('Previsión', 'FONASA / Isapre'),
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
                    children: [new TextRun({ text: '\n\n\n__________________________', bold: true }), new TextRun({ text: '\nFirma y Timbre Médico Solicitante', size: 18 })],
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
 * Generate "Solicitud Ambulancia" DOCX Fallback
 */
export const generateSolicitudAmbulancia = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    _hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const doc = new Document({
        sections: [{
            properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
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
                ...processConditionSection(responses),
                ...processItinerarySection(responses),
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

const processConditionSection = (responses: QuestionnaireResponse) => {
    return [
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
        })
    ];
};

const processItinerarySection = (responses: QuestionnaireResponse) => {
    return [
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
        })
    ];
};

/**
 * Generate "Formulario IAAS" XLSX Fallback
 */
export const generateFormularioIAAS = async (
    patientData: TransferPatientData,
    responses: QuestionnaireResponse,
    _hospital: HospitalConfig
): Promise<GeneratedDocument> => {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Formulario IAAS');

    // Simple layout for IAAS
    sheet.getColumn('A').width = 40;
    sheet.getColumn('B').width = 50;

    sheet.mergeCells('A1:B1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'HOSPITAL DEL SALVADOR - FORMULARIO IAAS';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    titleCell.alignment = { horizontal: 'center' };

    const dataRows = [
        ['Nombre:', patientData.patientName],
        ['Rut:', patientData.rut],
        ['Precauciones:', getResponse(responses, 'tipoPrecauciones') || 'Estándar'],
        ['Estudio Micro:', getResponse(responses, 'estudioMicrobiologico')],
        ['Resultados:', getResponse(responses, 'resultadosMicrobiologicos') || 'Pendientes'],
        ['Fecha Emisión:', getCurrentDate()]
    ];

    dataRows.forEach((row, _i) => {
        const r = sheet.addRow(row);
        r.getCell(1).font = { bold: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return {
        templateId: 'formulario-iaas',
        fileName: `Formulario_IAAS_${patientData.patientName.replace(/\s+/g, '_')}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        generatedAt: new Date().toISOString()
    };
};
