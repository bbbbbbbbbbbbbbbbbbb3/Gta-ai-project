// Lightweight arcade collision: axis-aligned boxes for the city, an upright
// box for the player, and simple ray/segment tests for grapples and shots.
// Pure functions (no Three.js) so they can be unit-tested.

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Body {
  x: number; // feet centre
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  halfW: number;
  height: number;
  grounded: boolean;
}

export interface MoveResult {
  hitX: boolean;
  hitZ: boolean;
  grounded: boolean;
  ceiling: boolean;
  /** Highest top of any wall touched this move (for mantling). */
  wallTop: number;
}

const EPS = 1e-4;
const MAX_SUBSTEP = 0.3;

export function makeBox(cx: number, cz: number, w: number, d: number, h: number, baseY = 0): AABB {
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    minY: baseY,
    maxY: baseY + h,
  };
}

function overlaps(b: Body, box: AABB, x: number, y: number, z: number): boolean {
  return (
    x + b.halfW > box.minX &&
    x - b.halfW < box.maxX &&
    z + b.halfW > box.minZ &&
    z - b.halfW < box.maxZ &&
    y + b.height > box.minY &&
    y < box.maxY
  );
}

/** Uniform-grid broadphase so collision queries stay cheap as the district grows. */
export class BoxGrid {
  private cells = new Map<number, AABB[]>();
  private scratch: AABB[] = [];
  private stamp = new Map<AABB, number>();
  private query = 0;
  constructor(public boxes: AABB[], private cell = 16) {
    for (const b of boxes) this.insert(b);
  }
  private key(ix: number, iz: number) {
    return (ix + 1024) * 4096 + (iz + 1024);
  }
  insert(b: AABB) {
    const c = this.cell;
    for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++)
      for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
        const k = this.key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(b);
      }
  }
  /** Boxes whose XZ footprint may touch the given rectangle. Result array is reused. */
  near(minX: number, minZ: number, maxX: number, maxZ: number): AABB[] {
    const c = this.cell;
    const out = this.scratch;
    out.length = 0;
    const q = ++this.query;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (!arr) continue;
        for (const b of arr) {
          if (this.stamp.get(b) === q) continue;
          this.stamp.set(b, q);
          out.push(b);
        }
      }
    return out;
  }
}

/**
 * Move an upright box body by (dx,dy,dz), resolving collisions axis by axis
 * with substeps so fast swings don't tunnel through walls.
 */
export function moveBody(
  body: Body,
  dx: number,
  dy: number,
  dz: number,
  grid: BoxGrid,
  stepHeight = 0.55,
): MoveResult {
  const res: MoveResult = { hitX: false, hitZ: false, grounded: false, ceiling: false, wallTop: -Infinity };
  const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  const sx = dx / n,
    sy = dy / n,
    sz = dz / n;
  const r = body.halfW + Math.max(Math.abs(dx), Math.abs(dz)) + 1;
  const boxes = grid.near(body.x - r, body.z - r, body.x + r, body.z + r).slice();
  const wasGrounded = body.grounded;

  for (let i = 0; i < n; i++) {
    // X axis
    if (sx !== 0) {
      body.x += sx;
      for (const box of boxes) {
        if (!overlaps(body, box, body.x, body.y, body.z)) continue;
        const rise = box.maxY - body.y;
        if (wasGrounded && rise > 0 && rise <= stepHeight && !blockedAt(body, boxes, body.x, box.maxY + EPS, body.z)) {
          body.y = box.maxY + EPS;
          continue;
        }
        res.wallTop = Math.max(res.wallTop, box.maxY);
        body.x = sx > 0 ? box.minX - body.halfW - EPS : box.maxX + body.halfW + EPS;
        res.hitX = true;
      }
    }
    // Z axis
    if (sz !== 0) {
      body.z += sz;
      for (const box of boxes) {
        if (!overlaps(body, box, body.x, body.y, body.z)) continue;
        const rise = box.maxY - body.y;
        if (wasGrounded && rise > 0 && rise <= stepHeight && !blockedAt(body, boxes, body.x, box.maxY + EPS, body.z)) {
          body.y = box.maxY + EPS;
          continue;
        }
        res.wallTop = Math.max(res.wallTop, box.maxY);
        body.z = sz > 0 ? box.minZ - body.halfW - EPS : box.maxZ + body.halfW + EPS;
        res.hitZ = true;
      }
    }
    // Y axis
    body.y += sy;
    for (const box of boxes) {
      if (!overlaps(body, box, body.x, body.y, body.z)) continue;
      if (sy <= 0) {
        body.y = box.maxY;
        res.grounded = true;
      } else {
        body.y = box.minY - body.height - EPS;
        res.ceiling = true;
      }
    }
    if (body.y <= 0) {
      body.y = 0;
      res.grounded = true;
    }
  }

  // Probe just below the feet so standing still on a roof counts as grounded.
  if (!res.grounded && dy <= 0) {
    if (body.y <= EPS * 2) res.grounded = true;
    else {
      for (const box of boxes)
        if (overlaps(body, box, body.x, body.y - 0.05, body.z)) {
          res.grounded = true;
          break;
        }
    }
  }
  if (res.hitX) body.vx = 0;
  if (res.hitZ) body.vz = 0;
  if ((res.grounded && body.vy < 0) || (res.ceiling && body.vy > 0)) body.vy = 0;
  body.grounded = res.grounded;
  return res;
}

