import * as THREE from 'three';
import { BLOCK, CityData, EXTENT, GRID_N, PITCH, STREET, blockCenter } from './city';

/**
 * Facade material: procedural windows in world space (no textures), sparse lit
 * windows, and lighter roofs. One material + InstancedMesh = 1 draw call.
 */
function buildingMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 cjWorld;
         varying vec3 cjNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         mat4 cjM = modelMatrix;
         #ifdef USE_INSTANCING
           cjM = modelMatrix * instanceMatrix;
         #endif
         cjWorld = (cjM * vec4(transformed, 1.0)).xyz;
         cjNormal = normalize(mat3(cjM) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 cjWorld;
         varying vec3 cjNormal;
         float cjHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float cjWin = 0.0;
         float cjLit = 0.0;
         if (abs(cjNormal.y) < 0.5) {
           float u = abs(cjNormal.x) > 0.5 ? cjWorld.z : cjWorld.x;
           float v = cjWorld.y;
           vec2 cell = vec2(floor(u / 2.6), floor(v / 3.4));
           vec2 f = vec2(fract(u / 2.6), fract(v / 3.4));
           cjWin = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.85) * step(3.0, v);
           float h = cjHash(cell + floor(cjWorld.xz * 0.05));
           cjLit = step(0.86, h);
           vec3 glass = mix(vec3(0.16, 0.22, 0.36), vec3(0.45, 0.62, 0.85), cjHash(cell * 1.7));
           diffuseColor.rgb = mix(diffuseColor.rgb, glass, cjWin * 0.85);
           // ground-floor band
           diffuseColor.rgb *= mix(0.72, 1.0, step(3.0, v));
         } else if (cjNormal.y > 0.5) {
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.76, 0.74), 0.6);
         }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += cjWin * cjLit * vec3(1.0, 0.82, 0.5) * 0.55;`,
      );
  };
  return mat;
}

function skyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3b5bdb) },
      mid: { value: new THREE.Color(0xf783ac) },
      bottom: { value: new THREE.Color(0xffc078) },
      sunDir: { value: new THREE.Vector3(-0.5, 0.35, -0.8).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.6) * pow(s, 400.0) * 2.0 + vec3(1.0,0.6,0.4) * pow(s, 8.0) * 0.35;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

const BILLBOARD_TEXT = [
  ['ZIP', 'COLA', '#ff6b6b', '#fff3bf'],
  ['NOODLE', 'PALACE', '#4dabf7', '#ffffff'],
  ['MEGA', 'BYTES', '#9775fa', '#c3fae8'],
  ['SKY', 'RADIO', '#38d9a9', '#1b1430'],
];

function billboardTexture(i: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 112;
  const g = c.getContext('2d')!;
  const [a, b, bg, fg] = BILLBOARD_TEXT[i % BILLBOARD_TEXT.length];
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 112);
  g.fillStyle = fg;
  g.font = '700 46px "Clash Display", "Satoshi", sans-serif';
  g.textAlign = 'center';
  g.fillText(a, 128, 50);
  g.font = '700 34px "Clash Display", "Satoshi", sans-serif';
  g.fillText(b, 128, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface CityMeshes {
  root: THREE.Group;
  sky: THREE.Mesh;
}

export function buildCityMeshes(city: CityData): CityMeshes {
  const root = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();

  // Ground (asphalt)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(EXTENT + 400, EXTENT + 400),
    new THREE.MeshLambertMaterial({ color: 0x3d4250 }),
  );
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  // Sidewalks / park lawn (visual only)
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  blockGeo.translate(0, 0.5, 0);
  const walks = new THREE.InstancedMesh(blockGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), city.blocks.length);
  city.blocks.forEach((b, i) => {
    m4.compose(p.set(b.cx, 0, b.cz), q.identity(), s.set(BLOCK, 0.14, BLOCK));
    walks.setMatrixAt(i, m4);
    walks.setColorAt(i, col.set(b.park ? 0x51cf66 : 0xc9c2b8));
  });
  root.add(walks);

  // Lane dashes + crosswalk stripes
  const dashes: THREE.Matrix4[] = [];
  for (let i = 0; i < GRID_N - 1; i++) {
    const road = blockCenter(i) + PITCH / 2;
    for (let t = -EXTENT / 2; t < EXTENT / 2; t += 6) {
      dashes.push(new THREE.Matrix4().compose(p.set(road, 0.02, t), q.identity(), s.set(0.25, 0.02, 2.6)));
      dashes.push(new THREE.Matrix4().compose(p.set(t, 0.02, road), q.identity(), s.set(2.6, 0.02, 0.25)));
    }
  }
  const dashMesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshBasicMaterial({ color: 0xffd43b }), dashes.length);
  dashes.forEach((d, i) => dashMesh.setMatrixAt(i, d));
  root.add(dashMesh);

  // Buildings
  const bmesh = new THREE.InstancedMesh(blockGeo, buildingMaterial(), city.buildings.length);
  city.buildings.forEach((b, i) => {
    m4.compose(p.set(b.x, 0, b.z), q.identity(), s.set(b.w, b.h, b.d));
    bmesh.setMatrixAt(i, m4);
    bmesh.setColorAt(i, col.set(b.color));
  });
  root.add(bmesh);

  // Roof trims (parapet look, visual)
  const trim = new THREE.InstancedMesh(blockGeo, new THREE.MeshLambertMaterial({ color: 0x2b2440 }), city.buildings.length);
  city.buildings.forEach((b, i) => {
    m4.compose(p.set(b.x, b.h - 0.71, b.z), q.identity(), s.set(b.w + 0.3, 0.7, b.d + 0.3));
    trim.setMatrixAt(i, m4);
  });
  root.add(trim);

  // Rooftop props
  const acs = city.props.filter((x) => x.kind === 'ac');
  const acMesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshLambertMaterial({ color: 0xadb5bd }), Math.max(1, acs.length));
  acs.forEach((a, i) => {
    m4.compose(p.set(a.x, a.y, a.z), q.identity(), s.set(a.w, a.h, a.d));
    acMesh.setMatrixAt(i, m4);
  });
  acMesh.count = acs.length;
  root.add(acMesh);

  const tanks = city.props.filter((x) => x.kind === 'tank');
  const tankGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 10);
  tankGeo.translate(0, 2.3 + 1.6, 0);
  const legGeo = new THREE.BoxGeometry(2.6, 2.3, 2.6);
  legGeo.translate(0, 1.15, 0);
  const tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshLambertMaterial({ color: 0xb08968 }), Math.max(1, tanks.length));
  const legMesh = new THREE.InstancedMesh(legGeo, new THREE.MeshLambertMaterial({ color: 0x495057, wireframe: false }), Math.max(1, tanks.length));
  tanks.forEach((t, i) => {
    m4.compose(p.set(t.x, t.y, t.z), q.identity(), s.set(1, 1, 1));
    tankMesh.setMatrixAt(i, m4);
    legMesh.setMatrixAt(i, m4);
  });
  tankMesh.count = legMesh.count = tanks.length;
  root.add(tankMesh, legMesh);

  // Billboards
  const textures = BILLBOARD_TEXT.map((_, i) => billboardTexture(i));
  const boardMats = textures.map((t) => new THREE.MeshBasicMaterial({ map: t }));
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x343a40 });
  for (const b of city.props.filter((x) => x.kind === 'billboard')) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(blockGeo, frameMat);
    frame.scale.set(b.w, b.h, b.d);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 0.4, b.h - 0.6), boardMats[b.variant]);
    face.position.set(0, b.h / 2, b.d / 2 + 0.01);
    const back = face.clone();
    back.rotation.y = Math.PI;
    back.position.z = -b.d / 2 - 0.01;
    g.add(frame, face, back);
    g.position.set(b.x, b.y, b.z);
    root.add(g);
  }

  // Trees (park + scattered)
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2, 5);
  trunkGeo.translate(0, 1, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.6, 0);
  crownGeo.translate(0, 3, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8d5524 }), city.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x40c057, flatShading: true }), city.trees.length);
  city.trees.forEach((t, i) => {
    m4.compose(p.set(t.x, 0.14, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), s.setScalar(t.s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, col.set(i % 3 === 0 ? 0x2f9e44 : i % 3 === 1 ? 0x51cf66 : 0x94d82d));
  });
  root.add(trunks, crowns);

  // Street lamps
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 5);
  poleGeo.translate(0, 2.5, 0);
  const headGeo = new THREE.BoxGeometry(0.5, 0.25, 0.9);
  headGeo.translate(0, 5, 0.3);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x343a40 }), city.lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff3bf }), city.lamps.length);
  city.lamps.forEach((l, i) => {
    m4.compose(p.set(l.x, 0, l.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot), s.setScalar(1));
    poles.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  });
  root.add(poles, heads);

  // Mark: streets are STREET wide between blocks (kept for future traffic lanes)
  root.userData.streetWidth = STREET;

  const sky = skyDome();
  return { root, sky };
}
