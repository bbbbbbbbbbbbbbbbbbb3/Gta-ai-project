// Procedural district layout (pure data, no Three.js).
import { AABB, makeBox } from './physics';
import { mulberry32 } from './rng';

export const BLOCK = 40; // block size incl. sidewalk
export const STREET = 14; // road width between blocks
export const SIDEWALK = 3;
export const GRID_N = 6; // blocks per side
export const PITCH = BLOCK + STREET;
export const EXTENT = GRID_N * PITCH; // full width of the district

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
}

export interface Prop {
  kind: 'ac' | 'tank' | 'billboard';
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  variant: number;
}

export interface Block {
  cx: number;
  cz: number;
  park: boolean;
}

export interface CityData {
  blocks: Block[];
  buildings: Building[];
  props: Prop[];
  boxes: AABB[];
  rings: { x: number; y: number; z: number }[];
  trees: { x: number; z: number; s: number }[];
  lamps: { x: number; z: number; rot: number }[];
  spawn: { x: number; y: number; z: number; yaw: number };
  carSpawn: { x: number; z: number; yaw: number };
  half: number;
}

// Vibrant, stylised facade palette.
const PALETTE = [
  0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x38d9a9, 0x4dabf7, 0x748ffc, 0xda77f2, 0xf783ac, 0xe9ecef, 0x9775fa,
  0x63e6be, 0xffc078, 0x8ce99a,
];

export function blockCenter(i: number): number {
  return (i - (GRID_N - 1) / 2) * PITCH;
}

