import * as THREE from 'three';
import { Squishy } from '../core/Squishy';
import { ISquishyStage3D, ISquishyStageCallbacks } from '../core/engineContract';
import { InteractionMode, SquishyChangeCategory } from '../core/types';
import { SquishyAudioEngine } from './SquishyAudioEngine';
import { SquishyMeshBundle, SquishyMeshFactory } from './SquishyMeshFactory';

/**
 * Scène 3D interactive : rendu Three.js + physique soft-body (ressorts amortis
 * par sommet) pour un comportement de vrai squishy (slow-rising, gelée, mousse).
 */

interface Deformable {
  geometry: THREE.BufferGeometry;
  /** Positions de repos (3 par sommet). */
  rest: Float32Array;
  /** Déplacement courant (3 par sommet). */
  offset: Float32Array;
  /** Vitesse courante (3 par sommet). */
  velocity: Float32Array;
}

interface PressSource {
  x: number;
  y: number;
  z: number;
  /** Direction vers l'intérieur du squishy (unitaire). */
  dx: number;
  dy: number;
  dz: number;
  radius: number;
  depth: number;
}

interface Stamp extends PressSource {
  age: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class SquishyStage3D implements ISquishyStage3D {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private stars: THREE.Points;
  private nebula: THREE.Mesh;

  private squishy: Squishy;
  private bundle: SquishyMeshBundle | null = null;
  private deformables: Deformable[] = [];

  private mode: InteractionMode = 'poke';
  private audio = new SquishyAudioEngine();
  private factory = new SquishyMeshFactory();

  private unsubscribe: (() => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  private press: PressSource | null = null;
  private stamps: Stamp[] = [];
  private transient: { src: PressSource; life: number; maxLife: number }[] = [];
  private mega = { active: false, t: 0, amount: 0, intensity: 1 };
  private squeezeAmount = 0;
  private wobblePhase = 0;
  private wobbleAmp = 0;
  private bodyBottom = 0;
  private bodyHeight = 2;
  private baseRootY = 0;
  private levitation = 0;
  private faceSquished = false;
  private frame = 0;
  private raf = 0;
  private lastTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  /** Orbite 360° autour du squishy. */
  private orbit = {
    azimuth: 0,
    polar: 0.16,
    zoom: 1,
    target: new THREE.Vector3(0, 1, 0),
    distance: 5
  };
  private orbiting = false;
  private orbitingButton = -1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private pinchAngle = 0;

  constructor(container: HTMLElement, initialSquishy: Squishy, private callbacks?: ISquishyStageCallbacks) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x050508, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050508);
    this.scene.environment = this.createStudioEnvironment();

    // Galaxie sobre : nébuleuse lointaine + champ d'étoiles en 3D
    this.nebula = this.createNebula();
    this.scene.add(this.nebula);
    this.stars = this.createStarField();
    this.scene.add(this.stars);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 260);
    this.camera.position.set(0, 1, 4.4);

    // Éclairage studio contrasté : fond noir, sujet très détaché.
    const hemi = new THREE.HemisphereLight(0xffe9f4, 0x0a0a12, 0.35);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(2.4, 4.2, 3.2);
    this.scene.add(key);

    // Contre-jour rose : liseré lumineux sur le contour du squishy
    const rim = new THREE.DirectionalLight(0xff9fd0, 3.4);
    rim.position.set(-3, 1.6, -2.6);
    this.scene.add(rim);

    // Contre-jour froid opposé, pour détacher le côté sombre du fond
    const rimCool = new THREE.DirectionalLight(0x8fd0ff, 1.9);
    rimCool.position.set(3.2, 0.9, -2.4);
    this.scene.add(rimCool);

    const fill = new THREE.PointLight(0xffffff, 4.5, 12, 2);
    fill.position.set(-1.6, 0.4, 2.6);
    this.scene.add(fill);

    this.squishy = initialSquishy;
    this.loadSquishy(initialSquishy);

