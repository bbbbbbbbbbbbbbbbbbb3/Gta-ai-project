import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
import { SUN_DIR } from './graphics';
import { BLOCK, CityData, EXTENT, GRID_N, PITCH, STREET, blockCenter } from './city';

const GLSL_NOISE = `
  float cjHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float cjNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(cjHash(i), cjHash(i+vec2(1,0)), f.x), mix(cjHash(i+vec2(0,1)), cjHash(i+vec2(1,1)), f.x), f.y);
  }`;

/**
 * Facade material: procedural PBR facades in world space (no textures).
 * Tall buildings become glass curtain walls; the rest are masonry with punched
 * windows, sills, floor ledges and lit storefronts. One material + InstancedMesh.
 */
function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 cjWorld;
         varying vec3 cjNormal;
         varying float cjH;
         varying float cjSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         mat4 cjM = modelMatrix;
         #ifdef USE_INSTANCING
           cjM = modelMatrix * instanceMatrix;
         #endif
         cjWorld = (cjM * vec4(transformed, 1.0)).xyz;
         cjNormal = normalize(mat3(cjM) * objectNormal);
         cjH = length(cjM[1].xyz);
         cjSeed = fract(sin(dot(cjM[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 cjWorld;
         varying vec3 cjNormal;
         varying float cjH;
         varying float cjSeed;
         ${GLSL_NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float cjRough = 0.9;
         float cjMetal = 0.0;
         vec3 cjEmit = vec3(0.0);
         if (abs(cjNormal.y) < 0.5) {
           float u = abs(cjNormal.x) > 0.5 ? cjWorld.z : cjWorld.x;
           float v = cjWorld.y;
           bool tower = cjH > 38.0 && cjSeed > 0.3;
           float bayW = tower ? 1.9 : 2.8;
           vec2 cell = floor(vec2(u / bayW, v / 3.4));
           vec2 f = fract(vec2(u / bayW, v / 3.4));
           float upper = step(4.3, v) * step(v, cjH - 1.2);
           float win = 0.0;
           if (tower) {
             win = step(0.05, f.x) * step(f.x, 0.95) * step(0.2, f.y) * upper;
             vec3 glass = mix(vec3(0.03, 0.06, 0.1), vec3(0.12, 0.2, 0.28), cjHash(cell * 0.31 + cjSeed));
             diffuseColor.rgb = mix(diffuseColor.rgb * 0.6, glass, win);
             cjRough = mix(0.45, 0.04, win);
             cjMetal = mix(0.3, 0.95, win);
           } else {
             win = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.86) * upper;
             float sill = step(0.23, f.y) * step(f.y, 0.3) * step(0.15, f.x) * step(f.x, 0.85) * upper;
             float ledge = step(f.y, 0.05) * upper;
             float pil = step(fract(u / (bayW * 4.0)), 0.06) * upper;
             float brick = cjHash(floor(vec2(u * 2.6 + floor(v * 6.0) * 0.5, v * 6.0)));
             float cjAA = clamp(1.0 - length(fwidth(vec2(u, v))) * 2.5, 0.0, 1.0);
             diffuseColor.rgb *= 1.0 + 0.12 * (brick - 0.5) * cjAA;
             diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.82, pil);
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.75, 0.7), max(sill, ledge) * 0.75);
             vec3 glass = mix(vec3(0.05, 0.07, 0.1), vec3(0.2, 0.26, 0.34), cjHash(cell * 1.7 + cjSeed));
             diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
             cjRough = mix(0.92, 0.1, win);
             cjMetal = mix(0.0, 0.6, win);
           }
           // lit apartments / offices
           float lit = step(0.84, cjHash(cell + cjSeed * 31.0));
           cjEmit += win * lit * mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.88, 1.0), step(0.5, cjHash(cell * 3.1))) * 1.3;
           // ground-floor storefronts with awnings
           if (v < 4.3) {
             float sid = floor(u / 6.5);
             float sf = fract(u / 6.5);
             float gl = step(0.1, sf) * step(sf, 0.9) * step(0.35, v) * step(v, 3.1);
             float awn = step(3.15, v) * step(v, 3.85) * step(0.06, sf) * step(sf, 0.94);
             vec3 awnCol = mix(vec3(0.55, 0.12, 0.1), vec3(0.1, 0.32, 0.3), step(0.5, cjHash(vec2(sid, cjSeed))));
             awnCol = mix(awnCol, vec3(0.75, 0.6, 0.2), step(0.8, cjHash(vec2(sid * 1.3, cjSeed))));
             diffuseColor.rgb *= 0.55;
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.06, 0.07), gl);
             diffuseColor.rgb = mix(diffuseColor.rgb, awnCol, awn);
             cjRough = mix(mix(0.85, 0.22, gl), 0.7, awn);
             cjMetal = 0.0;
             // interior shelves / signage glimpsed through the glass
             float shelf = step(0.7, fract(v * 1.6)) * gl;
             diffuseColor.rgb = mix(diffuseColor.rgb, awnCol * 0.6, shelf * 0.5);
             cjEmit += gl * vec3(1.0, 0.8, 0.55) * (0.12 + 0.35 * cjHash(vec2(sid, cjSeed * 9.0))) * smoothstep(0.35, 2.6, v);
           }
           // ambient occlusion near street level + soft weathering streaks
           diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 6.0, v));
           diffuseColor.rgb *= 0.9 + 0.1 * cjNoise(vec2(u * 0.8, v * 0.08));
         } else if (cjNormal.y > 0.5) {
           float n = cjNoise(cjWorld.xz * 1.5);
           diffuseColor.rgb = vec3(0.36, 0.35, 0.34) * (0.8 + 0.3 * n);
           cjRough = 0.95;
         }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = cjRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = cjMetal;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += cjEmit;`,
      );
  };
  return mat;
}

/** Asphalt with grain, tyre wear and reflective puddles. */
function asphaltMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b3e45, roughness: 0.85 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 cjWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n cjWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec3 cjWorld;\n ${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float grain = mix(0.5, cjHash(floor(cjWorld.xz * 9.0)), clamp(1.0 - length(fwidth(cjWorld.xz)) * 6.0, 0.0, 1.0));
         float cjPatch = cjNoise(cjWorld.xz * 0.08);
         diffuseColor.rgb *= 0.85 + 0.15 * grain + 0.2 * (cjPatch - 0.5);
         float puddle = smoothstep(0.62, 0.7, cjNoise(cjWorld.xz * 0.11 + 17.0));
         diffuseColor.rgb *= 1.0 - puddle * 0.35;
         float cjRough = mix(0.82 + 0.1 * grain, 0.05, puddle);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = cjRough;');
  };
  return mat;
}

/** Sidewalk concrete slabs with joints. */
function pavementMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 cjWorld;\n varying vec3 cjN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         mat4 cjM = modelMatrix;
         #ifdef USE_INSTANCING
           cjM = modelMatrix * instanceMatrix;
         #endif
         cjWorld = (cjM * vec4(transformed, 1.0)).xyz;
         cjN = normalize(mat3(cjM) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec3 cjWorld;\n varying vec3 cjN;\n ${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         if (cjN.y > 0.5) {
           vec2 g = fract(cjWorld.xz / 1.6);
           float joint = 1.0 - step(0.04, g.x) * step(0.04, g.y);
           diffuseColor.rgb *= (0.9 + 0.12 * cjHash(floor(cjWorld.xz / 1.6))) * (1.0 - joint * 0.25);
         } else {
           diffuseColor.rgb *= 0.8;
         }`,
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
      top: { value: new THREE.Color(0x2a4f8f) },
      mid: { value: new THREE.Color(0xe98a6e) },
      bottom: { value: new THREE.Color(0xf6c08e) },
      sunDir: { value: SUN_DIR.clone().setY(0.18).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.6) * pow(s, 600.0) * 6.0 + vec3(1.0,0.6,0.35) * pow(s, 10.0) * 0.5;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
    asphaltMaterial(),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Sidewalks / park lawn (visual only)
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  blockGeo.translate(0, 0.5, 0);
  const walks = new THREE.InstancedMesh(blockGeo, pavementMaterial(), city.blocks.length);
  walks.receiveShadow = true;
  city.blocks.forEach((b, i) => {
    m4.compose(p.set(b.cx, 0, b.cz), q.identity(), s.set(BLOCK, 0.14, BLOCK));
    walks.setMatrixAt(i, m4);
    walks.setColorAt(i, col.set(b.park ? 0x4f7d3a : 0xb5afa6));
  });
  root.add(walks);

  // Road markings: centre double line, lane edge lines and zebra crossings.
  const roads: number[] = [];
  for (let i = 0; i < GRID_N - 1; i++) roads.push(blockCenter(i) + PITCH / 2);
  const nearJunction = (t: number) => roads.some((r) => Math.abs(t - r) < STREET / 2 + 3.4);
  const yellow: THREE.Matrix4[] = [];
  const white: THREE.Matrix4[] = [];
  const mk = (x: number, z: number, w: number, d: number) =>
    new THREE.Matrix4().compose(p.set(x, 0.015, z), q.identity(), s.set(w, 0.02, d));
  for (const road of roads) {
    for (let t = -EXTENT / 2; t < EXTENT / 2; t += 1.5) {
      if (nearJunction(t)) continue;
      // continuous centre double line (in 1.5 m segments)
      for (const o of [-0.18, 0.18]) {
        yellow.push(mk(road + o, t, 0.12, 1.52));
        yellow.push(mk(t, road + o, 1.52, 0.12));
      }
      // dashed lane dividers between the two lanes each way are omitted; edge lines instead
      for (const o of [-(STREET / 2 - 0.9), STREET / 2 - 0.9]) {
        white.push(mk(road + o, t, 0.14, 1.52));
        white.push(mk(t, road + o, 1.52, 0.14));
      }
    }
    for (const r2 of roads) {
      for (const side of [-1, 1]) {
        const off = side * (STREET / 2 + 1.8);
        for (let k = -STREET / 2 + 1.2; k <= STREET / 2 - 1.2; k += 1.1) {
          white.push(mk(road + k, r2 + off, 0.55, 2.6));
          white.push(mk(r2 + off, road + k, 2.6, 0.55));
        }
      }
    }
  }
  const paintMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const yMesh = new THREE.InstancedMesh(blockGeo, paintMat(0xe0b52e), yellow.length);
  yellow.forEach((d, i) => yMesh.setMatrixAt(i, d));
  const wMesh = new THREE.InstancedMesh(blockGeo, paintMat(0xe8e6e1), white.length);
  white.forEach((d, i) => wMesh.setMatrixAt(i, d));
  yMesh.receiveShadow = wMesh.receiveShadow = true;
  root.add(yMesh, wMesh);

  // Buildings
  const bmesh = new THREE.InstancedMesh(blockGeo, buildingMaterial(), city.buildings.length);
  city.buildings.forEach((b, i) => {
    m4.compose(p.set(b.x, 0, b.z), q.identity(), s.set(b.w, b.h, b.d));
    bmesh.setMatrixAt(i, m4);
    bmesh.setColorAt(i, col.set(b.color));
  });
  bmesh.castShadow = bmesh.receiveShadow = true;
  root.add(bmesh);

  // Roof trims (parapet look, visual)
  const trim = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardMaterial({ color: 0x8f8a84, roughness: 0.85 }), city.buildings.length);
  city.buildings.forEach((b, i) => {
    m4.compose(p.set(b.x, b.h - 0.71, b.z), q.identity(), s.set(b.w + 0.3, 0.7, b.d + 0.3));
    trim.setMatrixAt(i, m4);
  });
  trim.castShadow = trim.receiveShadow = true;
  root.add(trim);

  // Rooftop props
  const acs = city.props.filter((x) => x.kind === 'ac');
  const acMesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardMaterial({ color: 0xa9acb0, roughness: 0.5, metalness: 0.6 }), Math.max(1, acs.length));
  acs.forEach((a, i) => {
    m4.compose(p.set(a.x, a.y, a.z), q.identity(), s.set(a.w, a.h, a.d));
    acMesh.setMatrixAt(i, m4);
  });
  acMesh.count = acs.length;
  acMesh.castShadow = acMesh.receiveShadow = true;
  root.add(acMesh);

  const tanks = city.props.filter((x) => x.kind === 'tank');
  const tankGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 10);
  tankGeo.translate(0, 2.3 + 1.6, 0);
  const legGeo = new THREE.BoxGeometry(2.6, 2.3, 2.6);
  legGeo.translate(0, 1.15, 0);
  const tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.8 }), Math.max(1, tanks.length));
  const legMesh = new THREE.InstancedMesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.6, metalness: 0.5 }), Math.max(1, tanks.length));
  tanks.forEach((t, i) => {
    m4.compose(p.set(t.x, t.y, t.z), q.identity(), s.set(1, 1, 1));
    tankMesh.setMatrixAt(i, m4);
    legMesh.setMatrixAt(i, m4);
  });
  tankMesh.count = legMesh.count = tanks.length;
  tankMesh.castShadow = legMesh.castShadow = true;
  root.add(tankMesh, legMesh);

  // Billboards
  const textures = BILLBOARD_TEXT.map((_, i) => billboardTexture(i));
  const boardMats = textures.map((t) => new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4 }));
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.6 });
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
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 1 }), city.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), city.trees.length);
  city.trees.forEach((t, i) => {
    m4.compose(p.set(t.x, 0.14, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), s.setScalar(t.s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, col.set(i % 3 === 0 ? 0x3d6b2f : i % 3 === 1 ? 0x4f7f35 : 0x6b8f3a));
  });
  trunks.castShadow = crowns.castShadow = true;
  root.add(trunks, crowns);

  // Street lamps
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 5);
  poleGeo.translate(0, 2.5, 0);
  const headGeo = new THREE.BoxGeometry(0.5, 0.25, 0.9);
  headGeo.translate(0, 5, 0.3);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.7 }), city.lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff3bf }), city.lamps.length);
  city.lamps.forEach((l, i) => {
    m4.compose(p.set(l.x, 0, l.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot), s.setScalar(1));
    poles.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  heads.material.color.multiplyScalar(2.2);
  root.add(poles, heads);

  // Parked cars: glossy paint, dark glass, tyres (3 instanced draws)
  const n = Math.max(1, city.parked.length);
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.72, 4.3);
  bodyGeo.translate(0, 0.62, 0);
  const cabGeo = new THREE.BoxGeometry(1.66, 0.6, 2.2);
  cabGeo.translate(0, 1.27, -0.2);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 1.98, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelsGeo = mergeGeometries([-1.35, 1.35].map((z) => wheelGeo.clone().translate(0, 0.36, z)));
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.55 }), n);
  const cabs = new THREE.InstancedMesh(cabGeo, new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.05, metalness: 0.9 }), n);
  const tyres = new THREE.InstancedMesh(wheelsGeo, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }), n);
  city.parked.forEach((c, i) => {
    m4.compose(p.set(c.x, 0, c.z), q.setFromAxisAngle(UP, c.alongZ ? 0 : Math.PI / 2), s.setScalar(1));
    bodies.setMatrixAt(i, m4);
    cabs.setMatrixAt(i, m4);
    tyres.setMatrixAt(i, m4);
    bodies.setColorAt(i, col.set(c.color));
  });
  bodies.count = cabs.count = tyres.count = city.parked.length;
  bodies.castShadow = cabs.castShadow = tyres.castShadow = true;
  bodies.receiveShadow = true;
  root.add(bodies, cabs, tyres);

  // Traffic signals: pole + mast arm + housing, with glowing lamps
  const sigPoleGeo = new THREE.CylinderGeometry(0.11, 0.13, 5.6, 6);
  sigPoleGeo.translate(0, 2.8, 0);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 4.2);
  armGeo.translate(0, 5.4, 2.1);
  const housingGeo = new THREE.BoxGeometry(0.42, 1.2, 0.36);
  housingGeo.translate(0, 4.8, 3.9);
  const sigMetal = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, metalness: 0.7 });
  const sigGeo = mergeGeometries([sigPoleGeo, armGeo, housingGeo]);
  const ns = Math.max(1, city.signals.length);
  const sig = new THREE.InstancedMesh(sigGeo, sigMetal, ns);
  const lampGeo = new THREE.BoxGeometry(0.26, 0.26, 0.05);
  const sigLamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), ns * 3);
  city.signals.forEach((g, i) => {
    q.setFromAxisAngle(UP, g.rot);
    m4.compose(p.set(g.x, 0, g.z), q, s.setScalar(1));
    sig.setMatrixAt(i, m4);
    const phase = i % 2; // alternate red / green per corner
    for (let k = 0; k < 3; k++) {
      const local = new THREE.Vector3(0, 5.2 - k * 0.38, 3.9 - 0.2).applyQuaternion(q);
      const on = (k === 0 && phase === 0) || (k === 2 && phase === 1);
      m4.compose(p.set(g.x + local.x, local.y, g.z + local.z), q, s.setScalar(1));
      sigLamps.setMatrixAt(i * 3 + k, m4);
      const c = k === 0 ? 0xff3b30 : k === 1 ? 0xffb020 : 0x2bd96b;
      sigLamps.setColorAt(i * 3 + k, col.set(c).multiplyScalar(on ? 3 : 0.12));
    }
  });
  sig.count = city.signals.length;
  sigLamps.count = city.signals.length * 3;
  sig.castShadow = true;
  root.add(sig, sigLamps);

  // Mark: streets are STREET wide between blocks (kept for future traffic lanes)
  root.userData.streetWidth = STREET;

  const sky = skyDome();
  return { root, sky };
}