export function generateCity(seed = 7): CityData {
  const rand = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const blocks: Block[] = [];
  const buildings: Building[] = [];
  const props: Prop[] = [];
  const trees: CityData['trees'] = [];
  const lamps: CityData['lamps'] = [];
  const half = EXTENT / 2;
  const maxR = Math.hypot(blockCenter(0), blockCenter(0));
  const parkIndex = { i: 1, j: 4 };

  for (let i = 0; i < GRID_N; i++)
    for (let j = 0; j < GRID_N; j++) {
      const cx = blockCenter(i),
        cz = blockCenter(j);
      const park = i === parkIndex.i && j === parkIndex.j;
      blocks.push({ cx, cz, park });
      const inner = BLOCK - SIDEWALK * 2;

      // Lamps on sidewalk corners
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        lamps.push({ x: cx + sx * (BLOCK / 2 - 0.8), z: cz + sz * (BLOCK / 2 - 0.8), rot: Math.atan2(sx, sz) });

      if (park) {
        for (let t = 0; t < 26; t++)
          trees.push({ x: cx + (rand() - 0.5) * (inner - 4), z: cz + (rand() - 0.5) * (inner - 4), s: 0.8 + rand() * 0.7 });
        continue;
      }

      const centrality = 1 - Math.hypot(cx, cz) / (maxR * 1.05);
      const tall = 10 + centrality * 46;
      const layout = rand();
      const lots: { x: number; z: number; w: number; d: number }[] = [];
      const gap = 2.5; // alleys between buildings
      if (layout < 0.18) {
        lots.push({ x: cx, z: cz, w: inner, d: inner });
      } else if (layout < 0.5) {
        const horiz = rand() < 0.5;
        const split = 0.35 + rand() * 0.3;
        const a = inner * split - gap / 2,
          b = inner * (1 - split) - gap / 2;
        if (horiz) {
          lots.push({ x: cx - inner / 2 + a / 2, z: cz, w: a, d: inner });
          lots.push({ x: cx + inner / 2 - b / 2, z: cz, w: b, d: inner });
        } else {
          lots.push({ x: cx, z: cz - inner / 2 + a / 2, w: inner, d: a });
          lots.push({ x: cx, z: cz + inner / 2 - b / 2, w: inner, d: b });
        }
      } else {
        const q = inner / 2 - gap / 2;
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ])
          lots.push({ x: cx + (sx * (q + gap)) / 2, z: cz + (sz * (q + gap)) / 2, w: q, d: q });
      }

      for (const lot of lots) {
        // Some lots step back to make stepped silhouettes and ledges
        const shrink = rand() < 0.35 ? 0.75 + rand() * 0.15 : 1;
        const w = lot.w * shrink,
          d = lot.d * shrink;
        const h = Math.max(7, tall * (0.55 + rand() * 0.65));
        const color = pick(PALETTE);
        buildings.push({ x: lot.x, z: lot.z, w, d, h, color });
        // Setback tier on wide tall buildings
        if (h > 26 && w > 12 && d > 12 && rand() < 0.55) {
          buildings.push({ x: lot.x, z: lot.z, w: w * 0.6, d: d * 0.6, h: h + 8 + rand() * 14, color });
        }
        // Rooftop props
        const top = h;
        if (rand() < 0.75)
          props.push({
            kind: 'ac',
            x: lot.x + (rand() - 0.5) * w * 0.5,
            z: lot.z + (rand() - 0.5) * d * 0.5,
            y: top,
            w: 2.2,
            d: 1.6,
            h: 1.3,
            rot: 0,
            variant: 0,
          });
        if (rand() < 0.3 && w > 9)
          props.push({ kind: 'tank', x: lot.x + w * 0.25, z: lot.z - d * 0.25, y: top, w: 3, d: 3, h: 5.5, rot: 0, variant: 0 });
        if (rand() < 0.22 && w > 10)
          props.push({
            kind: 'billboard',
            x: lot.x,
            z: lot.z + d * 0.3,
            y: top,
            w: Math.min(10, w * 0.7),
            d: 0.5,
            h: 4.5,
            rot: 0,
            variant: Math.floor(rand() * 4),
          });
      }
    }

  // Remove props that ended up on a lower tier but inside a setback tower
  const boxes: AABB[] = buildings.map((b) => makeBox(b.x, b.z, b.w, b.d, b.h));
  const keptProps = props.filter((p) => !boxes.some((b) => inside2D(p.x, p.z, b, 1.5) && b.maxY > p.y + 0.1));
  props.length = 0;
  props.push(...keptProps);
  for (const p of props) {
    const legs = p.kind === 'billboard' ? 1.2 : 0;
    boxes.push(makeBox(p.x, p.z, p.w, p.d, p.h, p.y + legs * 0));
  }

  // District boundary walls (invisible)
  const wallH = 400,
    t = 4;
  const lim = half + 6;
  boxes.push(makeBox(0, -lim - t / 2, EXTENT + 30, t, wallH));
  boxes.push(makeBox(0, lim + t / 2, EXTENT + 30, t, wallH));
  boxes.push(makeBox(-lim - t / 2, 0, t, EXTENT + 30, wallH));
  boxes.push(makeBox(lim + t / 2, 0, t, EXTENT + 30, wallH));

  // Rings: start near spawn (low, easy) then lead up across rooftops.
  const streetMid = blockCenter(2) + PITCH / 2; // a central road
  const spawn = { x: streetMid, y: 0, z: blockCenter(3) + 4, yaw: 0 };
  const carSpawn = { x: streetMid + 3.5, z: blockCenter(3) - 8, yaw: 0 };

  const rings: CityData['rings'] = [];
  rings.push({ x: streetMid, y: 6, z: blockCenter(3) - 16 });
  const roofCandidates = buildings
    .filter((b) => b.h > 14)
    .sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z));
  const used: Building[] = [];
  for (const b of roofCandidates) {
    if (rings.length >= 10) break;
    if (used.some((u) => Math.hypot(u.x - b.x, u.z - b.z) < 50)) continue;
    const topAt = topHeightAt(boxes, b.x, b.z);
    used.push(b);
    rings.push({ x: b.x, y: topAt + 5, z: b.z });
  }
  // Two street-canyon rings to encourage swinging between towers
  rings.push({ x: blockCenter(1) + PITCH / 2, y: 18, z: blockCenter(1) });
  rings.push({ x: blockCenter(4), y: 22, z: blockCenter(4) + PITCH / 2 });

  return { blocks, buildings, props, boxes, rings, trees, lamps, spawn, carSpawn, half };
}

function inside2D(x: number, z: number, b: AABB, pad = 0) {
  return x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
}

/** Highest box top at an XZ point (0 if street). */
export function topHeightAt(boxes: AABB[], x: number, z: number): number {
  let top = 0;
  for (const b of boxes) if (b.maxY < 300 && inside2D(x, z, b)) top = Math.max(top, b.maxY);
  return top;
}

export function pointInsideAnyBox(boxes: AABB[], x: number, y: number, z: number, pad = 0): boolean {
  return boxes.some(
    (b) =>
      x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad && y > b.minY - pad && y < b.maxY + pad,
  );
}
