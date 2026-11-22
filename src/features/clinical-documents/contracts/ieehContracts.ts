/** MINSAL discharge condition codes (1-7). */
export type IeehDischargeConditionCode = '1' | '2' | '3' | '4' | '5' | '6' | '7';

/** Binary yes/no flag used for intervention and procedure fields. */
export type IeehBinaryFlag = '1' | '2';

/**
 * Draft of the IEEH (Informe Estadístico de Egreso Hospitalario)
 * captured while writing an epicrisis. The discharge time is left blank
 * because the patient hasn't physically left yet — that step belongs
 * to the nurse at the census.
 */
export interface ClinicalDocumentIeehDraft {
  /** ICD-10 / CIE-10 code (e.g. "E11.5"). */
  cie10Code: string;
  /** Official CIE-10 description in Spanish. */
  cie10Description: string;
  /** Free-text principal diagnosis. */
  diagnosticoPrincipal: string;
  /** Discharge condition code per MINSAL (1=Domicilio ... 7=Hosp. domiciliaria). */
  condicionEgreso: IeehDischargeConditionCode;
  /** Surgical intervention flag: '1' = Sí, '2' = No. */
  intervencionQuirurgica: IeehBinaryFlag;
  /** Surgical intervention description (when applicable). */
  intervencionQuirurgDescrip?: string;
  /** FONASA Anexo 9 code for the surgical intervention (e.g. "1103049"). */
  intervencionCodigo?: string;
  /** Procedure flag: '1' = Sí, '2' = No. */
  procedimiento: IeehBinaryFlag;
  /** Procedure description (when applicable). */
  procedimientoDescrip?: string;
  /** FONASA Anexo 14 code for the procedure (e.g. "0403001"). */
  procedimientoCodigo?: string;
  /** IEEH-only treating doctor full name override. Does not change epicrisis authorship. */
  tratanteNombreCompleto?: string;
  /** IEEH-only treating doctor specialty override. Does not change epicrisis specialty. */
  tratanteEspecialidad?: string;
  /** Treating doctor RUT (optional, for PDF field #49). */
  tratanteRut?: string;
}
