import * as THREE from 'three';
import { BLOCK, Block } from './city';
import { BoxGrid, pushCircleXZ } from './physics';
import { mulberry32 } from './rng';

export type NpcState = 'walk' | 'panic' | 'knocked' | 'down' | 'getup';

interface Npc {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  tilt: number; // 0 upright .. PI/2 lying
  spin: number;
  spinAxis: THREE.Vector3;
  roll: number;
  state: NpcState;
  timer: number;
  block: Block;
  corner: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
  scale: number;
}

const SHIRTS = [0xff8787, 0x74c0fc, 0xffd43b, 0x8ce99a, 0xe599f7, 0xffa94d, 0x63e6be, 0xf8f9fa];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const RADIUS = 0.45;

/** Wandering pedestrians rendered with 3 instanced meshes (body, head, legs). */
export class Crowd {
  npcs: Npc[] = [];
  bodies: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  legs: THREE.InstancedMesh;
  group = new THREE.Group();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private e = new THREE.Euler();

  constructor(
    private blocks: Block[],
    private grid: BoxGrid,
    count = 48,
  ) {
    const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.55, 2, 6);
    bodyGeo.translate(0, 0.95, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.2, 0);
    headGeo.translate(0, 1.62, 0);
    const legGeo = new THREE.BoxGeometry(0.4, 0.55, 0.22);
    legGeo.translate(0, 0.28, 0);
    this.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 }), count);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7 }), count);
    this.legs = new THREE.InstancedMesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x2b3550, roughness: 0.9 }), count);
    for (const m of [this.bodies, this.heads, this.legs]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    this.group.add(this.bodies, this.heads, this.legs);
    this.reset(count);
  }

  reset(count = this.npcs.length || 48) {
    const rand = mulberry32(99);
    const c = new THREE.Color();
    this.npcs = [];
    const walkable = this.blocks;
    for (let i = 0; i < count; i++) {
      const block = walkable[Math.floor(rand() * walkable.length)];
      const corner = Math.floor(rand() * 4);
      const p = cornerPos(block, corner);
      const n: Npc = {
        x: p.x,
        y: 0.14,
        z: p.z,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: 0,
        tilt: 0,
        spin: 0,
        spinAxis: new THREE.Vector3(1, 0, 0),
        roll: 0,
        state: 'walk',
        timer: 0,
        block,
        corner,
        dir: rand() < 0.5 ? 1 : -1,
        speed: 1.2 + rand() * 0.6,
        phase: rand() * 10,
        scale: 0.9 + rand() * 0.2,
      };
      // spread along the edge
      const nxt = cornerPos(block, (corner + n.dir + 4) % 4);
      const t = rand();
      n.x = p.x + (nxt.x - p.x) * t;
      n.z = p.z + (nxt.z - p.z) * t;
      n.corner = (corner + n.dir + 4) % 4;
      this.npcs.push(n);
      this.bodies.setColorAt(i, c.set(SHIRTS[i % SHIRTS.length]));
      this.heads.setColorAt(i, c.set(SKIN[i % SKIN.length]));
    }
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }

  /** Index of an NPC whose body is within `r` of the point, or -1. */
  hitTest(x: number, y: number, z: number, r = 0.6): number {
    for (let i = 0; i < this.npcs.length; i++) {
      const n = this.npcs[i];
      const dy = y - (n.y + 0.9);
      if (Math.abs(dy) > 1.1 + r) continue;
      const dx = x - n.x,
        dz = z - n.z;
      if (dx * dx + dz * dz < (RADIUS + r) * (RADIUS + r)) return i;
    }
    return -1;
  }

  /** Kinetic, non-graphic reaction: they get bowled over, tumble, and pop back up. */
  knock(i: number, ix: number, iy: number, iz: number): boolean {
    const n = this.npcs[i];
    const fresh = n.state !== 'knocked';
    n.state = 'knocked';
    n.vx += ix;
    n.vy = Math.max(n.vy, 0) + iy;
    n.vz += iz;
    n.spin = 6 + Math.hypot(ix, iz) * 0.4;
    n.spinAxis.set(iz, 0, -ix).normalize();
    if (n.spinAxis.lengthSq() < 0.1) n.spinAxis.set(1, 0, 0);
    n.timer = 0;
    return fresh;
  }

  /** Nearby walkers panic and run away from a commotion. */
  scare(x: number, z: number, radius: number) {
    for (const n of this.npcs) {
      if (n.state !== 'walk') continue;
      if ((n.x - x) ** 2 + (n.z - z) ** 2 < radius * radius) {
        n.state = 'panic';
        n.timer = 3 + Math.random() * 2;
        n.yaw = Math.atan2(n.x - x, n.z - z);
      }
    }
  }

  get knockedCount() {
    return this.npcs.filter((n) => n.state === 'knocked' || n.state === 'down').length;
  }

  update(dt: number) {
    for (const n of this.npcs) {
      n.phase += dt * n.speed * 5;
      switch (n.state) {
        case 'walk':
        case 'panic': {
          const panic = n.state === 'panic';
          const speed = panic ? 4.6 : n.speed;
          if (!panic) {
            const t = cornerPos(n.block, n.corner);
            const dx = t.x - n.x,
              dz = t.z - n.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.4) n.corner = (n.corner + n.dir + 4) % 4;
            else {
              const target = Math.atan2(dx, dz);
              n.yaw = lerpAngle(n.yaw, target, Math.min(1, dt * 6));
            }
          } else {
            n.timer -= dt;
            if (n.timer <= 0) {
              n.state = 'walk';
              n.block = nearestBlock(this.blocks, n.x, n.z);
              n.corner = nearestCorner(n.block, n.x, n.z);
            }
          }
          n.x += Math.sin(n.yaw) * speed * dt;
          n.z += Math.cos(n.yaw) * speed * dt;
          const pos = { x: n.x, z: n.z };
          const hit = pushCircleXZ(pos, RADIUS, n.y, n.y + 1.7, this.grid);
          n.x = pos.x;
          n.z = pos.z;
          if (hit && panic) n.yaw = Math.atan2(hit.nx, hit.nz) + (Math.random() - 0.5);
          n.y = 0.14;
          n.tilt = 0;
          n.roll = 0;
          break;
        }
        case 'knocked': {
          n.vy -= 22 * dt;
          n.x += n.vx * dt;
          n.y += n.vy * dt;
          n.z += n.vz * dt;
          n.roll += n.spin * dt;
          const pos = { x: n.x, z: n.z };
          const hit = pushCircleXZ(pos, RADIUS, n.y, n.y + 1.7, this.grid);
          if (hit) {
            // bounce off walls
            const dot = n.vx * hit.nx + n.vz * hit.nz;
            if (dot < 0) {
              n.vx -= 1.6 * dot * hit.nx;
              n.vz -= 1.6 * dot * hit.nz;
            }
          }
          n.x = pos.x;
          n.z = pos.z;
          if (n.y <= 0.14) {
            n.y = 0.14;
            if (n.vy < -3) n.vy = -n.vy * 0.35;
            else n.vy = 0;
            n.vx *= 0.8;
            n.vz *= 0.8;
            n.spin *= 0.6;
            if (Math.hypot(n.vx, n.vz) < 1 && n.vy === 0) {
              n.state = 'down';
              n.timer = 1.4;
            }
          }
          n.timer += dt;
          if (n.timer > 6) {
            n.state = 'down';
            n.timer = 1;
          }
          break;
        }
        case 'down':
          n.timer -= dt;
          n.roll = lerp(n.roll, Math.round(n.roll / Math.PI) * Math.PI, dt * 5);
          n.tilt = lerp(n.tilt, Math.PI / 2, dt * 8);
          if (n.timer <= 0) {
            n.state = 'getup';
            n.timer = 0.6;
          }
          break;
        case 'getup':
          n.timer -= dt;
          n.tilt = lerp(n.tilt, 0, dt * 7);
          n.roll = lerp(n.roll, 0, dt * 7);
          if (n.timer <= 0) {
            n.state = 'panic';
            n.timer = 3;
            n.roll = 0;
            n.tilt = 0;
          }
          break;
      }
    }
    this.writeMatrices();
  }

  private writeMatrices() {
    const { m4, q, q2, v, sc, e } = this;
    this.npcs.forEach((n, i) => {
      const moving = n.state === 'walk' || n.state === 'panic';
      const bob = moving ? Math.abs(Math.sin(n.phase)) * 0.06 : 0;
      q.setFromEuler(e.set(0, n.yaw, 0));
      if (n.state === 'knocked') {
        q2.setFromAxisAngle(n.spinAxis, n.roll);
        q.premultiply(q2);
      } else if (n.tilt > 0.001 || Math.abs(n.roll) > 0.001) {
        q2.setFromEuler(e.set(-n.tilt, 0, 0));
        q.multiply(q2);
      }
      if (moving) {
        q2.setFromEuler(e.set(0, 0, Math.sin(n.phase) * 0.06));
        q.multiply(q2);
      }
      // rotate around the body centre rather than the feet
      const pivot = n.state === 'knocked' ? 0.9 : 0;
      v.set(0, -pivot, 0).applyQuaternion(q).add(this.sc.set(n.x, n.y + pivot + bob, n.z));
      sc.setScalar(n.scale);
      m4.compose(v, q, sc);
      this.bodies.setMatrixAt(i, m4);
      this.heads.setMatrixAt(i, m4);
      this.legs.setMatrixAt(i, m4);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }

  snapshot() {
    return this.npcs.map((n) => ({ x: +n.x.toFixed(1), z: +n.z.toFixed(1), state: n.state }));
  }
}

function cornerPos(b: Block, c: number) {
  const r = BLOCK / 2 - 1.5;
  const sx = c === 0 || c === 3 ? -1 : 1;
  const sz = c < 2 ? -1 : 1;
  return { x: b.cx + sx * r, z: b.cz + sz * r };
}

function nearestBlock(blocks: Block[], x: number, z: number) {
  let best = blocks[0],
    bd = Infinity;
  for (const b of blocks) {
    const d = (b.cx - x) ** 2 + (b.cz - z) ** 2;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

function nearestCorner(b: Block, x: number, z: number) {
  let best = 0,
    bd = Infinity;
  for (let c = 0; c < 4; c++) {
    const p = cornerPos(b, c);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
