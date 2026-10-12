import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { hideMoaAndRestoreFocus } from '@/shared/ui/useMoaVisibility';
import { MoaMascot } from './navbar/MoaMascot';
import { MoaSequence, moaScenes } from './MoaSequence';
import './moaCompanion.css';

const gestures = moaScenes;
type Gesture = (typeof gestures)[number] | 'idle' | 'welcome';

/** A local, playful companion. Its only actions are gestures and visibility. */
const MoaCompanion = () => {
  const [gesture, setGesture] = useState<Gesture>('welcome');
  const [hidden, setHidden] = useState(() => document.hidden);
  const [playbackId, setPlaybackId] = useState(0);
  const nextGesture = useRef(0);
  const scene = gesture === 'welcome' ? 'wave' : moaScenes.find(name => name === gesture);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const play = () => {
    setGesture(gestures[nextGesture.current++ % gestures.length]);
    setPlaybackId(value => value + 1);
  };
  const notice = () => {
    if (gesture === 'idle') setGesture('curious');
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
          <X size={12} />
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
        {scene ? (
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
