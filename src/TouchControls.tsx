import { useRef, useState } from 'react';
import type { Game } from './game/Game';

/** Left: virtual stick. Right: drag to look. Buttons for jump, swing, fire, car. */
export function TouchControls({ game, inCar }: { game: Game; inCar: boolean }) {
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const lastLook = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false, ox: 0, oy: 0 });

  const onStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && stickId.current === null) {
        stickId.current = t.identifier;
        origin.current = { x: t.clientX, y: t.clientY };
        setKnob({ x: 0, y: 0, active: true, ox: t.clientX, oy: t.clientY });
      } else if (lookId.current === null) {
        lookId.current = t.identifier;
        lastLook.current = { x: t.clientX, y: t.clientY };
      }
    }
  };
  const onMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId.current) {
        let dx = t.clientX - origin.current.x,
          dy = t.clientY - origin.current.y;
        const len = Math.hypot(dx, dy),
          max = 50;
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        game.touch.moveX = dx / max;
        game.touch.moveY = dy / max;
        setKnob((k) => ({ ...k, x: dx, y: dy }));
      } else if (t.identifier === lookId.current) {
        game.touch.lookDX += t.clientX - lastLook.current.x;
        game.touch.lookDY += t.clientY - lastLook.current.y;
        lastLook.current = { x: t.clientX, y: t.clientY };
      }
    }
  };
  const onEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId.current) {
        stickId.current = null;
        game.touch.moveX = game.touch.moveY = 0;
        setKnob({ x: 0, y: 0, active: false, ox: 0, oy: 0 });
      } else if (t.identifier === lookId.current) lookId.current = null;
    }
  };

  const hold = (key: 'jump' | 'grapple' | 'fire') => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.stopPropagation();
      game.sfx.init();
      game.touch[key] = true;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.stopPropagation();
      game.touch[key] = false;
    },
    onTouchCancel: () => {
      game.touch[key] = false;
    },
  });

  return (
    <div className="touch" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      {knob.active && (
        <div className="stick" style={{ left: knob.ox, top: knob.oy }}>
          <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        </div>
      )}
      <div className="touch-buttons">
        <button className="tbtn pause" onTouchStart={(e) => { e.stopPropagation(); game.pause(); }} aria-label="Pause">II</button>
        <button
          className="tbtn car"
          onTouchStart={(e) => {
            e.stopPropagation();
            game.toggleCar();
          }}
        >
          CAR
        </button>
        {!inCar && (
          <>
            <button className="tbtn fire" {...hold('fire')}>FIRE</button>
            <button className="tbtn swing" {...hold('grapple')}>SWING</button>
          </>
        )}
        <button className="tbtn jump" {...hold('jump')}>{inCar ? 'DRIFT' : 'JUMP'}</button>
      </div>
    </div>
  );
}
