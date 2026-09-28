/** Page reads needed to recover an episode; absent selection means a full read. */
export type ClinicalReadSource = 'devices' | 'history' | 'forms' | 'cudyr';
export type ClinicalReadSelection = Readonly<Record<string, readonly ClinicalReadSource[]>>;

export const needsClinicalRead = (
  selection: ClinicalReadSelection | undefined,
  episodeId: string,
  source: ClinicalReadSource
): boolean => !selection?.[episodeId]?.length || selection[episodeId].includes(source);
