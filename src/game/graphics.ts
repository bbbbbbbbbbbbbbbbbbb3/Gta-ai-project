import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Rendering tiers.
 *  - cinematic: soft sun shadows that follow the player, sky reflections, HDR bloom, MSAA.
 *  - performance: no shadows or post; same materials and lighting. Used for VR and touch.
 * The environment map and tone mapping are shared, so both tiers keep the same look.
 */
export type Quality = 'cinematic' | 'performance';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
const SHADOW_HALF = 85;
const SHADOW_RES = 2048;

export class Graphics {
  quality: Quality;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    sky: THREE.Object3D,
    quality: Quality,
  ) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Image-based lighting from the sky dome: glass and wet asphalt reflect the sunset.
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 1.0;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xc4d6ff, 0x7a6252, 1.7);
    this.sun = new THREE.DirectionalLight(0xffd6a8, 3.1);
    const s = this.sun;
    s.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
    const c = s.shadow.camera;
    c.left = c.bottom = -SHADOW_HALF;
    c.right = c.top = SHADOW_HALF;
    c.near = 1;
    c.far = 420;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.5;
    scene.add(this.hemi, s, s.target);

    this.quality = quality;
    this.apply();
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.apply();
  }

  private apply() {
    const hi = this.quality === 'cinematic';
    this.renderer.shadowMap.enabled = hi;
    this.sun.castShadow = hi;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, hi ? 1.5 : 1.25));
    if (hi && !this.composer) this.buildComposer();
    const { width, height } = this.renderer.getSize(new THREE.Vector2());
    this.resize(width, height);
  }

  private buildComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  /** Keep the shadow frustum centred on the player, snapped to texels to avoid shimmer. */
  follow(x: number, z: number) {
    if (!this.sun.castShadow) {
      this.sun.position.copy(SUN_DIR).multiplyScalar(200);
      this.sun.target.position.set(0, 0, 0);
      return;
    }
    const texel = (SHADOW_HALF * 2) / SHADOW_RES;
    const tx = Math.round(x / texel) * texel;
    const tz = Math.round(z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + SUN_DIR.x * 220, SUN_DIR.y * 220, tz + SUN_DIR.z * 220);
    this.sun.target.updateMatrixWorld();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  render() {
    if (this.quality === 'cinematic' && this.composer && !this.renderer.xr.isPresenting) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    this.bloom?.dispose();
  }
}
