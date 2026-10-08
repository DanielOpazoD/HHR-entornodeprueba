import type { SavedCudyrReview, CudyrReviewSource } from '@/types/domain/cudyrReview';
import { cudyrReviewSourceSets } from '@/services/cudyr/cudyrReviewResume';

export const CudyrReviewResume = ({
  records,
  from,
  to,
  onResume,
}: {
  records: SavedCudyrReview[];
  from: string;
  to: string;
  onResume: (sources: CudyrReviewSource[]) => void;
}) => {
  const sets = cudyrReviewSourceSets(records, from, to);
  if (!sets.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <p>Retomar una revisión con sus fuentes originales:</p>
      {sets.map(({ key, sources }, index) => (
        <div key={key} className="rounded border bg-white p-2">
          <p className="break-words">{sources.map(s => s.name).join(' · ')}</p>
          <button
            type="button"
            className="mt-1 rounded border border-teal-700 px-3 py-2 font-medium text-teal-900"
            onClick={() => onResume(sources)}
          >
            Continuar revisión de {from.slice(0, 7)}
            {sets.length > 1 ? ` · fuentes ${index + 1}` : ''}
          </button>
        </div>
      ))}
    </div>
  );
};