function blockedAt(body: Body, boxes: AABB[], x: number, y: number, z: number): boolean {
  for (const b of boxes) if (overlaps(body, b, x, y, z)) return true;
  return false;
}

export interface RayHit {
  t: number;
  box: AABB;
  nx: number;
  ny: number;
  nz: number;
}

/** Slab-method ray vs AABB. Returns entry distance and face normal, or null. */
export function rayAABB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: AABB,
  maxT: number,
): RayHit | null {
  let tmin = 0,
    tmax = maxT;
  let nx = 0,
    ny = 0,
    nz = 0;
  const axes: [number, number, number, number][] = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (let a = 0; a < 3; a++) {
    const [o, d, mn, mx] = axes[a];
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d,
      t2 = (mx - o) / d;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = a === 0 ? sign : 0;
      ny = a === 1 ? sign : 0;
      nz = a === 2 ? sign : 0;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin <= 0) return null; // origin inside the box: ignore
  return { t: tmin, box, nx, ny, nz };
}

export function raycastGrid(
  grid: BoxGrid,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): RayHit | null {
  const ex = ox + dx * maxT,
    ez = oz + dz * maxT;
  const boxes = grid.near(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
  let best: RayHit | null = null;
  for (const b of boxes) {
    const h = rayAABB(ox, oy, oz, dx, dy, dz, b, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) best = h;
  }
  // Ground plane
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < (best ? best.t : maxT)) {
      best = { t, box: GROUND, nx: 0, ny: 1, nz: 0 };
    }
  }
  return best;
}

export const GROUND: AABB = { minX: -1e5, maxX: 1e5, minY: -1, maxY: 0, minZ: -1e5, maxZ: 1e5 };

/** Squared distance from point P to segment AB. */
export function segPointDist2(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t - px,
    cy = ay + aby * t - py,
    cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

/** Push a circle (XZ) out of boxes that it overlaps vertically. Returns push normal or null. */
export function pushCircleXZ(
  pos: { x: number; z: number },
  radius: number,
  y0: number,
  y1: number,
  grid: BoxGrid,
): { nx: number; nz: number } | null {
  const boxes = grid.near(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
  let out: { nx: number; nz: number } | null = null;
  for (const b of boxes) {
    if (y1 <= b.minY || y0 >= b.maxY) continue;
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    let dx = pos.x - cx,
      dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-8) {
      // centre inside box: push out along the shallowest axis
      const pen = [pos.x - b.minX, b.maxX - pos.x, pos.z - b.minZ, b.maxZ - pos.z];
      const m = pen.indexOf(Math.min(...pen));
      dx = m === 0 ? -1 : m === 1 ? 1 : 0;
      dz = m === 2 ? -1 : m === 3 ? 1 : 0;
      pos.x += dx * (pen[m] + radius);
      pos.z += dz * (pen[m] + radius);
    } else {
      const d = Math.sqrt(d2);
      dx /= d;
      dz /= d;
      pos.x += dx * (radius - d);
      pos.z += dz * (radius - d);
    }
    out = { nx: dx, nz: dz };
  }
  return out;
}
