import { describe, expect, it } from 'vitest';
import { generateCity, pointInsideAnyBox } from '../city';

describe('generateCity', () => {
  const city = generateCity();
  it('is deterministic', () => {
    expect(generateCity().buildings.length).toBe(city.buildings.length);
  });
  it('spawns the player and car on open street', () => {
    expect(pointInsideAnyBox(city.boxes, city.spawn.x, 1, city.spawn.z, 0.5)).toBe(false);
    expect(pointInsideAnyBox(city.boxes, city.carSpawn.x, 1, city.carSpawn.z, 2.2)).toBe(false);
  });
  it('places a full set of rings in open air', () => {
    expect(city.rings.length).toBeGreaterThanOrEqual(10);
    for (const r of city.rings) expect(pointInsideAnyBox(city.boxes, r.x, r.y, r.z, 1)).toBe(false);
  });
  it('builds a dense district', () => {
    expect(city.buildings.length).toBeGreaterThan(60);
  });
  it('parks cars at the curb without blocking driving lanes', () => {
    expect(city.parked.length).toBeGreaterThan(20);
    for (const c of city.parked) {
      // lateral offset from the road centre line must leave the 2 m-wide lane at +-3.5 clear
      const lat = c.alongZ ? c.x : c.z;
      const m = ((lat % 54) + 54) % 54; // roads sit on multiples of PITCH (54)
      const off = Math.min(m, 54 - m);
      expect(off - 1.0).toBeGreaterThan(3.5 + 1.0);
      expect(off + 1.0).toBeLessThan(7); // stays off the sidewalk
    }
  });
});