    container.addEventListener('pointerdown', this.onPointerDown);
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerup', this.onPointerUp);
    container.addEventListener('pointercancel', this.onPointerUp);
    container.addEventListener('pointerleave', this.onPointerUp);
    container.addEventListener('wheel', this.onWheel, { passive: false });
    container.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.animate);
  }

  // --- ISquishyStage3D -----------------------------------------------------

  loadSquishy(squishy: Squishy): void {
    this.unsubscribe?.();
    this.squishy = squishy;
    this.rebuild();
    this.unsubscribe = squishy.subscribe((s, category) => this.onSquishyChange(s, category));
  }

  getCurrentSquishy(): Squishy {
    return this.squishy;
  }

  setInteractionMode(mode: InteractionMode): void {
    this.mode = mode;
  }

  getInteractionMode(): InteractionMode {
    return this.mode;
  }

  triggerMegaSquish(intensity = 1): void {
    this.mega.active = true;
    this.mega.t = 0;
    this.mega.intensity = clamp(intensity, 0.1, 1);
    this.wobbleAmp = Math.max(this.wobbleAmp, this.squishy.physics.wobbleIntensity * 0.08);
    this.audio.playSquish(this.squishy.audio, intensity, 'squeeze');
    this.squishy.registerSqueeze(intensity);
    this.callbacks?.onSqueezeTriggered?.(this.squishy, intensity);
  }

  triggerPokeAtCenter(intensity = 0.8): void {
    const src = this.centerPressSource(clamp(intensity, 0.1, 1) * 0.7);
    this.transient.push({ src, life: 0.45, maxLife: 0.45 });
    this.audio.playSquish(this.squishy.audio, intensity, 'poke');
    this.squishy.registerSqueeze(intensity);
    this.callbacks?.onSqueezeTriggered?.(this.squishy, intensity);
  }

  resetDeformationImmediate(): void {
    this.press = null;
    this.stamps.length = 0;
    this.transient.length = 0;
    this.mega.active = false;
    this.squeezeAmount = 0;
    this.wobbleAmp = 0;
    for (const d of this.deformables) {
      d.offset.fill(0);
      d.velocity.fill(0);
    }
    this.writeGeometry();
    this.updateCompressionState();
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  isMuted(): boolean {
    return this.audio.isMuted();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.onPointerUp);
    this.container.removeEventListener('pointerleave', this.onPointerUp);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bundle?.dispose();
    this.bundle = null;
    this.deformables = [];
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.nebula.geometry.dispose();
    const nebulaMat = this.nebula.material as THREE.Material & { map?: THREE.Texture };
    if (nebulaMat.map) nebulaMat.map.dispose();
    nebulaMat.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // --- construction / reconstruction --------------------------------------

  private rebuild(): void {
    if (this.bundle) {
      this.scene.remove(this.bundle.root);
      this.bundle.dispose();
      this.bundle = null;
    }
    this.deformables = [];
    this.press = null;
    this.stamps.length = 0;
    this.transient.length = 0;

    const bundle = this.factory.build(this.squishy);
    this.bundle = bundle;
    this.scene.add(bundle.root);

    for (const mesh of bundle.meshes) {
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      pos.setUsage(THREE.DynamicDrawUsage);
      const rest = new Float32Array(pos.array as Float32Array);
      this.deformables.push({
        geometry: mesh.geometry,
        rest,
        offset: new Float32Array(rest.length),
        velocity: new Float32Array(rest.length)
      });
    }

    // Squishy flottant : la silhouette est centrée sur l'origine, sans sol.
    const bounds = this.computeLocalBounds(bundle);
    const scale = this.squishy.geometry.scale;
    this.bodyBottom = bounds.minY;
    this.bodyHeight = Math.max(0.2, (bounds.maxY - bounds.minY) * scale.y);
    this.baseRootY = -((bounds.minY + bounds.maxY) / 2) * scale.y;
    bundle.root.position.y = this.baseRootY;

    const h = this.bodyHeight;
    this.orbit.target.set(0, 0, 0);
    this.orbit.distance = 3.4 + h * 1.25;
    this.updateCamera();

    this.faceSquished = false;
    bundle.updateFace(this.squishy.face.style, false);
    this.writeGeometry();
  }

  /** Bornes de l'ensemble du squishy dans l'espace local de la racine. */
  private computeLocalBounds(bundle: SquishyMeshBundle): { minY: number; maxY: number } {
    let minY = Infinity;
    let maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (const mesh of bundle.meshes) {
      if (mesh.userData.framing === false) continue;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      if (!box) continue;
      mesh.updateMatrix();
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z
        );
        corner.applyMatrix4(mesh.matrix);
        if (corner.y < minY) minY = corner.y;
        if (corner.y > maxY) maxY = corner.y;
      }
    }
    if (!isFinite(minY)) return { minY: -1, maxY: 1 };
    return { minY, maxY };
  }

  private onSquishyChange(squishy: Squishy, category: SquishyChangeCategory): void {
    if (!this.bundle) return;
    switch (category) {
      case 'material':
      case 'toppings':
        this.factory.refreshTexture(this.bundle, squishy);
        break;
      case 'face':
        this.factory.refreshFace(this.bundle, squishy, this.faceSquished);
        break;
      case 'geometry':
      case 'reset':
        this.rebuild();
        break;
      default:
        break;
    }
  }

  // --- entrées pointeur ----------------------------------------------------

  private onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      // Deux doigts : pincement (zoom + rotation) — on abandonne la déformation.
      this.releasePress();
      this.orbiting = true;
      
      this.updatePinchState();
      return;
    }

    event.preventDefault();
    try {
      this.container.setPointerCapture(event.pointerId);
    } catch {
      /* certains navigateurs refusent la capture : sans conséquence */
    }

    // Clic droit ou vide : on tourne autour du squishy au lieu de le déformer.
    const hit = event.button === 2 ? null : this.pick(event);
    if (!hit) {
      this.orbiting = true;
      
      return;
    }
    this.orbiting = false;

    const phys = this.squishy.physics;
    const intensity = clamp(phys.softness, 0.15, 1);

    if (this.mode === 'slap') {
      this.applySlapImpulse(hit.point, hit.normal, intensity);
      this.press = {
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z,
        dx: -hit.normal.x,
        dy: -hit.normal.y,
        dz: -hit.normal.z,
        radius: phys.squeezeRadius * 0.9,
        depth: 0.03
      };
      this.wobbleAmp = Math.max(this.wobbleAmp, phys.wobbleIntensity * 0.14);
      this.audio.playSquish(this.squishy.audio, intensity, 'slap');
    } else {
      const radius = phys.squeezeRadius * (this.mode === 'squeeze' ? 1.05 : 0.85);
      this.press = {
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z,
        dx: -hit.normal.x,
        dy: -hit.normal.y,
        dz: -hit.normal.z,
        radius,
        // La profondeur est limitée au rayon : au-delà, la surface s'inverse
        // et le maillage se replie sur lui-même.
        depth: Math.min(this.pressDepth(), radius * 0.45)
      };
      this.audio.playSquish(this.squishy.audio, intensity, this.mode);
      if (this.mode === 'knead') this.addStamp();
    }

    this.squishy.registerSqueeze(intensity);
    this.callbacks?.onSqueezeTriggered?.(this.squishy, intensity);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    if (this.orbiting) {
      // Orbite 360° : le glisser fait tourner la caméra autour du squishy.
      this.orbit.azimuth -= dx * 0.008;
      this.orbit.polar = clamp(this.orbit.polar + dy * 0.006, -1.45, 1.45);
      this.updateCamera();
      return;
    }

    if (!this.press) return;
    const hit = this.pick(event);
    if (!hit) return;
    if (this.mode === 'knead') {
      this.addStamp();
    }
    this.press.x = hit.point.x;
    this.press.y = hit.point.y;
    this.press.z = hit.point.z;
    this.press.dx = -hit.normal.x;
    this.press.dy = -hit.normal.y;
    this.press.dz = -hit.normal.z;
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) {
      this.orbiting = false;
      
    }
    this.releasePress();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.orbit.zoom = clamp(this.orbit.zoom * (1 + event.deltaY * 0.0012), 0.45, 2.2);
    this.updateCamera();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  /** Relâche la pression en cours (fin de geste, passage en orbite, pincement). */
  private releasePress(): void {
    if (!this.press) return;
    this.press = null;
    this.audio.playRelease(this.squishy.audio, this.squishy.physics.recoverySpeed);
  }

  private updatePinchState(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    this.pinchDistance = Math.hypot(dx, dy);
    this.pinchAngle = Math.atan2(dy, dx);
  }

  private updatePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    if (this.pinchDistance > 0 && dist > 0) {
      this.orbit.zoom = clamp(this.orbit.zoom * (this.pinchDistance / dist), 0.45, 2.2);
    }
    let delta = angle - this.pinchAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.orbit.azimuth -= delta;
    this.pinchDistance = dist;
    this.pinchAngle = angle;
    this.updateCamera();
  }

  /** Positionne la caméra sur l'orbite courante autour du squishy. */
  private updateCamera(): void {
    const d = this.orbit.distance * this.orbit.zoom;
    const el = this.orbit.polar;
    const az = this.orbit.azimuth;
    const t = this.orbit.target;
    const horizontal = Math.cos(el) * d;
    this.camera.position.set(
      t.x + horizontal * Math.sin(az),
      t.y + Math.sin(el) * d,
      t.z + horizontal * Math.cos(az)
    );
    this.camera.lookAt(t);
    this.camera.updateMatrixWorld(true);
  }

  private pressDepth(): number {
    const phys = this.squishy.physics;
    switch (this.mode) {
      case 'squeeze':
        return 0.25 * phys.softness;
      case 'knead':
        return 0.22 * phys.softness;
      default:
        return 0.36 * phys.softness;
    }
  }

  private addStamp(): void {
    if (!this.press) return;
    const depth = this.press.depth * 0.6;
    // Un sillon proche remplace le précédent : pas d'empilement de griffures.
    const last = this.stamps[this.stamps.length - 1];
    if (last) {
      const dist = Math.hypot(last.x - this.press.x, last.y - this.press.y, last.z - this.press.z);
      if (dist < 0.18) {
        last.x = this.press.x;
        last.y = this.press.y;
        last.z = this.press.z;
        last.dx = this.press.dx;
        last.dy = this.press.dy;
        last.dz = this.press.dz;
        last.depth = depth;
        last.age = 0;
        return;
      }
    }
    this.stamps.push({
      x: this.press.x,
      y: this.press.y,
      z: this.press.z,
      dx: this.press.dx,
      dy: this.press.dy,
      dz: this.press.dz,
      radius: this.press.radius * 0.75,
      depth,
      age: 0
    });
    if (this.stamps.length > 36) this.stamps.shift();
  }

  private applySlapImpulse(point: THREE.Vector3, normal: THREE.Vector3, intensity: number): void {
    const phys = this.squishy.physics;
    const radius = phys.squeezeRadius * 0.85;
    const power = 3.2 * intensity * (0.5 + phys.wobbleIntensity);
    const dx = -normal.x;
    const dy = -normal.y;
    const dz = -normal.z;
    for (const d of this.deformables) {
      for (let i = 0; i < d.rest.length; i += 3) {
        const ddx = d.rest[i] - point.x;
        const ddy = d.rest[i + 1] - point.y;
        const ddz = d.rest[i + 2] - point.z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (dist > radius) continue;
        const w = 1 - dist / radius;
        d.velocity[i] += dx * power * w;
        d.velocity[i + 1] += dy * power * w;
        d.velocity[i + 2] += dz * power * w;
      }
    }
  }

  private centerPressSource(depth: number): PressSource {
    const radius = this.squishy.physics.squeezeRadius;
    return {
      x: 0,
      y: this.bodyBottom + this.bodyHeight / this.squishy.geometry.scale.y,
      z: 0,
      dx: 0,
      dy: -1,
      dz: 0,
      radius,
      depth: Math.min(depth, radius * 0.45)
    };
  }

  private pick(event: PointerEvent): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (!this.bundle) return null;
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObjects(this.bundle.pickTargets, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const root = this.bundle.root;
    root.updateWorldMatrix(true, false);
    const point = root.worldToLocal(hit.point.clone());
    const worldNormal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    const normal = worldNormal.transformDirection(root.matrixWorld.clone().invert()).normalize();
    return { point, normal };
  }

  // --- boucle de rendu -----------------------------------------------------

  private animate = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0005, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number): void {
    const phys = this.squishy.physics;

    // Lévoitation douce en apesanteur + scintillement des étoiles
    this.levitation += dt;
    if (this.bundle) {
      this.bundle.root.position.y = this.baseRootY + Math.sin(this.levitation * 0.7) * 0.045;
    }
    const starUniform = (this.stars.material as THREE.ShaderMaterial).uniforms;
    if (starUniform?.uTime) starUniform.uTime.value = this.levitation;

    // Mega squish
    if (this.mega.active) {
      this.mega.t += dt;
      const i = this.mega.intensity;
      if (this.mega.t < 0.18) {
        this.mega.amount = i * smoothstep01(this.mega.t / 0.18);
      } else if (this.mega.t < 0.62) {
        this.mega.amount = i;
      } else if (this.mega.t < 0.78) {
        this.mega.amount = i * (1 - smoothstep01((this.mega.t - 0.62) / 0.16));
      } else {
        this.mega.active = false;
        this.mega.amount = 0;
      }
    }

    // Compression globale (mode squeeze ou mega squish)
    const squeezeTarget =
      this.mega.active ? this.mega.amount * 0.85 : this.press && this.mode === 'squeeze' ? 1 : 0;
    this.squeezeAmount += (squeezeTarget - this.squeezeAmount) * Math.min(1, dt * 12);

    // Empreintes de malaxage : les sillons restent puis s'effacent lentement
    const stampDecay = 0.5 + phys.recoverySpeed * 3;
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i];
      s.age += dt;
      if (s.age > 6) {
        this.stamps.splice(i, 1);
        continue;
      }
      s.depth *= Math.exp(-dt * stampDecay * 0.35);
    }

    // Pressions ponctuelles (poke central, mega squish)
    for (let i = this.transient.length - 1; i >= 0; i--) {
      const t = this.transient[i];
      t.life -= dt;
      t.src.depth *= Math.max(0, t.life) / t.maxLife;
      if (t.life <= 0) this.transient.splice(i, 1);
    }
    if (this.mega.active && this.mega.amount > 0.01) {
      const src = this.centerPressSource(this.mega.amount * 0.5);
      this.transient.push({ src, life: 0.05, maxLife: 0.05 });
    }

    // Oscillation jelly amortie
    this.wobblePhase += dt * (2 * Math.PI * 3.1);
    this.wobbleAmp *= Math.exp(-dt * (1.6 + phys.viscosity * 2.4));
    if (this.wobbleAmp < 0.0005) this.wobbleAmp = 0;

    this.integrate(dt);
    this.writeGeometry();
    this.updateCompressionState();

    this.frame++;
    if (this.frame % 2 === 0) {
      this.callbacks?.onSquishUpdate?.(this.squishy);
    }
  }

  private integrate(dt: number): void {
    const phys = this.squishy.physics;
    const t = clamp((phys.recoverySpeed - 0.04) / 0.91, 0, 1);
    const riseTime = 6.0 * Math.exp(-3.2 * t);
    const zeta = clamp(1.05 - phys.wobbleIntensity * 0.85 + (phys.viscosity - 0.5) * 0.2, 0.08, 1.4);
    const omega = 4 / (zeta * riseTime);
    const contactOmega = 26;
    const poisson = phys.poissonRatio;

    const goal = this.goalScratch;
    const steps = 2;
    const h = dt / steps;

    // Rigidité uniforme pour toute la surface : un mélange par sommet créerait
    // des cisaillements (le maillage se déchire). Le mode « contact » est donc
    // calculé une fois par image, à partir de la pression la plus forte.
    let peak = this.squeezeAmount * this.bodyHeight * 0.55;
    if (this.press) peak = Math.max(peak, this.press.depth);
    for (const s of this.stamps) peak = Math.max(peak, s.depth);
    for (const t of this.transient) peak = Math.max(peak, t.src.depth);
    const contact = clamp(peak / 0.28, 0, 1);
    const om = omega + (contactOmega - omega) * contact;
    const zetaEff = zeta + (1.05 - zeta) * contact;
    const k = om * om;
    const c = 2 * zetaEff * om;

    for (let s = 0; s < steps; s++) {
      for (const d of this.deformables) {
        const arr = (d.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        const rest = d.rest;
        const off = d.offset;
        const vel = d.velocity;

        for (let i = 0; i < rest.length; i += 3) {
          const px = rest[i];
          const py = rest[i + 1];
          const pz = rest[i + 2];
          goal.set(0, 0, 0);

          // Compression globale (conservation approximative du volume)
          if (this.squeezeAmount > 0.0001) {
            const c2 = this.squeezeAmount;
            const ex = c2 * poisson * 0.9;
            goal.x += px * ex;
            goal.z += pz * ex;
            goal.y += py * -c2 * 0.55;
          }

          // Pression du pointeur
          if (this.press) applyPress(this.press, px, py, pz, goal, poisson);
          // Sillons de malaxage
          for (let k2 = 0; k2 < this.stamps.length; k2++) {
            applyPress(this.stamps[k2], px, py, pz, goal, poisson);
          }
          // Pressions ponctuelles
          for (let k2 = 0; k2 < this.transient.length; k2++) {
            applyPress(this.transient[k2].src, px, py, pz, goal, poisson);
          }

          let fx = goal.x;
          let fy = goal.y;
          let fz = goal.z;
          const gmag = Math.sqrt(fx * fx + fy * fy + fz * fz);
          // Plafond de déformation : évite le pliement de la surface.
          const maxDisp = this.bodyHeight * 0.4;
          if (gmag > maxDisp) {
            const scale = maxDisp / gmag;
            fx *= scale;
            fy *= scale;
            fz *= scale;
          }

          const ax = (fx - off[i]) * k - vel[i] * c;
          const ay = (fy - off[i + 1]) * k - vel[i + 1] * c;
          const az = (fz - off[i + 2]) * k - vel[i + 2] * c;
          vel[i] += ax * h;
          vel[i + 1] += ay * h;
          vel[i + 2] += az * h;
          off[i] += vel[i] * h;
          off[i + 1] += vel[i + 1] * h;
          off[i + 2] += vel[i + 2] * h;
        }
      }
    }
  }

  private goalScratch = new THREE.Vector3();

  private writeGeometry(): void {
    const phys = this.squishy.physics;
    const wob = this.wobbleAmp * Math.sin(this.wobblePhase);
    const lateral = 1 - wob * phys.poissonRatio * 0.35;

    for (const d of this.deformables) {
      const attr = d.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const rest = d.rest;
      const off = d.offset;
      for (let i = 0; i < rest.length; i += 3) {
        const y = rest[i + 1] + off[i + 1];
        arr[i] = (rest[i] + off[i]) * lateral;
        arr[i + 1] = this.bodyBottom + (y - this.bodyBottom) * (1 + wob);
        arr[i + 2] = (rest[i + 2] + off[i + 2]) * lateral;
      }
      attr.needsUpdate = true;
      d.geometry.computeVertexNormals();
      (d.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateCompressionState(): void {
    const body = this.deformables[0];
    let maxDisp = 0;
    let sum = 0;
    if (body) {
      for (let i = 0; i < body.rest.length; i += 3) {
        const disp = Math.hypot(body.offset[i], body.offset[i + 1], body.offset[i + 2]);
        if (disp > maxDisp) maxDisp = disp;
        sum += disp;
      }
    }
    const norm = Math.max(0.3, this.bodyHeight * 0.5);
    // Compression = écrasement global + enfoncement local
    const compression = clamp(Math.max(this.squeezeAmount, maxDisp / norm), 0, 1);
    const residual = clamp(sum / Math.max(1, body ? body.rest.length : 1) / norm, 0, 1);
    const isPressed = Boolean(this.press) || this.mega.active;

    this.squishy.syncDeformationState({
      currentCompression: compression,
      residualDeformation: residual,
      isPressed,
      isRecovering: !isPressed && residual > 0.01
    });

    const squished = this.squishy.face.reactiveToSquish && compression > 0.3;
    if (squished !== this.faceSquished) {
      this.faceSquished = squished;
      this.bundle?.updateFace(this.squishy.face.style, squished);
    }
  }

  // --- utilitaires ----------------------------------------------------------

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Nébuleuse lointaine très sombre : donne de la profondeur en orbite. */
  private createNebula(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 1024, 512);
      const blobs: [number, number, number, string][] = [
        [230, 190, 260, 'rgba(38, 20, 72, 0.55)'],
        [640, 300, 320, 'rgba(18, 30, 68, 0.5)'],
        [880, 120, 200, 'rgba(56, 24, 60, 0.4)'],
        [420, 420, 240, 'rgba(14, 26, 58, 0.45)']
      ];
      for (const [x, y, r, color] of blobs) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1024, 512);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(120, 48, 32),
      new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false
      })
    );
    mesh.renderOrder = -2;
    return mesh;
  }

  /** Champ d'étoiles fines en 3D, scintillement très discret. */
  private createStarField(): THREE.Points {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const radius = 34 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      phases[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.5 + Math.random() * 1.3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float phase;
        attribute float size;
        uniform float uTime;
        varying float vAlpha;
        varying float vTint;
        void main() {
          float tw = 0.5 + 0.5 * sin(uTime * 0.55 + phase);
          vAlpha = 0.22 + 0.78 * pow(tw, 3.0);
          vTint = fract(phase * 0.159);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (230.0 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vTint;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float core = smoothstep(0.5, 0.02, d);
          float halo = smoothstep(0.5, 0.14, d);
          vec3 warm = vec3(1.0, 0.92, 0.8);
          vec3 cool = vec3(0.76, 0.87, 1.0);
          vec3 col = mix(warm, cool, vTint);
          gl_FragColor = vec4(col, (core * 0.9 + halo * 0.22) * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = -1;
    return points;
  }

  private createStudioEnvironment(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, '#fff6fb');
      grad.addColorStop(0.5, '#e7d7e4');
      grad.addColorStop(1, '#8f7d8d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 128);
      const blob = ctx.createRadialGradient(190, 34, 0, 190, 34, 70);
      blob.addColorStop(0, 'rgba(255,255,255,1)');
      blob.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = blob;
      ctx.fillRect(120, 0, 140, 110);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    return env;
  }
}

function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Enfoncement localisé + gonflement annulaire (coefficient de Poisson). */
function applyPress(
  src: PressSource,
  px: number,
  py: number,
  pz: number,
  out: THREE.Vector3,
  poisson: number
): void {
  const dx = px - src.x;
  const dy = py - src.y;
  const dz = pz - src.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const R = src.radius;
  if (dist > R * 2.2) return;

  const t = dist / R;
  let w = 1 - t;
  if (w <= 0) return;
  w = w * w * (3 - 2 * w);

  const core = src.depth * w;
  out.x += src.dx * core;
  out.y += src.dy * core;
  out.z += src.dz * core;

  const rd = (dist - R * 1.2) / (R * 0.6);
  const ring = Math.exp(-rd * rd) * (dist > R * 0.3 ? 1 : 0);
  const bulge = src.depth * poisson * ring;
  out.x -= src.dx * bulge;
  out.y -= src.dy * bulge;
  out.z -= src.dz * bulge;
}

