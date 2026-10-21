import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { hideMoaAndRestoreFocus } from '@/shared/ui/useMoaVisibility';
import { MoaMascot } from './navbar/MoaMascot';
import { MoaSequence, moaScenes } from './MoaSequence';
import './moaCompanion.css';
import { useMoaCatalog } from './moa/useMoaCatalog';
import { MoaCatalogSequence } from './moa/MoaCatalogSequence';
import type { MoaCatalogScene } from './moa/moaCatalog';

const gestures = moaScenes;
type Gesture = string;

/** Optional decoration. No clinical data, auth or patient context enters this component. */
const MoaCompanion = () => {
  const catalog = useMoaCatalog();
  const [selected, setSelected] = useState<MoaCatalogScene | null>(null);
  const choices =
    catalog?.scenes || gestures.map(id => ({ id, title: id, category: 'Originales' }));
  const [gesture, setGesture] = useState<Gesture>('welcome');
  const [hidden, setHidden] = useState(() => document.hidden);
  const [playbackId, setPlaybackId] = useState(0);
  const lastChoice = useRef('');
  const scene = gesture === 'welcome' ? 'wave' : moaScenes.find(name => name === gesture);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const play = () => {
    const alternatives = choices.filter(choice => choice.id !== lastChoice.current);
    const available = alternatives.length ? alternatives : choices;
    const choice = available[Math.floor(Math.random() * available.length)];
    lastChoice.current = choice.id;
    setSelected(catalog?.scenes.find(item => item.id === choice.id) || null);
    setGesture(choice.id);
    setPlaybackId(value => value + 1);
  };
  const notice = () => {
    if (gesture === 'idle') {
      setSelected(null);
      setGesture('curious');
    }
  };
  return (
    <section
      id="census-moa"
      aria-label="Moa"
      className="moa-companion print:hidden"
      data-paused={hidden}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          hideMoaAndRestoreFocus();
        }
      }}
    >
      <div className="moa-controls">
        <button
          type="button"
          aria-label="Ocultar Moa"
          title="Ocultar Moa"
          onClick={hideMoaAndRestoreFocus}
        >
          <X size={8} />
        </button>
      </div>
      <button
        type="button"
        className="moa-character"
        aria-label="Jugar con Moa"
        title="Moa · Tócame para jugar"
        data-gesture={gesture}
        onClick={play}
        onPointerEnter={notice}
        onFocus={notice}
      >
        {selected && gesture !== 'idle' ? (
          <MoaCatalogSequence
            key={`${gesture}:${playbackId}`}
            scene={selected}
            paused={hidden}
            onComplete={() => setGesture('idle')}
          />
        ) : scene ? (
          <MoaSequence
            key={`${gesture}:${playbackId}`}
            scene={scene}
            onComplete={() => setGesture('idle')}
          />
        ) : (
          <MoaMascot className="h-[84px] w-36" />
        )}
      </button>
    </section>
  );
};

export default MoaCompanion;

// Both decorative hosts share one on-demand module, never the clinical startup bundle.
export { CensusEmptyMoa } from './moa/CensusEmptyMoa';
