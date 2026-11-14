import * as THREE from 'three';

/**
 * Low-poly superhero gauntlet: armoured cuff, plated hand, segmented fingers
 * and a glowing palm/back core that pulses when firing or gripping.
 */
export interface Gauntlet {
  root: THREE.Group;
  fingers: THREE.Object3D[];
  core: THREE.MeshBasicMaterial;
  setGrip(amount: number): void;
  flash(amount: number): void;
}

const ARMOR = new THREE.MeshLambertMaterial({ color: 0x23305c, flatShading: true });
const TRIM = new THREE.MeshLambertMaterial({ color: 0xffc94d, flatShading: true });
const KNUCKLE = new THREE.MeshLambertMaterial({ color: 0x3d4f8f, flatShading: true });

export function makeGauntlet(side: 'left' | 'right'): Gauntlet {
  const s = side === 'left' ? -1 : 1;
  const root = new THREE.Group();

  // Points down -Z (forward), palm faces inward slightly.
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.16, 6), ARMOR);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.1;
  const cuffRing = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.025, 6), TRIM);
  cuffRing.rotation.x = Math.PI / 2;
  cuffRing.position.z = 0.03;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.12), TRIM);
  fin.position.set(0, 0.05, 0.11);

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.035, 0.095), ARMOR);
  hand.position.z = -0.03;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.07), KNUCKLE);
  plate.position.set(0, 0.022, -0.03);

  const coreMat = new THREE.MeshBasicMaterial({ color: 0x66f0ff });
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.018, 6), coreMat);
  core.rotation.x = -Math.PI / 2;
  core.position.set(0, 0.0295, -0.03);
  const palm = new THREE.Mesh(new THREE.CircleGeometry(0.02, 6), coreMat);
  palm.rotation.x = Math.PI / 2;
  palm.position.set(0, -0.0185, -0.03);

  const fingers: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(-0.03 + i * 0.02, 0, -0.078);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.055), i % 2 ? ARMOR : KNUCKLE);
    seg.position.z = -0.027;
    pivot.add(seg);
    fingers.push(pivot);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.048 * s, -0.004, -0.02);
  thumb.rotation.y = 0.6 * s;
  const tseg = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.05), KNUCKLE);
  tseg.position.z = -0.025;
  thumb.add(tseg);
  fingers.push(thumb);

  root.add(cuff, cuffRing, fin, hand, plate, core, palm, ...fingers);
  const base = new THREE.Color(0x66f0ff);
  const hot = new THREE.Color(0xffffff);

  return {
    root,
    fingers,
    core: coreMat,
    setGrip(a: number) {
      fingers.forEach((f, i) => {
        if (i < 4) f.rotation.x = -a * 1.35;
        else f.rotation.x = -a * 0.6;
      });
    },
    flash(a: number) {
      coreMat.color.copy(base).lerp(hot, Math.min(1, a));
    },
  };
}
