export interface CudyrReviewDecision {
  action: 'link' | 'exclude' | 'pending';
  episodeId: string;
  reason: string;
}
export interface CudyrReviewSource {
  kind: 'categories' | 'discharges';
  sha256: string;
  name: string;
}
export interface CudyrReviewEvidence {
  sources: CudyrReviewSource[];
  from: string;
  to: string;
  contextHash: string;
  patientName: string;
  document: string;
  sourceDate: string;
  sourceValue: string;
}
export interface SavedCudyrReview {
  schemaVersion: 1;
  id: string;
  month: string;
  entryKey: string;
  revision: number;
  decision: CudyrReviewDecision;
  evidence: CudyrReviewEvidence;
  verification: 'user_review';
  updatedAt: string;
  reviewedBy: { uid: string; name: string; email: string; role: string };
}
