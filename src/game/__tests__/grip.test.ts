import { describe, expect, it } from 'vitest';
import { GripTracker } from '../grip';

describe('GripTracker', () => {
  it('moves the body opposite to the pulling hand', () => {
    const g = new GripTracker();
    g.grab(0, { x: 0, y: 1, z: 0 }, true);
    const out = g.update([{ x: 0, y: 0.9, z: -0.1 }, { x: 0, y: 0, z: 0 }], 0.1);
    expect(out.phase).toBe('held');
    expect(out.velocity.y).toBeCloseTo(1);
    expect(out.velocity.z).toBeCloseTo(1);
  });

  it('averages both hands', () => {
    const g = new GripTracker();
    g.grab(0, { x: 0, y: 0, z: 0 }, true);
    g.grab(1, { x: 0, y: 0, z: 0 }, true);
    const out = g.update([{ x: 0, y: -0.2, z: 0 }, { x: 0, y: 0, z: 0 }], 0.1);
    expect(out.velocity.y).toBeCloseTo(1);
  });

  it('weakens pulls on empty air', () => {
    const g = new GripTracker();
    g.grab(0, { x: 0, y: 0, z: 0 }, false);
    const out = g.update([{ x: 0, y: -0.1, z: 0 }, { x: 0, y: 0, z: 0 }], 0.1);
    expect(out.velocity.y).toBeCloseTo(0.9);
  });

  it('launches with boosted, capped momentum on release', () => {
    const g = new GripTracker();
    g.grab(0, { x: 0, y: 0, z: 0 }, true);
    let y = 0;
    for (let i = 0; i < 5; i++) {
      y -= 0.05;
      g.update([{ x: 0, y, z: 0 }, { x: 0, y: 0, z: 0 }], 1 / 60);
    }
    g.release(0);
    const out = g.update([{ x: 0, y, z: 0 }, { x: 0, y: 0, z: 0 }], 1 / 60);
    expect(out.phase).toBe('launched');
    expect(out.velocity.y).toBeGreaterThan(3);
    expect(out.velocity.y).toBeLessThanOrEqual(24);
    expect(g.update([{ x: 0, y, z: 0 }, { x: 0, y: 0, z: 0 }], 1 / 60).phase).toBe('free');
  });

  it('ignores the jump caused by a snap turn after resetReference', () => {
    const g = new GripTracker();
    g.grab(0, { x: 0.3, y: 1, z: 0 }, true);
    g.resetReference([{ x: 0, y: 1, z: 0.3 }, { x: 0, y: 0, z: 0 }]);
    const out = g.update([{ x: 0, y: 1, z: 0.3 }, { x: 0, y: 0, z: 0 }], 1 / 60);
    expect(Math.hypot(out.velocity.x, out.velocity.y, out.velocity.z)).toBeCloseTo(0);
  });
});
