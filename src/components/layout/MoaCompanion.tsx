import { useRef, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { hideMoaAndRestoreFocus } from '@/shared/ui/useMoaVisibility';
import { MoaMascot } from './navbar/MoaMascot';
import './moaCompanion.css';

const gestures = ['wave', 'curious', 'stroll', 'happy'] as const;
type Gesture = (typeof gestures)[number] | 'idle' | 'welcome';

/** A local, playful companion. Its only actions are gestures and visibility. */
const MoaCompanion = () => {
  const [gesture, setGesture] = useState<Gesture>('welcome');
  const [paused, setPaused] = useState(false);
  const nextGesture = useRef(0);
  const play = () => setGesture(gestures[nextGesture.current++ % gestures.length]);
  const notice = () => {
    if (gesture === 'idle') setGesture('curious');
  };
  return (
    <section
      id="census-moa"
      aria-label="Moa"
      className="moa-companion print:hidden"
      data-paused={paused}
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
          aria-label={paused ? 'Reanudar animación de Moa' : 'Pausar animación de Moa'}
          aria-pressed={paused}
          title={paused ? 'Reanudar animación' : 'Pausar animación'}
          onClick={() => setPaused(value => !value)}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
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
        <span
          className="moa-motion"
          onAnimationEnd={event => {
            if (event.target === event.currentTarget && gesture !== 'idle') setGesture('idle');
          }}
        >
          <MoaMascot className="h-[72px] w-16" />
        </span>
      </button>
    </section>
  );
};

export default MoaCompanion;
