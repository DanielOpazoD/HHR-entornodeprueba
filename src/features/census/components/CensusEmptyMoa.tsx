import React, { useState } from 'react';
import { MoaSequence, moaScenes } from '@/components/layout/MoaSequence';
import '@/components/layout/moaCompanion.css';
import './censusMotion.css';

/** Independent of the optional floating companion: no close control or chooser. */
export const CensusEmptyMoa: React.FC = () => {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * moaScenes.length));
  const nextScene = () =>
    setIndex(
      previous =>
        (previous + 1 + Math.floor(Math.random() * (moaScenes.length - 1))) % moaScenes.length
    );
  return (
    <button
      type="button"
      onClick={nextScene}
      aria-label="Cambiar animación de Moa"
      title="Haz clic para cambiar la animación"
      className="census-empty-moa relative mb-4 h-[168px] w-72 max-w-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-500"
      data-testid="census-empty-moa"
    >
      <MoaSequence
        key={index}
        scene={moaScenes[index]}
        onComplete={() => {
          /* Keep the local placeholder on asset errors. */
        }}
      />
    </button>
  );
};
