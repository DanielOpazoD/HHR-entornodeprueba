import React, { useEffect, useRef, useState } from 'react';
import { MoaSequence, moaScenes } from '@/components/layout/MoaSequence';
import '@/components/layout/moaCompanion.css';
import './censusEmptyMoa.css';

/** Independent of the optional floating companion: no close control or chooser. */
export const CensusEmptyMoa: React.FC = () => {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * moaScenes.length));
  const [pending, setPending] = useState(false);
  const [preloaded, setPreloaded] = useState(false);
  const mounted = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeLoad = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timeout.current) clearTimeout(timeout.current);
      activeLoad.current = null;
    };
  }, []);
  const nextScene = () => {
    if (pending || activeLoad.current) return;
    const next =
      (index + 1 + Math.floor(Math.random() * (moaScenes.length - 1))) % moaScenes.length;
    const candidate = new Image();
    activeLoad.current = candidate;
    setPending(true);
    const finish = async () => {
      try {
        if (candidate.decode) await candidate.decode();
        if (candidate.naturalWidth !== 1728 || candidate.naturalHeight !== 168)
          throw new Error('Invalid sprite');
        if (!mounted.current || activeLoad.current !== candidate) return;
        setPreloaded(true);
        setIndex(next);
      } catch {
        /* Keep the current animation if the next cannot decode. */
      } finally {
        if (mounted.current && activeLoad.current === candidate) {
          clearTimeout(timeout.current);
          activeLoad.current = null;
          setPending(false);
        }
      }
    };
    candidate.onload = () => {
      void finish();
    };
    candidate.onerror = () => {
      if (mounted.current && activeLoad.current === candidate) {
        clearTimeout(timeout.current);
        activeLoad.current = null;
        setPending(false);
      }
    };
    timeout.current = setTimeout(() => {
      if (mounted.current && activeLoad.current === candidate) {
        activeLoad.current = null;
        setPending(false);
      }
    }, 10_000);
    candidate.src = `/images/moa/moa-${moaScenes[next]}-v2.png`;
  };
  return (
    <button
      type="button"
      onClick={nextScene}
      disabled={pending}
      aria-busy={pending}
      aria-label="Cambiar animación de Moa"
      title="Haz clic para cambiar la animación"
      className="census-empty-moa relative mb-4 h-[168px] w-72 max-w-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-500"
      data-testid="census-empty-moa"
    >
      <MoaSequence
        key={index}
        scene={moaScenes[index]}
        initiallyReady={preloaded}
        onComplete={() => {
          /* Keep the local placeholder on asset errors. */
        }}
      />
    </button>
  );
};
