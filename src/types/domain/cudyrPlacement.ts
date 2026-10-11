/** Source evidence captured with CUDYR, distinct from the HHR bed at archive time. */
export interface CudyrSourcePlacement {
  clinicalEpisodeId: string;
  sourceMappingId: string;
  sourceBedId: string;
  sourceBedLabel: string;
  sourceDepartmentId: string;
  sourceDepartmentLabel: string;
  sourceVersion: string;
  /** Original source strings. A sentinel end date does not close an interval. */
  sourceStartAt: string;
  sourceEndAt: string;
  currentAssignment: boolean;
  isDeleted: boolean;
  bedId: string;
  modality: 'hospitalizacion' | 'cuna' | 'cma' | 'desconocida';
}
