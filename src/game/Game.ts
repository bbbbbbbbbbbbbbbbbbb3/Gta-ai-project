import * as THREE from 'three';
import { Sfx } from './audio';
import { Car, DriveInput } from './car';
import { CityData, generateCity } from './city';
import { buildCityMeshes } from './cityMesh';
import { Particles, Popups, Projectiles, makeVignette } from './fx';
import { Gauntlet, makeGauntlet } from './gauntlet';
import { GripTracker, V3 } from './grip';
import { Crowd } from './npcs';
import { Body, BoxGrid, GROUND, moveBody, raycastGrid, segPointDist2 } from './physics';

export type Mode = 'menu' | 'playing' | 'paused' | 'finished';
export type Platform = 'desktop' | 'touch' | 'vr';

export interface UiState {
  mode: Mode;
  platform: Platform;
  rings: number;
  ringsTotal: number;
  time: number;
  bestTime: number | null;
  score: number;
  knockouts: number;
  combo: number;
  nearest: { bearing: number; dist: number; dy: number } | null;
  aim: 'none' | 'grapple' | 'far';
  aimDist: number;
  grappling: boolean;
  prompt: string | null;
  hint: string | null;
  inCar: boolean;
  speed: number;
  xrSupported: boolean;
  xrActive: boolean;
  pointerLocked: boolean;
  muted: boolean;
  fps: number;
  drawCalls: number;
  flash: number; // increments on events for HUD pulses
}

export interface TouchInput {
  moveX: number;
  moveY: number;
  lookDX: number;
  lookDY: number;
  jump: boolean;
  grapple: boolean;
  fire: boolean;
}

