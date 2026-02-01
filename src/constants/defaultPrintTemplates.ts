import { PrintTemplateConfig } from '@/types/printTemplates';

export const DEFAULT_TEMPLATE_SOLICITUD: PrintTemplateConfig = {
    id: 'solicitud_imagenologia',
    name: 'Solicitud de Imagenología',
    backgroundUrl: '/images/forms/solicitud_imagenologia.png',
    pageWidth: 210,
    pageHeight: 297,
    fields: [
        { id: 'name', label: 'Nombre', type: 'automated', dataSource: 'patient.name', x: 45, y: 35, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'rut', label: 'RUT', type: 'automated', dataSource: 'patient.rut', x: 155, y: 35, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'age', label: 'Edad', type: 'automated', dataSource: 'patient.age', x: 45, y: 41, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'sex', label: 'Sexo', type: 'automated', dataSource: 'patient.sex', x: 155, y: 41, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'bed', label: 'Cama', type: 'automated', dataSource: 'bed.name', x: 45, y: 47, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'date', label: 'Fecha', type: 'automated', dataSource: 'today.date', x: 100, y: 47, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'prev', label: 'Previsión', type: 'automated', dataSource: 'prevision', x: 155, y: 47, fontSize: 11, fontWeight: 'bold', alignment: 'left' },
        { id: 'diag', label: 'Diagnóstico', type: 'automated', dataSource: 'survey.diagnosis', x: 45, y: 55, width: 140, fontSize: 10, fontWeight: 'bold', alignment: 'left' },
        { id: 'exams', label: 'Exámenes', type: 'automated', dataSource: 'selectedExams', x: 25, y: 80, width: 160, fontSize: 10, fontWeight: 'bold', alignment: 'left' }
    ]
};

export const DEFAULT_TEMPLATE_ENCUESTA: PrintTemplateConfig = {
    id: 'encuesta_contraste_tac',
    name: 'Encuesta Contraste TAC',
    backgroundUrl: '/images/forms/encuesta_contraste_tac.png',
    pageWidth: 210,
    pageHeight: 297,
    fields: [
        { id: 'name', label: 'Nombre', type: 'automated', dataSource: 'patient.name', x: 40, y: 21, fontSize: 10, fontWeight: 'bold', alignment: 'left' },
        { id: 'rut', label: 'RUT', type: 'automated', dataSource: 'patient.rut', x: 142, y: 21, fontSize: 10, fontWeight: 'bold', alignment: 'left' },
        { id: 'age', label: 'Edad', type: 'automated', dataSource: 'patient.age', x: 35, y: 25, fontSize: 10, fontWeight: 'bold', alignment: 'left' },
        { id: 'weight', label: 'Peso', type: 'automated', dataSource: 'survey.weight', x: 105, y: 25, fontSize: 10, fontWeight: 'bold', alignment: 'left' },
        { id: 'phone', label: 'Teléfono', type: 'automated', dataSource: 'survey.phone', x: 140, y: 25, fontSize: 10, fontWeight: 'bold', alignment: 'left' },
        { id: 'doctor', label: 'Médico', type: 'automated', dataSource: 'survey.doctor', x: 40, y: 29, fontSize: 10, fontWeight: 'bold', alignment: 'left' }
    ]
};
