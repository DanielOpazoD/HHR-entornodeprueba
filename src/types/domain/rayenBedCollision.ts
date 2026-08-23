export interface RayenBedCollisionResolutionReceipt {
  id: string;
  selectedEpisodeId: string;
  otherEpisodeId: string;
  otherDisposition:
    | { kind: 'move'; targetBedId: string }
    | { kind: 'discharge' | 'transfer' | 'remove' };
}