const EYE = 1.65;
const GRAVITY = 24;
const WALK = 8;
const SPRINT = 13;
const JUMP_V = 8.6;
const GRAPPLE_RANGE = 85;
const FIRE_COOLDOWN = 0.2;
const FIXED = 1 / 60;
const RING_RADIUS = 2.8;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig = new THREE.Group();
  city: CityData;
  grid: BoxGrid;
  crowd: Crowd;
  car = new Car();
  particles = new Particles();
  popups = new Popups();
  projectiles = new Projectiles();
  sfx = new Sfx();
  grip = new GripTracker();

  mode: Mode = 'menu';
  platform: Platform;
  body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, halfW: 0.35, height: 1.8, grounded: true };
  yaw = 0;
  pitch = 0;
  inCar = false;
  time = 0;
  bestTime: number | null = null;
  score = 0;
  knockouts = 0;
  combo = 1;
  comboTimer = 0;
  ringsCollected: boolean[] = [];
  onUi: ((s: UiState) => void) | null = null;

  // input
  keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseFire = false;
  private mouseGrapple = false;
  private lookDX = 0;
  private lookDY = 0;
  touch: TouchInput = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, grapple: false, fire: false };
  private touchJumpPrev = false;
  pointerLocked = false;
  private hadPointerLock = false;

  // movement state
  private coyote = 0;
  private jumpBuffer = 0;
  private airJumps = 1;
  private landDip = 0;
  private bob = 0;
  private wasGrounded = true;
  private prevVy = 0;
  private walked = 0;
  private fireCd = 0;
  private recoil = 0;
  private grappleLockout = false;
  grapple = { active: false, anchor: new THREE.Vector3(), len: 0, used: false };
  private aim: { kind: UiState['aim']; dist: number; point: THREE.Vector3; normal: THREE.Vector3 } = {
    kind: 'none',
    dist: 0,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
  };
  private fired = false;
  private hintStep = 0;
  private hintTimer = 0;
  private shake = 0;
  private flash = 0;

  // visuals
  private gauntletL: Gauntlet;
  private gauntletR: Gauntlet;
  private viewmodel = new THREE.Group();
  private rope: THREE.Line;
  private aimMarker: THREE.Mesh;
  private ringMesh: THREE.InstancedMesh;
  private beamMesh: THREE.InstancedMesh;
  private vignette: THREE.Mesh;
  private ringSpin = 0;

  // XR
  xrSupported = false;
  xrActive = false;
  private xrHands: { grip: THREE.Group; ray: THREE.Group; gauntlet: Gauntlet; handed: 'left' | 'right'; gp?: Gamepad }[] = [];
  private snapCooldown = 0;
  private xrPrevButtons: boolean[][] = [[], []];

  // loop
  private clock = new THREE.Clock();
  private acc = 0;
  private uiTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private ac = new AbortController();

  constructor(private container: HTMLElement) {
    this.platform = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop';
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(container.clientWidth, container.clientHeight);
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFoveation(1);
    container.appendChild(r.domElement);
    r.domElement.style.display = 'block';
    r.domElement.tabIndex = 0;

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 1200);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // World
    this.city = generateCity();
    this.grid = new BoxGrid(this.city.boxes);
    const { root, sky } = buildCityMeshes(this.city);
    this.scene.add(root, sky);
    this.scene.fog = new THREE.Fog(0xffb98a, 140, 520);
    this.scene.background = new THREE.Color(0xffb98a);
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a6d5a, 1.25);
    const sun = new THREE.DirectionalLight(0xffe2c4, 1.7);
    sun.position.set(-0.5, 0.8, -0.6);
    this.scene.add(hemi, sun);

    this.crowd = new Crowd(this.city.blocks, this.grid);
    this.scene.add(this.crowd.group, this.car.group, this.particles.points, this.popups.group, this.projectiles.group);

    // Rings + beacons
    const n = this.city.rings.length;
    this.ringMesh = new THREE.InstancedMesh(
      new THREE.TorusGeometry(RING_RADIUS, 0.28, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x66f0ff }),
      n,
    );
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 120, 6, 1, true);
    beamGeo.translate(0, 60, 0);
    this.beamMesh = new THREE.InstancedMesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.22, depthWrite: false, fog: false }),
      n,
    );
    this.scene.add(this.ringMesh, this.beamMesh);

    // Desktop viewmodel gauntlets
    this.gauntletL = makeGauntlet('left');
    this.gauntletR = makeGauntlet('right');
    this.gauntletL.root.scale.setScalar(1.25);
    this.gauntletR.root.scale.setScalar(1.25);
    this.viewmodel.add(this.gauntletL.root, this.gauntletR.root);
    this.camera.add(this.viewmodel);
    this.vignette = makeVignette();
    this.camera.add(this.vignette);

    // Grapple rope + aim marker
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x66f0ff }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.75, 20),
      new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }),
    );
    this.aimMarker.renderOrder = 5;
    this.aimMarker.visible = false;
    this.scene.add(this.rope, this.aimMarker);

    this.setupXR();
    this.bindInput();
    this.resetWorld();
    this.mode = 'menu';

    window.addEventListener('resize', () => this.resize(), { signal: this.ac.signal });
    r.setAnimationLoop(() => this.frame());
    (window as any).advanceTime = (ms: number) => this.advanceTime(ms);
    (window as any).render_game_to_text = () => this.renderGameToText();
    (window as any).__game = this;
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.sfx.init();
    if (this.mode === 'finished' || this.mode === 'menu') this.resetWorld();
    this.mode = 'playing';
    this.clock.getDelta();
    this.requestLock();
    this.emitUi(true);
  }

  restart() {
    this.sfx.init();
    this.resetWorld();
    this.mode = 'playing';
    this.requestLock();
    this.emitUi(true);
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.mouseFire = this.mouseGrapple = false;
    this.endGrapple(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.emitUi(true);
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.clock.getDelta();
    this.requestLock();
    this.emitUi(true);
  }

  quitToMenu() {
    this.mode = 'menu';
    this.inCar = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.emitUi(true);
  }

  setMuted(m: boolean) {
    this.sfx.setMuted(m);
    this.emitUi(true);
  }

  private resetWorld() {
    const s = this.city.spawn;
    Object.assign(this.body, { x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, grounded: true });
    this.yaw = s.yaw;
    this.pitch = -0.05;
    this.inCar = false;
    this.car.place(this.city.carSpawn.x, this.city.carSpawn.z, this.city.carSpawn.yaw);
    this.crowd.reset();
    this.particles.clear();
    this.popups.clear();
    this.projectiles.clear();
    this.endGrapple(false);
    this.ringsCollected = this.city.rings.map(() => false);
    this.time = 0;
    this.score = 0;
    this.knockouts = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.walked = 0;
    this.hintTimer = 0;
    this.fired = false;
    this.grapple.used = false;
    this.hintStep = 0;
    this.writeRings();
  }

  dispose() {
    this.ac.abort();
    this.renderer.setAnimationLoop(null);
    this.sfx.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ---------------------------------------------------------------- input
  private requestLock() {
    if (this.platform !== 'desktop' || this.xrActive) return;
    const el = this.renderer.domElement as HTMLCanvasElement & { requestPointerLock: () => any };
    try {
      const p = el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock blocked (e.g. sandboxed iframe): fall back to free mouse look */
    }
  }

  private bindInput() {
    const sig = { signal: this.ac.signal };
    const el = this.renderer.domElement;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        const playing = this.mode === 'playing';
        if (playing && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        this.keys.add(e.code);
        this.pressed.add(e.code);
        if (e.code === 'Escape' || e.code === 'KeyP') {
          if (this.mode === 'playing') this.pause();
          else if (this.mode === 'paused' && e.code === 'KeyP') this.resume();
        }
        if (e.code === 'KeyR' && (this.mode === 'finished' || this.mode === 'paused')) this.restart();
        if (e.code === 'KeyM') this.setMuted(!this.sfx.muted);
        if (e.code === 'Enter' && this.mode === 'menu') this.start();
      },
      sig,
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), sig);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = this.mouseGrapple = false;
    }, sig);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
    el.addEventListener(
      'mousedown',
      (e) => {
        if (this.mode !== 'playing') return;
        this.sfx.init();
        if (!this.pointerLocked) this.requestLock();
        if (e.button === 0) this.mouseFire = true;
        if (e.button === 2) this.mouseGrapple = true;
      },
      sig,
    );
    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 0) this.mouseFire = false;
        if (e.button === 2) this.mouseGrapple = false;
      },
      sig,
    );
    window.addEventListener(
      'mousemove',
      (e) => {
        if (this.mode !== 'playing' || this.platform !== 'desktop') return;
        // With pointer lock: classic FPS look. Without (sandboxed iframes):
        // relative mouse movement still turns the view.
        if (this.pointerLocked || e.target === el) {
          this.lookDX += e.movementX;
          this.lookDY += e.movementY;
        }
      },
      sig,
    );
    document.addEventListener(
      'pointerlockchange',
      () => {
        this.pointerLocked = document.pointerLockElement === el;
        if (this.pointerLocked) this.hadPointerLock = true;
        else if (this.hadPointerLock && this.mode === 'playing') this.pause();
        this.emitUi(true);
      },
      sig,
    );
  }

  private consumePress(code: string) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  // ---------------------------------------------------------------- XR
  private setupXR() {
    const xr = (navigator as any).xr;
    if (xr?.isSessionSupported) {
      xr.isSessionSupported('immersive-vr')
        .then((ok: boolean) => {
          this.xrSupported = ok;
          this.emitUi(true);
        })
        .catch(() => {});
    }
    for (let i = 0; i < 2; i++) {
      const ray = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      const gauntlet = makeGauntlet(i === 0 ? 'left' : 'right');
      gauntlet.root.rotation.x = -0.5; // align with controller grip pose
      grip.add(gauntlet.root);
      this.rig.add(ray, grip);
      const hand = { grip, ray, gauntlet, handed: (i === 0 ? 'left' : 'right') as 'left' | 'right', gp: undefined as Gamepad | undefined };
      this.xrHands.push(hand);
      ray.addEventListener('connected', (e: any) => {
        hand.handed = e.data?.handedness === 'left' ? 'left' : 'right';
        hand.gp = e.data?.gamepad;
      });
      ray.addEventListener('squeezestart', () => this.xrGrab(i));
      ray.addEventListener('squeezeend', () => this.xrRelease(i));
      ray.addEventListener('selectstart', () => this.xrFire(i));
    }
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.xrActive = true;
      this.platform = 'vr';
      this.viewmodel.visible = false;
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.rig.rotation.set(0, this.yaw, 0);
      this.hintStep = 0;
      this.hintTimer = 0;
      if (this.mode !== 'playing') this.start();
      this.emitUi(true);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.xrActive = false;
      this.platform = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop';
      this.viewmodel.visible = true;
      this.grip.release(0);
      this.grip.release(1);
      this.camera.position.set(0, EYE, 0);
      this.camera.rotation.set(0, 0, 0);
      this.camera.quaternion.identity();
      this.pause();
      this.emitUi(true);
    });
  }

  async enterVR() {
    const xr = (navigator as any).xr;
    if (!xr) return;
    this.sfx.init();
    const session = await xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await this.renderer.xr.setSession(session);
  }

  private handPosWorldOriented(i: number, out: V3): V3 {
    tmpV.copy(this.xrHands[i].grip.position).applyQuaternion(this.rig.quaternion);
    out.x = tmpV.x;
    out.y = tmpV.y;
    out.z = tmpV.z;
    return out;
  }

  private xrGrab(i: number) {
    if (this.mode !== 'playing' || this.inCar) return;
    const hand = this.xrHands[i];
    hand.grip.getWorldPosition(tmpV);
    const near = this.grid.near(tmpV.x - 0.4, tmpV.z - 0.4, tmpV.x + 0.4, tmpV.z + 0.4);
    let surface = tmpV.y < 0.35;
    for (const b of near) {
      const dx = Math.max(b.minX - tmpV.x, 0, tmpV.x - b.maxX);
      const dy = Math.max(b.minY - tmpV.y, 0, tmpV.y - b.maxY);
      const dz = Math.max(b.minZ - tmpV.z, 0, tmpV.z - b.maxZ);
      if (dx * dx + dy * dy + dz * dz < 0.3 * 0.3) surface = true;
    }
    const p = { x: 0, y: 0, z: 0 };
    this.grip.grab(i, this.handPosWorldOriented(i, p), surface);
    this.pulse(i, surface ? 0.6 : 0.25, 40);
    this.sfx.grab();
    this.grapple.used = true;
  }

  private xrRelease(i: number) {
    this.grip.release(i);
  }

  private xrFire(i: number) {
    if (this.mode !== 'playing' || this.inCar) return;
    const hand = this.xrHands[i];
    hand.ray.getWorldPosition(tmpV);
    hand.ray.getWorldQuaternion(tmpQ);
    tmpV2.set(0, 0, -1).applyQuaternion(tmpQ);
    this.fireFrom(tmpV, tmpV2, hand.gauntlet);
    this.pulse(i, 0.4, 30);
  }

  private pulse(i: number, intensity: number, ms: number) {
    const gp: any = this.xrHands[i]?.gp;
    gp?.hapticActuators?.[0]?.pulse?.(intensity, ms);
  }

  private xrGamepad(handed: 'left' | 'right') {
    const h = this.xrHands.find((x) => x.handed === handed);
    return h?.gp;
  }

  private xrButtonPressed(handIdx: number, btn: number, gp?: Gamepad) {
    const now = !!gp?.buttons[btn]?.pressed;
    const prev = !!this.xrPrevButtons[handIdx][btn];
    this.xrPrevButtons[handIdx][btn] = now;
    return now && !prev;
  }

  // ---------------------------------------------------------------- loop
  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.applyLook();
    // Once a test harness drives time via advanceTime(), stop real-time stepping.
    this.acc = this.manualTime ? 0 : this.acc + dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 6) {
      this.update(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    this.render(dt);
    this.uiTimer += dt;
    if (this.uiTimer > 0.1) {
      this.uiTimer = 0;
      this.emitUi();
    }
  }

  private manualTime = false;
  advanceTime(ms: number) {
    this.manualTime = true;
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) {
      this.applyLook();
      this.update(FIXED);
    }
    this.render(FIXED);
    this.emitUi(true);
  }

  private applyLook() {
    if (this.xrActive) return;
    const sens = 0.0024;
    this.yaw -= (this.lookDX + this.touch.lookDX * 2.2) * sens;
    this.pitch -= (this.lookDY + this.touch.lookDY * 2.2) * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.lookDX = this.lookDY = 0;
    this.touch.lookDX = this.touch.lookDY = 0;
  }

  private update(dt: number) {
    this.ringSpin += dt;
    this.crowd.update(dt);
    this.particles.update(dt);
    this.popups.update(dt);
    if (this.mode !== 'playing') {
      if (!this.inCar) this.car.update(dt, null, this.grid);
      this.pressed.clear();
      return;
    }
    this.time += dt;
    this.fireCd -= dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 1;
    this.shake *= 1 - dt * 8;

    if (this.xrActive) this.updateVR(dt);
    else if (this.inCar) this.updateCar(dt);
    else this.updateOnFoot(dt);

    if (!this.inCar) this.car.update(dt, null, this.grid);
    this.updateProjectiles(dt);
    this.collectRings();
    this.updateHints(dt);

    if (this.body.y < -30) this.respawn();
    this.sfx.setWind(Math.hypot(this.body.vx, this.body.vy, this.body.vz) * (this.inCar ? 0 : 1));
    this.sfx.setEngine(this.inCar, this.car.forwardSpeed);
    this.pressed.clear();
  }

  private wishDir(out: THREE.Vector3): THREE.Vector3 {
    let f = 0,
      s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    f += -this.touch.moveY;
    s += this.touch.moveX;
    const len = Math.hypot(f, s);
    if (len > 1) {
      f /= len;
      s /= len;
    }
    const sy = Math.sin(this.yaw),
      cy = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    return out.set(-sy * f + cy * s, 0, -cy * f - sy * s);
  }

  private updateOnFoot(dt: number) {
    const b = this.body;
    const wish = this.wishDir(tmpV2);
    const wishLen = wish.length();
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.platform === 'touch';
    const speed = sprint ? SPRINT : WALK;

    // jump buffering + coyote time make jumps reliable
    const touchJump = this.touch.jump && !this.touchJumpPrev;
    this.touchJumpPrev = this.touch.jump;
    if (this.consumePress('Space') || touchJump) this.jumpBuffer = 0.14;
    this.jumpBuffer -= dt;
    if (b.grounded) {
      this.coyote = 0.12;
      this.airJumps = 1;
    } else this.coyote -= dt;

    // grapple
    const wantGrapple = this.mouseGrapple || this.keys.has('KeyQ') || this.touch.grapple;
    // After a zip-launch, require releasing the button before grappling again.
    if (!wantGrapple) this.grappleLockout = false;
    if (wantGrapple && !this.grapple.active && !this.grappleLockout) this.startGrapple();
    if (!wantGrapple && this.grapple.active) this.endGrapple(true);

    if (b.grounded && !this.grapple.active) {
      const k = Math.min(1, dt * (wishLen > 0 ? 14 : 18));
      b.vx += (wish.x * speed - b.vx) * k;
      b.vz += (wish.z * speed - b.vz) * k;
      if (wishLen > 0) this.walked += Math.hypot(b.vx, b.vz) * dt;
    } else {
      // air control that never kills momentum gained from swings
      const along = b.vx * wish.x + b.vz * wish.z;
      if (along < speed) {
        b.vx += wish.x * 16 * dt;
        b.vz += wish.z * 16 * dt;
      }
      const drag = 1 - 0.08 * dt;
      b.vx *= drag;
      b.vz *= drag;
    }

    if (this.jumpBuffer > 0) {
      if (this.coyote > 0) {
        b.vy = JUMP_V;
        this.coyote = 0;
        this.jumpBuffer = 0;
        b.grounded = false;
      } else if (this.grapple.active) {
        // Space while swinging = reel in faster (handled below)
      } else if (this.airJumps > 0) {
        // gauntlet pulse hop
        this.airJumps--;
        b.vy = Math.max(b.vy, JUMP_V * 0.85);
        this.jumpBuffer = 0;
        this.particles.burst(b.x, b.y, b.z, 14, [0x66f0ff, 0xffffff], 4, -1);
        this.sfx.release();
      }
    }

    b.vy -= GRAVITY * dt;
    let extraX = 0,
      extraY = 0,
      extraZ = 0;
    if (this.grapple.active) {
      const a = this.grapple.anchor;
      const cx = b.x,
        cy = b.y + 1.0,
        cz = b.z;
      tmpV.set(a.x - cx, a.y - cy, a.z - cz);
      const dist = tmpV.length();
      tmpV.divideScalar(Math.max(dist, 1e-4));
      const reel = this.keys.has('Space') || this.touch.jump ? 26 : 13;
      this.grapple.len = Math.max(2.5, Math.min(this.grapple.len, dist) - reel * dt);
      b.vx += tmpV.x * 8 * dt + wish.x * 14 * dt;
      b.vy += tmpV.y * 8 * dt;
      b.vz += tmpV.z * 8 * dt + wish.z * 14 * dt;
      if (dist > this.grapple.len) {
        // Taut rope: cancel outward motion and reel in at least `reel` m/s so
        // a grapple from street level reliably lifts you into a swing.
        const vdot = b.vx * tmpV.x + b.vy * tmpV.y + b.vz * tmpV.z;
        const want = Math.min(reel, (dist - this.grapple.len) * 10 + reel * 0.6);
        if (vdot < want) {
          const add = want - vdot;
          b.vx += tmpV.x * add;
          b.vy += tmpV.y * add;
          b.vz += tmpV.z * add;
        }
        const corr = Math.min(0.5, (dist - this.grapple.len) * 0.2);
        extraX = tmpV.x * corr;
        extraY = tmpV.y * corr;
        extraZ = tmpV.z * corr;
      }
      if (b.vy > 20) b.vy = 20; // comfort: no violent vertical whips
      // Zip-launch: arriving at the anchor pops you up and over the ledge.
      if (dist < 3.2) {
        const h = Math.hypot(tmpV.x, tmpV.z) || 1;
        b.vx = (tmpV.x / h) * 7 + b.vx * 0.3;
        b.vz = (tmpV.z / h) * 7 + b.vz * 0.3;
        b.vy = 13;
        this.grapple.active = false;
        this.grappleLockout = true;
        this.sfx.release();
        this.particles.burst(a.x, a.y, a.z, 16, [0x66f0ff, 0xffffff], 5, 2);
      }
      // cap for comfort / tunnelling
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      if (sp > 42) {
        const s = 42 / sp;
        b.vx *= s;
        b.vy *= s;
        b.vz *= s;
      }
    }

    this.prevVy = b.vy;
    const res = moveBody(b, b.vx * dt + extraX, b.vy * dt + extraY, b.vz * dt + extraZ, this.grid);

    // mantle onto ledges up to ~2m when pushing into them
    if ((res.hitX || res.hitZ) && wishLen > 0.2) {
      const rise = res.wallTop - b.y;
      if (rise > 0.55 && rise < 2.1 && b.vy < 7) {
        b.vy = 7.5;
        b.vx += wish.x * 2;
        b.vz += wish.z * 2;
      }
    }

    if (!this.wasGrounded && b.grounded && this.prevVy < -9) {
      const power = -this.prevVy;
      this.landDip = Math.min(0.35, power * 0.012);
      this.sfx.land(power);
      this.particles.burst(b.x, b.y + 0.1, b.z, Math.min(30, Math.floor(power)), [0xe9ecef, 0xced4da], 3, 1);
      if (power > 18) this.shockwave(b.x, b.z, power);
    }
    this.wasGrounded = b.grounded;
    this.updateAim();

    // shooting
    const wantFire = this.mouseFire || this.touch.fire;
    if (wantFire && this.fireCd <= 0) this.fireFromCamera();

    // car
    if (this.consumePress('KeyF') && this.nearCar()) this.enterCar();
  }

  /** Heavy landings bowl over nearby pedestrians (superhero landing). */
  private shockwave(x: number, z: number, power: number) {
    const r = Math.min(7, power * 0.25);
    this.crowd.npcs.forEach((n, i) => {
      const dx = n.x - x,
        dz = n.z - z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 0.01) this.knockNpc(i, (dx / d) * 8, 6, (dz / d) * 8, n.x, n.z, 'WHOA!');
    });
    this.shake = 0.6;
  }

  private startGrapple() {
    if (this.aim.kind !== 'grapple') return;
    this.grapple.active = true;
    this.grapple.anchor.copy(this.aim.point);
    this.grapple.len = this.aim.dist;
    this.grapple.used = true;
    this.sfx.thwip();
    // small hop so grappling from the ground lifts you off immediately
    if (this.body.grounded) {
      this.body.vy = Math.max(this.body.vy, 5);
      this.body.grounded = false;
    }
  }

  private endGrapple(boost: boolean) {
    if (!this.grapple.active) return;
    this.grapple.active = false;
    if (boost) {
      const b = this.body;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 6) {
        b.vx += (b.vx / sp) * 2.5;
        b.vz += (b.vz / sp) * 2.5;
        b.vy = Math.max(b.vy + 3, 4);
      }
      this.sfx.release();
    }
  }

  /** Forgiving grapple targeting: a few rays around the crosshair, biased upward. */
  /** Keep camera matrices current before aiming/firing within a fixed step. */
  private syncFootCamera() {
    const b = this.body;
    this.rig.position.set(b.x, b.y, b.z);
    this.rig.rotation.set(0, this.yaw, 0);
    this.camera.position.set(0, EYE, 0);
    this.camera.rotation.set(this.pitch, 0, 0);
    this.rig.updateMatrixWorld(true);
  }

  private updateAim() {
    this.aim.kind = 'none';
    if (!this.xrActive && !this.inCar) this.syncFootCamera();
    if (this.grapple.active || this.inCar || this.xrActive) {
      this.aimMarker.visible = false;
      return;
    }
    this.camera.getWorldPosition(tmpV);
    const offsets = [
      [0, 0],
      [0.05, 0],
      [0.1, 0],
      [0.05, 0.05],
      [0.05, -0.05],
      [0.17, 0],
    ];
    let best: { t: number; nx: number; ny: number; nz: number; dx: number; dy: number; dz: number } | null = null;
    let far = false;
    for (const [dp, dyaw] of offsets) {
      const p = this.pitch + dp,
        y = this.yaw + dyaw;
      const dx = -Math.sin(y) * Math.cos(p),
        dy = Math.sin(p),
        dz = -Math.cos(y) * Math.cos(p);
      const hit = raycastGrid(this.grid, tmpV.x, tmpV.y, tmpV.z, dx, dy, dz, GRAPPLE_RANGE * 1.6);
      if (!hit || hit.box === GROUND || hit.box.maxY > 300) continue;
      if (hit.t > GRAPPLE_RANGE) {
        far = true;
        continue;
      }
      best = { t: hit.t, nx: hit.nx, ny: hit.ny, nz: hit.nz, dx, dy, dz };
      break;
    }
    if (best) {
      this.aim.kind = 'grapple';
      this.aim.dist = best.t;
      this.aim.point.set(tmpV.x + best.dx * best.t, tmpV.y + best.dy * best.t, tmpV.z + best.dz * best.t);
      this.aim.normal.set(best.nx, best.ny, best.nz);
      this.aimMarker.visible = true;
      this.aimMarker.position.copy(this.aim.point).addScaledVector(this.aim.normal, 0.05);
      this.aimMarker.lookAt(tmpV2.copy(this.aim.point).add(this.aim.normal));
      const s = 0.6 + best.t * 0.03;
      this.aimMarker.scale.setScalar(s);
    } else {
      this.aim.kind = far ? 'far' : 'none';
      this.aimMarker.visible = false;
    }
  }

  private fireFromCamera() {
    this.camera.getWorldPosition(tmpV);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(tmpQ));
    // aim point: whatever is under the crosshair
    const hit = raycastGrid(this.grid, tmpV.x, tmpV.y, tmpV.z, dir.x, dir.y, dir.z, 160);
    const target = tmpV.clone().addScaledVector(dir, hit ? hit.t : 160);
    const origin = new THREE.Vector3();
    this.gauntletR.root.getWorldPosition(origin);
    origin.addScaledVector(dir, 0.25);
    const d = target.sub(origin).normalize();
    this.fireFrom(origin, d, this.gauntletR);
    this.recoil = 1;
  }

  private fireFrom(origin: THREE.Vector3, dir: THREE.Vector3, g: Gauntlet) {
    if (this.fireCd > 0) return;
    this.fireCd = FIRE_COOLDOWN;
    this.projectiles.fire(origin, dir);
    this.sfx.fire();
    g.flash(1);
    this.fired = true;
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles.list) {
      if (!p.alive) continue;
      const ax = p.pos.x,
        ay = p.pos.y,
        az = p.pos.z;
      const segLen = p.vel.length() * dt;
      tmpV.copy(p.vel).normalize();
      const wall = raycastGrid(this.grid, ax, ay, az, tmpV.x, tmpV.y, tmpV.z, segLen);
      const len = wall ? wall.t : segLen;
      const bx = ax + tmpV.x * len,
        by = ay + tmpV.y * len,
        bz = az + tmpV.z * len;
      // NPCs
      let hitNpc = -1;
      for (let i = 0; i < this.crowd.npcs.length; i++) {
        const n = this.crowd.npcs[i];
        if (segPointDist2(ax, ay, az, bx, by, bz, n.x, n.y + 0.95, n.z) < 0.75 * 0.75) {
          hitNpc = i;
          break;
        }
      }
      if (hitNpc >= 0) {
        const n = this.crowd.npcs[hitNpc];
        this.knockNpc(hitNpc, tmpV.x * 13, 6.5, tmpV.z * 13, n.x, n.z);
        this.projectiles.kill(p);
        continue;
      }
      // car
      if (segPointDist2(ax, ay, az, bx, by, bz, this.car.x, 1, this.car.z) < 2.2 * 2.2) {
        this.car.shove(tmpV.x * 4, tmpV.z * 4);
        this.particles.burst(bx, by, bz, 12, [0xffd43b, 0xffffff], 5);
        this.sfx.spark();
        this.projectiles.kill(p);
        continue;
      }
      if (wall) {
        this.particles.burst(bx, by, bz, 10, [0x66f0ff, 0xffffff, 0x99e9f2], 5, 1);
        this.projectiles.kill(p);
        continue;
      }
      p.pos.set(bx, by, bz);
      p.mesh.position.copy(p.pos);
      p.life -= dt;
      if (p.life <= 0) this.projectiles.kill(p);
    }
  }

  private knockNpc(i: number, ix: number, iy: number, iz: number, x: number, z: number, word?: 'WHOA!' | 'BONK!') {
    const fresh = this.crowd.knock(i, ix, iy, iz);
    const n = this.crowd.npcs[i];
    this.particles.burst(n.x, n.y + 1.2, n.z, 22, [0xffd43b, 0xff6b6b, 0x74c0fc, 0xb197fc, 0x69db7c], 6, 3);
    this.crowd.scare(x, z, 16);
    this.sfx.hit();
    if (fresh) {
      this.knockouts++;
      this.score += 100 * this.combo;
      this.popups.show(word ?? this.popups.randomHitWord(), n.x, n.y + 2.4, n.z, this.combo > 1 ? 1.25 : 1);
      this.combo = Math.min(8, this.combo + 1);
      this.comboTimer = 2.5;
      this.flash++;
    }
  }

  // ---------------------------------------------------------------- car
  private nearCar() {
    return Math.hypot(this.body.x - this.car.x, this.body.z - this.car.z) < 4.5 && this.body.y < 3;
  }

  private enterCar() {
    this.inCar = true;
    this.endGrapple(false);
    this.grip.release(0);
    this.grip.release(1);
    this.sfx.door();
    this.camYaw = this.car.yaw;
  }

  private exitCar() {
    this.inCar = false;
    this.sfx.door();
    const c = this.car;
    for (const side of [-1, 1]) {
      const x = c.x + Math.cos(c.yaw) * 2.6 * side,
        z = c.z - Math.sin(c.yaw) * 2.6 * side;
      const near = this.grid.near(x - 0.5, z - 0.5, x + 0.5, z + 0.5);
      if (!near.some((b) => x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4)) {
        Object.assign(this.body, { x, y: 0, z, vx: c.vx * 0.4, vy: 0, vz: c.vz * 0.4 });
        this.yaw = c.yaw;
        this.pitch = -0.05;
        return;
      }
    }
    Object.assign(this.body, { x: c.x, y: 1.9, z: c.z, vx: 0, vy: 0, vz: 0 });
  }

  private camYaw = 0;
  private camPos = new THREE.Vector3();

  private driveInput(): DriveInput {
    let t = 0,
      s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) t += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) t -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s -= 1;
    t += -this.touch.moveY;
    s += -this.touch.moveX;
    return {
      throttle: Math.max(-1, Math.min(1, t)),
      steer: Math.max(-1, Math.min(1, s)),
      handbrake: this.keys.has('Space') || this.touch.jump,
    };
  }

  private updateCar(dt: number, input?: DriveInput) {
    const c = this.car;
    const impact = c.update(dt, input ?? this.driveInput(), this.grid);
    if (impact > 4) {
      this.sfx.crash(impact);
      this.shake = Math.min(1, impact / 20);
      this.particles.burst(c.x - Math.sin(c.yaw) * 2.2, 0.8, c.z - Math.cos(c.yaw) * 2.2, 14, [0xffd43b, 0xadb5bd], 5);
    }
    // bowl over pedestrians
    const sp = c.speed;
    if (sp > 2.5) {
      this.crowd.npcs.forEach((n, i) => {
        if (n.state === 'knocked') return;
        if ((n.x - c.x) ** 2 + (n.z - c.z) ** 2 < 2.5 * 2.5) {
          this.knockNpc(i, c.vx * 0.9, 5 + sp * 0.25, c.vz * 0.9, n.x, n.z, 'WHOA!');
          c.vx *= 0.93;
          c.vz *= 0.93;
        }
      });
    }
    if (this.consumePress('KeyH')) this.sfx.horn();
    this.body.x = c.x;
    this.body.z = c.z;
    this.body.y = 0;
    this.body.vx = c.vx;
    this.body.vz = c.vz;
    this.body.vy = 0;
    if (this.consumePress('KeyF')) this.exitCar();
  }

  // ---------------------------------------------------------------- VR
  private updateVR(dt: number) {
    const b = this.body;
    const left = this.xrGamepad('left');
    const right = this.xrGamepad('right');
    const li = this.xrHands.findIndex((h) => h.handed === 'left');
    const ri = this.xrHands.findIndex((h) => h.handed === 'right');

    // snap turn (right stick), pivoting around the head
    this.snapCooldown -= dt;
    const rx = right?.axes[2] ?? 0;
    if (Math.abs(rx) > 0.7 && this.snapCooldown <= 0) {
      const head = this.camera.getWorldPosition(new THREE.Vector3());
      const angle = rx > 0 ? -Math.PI / 6 : Math.PI / 6;
      this.rig.rotation.y += angle;
      const offset = tmpV.set(this.rig.position.x - head.x, 0, this.rig.position.z - head.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      b.x = head.x + offset.x;
      b.z = head.z + offset.z;
      this.snapCooldown = 0.3;
      this.grip.resetReference([0, 1].map((i) => this.handPosWorldOriented(i, { x: 0, y: 0, z: 0 })));
    }
    if (Math.abs(rx) < 0.3) this.snapCooldown = 0;
    this.yaw = this.rig.rotation.y;

    if (this.inCar) {
      const ly = left?.axes[3] ?? 0,
        lx = left?.axes[2] ?? 0;
      const trig = right?.buttons[0]?.value ?? 0;
      const brake = left?.buttons[0]?.value ?? 0;
      this.updateCar(dt, { throttle: Math.max(-1, Math.min(1, trig - brake - ly)), steer: -lx, handbrake: !!right?.buttons[1]?.pressed });
      if (this.xrButtonPressed(ri < 0 ? 1 : ri, 5, right) || this.xrButtonPressed(li < 0 ? 0 : li, 5, left)) this.exitCar();
      return;
    }

    for (let i = 0; i < 2; i++) {
      const g = this.xrHands[i].gauntlet;
      g.setGrip(this.grip.hands[i].held ? 1 : 0.15);
      g.flash(Math.max(0, this.fireCd / FIRE_COOLDOWN));
    }
    const positions = [0, 1].map((i) => this.handPosWorldOriented(i, { x: 0, y: 0, z: 0 }));
    const out = this.grip.update(positions, dt);
    if (out.phase === 'held') {
      b.vx = out.velocity.x;
      b.vy = out.velocity.y;
      b.vz = out.velocity.z;
    } else {
      if (out.phase === 'launched') {
        b.vx = out.velocity.x;
        b.vy = out.velocity.y;
        b.vz = out.velocity.z;
        this.sfx.release();
      }
      // optional gentle stick walking for accessibility
      const lx = left?.axes[2] ?? 0,
        ly = left?.axes[3] ?? 0;
      if (b.grounded) {
        tmpV.set(lx, 0, ly).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.headYaw());
        const k = Math.min(1, dt * 10);
        b.vx += (tmpV.x * 3.5 - b.vx) * k;
        b.vz += (tmpV.z * 3.5 - b.vz) * k;
      } else {
        b.vx *= 1 - 0.1 * dt;
        b.vz *= 1 - 0.1 * dt;
      }
      b.vy -= GRAVITY * 0.85 * dt;
    }
    this.prevVy = b.vy;
    moveBody(b, b.vx * dt, b.vy * dt, b.vz * dt, this.grid);
    if (!this.wasGrounded && b.grounded && this.prevVy < -9) {
      this.sfx.land(-this.prevVy);
      this.particles.burst(b.x, b.y + 0.1, b.z, 16, [0xe9ecef], 3, 1);
      if (-this.prevVy > 18) this.shockwave(b.x, b.z, -this.prevVy);
    }
    this.wasGrounded = b.grounded;

    // A / X near the car to drive
    const aPressed = this.xrButtonPressed(ri < 0 ? 1 : ri, 4, right) || this.xrButtonPressed(li < 0 ? 0 : li, 4, left);
    if (aPressed && this.nearCar()) this.enterCar();
  }

  private headYaw() {
    this.camera.getWorldQuaternion(tmpQ);
    const e = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ');
    return e.y;
  }

  // ---------------------------------------------------------------- rings / hints
  private writeRings() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.city.rings.forEach((r, i) => {
      const got = this.ringsCollected[i];
      q.setFromEuler(new THREE.Euler(0, this.ringSpin * 0.8 + i, 0));
      s.setScalar(got ? 0 : 1 + Math.sin(this.ringSpin * 3 + i) * 0.04);
      m.compose(tmpV.set(r.x, r.y, r.z), q, s);
      this.ringMesh.setMatrixAt(i, m);
      m.compose(tmpV.set(r.x, r.y, r.z), tmpQ.identity(), s.setScalar(got ? 0 : 1));
      this.beamMesh.setMatrixAt(i, m);
    });
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.beamMesh.instanceMatrix.needsUpdate = true;
  }

  private collectRings() {
    const p = this.xrActive ? this.camera.getWorldPosition(tmpV) : tmpV.set(this.body.x, this.body.y + 1, this.body.z);
    let got = false;
    this.city.rings.forEach((r, i) => {
      if (this.ringsCollected[i]) return;
      if ((p.x - r.x) ** 2 + (p.y - r.y) ** 2 + (p.z - r.z) ** 2 < (RING_RADIUS + 0.6) ** 2) {
        this.ringsCollected[i] = true;
        this.score += 500;
        this.popups.show('+RING', r.x, r.y + 3, r.z, 1.4);
        this.particles.burst(r.x, r.y, r.z, 40, [0x66f0ff, 0xffffff, 0xffd43b], 9, 2);
        this.sfx.ring();
        this.flash++;
        got = true;
      }
    });
    if (got && this.ringsCollected.every(Boolean)) this.finish();
  }

  private finish() {
    this.mode = 'finished';
    this.bestTime = this.bestTime === null ? this.time : Math.min(this.bestTime, this.time);
    this.endGrapple(false);
    this.sfx.win();
    if (document.pointerLockElement) document.exitPointerLock();
    this.emitUi(true);
  }

  private respawn() {
    const s = this.city.spawn;
    Object.assign(this.body, { x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0 });
    this.endGrapple(false);
  }

  private hintsFor(): { text: string; done: () => boolean; timeout?: number }[] {
    if (this.platform === 'vr')
      return [
        { text: 'Squeeze a grip and pull to drag yourself through the air. Let go to launch', done: () => this.grapple.used },
        { text: 'Pull a trigger to fire a kinetic pulse', done: () => this.fired },
        { text: 'Right stick snap-turns. Fly through the glowing rings', done: () => false, timeout: 8 },
      ];
    if (this.platform === 'touch')
      return [
        { text: 'Left stick to run. Drag the right side to look', done: () => this.walked > 6 },
        { text: 'Aim at a wall and hold SWING to grapple', done: () => this.grapple.used },
        { text: 'Tap FIRE to send a kinetic pulse', done: () => this.fired },
        { text: 'Follow the arrow to the glowing rings', done: () => false, timeout: 7 },
      ];
    return [
      { text: 'WASD to move, mouse to look, Space to jump (twice for a pulse hop)', done: () => this.walked > 6 },
      { text: 'Aim at a building and hold right-click or Q to swing. Space reels in', done: () => this.grapple.used },
      { text: 'Left-click fires a kinetic pulse. Try it on a pedestrian', done: () => this.fired },
      { text: 'Follow the arrow to the glowing rings. Shift sprints', done: () => false, timeout: 7 },
    ];
  }

  private updateHints(dt: number) {
    const hints = this.hintsFor();
    const h = hints[this.hintStep];
    if (!h) return;
    this.hintTimer += dt;
    if (h.done() || (h.timeout && this.hintTimer > h.timeout)) {
      this.hintStep++;
      this.hintTimer = 0;
    }
  }

  private currentPrompt(): string | null {
    if (this.mode !== 'playing') return null;
    if (this.inCar) {
      if (this.platform === 'vr') return 'Left stick or triggers to drive. B or Y to get out';
      if (this.platform === 'touch') return 'Stick to drive, JUMP to drift, CAR to get out';
      return 'W/S drive, A/D steer, Space drift, H horn, F to get out';
    }
    if (this.nearCar()) return this.platform === 'vr' ? 'Press A or X to drive' : this.platform === 'touch' ? 'Tap CAR to drive' : 'Press F to drive';
    return null;
  }

  // ---------------------------------------------------------------- render
  private render(dt: number) {
    this.writeRings();
    const b = this.body;

    if (this.mode === 'menu') {
      // attract-mode orbit
      const t = performance.now() * 0.00004;
      this.rig.position.set(Math.sin(t) * 150, 62, Math.cos(t) * 150);
      this.rig.rotation.set(0, t, 0);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(-0.32, 0, 0);
      this.viewmodel.visible = false;
      this.rope.visible = false;
      this.aimMarker.visible = false;
    } else if (this.xrActive) {
      if (this.inCar) {
        const seat = this.car.seat(tmpV);
        this.rig.position.set(seat.x, 0.35, seat.z);
      } else this.rig.position.set(b.x, b.y, b.z);
      this.rope.visible = false;
      const sp = this.inCar ? this.car.speed : Math.hypot(b.vx, b.vy, b.vz);
      this.setVignette(Math.max(0, Math.min(0.85, (sp - 4) / 14)));
    } else if (this.inCar) {
      const c = this.car;
      this.camYaw += angleDiff(this.camYaw, c.yaw) * Math.min(1, dt * 4);
      const desired = tmpV.set(Math.sin(this.camYaw) * 9, 4.2, Math.cos(this.camYaw) * 9).add(tmpV2.set(c.x, 0, c.z));
      if (this.camPos.lengthSq() === 0 || this.camPos.distanceTo(desired) > 30) this.camPos.copy(desired);
      this.camPos.lerp(desired, Math.min(1, dt * 6));
      const look = tmpV2.set(c.x - Math.sin(c.yaw) * 3, 1.2, c.z - Math.cos(c.yaw) * 3);
      const d = look.clone().sub(this.camPos);
      this.rig.position.copy(this.camPos);
      this.rig.rotation.set(0, Math.atan2(-d.x, -d.z), 0);
      this.camera.position.set((Math.random() - 0.5) * this.shake * 0.3, (Math.random() - 0.5) * this.shake * 0.3, 0);
      this.camera.rotation.set(Math.atan2(d.y, Math.hypot(d.x, d.z)), 0, 0);
      this.viewmodel.visible = false;
      this.rope.visible = false;
      this.aimMarker.visible = false;
      this.setFov(75 + Math.min(18, c.speed * 0.5));
      this.setVignette(0);
    } else {
      this.viewmodel.visible = true;
      this.rig.position.set(b.x, b.y, b.z);
      this.rig.rotation.set(0, this.yaw, 0);
      const hs = Math.hypot(b.vx, b.vz);
      if (b.grounded && hs > 0.5) this.bob += dt * hs * 1.25;
      this.landDip *= 1 - Math.min(1, dt * 7);
      const bobY = b.grounded ? Math.sin(this.bob * 2) * 0.035 * Math.min(1, hs / 8) : 0;
      this.camera.position.set(
        (Math.random() - 0.5) * this.shake * 0.25,
        EYE - this.landDip + bobY + (Math.random() - 0.5) * this.shake * 0.25,
        0,
      );
      this.camera.rotation.set(this.pitch, 0, 0);
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      this.setFov(75 + Math.max(0, Math.min(16, (sp - 10) * 0.55)));
      this.setVignette(Math.max(0, Math.min(0.5, (sp - 18) / 30)));
      this.animateViewmodel(dt, hs);
      if (this.grapple.active) {
        this.camera.updateMatrixWorld(true);
        this.gauntletL.root.getWorldPosition(tmpV);
        const pos = this.rope.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, tmpV.x, tmpV.y, tmpV.z);
        pos.setXYZ(1, this.grapple.anchor.x, this.grapple.anchor.y, this.grapple.anchor.z);
        pos.needsUpdate = true;
        this.rope.visible = true;
      } else this.rope.visible = false;
    }
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }

  private setFov(f: number) {
    if (this.xrActive) return;
    const next = this.camera.fov + (f - this.camera.fov) * 0.12;
    if (Math.abs(next - this.camera.fov) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  private setVignette(v: number) {
    const u = (this.vignette.material as THREE.ShaderMaterial).uniforms.strength;
    u.value += (v - u.value) * 0.15;
    this.vignette.visible = u.value > 0.01;
  }

  private animateViewmodel(dt: number, hs: number) {
    this.recoil *= 1 - Math.min(1, dt * 12);
    const sway = Math.sin(this.bob * 2) * 0.012 * Math.min(1, hs / 8);
    const L = this.gauntletL.root,
      R = this.gauntletR.root;
    const reach = this.grapple.active ? 1 : 0;
    L.position.set(-0.24 + reach * 0.06, -0.22 + sway + reach * 0.1, -0.52 - reach * 0.12);
    L.rotation.set(0.1 + reach * 0.35, 0.1, 0.15);
    R.position.set(0.24, -0.22 - sway, -0.52 + this.recoil * 0.07);
    R.rotation.set(0.1 + this.recoil * 0.35, -0.1, -0.15);
    this.gauntletL.setGrip(this.grapple.active ? 1 : 0.35);
    this.gauntletR.setGrip(this.mouseFire || this.touch.fire ? 0.1 : 0.45);
    this.gauntletR.flash(this.recoil);
    this.gauntletL.flash(this.aim.kind === 'grapple' ? 0.5 + Math.sin(performance.now() * 0.01) * 0.3 : 0);
  }

  // ---------------------------------------------------------------- UI bridge
  private nearestRing(): UiState['nearest'] {
    let best = -1,
      bd = Infinity;
    const px = this.body.x,
      py = this.body.y + 1,
      pz = this.body.z;
    this.city.rings.forEach((r, i) => {
      if (this.ringsCollected[i]) return;
      const d = (r.x - px) ** 2 + (r.z - pz) ** 2 + (r.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return null;
    const r = this.city.rings[best];
    const dx = r.x - px,
      dz = r.z - pz;
    const theta = Math.atan2(-dx, -dz);
    const viewYaw = this.inCar ? this.rig.rotation.y : this.xrActive ? this.headYaw() : this.yaw;
    const rel = angleDiff(viewYaw, theta);
    return { bearing: (-rel * 180) / Math.PI, dist: Math.sqrt(bd), dy: r.y - py };
  }

  uiState(): UiState {
    const hints = this.hintsFor();
    return {
      mode: this.mode,
      platform: this.platform,
      rings: this.ringsCollected.filter(Boolean).length,
      ringsTotal: this.city.rings.length,
      time: this.time,
      bestTime: this.bestTime,
      score: this.score,
      knockouts: this.knockouts,
      combo: this.combo,
      nearest: this.nearestRing(),
      aim: this.aim.kind,
      aimDist: this.aim.dist,
      grappling: this.grapple.active,
      prompt: this.currentPrompt(),
      hint: this.mode === 'playing' ? hints[this.hintStep]?.text ?? null : null,
      inCar: this.inCar,
      speed: this.inCar ? Math.abs(this.car.forwardSpeed) : Math.hypot(this.body.vx, this.body.vz),
      xrSupported: this.xrSupported,
      xrActive: this.xrActive,
      pointerLocked: this.pointerLocked,
      muted: this.sfx.muted,
      fps: this.fps,
      drawCalls: this.renderer.info.render.calls,
      flash: this.flash,
    };
  }

  private emitUi(_force = false) {
    this.onUi?.(this.uiState());
  }

  /** Touch overlay: tap CAR button. */
  toggleCar() {
    if (this.mode !== 'playing') return;
    if (this.inCar) this.exitCar();
    else if (this.nearCar()) this.enterCar();
  }

  renderGameToText(): string {
    const b = this.body;
    const r = (v: number) => Math.round(v * 10) / 10;
    return JSON.stringify({
      coords: 'x east, y up, z south; player faces -z at yaw 0',
      mode: this.mode,
      platform: this.platform,
      player: { x: r(b.x), y: r(b.y), z: r(b.z), vx: r(b.vx), vy: r(b.vy), vz: r(b.vz), grounded: b.grounded, yaw: r(this.yaw), pitch: r(this.pitch) },
      grapple: this.grapple.active ? { anchor: this.grapple.anchor.toArray().map(r), len: r(this.grapple.len) } : null,
      aim: { kind: this.aim.kind, dist: r(this.aim.dist) },
      inCar: this.inCar,
      car: { x: r(this.car.x), z: r(this.car.z), yaw: r(this.car.yaw), speed: r(this.car.forwardSpeed) },
      rings: { collected: this.ringsCollected.filter(Boolean).length, total: this.city.rings.length, nearest: this.nearestRing() },
      score: this.score,
      knockouts: this.knockouts,
      knockedNow: this.crowd.knockedCount,
      projectiles: this.projectiles.list.filter((p) => p.alive).length,
      time: r(this.time),
      hint: this.uiState().hint,
      prompt: this.currentPrompt(),
    });
  }
}

function angleDiff(from: number, to: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
