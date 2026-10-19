/** Original clinical evidence copied into a new day; never a new measurement or sync receipt. */
export interface ClinicalCarryover {
  sourceDate: string;
  clinicalEpisodeId: string;
  vitalsPending: boolean;
  devicesPending: boolean;
}
