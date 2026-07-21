/**
 * Export/CSV Constants
 * Headers and configuration for data export
 */

export const CSV_HEADERS = [
    'ID Cama',
    'Nombre Cama',
    'Ubicación',
    'Tipo Cama',
    'Mobiliario',
    'Cuna RN Sano',
    'Bloqueada',
    'Motivo Bloqueo',
    'Paciente',
    'Tipo Doc',
    'RUT/Pasaporte',
    'F. Nacimiento',
    'Edad',
    'Sexo',
    'Previsión',
    'Origen Ingreso',
    'Detalle Origen',
    'Cond. Permanencia',
    'Rapanui',
    'Diagnóstico',
    'Comentarios Dx',
    'Especialidad',
    'Estado',
    'F. Ingreso',
    'Brazalete',
    'Dispositivos',
    'CUP F.Instalación',
    'CUP F.Retiro',
    'CVC F.Instalación',
    'CVC F.Retiro',
    'VMI F.Inicio',
    'VMI F.Término',
    'Comp. Qx',
    'UPC',
    'Nota Entrega',
    'Enfermero/a'
];

export const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
] as const;

export type MonthName = typeof MONTH_NAMES[number];
