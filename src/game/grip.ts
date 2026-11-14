// Two-hand grip locomotion (VR). While a hand is squeezed, the body moves
// opposite to that hand's motion, as if pulling on the air or a surface.
// On release the body keeps a smoothed, slightly boosted launch velocity.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface GripConfig {
  /** Multiplier applied to the smoothed pull speed when letting go. */
  launchBoost: number;
  /** Hard cap on launch speed (m/s) for comfort. */
  maxLaunch: number;
  /** Strength of pulls on empty air vs. a real surface (0..1). */
  airStrength: number;
  /** Samples averaged for the launch velocity. */
  historySize: number;
}

export const DEFAULT_GRIP: GripConfig = {
  launchBoost: 1.35,
  maxLaunch: 24,
  airStrength: 0.9,
  historySize: 5,
};

export type GripPhase = 'free' | 'held' | 'launched';

export interface GripOutput {
  phase: GripPhase;
  velocity: V3;
}

interface HandState {
  held: boolean;
  surface: boolean;
  prev: V3 | null;
}

export class GripTracker {
  hands: HandState[] = [
    { held: false, surface: false, prev: null },
    { held: false, surface: false, prev: null },
  ];
  private history: V3[] = [];
  private wasActive = false;

  constructor(public cfg: GripConfig = DEFAULT_GRIP) {}

  grab(hand: number, pos: V3, surface: boolean) {
    const h = this.hands[hand];
    h.held = true;
    h.surface = surface;
    h.prev = { ...pos };
  }

  release(hand: number) {
    const h = this.hands[hand];
    h.held = false;
    h.prev = null;
  }

  /** Call after a snap turn or teleport so the rotated hand doesn't read as a pull. */
  resetReference(positions: V3[]) {
    this.hands.forEach((h, i) => {
      if (h.held) h.prev = { ...positions[i] };
    });
  }

  get active() {
    return this.hands[0].held || this.hands[1].held;
  }

  /**
   * @param positions hand positions in play-space, already rotated into world orientation
   * @param dt seconds since last update
   */
  update(positions: V3[], dt: number): GripOutput {
    const v: V3 = { x: 0, y: 0, z: 0 };
    let count = 0;
    if (dt > 0) {
      this.hands.forEach((h, i) => {
        if (!h.held || !h.prev) return;
        const p = positions[i];
        const k = h.surface ? 1 : this.cfg.airStrength;
        v.x += (-(p.x - h.prev.x) / dt) * k;
        v.y += (-(p.y - h.prev.y) / dt) * k;
        v.z += (-(p.z - h.prev.z) / dt) * k;
        h.prev = { ...p };
        count++;
      });
    }
    if (count > 0) {
      v.x /= count;
      v.y /= count;
      v.z /= count;
      this.history.push(v);
      if (this.history.length > this.cfg.historySize) this.history.shift();
      this.wasActive = true;
      return { phase: 'held', velocity: v };
    }
    if (this.wasActive) {
      this.wasActive = false;
      const launch = this.launchVelocity();
      this.history = [];
      return { phase: 'launched', velocity: launch };
    }
    return { phase: 'free', velocity: v };
  }

  private launchVelocity(): V3 {
    const n = this.history.length;
    if (!n) return { x: 0, y: 0, z: 0 };
    const out = { x: 0, y: 0, z: 0 };
    for (const s of this.history) {
      out.x += s.x;
      out.y += s.y;
      out.z += s.z;
    }
    const b = this.cfg.launchBoost / n;
    out.x *= b;
    out.y *= b;
    out.z *= b;
    const sp = Math.hypot(out.x, out.y, out.z);
    if (sp > this.cfg.maxLaunch) {
      const s = this.cfg.maxLaunch / sp;
      out.x *= s;
      out.y *= s;
      out.z *= s;
    }
    return out;
  }
}
