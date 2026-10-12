import { useState, type CSSProperties } from 'react';
import { MoaMascot } from './navbar/MoaMascot';

export const moaScenes = [
  'drink',
  'juggle',
  'care',
  'sleep',
  'yawn',
  'pushups',
  'roll',
  'jump',
  'run',
  'wink',
  'love',
  'angry',
  'mother',
  'surf',
  'wave',
  'curious',
  'stroll',
  'happy',
] as const;
type Scene = (typeof moaScenes)[number];
const playback: Record<Scene, [seconds: number, cycles: number, still: number]> = {
  drink: [4, 1, 2],
  juggle: [3.6, 1, 2],
  care: [4.8, 1, 2],
  sleep: [6, 1, 5],
  yawn: [4, 1, 3],
  pushups: [1.2, 3, 2],
  roll: [3.6, 1, 3],
  jump: [3, 1, 2],
  run: [0.75, 4, 3],
  wink: [3, 1, 2],
  love: [4.5, 1, 3],
  angry: [4.8, 1, 2],
  mother: [5.4, 1, 3],
  surf: [3.6, 1, 2],
  wave: [3, 1, 3],
  curious: [3.6, 1, 3],
  stroll: [1.2, 3, 2],
  happy: [3, 1, 3],
};

/** Six illustrated key poses. Fetch only the chosen scene; no animation timers. */
export const MoaSequence = ({ scene, onComplete }: { scene: Scene; onComplete: () => void }) => {
  const [ready, setReady] = useState(false);
  const [seconds, cycles, still] = playback[scene];
  return (
    <span
      className="moa-sequence"
      data-moa-scene={scene}
      style={
        {
          '--scene-time': `${seconds}s`,
          '--scene-cycles': cycles,
          '--scene-still': `${(-100 * still) / 6}%`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {!ready && (
        <span className="moa-sequence-placeholder">
          <MoaMascot className="h-[84px] w-36" />
        </span>
      )}
      <img
        src={`/images/moa/moa-${scene}-v2.png`}
        alt=""
        width={1728}
        height={168}
        decoding="async"
        draggable={false}
        className="moa-scene-frames"
        data-ready={ready}
        onLoad={() => setReady(true)}
        onError={onComplete}
        onAnimationEnd={event => {
          event.stopPropagation();
          onComplete();
        }}
      />
    </span>
  );
};
