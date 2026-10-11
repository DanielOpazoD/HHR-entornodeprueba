/** Human-reviewed placement of one RN episode; never a manually entered CUDYR. */
export interface NeonatalPlacementDecision {
  clinicalEpisodeId: string;
  kind: 'mother' | 'independent';
  bedId: string;
  parentEpisodeId?: string;
  effectiveAt: string;
  reviewedAt: string;
  reviewedBy: string;
  /** Last source location accepted for this episode; a matching correction needs no new bed review. */
  sourcePlacementKey?: string;
  sourceService?: string;
  /** Last source identifier explicitly accepted for this placement. */
  sourceRun?: string;
  /** A proven source maternal document remains lookup-only after its episode leaves the census. */
  sourceRunIsMaternal?: boolean;
  /** Lookup identity only; never the RN personal document. */
  maternalRut?: string;
}
