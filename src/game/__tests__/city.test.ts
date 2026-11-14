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
});
