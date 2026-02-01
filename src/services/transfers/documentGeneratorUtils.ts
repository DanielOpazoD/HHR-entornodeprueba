import { Paragraph, TextRun, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { QuestionnaireResponse } from '@/types/transferDocuments';

/**
 * Get response value by question ID
 */
export const getResponse = (responses: QuestionnaireResponse, questionId: string): string => {
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
export const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CL');
};

/**
 * Format current date
 */
export const getCurrentDate = (): string => {
    return new Date().toLocaleDateString('es-CL');
};

/**
 * Helper to calculate age if birthDate is provided
 */
export const calculateAge = (birthDate?: string): number | string => {
    if (!birthDate) return 'No especificada';
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
};

/**
 * Helper to create an official header for DOCX
 */
export const createOfficialHeader = (title: string): Paragraph => {
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
};

/**
 * Helper to create a standard document table row
 */
export const createTableRow = (label: string, value: string): TableRow => {
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
};
