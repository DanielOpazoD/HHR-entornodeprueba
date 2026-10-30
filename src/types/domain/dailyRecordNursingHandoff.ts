export interface DailyRecordHandoffSharedChecklist {
  crashCartReviewDate?: string;
  crashCartCode?: string;
}

export interface DailyRecordHandoffDayChecklist {
  [key: string]: boolean | undefined;
  escalaBraden?: boolean;
  escalaRiesgoCaidas?: boolean;
  escalaRiesgoLPP?: boolean;
}

export interface DailyRecordHandoffNightChecklist {
  [key: string]: boolean | string | undefined;
  estadistica?: boolean;
  categorizacionCudyr?: boolean;
  encuestaUTI?: boolean;
  encuestaMedias?: boolean;
  conteoMedicamento?: boolean;
  conteoNoControlados?: boolean;
  conteoNoControladosProximaFecha?: string;
}
