import { describe, expect, it } from 'vitest';
import { Body, BoxGrid, makeBox, moveBody, raycastGrid, pushCircleXZ } from '../physics';

const body = (x = 0, y = 0, z = 0): Body => ({ x, y, z, vx: 0, vy: 0, vz: 0, halfW: 0.35, height: 1.8, grounded: true });

describe('moveBody', () => {
  const grid = new BoxGrid([makeBox(5, 0, 2, 10, 10)]); // wall from x=4..6

  it('stops at walls instead of passing through', () => {
    const b = body();
    const r = moveBody(b, 10, 0, 0, grid);
    expect(r.hitX).toBe(true);
    expect(b.x).toBeLessThan(4);
    expect(b.x).toBeGreaterThan(3.5);
  });

  it('does not tunnel at swing speeds', () => {
    const b = body(0, 1, 0);
    b.grounded = false;
    moveBody(b, 40 / 60 * 30, 0, 0, grid); // a whole half-second at 40 m/s in one call
    expect(b.x).toBeLessThan(4);
  });

  it('lands on roofs and reports grounded', () => {
    const b = body(5, 12, 0);
    b.grounded = false;
    const r = moveBody(b, 0, -5, 0, grid);
    expect(r.grounded).toBe(true);
    expect(b.y).toBeCloseTo(10, 3);
  });

  it('steps up small ledges like curbs', () => {
    const g = new BoxGrid([makeBox(2, 0, 2, 4, 0.4)]);
    const b = body();
    moveBody(b, 2, 0, 0, g);
    expect(b.y).toBeCloseTo(0.4, 2);
  });

  it('reports wall top for mantling', () => {
    const g = new BoxGrid([makeBox(2, 0, 2, 4, 1.4)]);
    const b = body();
    const r = moveBody(b, 2, 0, 0, g);
    expect(r.hitX).toBe(true);
    expect(r.wallTop).toBeCloseTo(1.4);
  });
});

describe('raycastGrid', () => {
  const grid = new BoxGrid([makeBox(0, 20, 10, 10, 30)]);
  it('hits the near face with a correct normal', () => {
    const h = raycastGrid(grid, 0, 5, 0, 0, 0, 1, 100);
    expect(h).not.toBeNull();
    expect(h!.t).toBeCloseTo(15);
    expect(h!.nz).toBe(-1);
  });
  it('returns null beyond range', () => {
    expect(raycastGrid(grid, 0, 5, 0, 0, 0, 1, 10)).toBeNull();
  });
  it('hits the ground when aiming down', () => {
    const h = raycastGrid(grid, 0, 5, 0, 0, -1, 0, 100);
    expect(h!.t).toBeCloseTo(5);
    expect(h!.ny).toBe(1);
  });
});

describe('pushCircleXZ', () => {
  it('pushes a car-sized circle out of a wall', () => {
    const grid = new BoxGrid([makeBox(3, 0, 2, 10, 5)]);
    const p = { x: 1, z: 0 };
    const n = pushCircleXZ(p, 2, 0, 1.5, grid);
    expect(n).not.toBeNull();
    expect(p.x).toBeCloseTo(0);
    expect(n!.nx).toBeLessThan(0);
  });
});
