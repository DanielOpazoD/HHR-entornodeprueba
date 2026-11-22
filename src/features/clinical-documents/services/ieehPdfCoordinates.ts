export const FIELD_COORDS = {
  // ── #4: NOMBRE LEGAL DEL PACIENTE ──
  primerApellido: { x: 50.84, y: 826.55, maxWidth: 137.82 },
  segundoApellido: { x: 237.79, y: 826.55, maxWidth: 118.68 },
  nombres: { x: 441.63, y: 826.55, maxWidth: 110.58 },

  // ── #52: NOMBRE SOCIAL ──
  nombreSocial: { x: 114.23, y: 804.28, maxWidth: 93.63 },

  // ── #5: TIPO DE IDENTIFICACIÓN + RUN ──
  tipoIdentificacion: { x: 111.31, y: 782.21, maxWidth: 11.03 },
  runDigits: { x: 56.99, y: 759.19, maxWidth: 87.72 },

  // ── #6: SEXO REGISTRAL ──
  sexoRegistral: { x: 305.82, y: 781.46, maxWidth: 11.76 },

  // ── #7: FECHA DE NACIMIENTO ──
  nacDia: { x: 450.35, y: 800.54, maxWidth: 22.86 },
  nacMes: { x: 489.42, y: 800.54, maxWidth: 21.4 },
  nacAnio: { x: 524.05, y: 800.54, maxWidth: 50.84 },

  // ── #8: EDAD ──
  edad: { x: 79, y: 722.06, maxWidth: 35.36 },
  edadUnidad: { x: 181.04, y: 720.09, maxWidth: 10.67 },

  // ── #10: PUEBLO INDÍGENA ──
  puebloIndigena: { x: 523.86, y: 750.12, maxWidth: 22.68 },

  // ── #18: PREVISIÓN ──
  prevision: { x: 54.37, y: 516.73, maxWidth: 10.67 },

  // ── #22: PROCEDENCIA ──
  procedencia: { x: 225.78, y: 471.36, maxWidth: 10.67 },

  // ── #24: INGRESO (hora, fecha) ──
  ingresoHora: { x: 101.85, y: 426.73, maxWidth: 22.68 },
  ingresoMin: { x: 135.87, y: 426.73, maxWidth: 21.33 },
  ingresoDia: { x: 181.22, y: 426.73, maxWidth: 22.68 },
  ingresoMes: { x: 215.23, y: 426.73, maxWidth: 23.35 },
  ingresoAnio: { x: 249.24, y: 426.73, maxWidth: 22.01 },

  // ── #29: EGRESO (hora, fecha) ──
  egresoHora: { x: 92.17, y: 339.45, maxWidth: 21.33 },
  egresoMin: { x: 124.85, y: 339.45, maxWidth: 23.35 },
  egresoDia: { x: 169.53, y: 339.45, maxWidth: 22.68 },
  egresoMes: { x: 204.88, y: 339.45, maxWidth: 23.35 },
  egresoAnio: { x: 238.9, y: 339.45, maxWidth: 24.02 },

  // ── #30: DÍAS DE ESTADA ──
  diasEstada: { x: 115.58, y: 327.24, maxWidth: 25.53 },

  // ── #31: CONDICIÓN AL EGRESO ──
  condicionEgreso: { x: 250.41, y: 326.75, maxWidth: 11.34 },
  destinoAlAlta: { x: 280.77, y: 343.4, maxWidth: 12.01 },

  // ── #33: DIAGNÓSTICO PRINCIPAL ──
  diagnosticoPrincipal: { x: 167.08, y: 282.54, maxWidth: 341.98 },
  codigoCIE10: { x: 529.23, y: 281.38, maxWidth: 46.69 },

  // ── #39: INTERVENCIÓN QUIRÚRGICA ──
  intervencionQuirurgica: { x: 150.08, y: 158.67, maxWidth: 11.19 },
  intervencionQuirurgDescrip: { x: 186.41, y: 148.64, maxWidth: 178.06 },
  intervencionCodigo: { x: 380, y: 158.67, maxWidth: 80 },

  // ── #42: PROCEDIMIENTO ──
  procedimiento: { x: 59.68, y: 100.83, maxWidth: 13.17 },
  procedimientoDescrip: { x: 234.27, y: 116.67, maxWidth: 128.83 },
  procedimientoCodigo: { x: 380, y: 100.83, maxWidth: 80 },

  // ── #49: MÉDICO TRATANTE ──
  tratanteApellido1: { x: 29.99, y: 57.34, maxWidth: 104.05 },
  tratanteApellido2: { x: 142.7, y: 56.69, maxWidth: 102.04 },
  tratanteNombre: { x: 260.77, y: 56.59, maxWidth: 164.04 },
  tratanteRut: { x: 58.7, y: 31.99, maxWidth: 92.72 },

  // ── #50: ESPECIALIDAD MÉDICO ──
  especialidadMedico: { x: 325.78, y: 78.59, maxWidth: 154.89 },
} as const;

export const mapInsurance = (insurance: string | undefined): string => {
  if (!insurance) return '';
  const map: Record<string, string> = {
    FONASA: '1',
    Fonasa: '1',
    ISAPRE: '2',
    Isapre: '2',
    CAPREDENA: '3',
    Capredena: '3',
    DIPRECA: '4',
    Dipreca: '4',
    SISA: '5',
    Particular: '96',
    'Sin Previsión': '96',
    Desconocido: '99',
  };
  return map[insurance] || '';
};

export const mapSex = (sex: string | undefined): string => {
  if (!sex) return '';
  const map: Record<string, string> = {
    Femenino: 'F',
    Masculino: 'M',
    Indeterminado: 'I',
  };
  return map[sex] || '';
};

export const mapProcedencia = (origin: string | undefined): string => {
  if (!origin) return '';
  const map: Record<string, string> = {
    Urgencias: '1',
    Urgencia: '1',
    'Otra Procedencia': '2',
    'Atención especialidades': '3',
    'Cirugía Mayor Ambulatoria': '5',
  };
  return map[origin] || '';
};
