import * as THREE from 'three';

/** Pooled point particles for confetti bursts, sparks and landing dust. */
export class Particles {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private c = new THREE.Color();

  constructor(private max = 600) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3).fill(-9999);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.28, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, n: number, colors: number[], speed = 6, up = 3) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const th = Math.random() * Math.PI * 2,
        ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      this.vel[i * 3 + 1] = Math.cos(ph) * s + up;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
      this.life[i] = 0.6 + Math.random() * 0.6;
      this.c.set(colors[k % colors.length]);
      this.col[i * 3] = this.c.r;
      this.col[i * 3 + 1] = this.c.g;
      this.col[i * 3 + 2] = this.c.b;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      this.vel[i * 3 + 1] -= 14 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.3;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.pos.fill(-9999);
  }
}

const WORDS: [string, string][] = [
  ['BONK!', '#ffd43b'],
  ['POW!', '#ff6b6b'],
  ['WHOA!', '#74c0fc'],
  ['BOING!', '#b197fc'],
  ['+RING', '#66f0ff'],
  ['THUD', '#ffffff'],
];

function wordTexture(word: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '700 64px "Clash Display", "Satoshi", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#1b1430';
  g.strokeText(word, 128, 50);
  g.fillStyle = color;
  g.fillText(word, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Floating comic words (world-space sprites so they also work in VR). */
export class Popups {
  group = new THREE.Group();
  private pool: { s: THREE.Sprite; life: number; vy: number }[] = [];
  private mats: THREE.SpriteMaterial[];
  private next = 0;
  constructor() {
    this.mats = WORDS.map(([w, c]) => new THREE.SpriteMaterial({ map: wordTexture(w, c), depthTest: false, transparent: true }));
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(this.mats[0].clone());
      s.visible = false;
      s.renderOrder = 10;
      this.group.add(s);
      this.pool.push({ s, life: 0, vy: 0 });
    }
  }
  show(word: 'BONK!' | 'POW!' | 'WHOA!' | 'BOING!' | '+RING' | 'THUD', x: number, y: number, z: number, scale = 1) {
    const idx = WORDS.findIndex((w) => w[0] === word);
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    (p.s.material as THREE.SpriteMaterial).map = this.mats[idx].map;
    p.s.position.set(x, y, z);
    p.s.scale.set(2.6 * scale, 1 * scale, 1);
    p.s.visible = true;
    p.life = 1;
    p.vy = 2.2;
  }
  randomHitWord(): 'BONK!' | 'POW!' | 'WHOA!' | 'BOING!' {
    return (['BONK!', 'POW!', 'WHOA!', 'BOING!'] as const)[Math.floor(Math.random() * 4)];
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (!p.s.visible) continue;
      p.life -= dt;
      p.s.position.y += p.vy * dt;
      p.vy *= 1 - dt * 2;
      (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, p.life * 2.5);
      if (p.life <= 0) p.s.visible = false;
    }
  }
  clear() {
    this.pool.forEach((p) => (p.s.visible = false));
  }
}

export interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  alive: boolean;
}

/** Kinetic pulse orbs fired from the gauntlet. */
export class Projectiles {
  group = new THREE.Group();
  list: Projectile[] = [];
  private next = 0;
  constructor(n = 24) {
    const geo = new THREE.IcosahedronGeometry(0.16, 1);
    const core = new THREE.MeshBasicMaterial({ color: 0xe6fcff });
    const glowGeo = new THREE.IcosahedronGeometry(0.32, 1);
    const glow = new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, core);
      m.add(new THREE.Mesh(glowGeo, glow));
      m.visible = false;
      this.group.add(m);
      this.list.push({ mesh: m, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, alive: false });
    }
  }
  fire(origin: THREE.Vector3, dir: THREE.Vector3, speed = 90) {
    const p = this.list[this.next];
    this.next = (this.next + 1) % this.list.length;
    p.pos.copy(origin);
    p.vel.copy(dir).multiplyScalar(speed);
    p.life = 1.4;
    p.alive = true;
    p.mesh.visible = true;
    p.mesh.position.copy(origin);
    return p;
  }
  kill(p: Projectile) {
    p.alive = false;
    p.mesh.visible = false;
  }
  clear() {
    this.list.forEach((p) => this.kill(p));
  }
}

/** Comfort vignette: darkens the periphery at high speed (VR + desktop). */
export function makeVignette(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.16, 1.2, 32);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying float r; void main(){ r = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float strength; varying float r; void main(){ float a = smoothstep(0.18, 0.42, r) * strength; gl_FragColor = vec4(0.04,0.02,0.1,a); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.z = -0.3;
  m.renderOrder = 999;
  m.frustumCulled = false;
  return m;
}
