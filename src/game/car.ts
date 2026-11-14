import * as THREE from 'three';
import { BoxGrid, pushCircleXZ } from './physics';

export interface DriveInput {
  throttle: number; // -1..1
  steer: number; // -1..1 (positive = left)
  handbrake: boolean;
}

/** Arcade car: grippy, a little drifty, bounces off walls, bowls over NPCs. */
export class Car {
  group = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Mesh[] = [];
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  steer = 0;
  wheelSpin = 0;
  bump = 0;
  readonly radius = 2.0;
  readonly maxSpeed = 30;
  private headlights: THREE.MeshBasicMaterial;
  private brakeLights: THREE.MeshBasicMaterial;

  constructor() {
    const paint = new THREE.MeshLambertMaterial({ color: 0xff3d7f, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x212529, flatShading: true });
    const glass = new THREE.MeshLambertMaterial({ color: 0x74c0fc, flatShading: true });
    const stripe = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.3), paint);
    chassis.position.y = 0.75;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.1), glass);
    cabin.position.set(0, 1.4, 0.25);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.12, 1.8), paint);
    roof.position.set(0, 1.75, 0.3);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 4.32), stripe);
    st.position.set(0, 1.11, 0);
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.3, 0.25), dark);
    bumperF.position.set(0, 0.5, -2.15);
    const bumperR = bumperF.clone();
    bumperR.position.z = 2.15;
    this.headlights = new THREE.MeshBasicMaterial({ color: 0xfff3bf });
    this.brakeLights = new THREE.MeshBasicMaterial({ color: 0x8a1c1c });
    for (const sx of [-0.7, 0.7]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.05), this.headlights);
      h.position.set(sx, 0.85, -2.16);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.05), this.brakeLights);
      b.position.set(sx, 0.85, 2.16);
      this.body.add(h, b);
    }
    this.body.add(chassis, cabin, roof, st, bumperF, bumperR);
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [
      [-1.0, -1.35],
      [1.0, -1.35],
      [-1.0, 1.35],
      [1.0, 1.35],
    ]) {
      const w = new THREE.Mesh(wheelGeo, dark);
      w.position.set(wx, 0.42, wz);
      this.wheels.push(w);
      this.group.add(w);
    }
    this.group.add(this.body);
  }

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = 0;
    this.steer = 0;
    this.sync();
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Signed forward speed (forward is -Z in car space). */
  get forwardSpeed() {
    return -(this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw));
  }

  /** Returns impact speed if it hit a wall this step. */
  update(dt: number, input: DriveInput | null, grid: BoxGrid): number {
    const fx = -Math.sin(this.yaw),
      fz = -Math.cos(this.yaw);
    let fwd = this.vx * fx + this.vz * fz;
    const latX = this.vx - fx * fwd,
      latZ = this.vz - fz * fwd;

    if (input) {
      const accel = input.throttle > 0 ? (fwd < -0.5 ? 26 : 16) : fwd > 0.5 ? 28 : 10;
      fwd += input.throttle * accel * dt;
      if (input.throttle === 0) fwd *= 1 - 0.9 * dt;
      fwd = Math.max(-9, Math.min(this.maxSpeed, fwd));
      this.steer += (input.steer - this.steer) * Math.min(1, dt * 8);
    } else {
      fwd *= 1 - 2.5 * dt;
      this.steer *= 1 - dt * 5;
    }
    const grip = input?.handbrake ? 1.5 : 9;
    if (input?.handbrake) fwd *= 1 - 1.2 * dt;
    const lat = Math.max(0, 1 - grip * dt);
    const turn = this.steer * 1.9 * Math.min(1, Math.abs(fwd) / 6) * Math.sign(fwd || 1) * (1 - Math.abs(fwd) / 80);
    this.yaw += turn * dt * (input?.handbrake ? 1.4 : 1);

    this.vx = fx * fwd + latX * lat;
    this.vz = fz * fwd + latZ * lat;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    let impact = 0;
    const pos = { x: this.x, z: this.z };
    const n = pushCircleXZ(pos, this.radius, 0, 1.6, grid);
    if (n) {
      const dot = this.vx * n.nx + this.vz * n.nz;
      if (dot < 0) {
        impact = -dot;
        this.vx -= 1.4 * dot * n.nx;
        this.vz -= 1.4 * dot * n.nz;
        this.vx *= 0.6;
        this.vz *= 0.6;
        this.bump = Math.min(1, impact / 15);
      }
    }
    this.x = pos.x;
    this.z = pos.z;
    this.wheelSpin += fwd * dt / 0.42;
    this.bump *= 1 - dt * 6;
    this.brakeLights.color.set(input && input.throttle < 0 && fwd > 0.5 ? 0xff2b2b : 0x8a1c1c);
    this.sync();
    return impact;
  }

  shove(ix: number, iz: number) {
    this.vx += ix;
    this.vz += iz;
  }

  private sync() {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;
    this.body.rotation.z = -this.steer * Math.min(1, this.speed / 20) * 0.06;
    this.body.rotation.x = this.bump * 0.08;
    this.wheels.forEach((w, i) => {
      w.rotation.set(-this.wheelSpin, i < 2 ? this.steer * 0.45 : 0, 0, 'YXZ');
    });
  }

  /** World position of the driver's seat (for camera / exit). */
  seat(out: THREE.Vector3) {
    return out.set(-0.4, 0, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(new THREE.Vector3(this.x, 0, this.z));
  }
}
