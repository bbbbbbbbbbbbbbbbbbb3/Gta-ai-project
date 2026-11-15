import { useEffect, useRef, useState } from 'react';
import { Game, UiState } from './game/Game';
import { TouchControls } from './TouchControls';

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [xrError, setXrError] = useState<string | null>(null);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'nogl'>('loading');
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(location.search).has('debug'));

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    let g: Game | null = null;
    let cancelled = false;
    // Let the loading screen paint before the (blocking) world build and shader compile.
    const id = requestAnimationFrame(() =>
      setTimeout(() => {
        if (cancelled) return;
        try {
          g = new Game(mount);
        } catch (e) {
          console.warn('Concrete Jungle could not start WebGL', e);
          setBoot('nogl');
          return;
        }
        gameRef.current = g;
        g.onUi = setUi;
        setUi(g.uiState());
        setBoot('ready');
      }, 30),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') setShowDebug((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', onKey);
      g?.dispose();
      gameRef.current = null;
    };
  }, []);

  const g = gameRef.current;
  const enterVR = async () => {
    setXrError(null);
    try {
      await g?.enterVR();
    } catch (e) {
      setXrError('Could not start VR. Check that your headset browser allows immersive sessions.');
    }
  };

  return (
    <div className="app">
      <div ref={mountRef} className="stage" />
      {boot !== 'ready' && (
        <div className="overlay menu boot">
          <div className="menu-card">
            <p className="eyebrow">A rooftop action sandbox</p>
            <h1 className="title">
              Concrete
              <br />
              Jungle
            </h1>
            {boot === 'loading' ? (
              <p className="lede boot-status" role="status">
                Building the city…
              </p>
            ) : (
              <p className="lede" role="alert">
                This game needs WebGL, and your browser couldn’t start it. Turn on hardware acceleration in your browser
                settings, or try a recent Chrome, Edge, Firefox or Quest Browser.
              </p>
            )}
          </div>
        </div>
      )}
      {ui && (
        <>
          {showDebug && (
            <div className="debug" aria-hidden>
              {ui.fps.toFixed(0)} fps · {ui.drawCalls} draws
            </div>
          )}
          {ui.mode === 'playing' && <Hud ui={ui} />}
          {ui.mode === 'playing' && ui.platform === 'touch' && g && <TouchControls game={g} inCar={ui.inCar} />}
          {ui.mode === 'menu' && (
            <div className="overlay menu">
              <div className="menu-card">
                <p className="eyebrow">A rooftop action sandbox</p>
                <h1 className="title">
                  Concrete
                  <br />
                  Jungle
                </h1>
                <p className="lede">
                  Swing between towers, bounce pedestrians with kinetic pulses and grab all {ui.ringsTotal} sky rings as fast
                  as you can.
                </p>
                <div className="actions">
                  <button className="btn primary" onClick={() => g?.start()} autoFocus>
                    Play
                  </button>
                  <button
                    className="btn"
                    onClick={enterVR}
                    disabled={!ui.xrSupported}
                    title={ui.xrSupported ? 'Enter VR' : 'Open on a WebXR headset (e.g. Quest Browser) to play in VR'}
                  >
                    {ui.xrSupported ? 'Enter VR' : 'VR not detected'}
                  </button>
                  <button className="btn ghost" onClick={() => setShowControls((v) => !v)}>
                    Controls
                  </button>
                </div>
                {xrError && <p className="error">{xrError}</p>}
                {showControls && <Controls />}
              </div>
            </div>
          )}
          {ui.mode === 'paused' && (
            <div className="overlay">
              <div className="panel">
                <h2 className="panel-title">Paused</h2>
                <div className="stats">
                  <Stat label="Rings" value={`${ui.rings}/${ui.ringsTotal}`} />
                  <Stat label="Time" value={fmtTime(ui.time)} />
                  <Stat label="Score" value={ui.score.toLocaleString()} />
                </div>
                <div className="actions">
                  <button className="btn primary" onClick={() => g?.resume()} autoFocus>
                    Resume
                  </button>
                  <button className="btn" onClick={() => g?.restart()}>
                    Restart
                  </button>
                  {ui.xrSupported && !ui.xrActive && (
                    <button className="btn" onClick={enterVR}>
                      Enter VR
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => g?.setMuted(!ui.muted)}>
                    Sound: {ui.muted ? 'off' : 'on'}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => g?.setQuality(ui.quality === 'cinematic' ? 'performance' : 'cinematic')}
                  >
                    Graphics: {ui.quality === 'cinematic' ? 'cinematic' : 'performance'}
                  </button>
                  <button className="btn ghost" onClick={() => g?.quitToMenu()}>
                    Title screen
                  </button>
                </div>
                <Controls />
              </div>
            </div>
          )}
          {ui.mode === 'finished' && (
            <div className="overlay">
              <div className="panel finish">
                <p className="eyebrow">All rings collected</p>
                <h2 className="title small">District cleared</h2>
                <div className="stats">
                  <Stat label="Time" value={fmtTime(ui.time)} />
                  <Stat label="Best" value={ui.bestTime !== null ? fmtTime(ui.bestTime) : '-'} />
                  <Stat label="Score" value={ui.score.toLocaleString()} />
                  <Stat label="Knockouts" value={String(ui.knockouts)} />
                </div>
                <div className="actions">
                  <button className="btn primary" onClick={() => g?.restart()} autoFocus>
                    Run it again
                  </button>
                  <button className="btn ghost" onClick={() => g?.quitToMenu()}>
                    Title screen
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function Hud({ ui }: { ui: UiState }) {
  const [pulse, setPulse] = useState(false);
  const last = useRef(ui.flash);
  useEffect(() => {
    if (ui.flash !== last.current) {
      last.current = ui.flash;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 220);
      return () => clearTimeout(t);
    }
  }, [ui.flash]);

  return (
    <div className="hud">
      <div className={`hud-top ${pulse ? 'pulse' : ''}`}>
        <div className="chip">
          <span className="chip-label">Rings</span>
          <span className="chip-value">
            {ui.rings}/{ui.ringsTotal}
          </span>
        </div>
        <div className="chip">
          <span className="chip-label">Time</span>
          <span className="chip-value">{fmtTime(ui.time)}</span>
        </div>
        <div className="chip">
          <span className="chip-label">Score</span>
          <span className="chip-value">{ui.score.toLocaleString()}</span>
        </div>
        {ui.combo > 1 && <div className="chip combo">x{ui.combo}</div>}
      </div>

      {ui.nearest && (
        <div className="compass" aria-label={`Nearest ring ${Math.round(ui.nearest.dist)} metres`}>
          <div className="arrow" style={{ transform: `rotate(${ui.nearest.bearing}deg)` }}>
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
              <path d="M12 2 L20 20 L12 15 L4 20 Z" fill="currentColor" />
            </svg>
          </div>
          <span className="compass-dist">
            {Math.round(ui.nearest.dist)}m{' '}
            {ui.nearest.dy > 4 ? <span className="up">▲</span> : ui.nearest.dy < -4 ? <span className="down">▼</span> : null}
          </span>
        </div>
      )}

      {!ui.inCar && (
        <div className={`crosshair ${ui.aim} ${ui.grappling ? 'grappling' : ''}`}>
          <span />
          {ui.aim === 'grapple' && <em>{Math.round(ui.aimDist)}m</em>}
          {ui.aim === 'far' && <em>too far</em>}
        </div>
      )}

      {ui.inCar && (
        <div className="speedo">
          <span className="speed-value">{Math.round(ui.speed * 3.6)}</span>
          <span className="speed-unit">km/h</span>
        </div>
      )}

      <div className="hud-bottom">
        {ui.prompt && <div className="prompt">{ui.prompt}</div>}
        {ui.hint && <div className="hint">{ui.hint}</div>}
      </div>
      {ui.platform === 'desktop' && !ui.pointerLocked && (
        <div className="lock-note">Click the game to capture the mouse · Esc pauses</div>
      )}
    </div>
  );
}

function Controls() {
  return (
    <div className="controls">
      <div>
        <h3>Desktop</h3>
        <dl>
          <dt>WASD / mouse</dt>
          <dd>Move and look</dd>
          <dt>Space</dt>
          <dd>Jump, then a mid-air pulse hop</dd>
          <dt>Right-click / Q</dt>
          <dd>Hold to grapple-swing (Space reels in)</dd>
          <dt>Left-click</dt>
          <dd>Kinetic pulse blast</dd>
          <dt>Shift</dt>
          <dd>Sprint</dd>
          <dt>F</dt>
          <dd>Enter or exit the car</dd>
          <dt>Esc / P · M · G</dt>
          <dd>Pause · mute · graphics</dd>
        </dl>
      </div>
      <div>
        <h3>VR headset</h3>
        <dl>
          <dt>Grip</dt>
          <dd>Grab air or walls and pull. Release to launch</dd>
          <dt>Trigger</dt>
          <dd>Fire a pulse from that gauntlet</dd>
          <dt>Right stick</dt>
          <dd>Snap turn</dd>
          <dt>Left stick</dt>
          <dd>Gentle walk on the ground</dd>
          <dt>A / X · B / Y</dt>
          <dd>Enter car · exit car</dd>
        </dl>
      </div>
    </div>
  );
}
