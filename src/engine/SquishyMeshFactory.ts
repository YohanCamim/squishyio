import * as THREE from "three";
import { Squishy } from "../core/Squishy";
import {
  SquishyFaceProps,
  SquishyFaceStyle,
  SquishyMaterialProps,
  SquishyShapeType,
  SquishyTopping
} from "../core/types";

/**
 * Fabrique de maillages 3D déformables pour squishy.io.
 *
 * Chaque forme est décrite par une surface paramétrique (u, v) : le corps et
 * le décalque de visage sont générés depuis cette même surface, ce qui garantit
 * que le visage colle exactement au maillage et suit sa déformation.
 * La texture Canvas 2D apporte le dégradé et les toppings, une seconde texture
 * Canvas dédiée porte l'expression kawaii (basculable en mode « écrasé »).
 */

export interface SquishyMeshBundle {
  /** Conteneur racine (porte l'échelle globale de geometry.scale). */
  root: THREE.Group;
  /** Maillage principal, haute densité, déformable. */
  body: THREE.Mesh;
  /** Tous les maillages déformables (corps, décorations, visage). */
  meshes: THREE.Mesh[];
  /** Objets ciblés par le raycast (corps + décorations 3D). */
  pickTargets: THREE.Object3D[];
  material: THREE.MeshPhysicalMaterial;
  bodyTexture: THREE.CanvasTexture;
  faceTexture: THREE.CanvasTexture;
  /** Bascule l'expression du visage (style + mode écrasé). */
  updateFace(style: SquishyFaceStyle, squished: boolean): void;
  dispose(): void;
}

interface PartSpec {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  /** Partie prise en compte dans le cadrage de la caméra (paille/feuille : non). */
  framing?: boolean;
}

/** Surface paramétrique : (u, v) ∈ [0,1]² → point 3D. */
type PointFn = (u: number, v: number, out: THREE.Vector3) => void;

interface SurfaceSpec {
  point: PointFn;
  /** Sculpture appliquée à la surface (identique pour le corps et le visage). */
  sculpt?: (p: THREE.Vector3) => void;
  /** Zone du décalque de visage dans les paramètres (u, v). */
  decal: { uCenter: number; uHalf: number; vCenter: number; vHalf: number };
}

interface ShapeSpec {
  body: THREE.BufferGeometry;
  parts: PartSpec[];
  surface: SurfaceSpec;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function signedPow(v: number, e: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), e);
}

/**
 * Répartit n+1 paramètres à pas d'arc constant le long d'une courbe de surface.
 * Les surfaces très anguleuses (super-ellipsoïdes) répartissent mal leurs
 * paramètres : sans ce rééchantillonnage, les rangées du décalque de visage
 * se resserrent et la texture se déforme.
 */
function resampleByArcLength(
  fn: (t: number, out: THREE.Vector3) => void,
  t0: number,
  t1: number,
  n: number
): number[] {
  const steps = 160;
  const ts: number[] = [];
  const cum: number[] = [];
  const p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  fn(t0, p);
  prev.copy(p);
  ts.push(t0);
  cum.push(0);
  let total = 0;
  for (let i = 1; i <= steps; i++) {
    const t = t0 + (i / steps) * (t1 - t0);
    fn(t, p);
    total += p.distanceTo(prev);
    ts.push(t);
    cum.push(total);
    prev.copy(p);
  }
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * total;
    while (k < cum.length - 2 && cum[k + 1] < target) k++;
    const span = cum[k + 1] - cum[k];
    const f = span > 1e-9 ? (target - cum[k]) / span : 0;
    out.push(ts[k] + (ts[k + 1] - ts[k]) * f);
  }
  return out;
}

/**
 * Maillage paramétrique construit depuis une surface (u, v).
 * `bodyUv` = true : les UV suivent les paramètres de la surface (texturage du corps).
 * sinon : les UV suivent une projection plane sur le patch (décalque de visage),
 * ce qui évite les déformations de texture dues à la non-linéarité des
 * paramètres de surface (formes très anguleuses).
 */
function buildGrid(
  spec: SurfaceSpec,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  segUin: number,
  segVin: number,
  bodyUv: boolean,
  normalOffset = 0,
  closed = true,
  projectionScale: { x: number; y: number; z: number } | null = null,
  arcLength = false
): THREE.BufferGeometry {
  const segU = Math.max(2, Math.round(segUin));
  const segV = Math.max(2, Math.round(segVin));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const pu = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const cols = segU + 1;

  // Répartition à pas d'arc constant (décalque de visage) : les rangées et
  // colonnes sont alors régulièrement espacées sur la surface.
  let uValues: number[] | null = null;
  let vValues: number[] | null = null;
  if (!bodyUv && arcLength) {
    const uMid = (u0 + u1) / 2;
    const vMid = (v0 + v1) / 2;
    const sample = (u: number, v: number, out: THREE.Vector3): void => {
      spec.point(u, v, out);
      if (spec.sculpt) spec.sculpt(out);
    };
    uValues = resampleByArcLength(
      (t, out) => sample(t, vMid, out),
      u0,
      u1,
      segU
    );
    vValues = resampleByArcLength(
      (t, out) => sample(uMid, t, out),
      v0,
      v1,
      segV
    );
  }

  for (let j = 0; j <= segV; j++) {
    const v = vValues ? vValues[j] : v0 + (j / segV) * (v1 - v0);
    for (let i = 0; i <= segU; i++) {
      const u = uValues ? uValues[i] : u0 + (i / segU) * (u1 - u0);
      spec.point(u, v, p);
      if (spec.sculpt) spec.sculpt(p);
      if (normalOffset !== 0) {
        // Normale par différences finies, décalage anti z-fighting.
        const eu = 0.002;
        const ev = 0.002;
        spec.point(u + eu, v, pu);
        if (spec.sculpt) spec.sculpt(pu);
        spec.point(u, v + ev, pv);
        if (spec.sculpt) spec.sculpt(pv);
        du.subVectors(pu, p);
        dv.subVectors(pv, p);
        n.crossVectors(du, dv);
        if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
        n.normalize();
        // On garde la normale dirigée vers l'extérieur (vers +Z pour les faces).
        if (n.z < 0 && Math.abs(n.z) > 0.2) n.negate();
        p.addScaledVector(n, normalOffset);
      }
      positions.push(p.x, p.y, p.z);
      uvs.push(bodyUv ? u : i / segU, bodyUv ? v : j / segV);
    }
  }

  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const A = j * cols + i;
      const B = A + 1;
      const C = A + cols;
      const D = C + 1;
      indices.push(A, C, B, B, C, D);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  if (!bodyUv && projectionScale) {
    // Projection plane : la texture est étalée uniformément sur le patch,
    // sans déformation, quelle que soit la forme de la surface.
    const s = projectionScale;
    const pointAt = (
      i: number,
      j: number,
      out: THREE.Vector3
    ): THREE.Vector3 => {
      const k = (j * cols + i) * 3;
      return out.set(
        positions[k] * s.x,
        positions[k + 1] * s.y,
        positions[k + 2] * s.z
      );
    };
    const midI = Math.floor(segU / 2);
    const midJ = Math.floor(segV / 2);
    const center = pointAt(midI, midJ, new THREE.Vector3());
    const uA = pointAt(0, midJ, new THREE.Vector3());
    const uB = pointAt(segU, midJ, new THREE.Vector3());
    const vA = pointAt(midI, 0, new THREE.Vector3());
    const vB = pointAt(midI, segV, new THREE.Vector3());
    const tangent = new THREE.Vector3().subVectors(uB, uA);
    const bitangent = new THREE.Vector3().subVectors(vB, vA);
    const width = tangent.length();
    const height = bitangent.length();
    tangent.normalize();
    bitangent.normalize();

    const tmp = new THREE.Vector3();
    for (let j = 0; j <= segV; j++) {
      for (let i = 0; i <= segU; i++) {
        const k = j * cols + i;
        pointAt(i, j, tmp).sub(center);
        uvs[k * 2] = 0.5 + tmp.dot(tangent) / Math.max(1e-6, width);
        uvs[k * 2 + 1] = 0.5 + tmp.dot(bitangent) / Math.max(1e-6, height);
      }
    }
  }

  geo.computeVertexNormals();
  orientOutward(geo, closed);
  return geo;
}

/**
 * Garantit que les faces sont tournées vers l'extérieur.
 * Volume signé (théorème de divergence) pour les maillages fermés, produit
 * scalaire position·normale pour les patches ouverts (décalque de visage).
 */
function orientOutward(geo: THREE.BufferGeometry, closed: boolean): void {
  const index = geo.getIndex();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;

  let flip = false;
  if (closed && index) {
    const arr = index.array as unknown as number[];
    let vol = 0;
    for (let i = 0; i < arr.length; i += 3) {
      const a = arr[i];
      const b = arr[i + 1];
      const c = arr[i + 2];
      const ax = pos.getX(a),
        ay = pos.getY(a),
        az = pos.getZ(a);
      const bx = pos.getX(b),
        by = pos.getY(b),
        bz = pos.getZ(b);
      const cx = pos.getX(c),
        cy = pos.getY(c),
        cz = pos.getZ(c);
      vol +=
        ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx);
    }
    flip = vol < 0;
  } else {
    let sum = 0;
    const step = Math.max(1, Math.floor(pos.count / 200));
    for (let i = 0; i < pos.count; i += step) {
      sum +=
        pos.getX(i) * nor.getX(i) +
        pos.getY(i) * nor.getY(i) +
        pos.getZ(i) * nor.getZ(i);
    }
    flip = sum < 0;
  }
  if (!flip) return;

  if (index) {
    const arr = index.array as unknown as number[];
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    index.needsUpdate = true;
  }
  geo.computeVertexNormals();
}

export class SquishyMeshFactory {
  static readonly BODY_TEXTURE_SIZE = 1024;
  static readonly FACE_TEXTURE_SIZE = 512;

  build(squishy: Squishy): SquishyMeshBundle {
    const shape = squishy.geometry.shape;
    const seg = clamp(Math.round(squishy.geometry.subdivisions), 24, 128);
    const spec = this.createShape(shape, squishy, seg);

    const root = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    const pickTargets: THREE.Object3D[] = [];

    const bodyTexture = this.createBodyTexture(squishy);
    const material = this.createMaterial(squishy.material, bodyTexture);

    const bodyMesh = new THREE.Mesh(spec.body, material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    root.add(bodyMesh);
    meshes.push(bodyMesh);
    pickTargets.push(bodyMesh);

    for (const part of spec.parts) {
      // Les transformations sont cuites dans la géométrie : tous les maillages
      // déformables partagent ainsi le même repère (espace racine).
      part.geometry.applyMatrix4(
        new THREE.Matrix4().compose(
          part.position,
          new THREE.Quaternion().setFromEuler(part.rotation),
          part.scale
        )
      );
      part.geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = true;
      mesh.userData.framing = part.framing !== false;
      root.add(mesh);
      meshes.push(mesh);
      pickTargets.push(mesh);
    }

    // Décalque de visage : généré sur la surface du corps, il suit exactement
    // la déformation (pas de déchirure).
    const d = spec.surface.decal;
    const faceGeo = buildGrid(
      spec.surface,
      d.uCenter - d.uHalf,
      d.uCenter + d.uHalf,
      d.vCenter - d.vHalf,
      d.vCenter + d.vHalf,
      32,
      32,
      false,
      0.014,
      false,
      squishy.geometry.scale,
      true
    );
    const face = this.createFaceDecal(faceGeo);
    root.add(face.mesh);
    meshes.push(face.mesh);

    const scale = squishy.geometry.scale;
    root.scale.set(scale.x, scale.y, scale.z);

    const bundle: SquishyMeshBundle = {
      root,
      body: bodyMesh,
      meshes,
      pickTargets,
      material,
      bodyTexture,
      faceTexture: face.texture,
      updateFace: (style: SquishyFaceStyle, squished: boolean) => {
        this.drawFace(face.texture, squishy.face, style, squished);
        face.texture.needsUpdate = true;
      },
      dispose: () => {
        for (const mesh of meshes) {
          mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material & { map?: THREE.Texture };
          if (mat.map) mat.map.dispose();
          mat.dispose();
        }
        bodyTexture.dispose();
      }
    };

    this.drawFace(face.texture, squishy.face, squishy.face.style, false);
    face.texture.needsUpdate = true;

    return bundle;
  }

  /** Redessine la texture du corps (dégradé + toppings) et rafraîchit le matériau. */
  refreshTexture(bundle: SquishyMeshBundle, squishy: Squishy): void {
    this.drawBody(bundle.bodyTexture.image as HTMLCanvasElement, squishy);
    bundle.bodyTexture.needsUpdate = true;
    this.applyMaterial(bundle.material, squishy.material);
  }

  /** Redessine le visage (style + état écrasé). */
  refreshFace(
    bundle: SquishyMeshBundle,
    squishy: Squishy,
    squished: boolean
  ): void {
    bundle.updateFace(squishy.face.style, squished);
  }

  dispose(bundle: SquishyMeshBundle): void {
    bundle.dispose();
  }

  // --- surfaces paramétriques des formes ----------------------------------

  private createShape(
    shape: SquishyShapeType,
    squishy: Squishy,
    seg: number
  ): ShapeSpec {
    const roundness = clamp(squishy.geometry.roundness, 0.1, 1);
    switch (shape) {
      case "cat-paw":
        return this.createCatPaw(roundness, seg, squishy);
      case "peach":
        return this.createPeach(roundness, seg, squishy);
      case "milk-box":
        return this.createMilkBox(roundness, seg, squishy);
      case "mochi-bunny":
        return this.createMochiBunny(roundness, seg, squishy);
      case "boba-cup":
        return this.createBobaCup(roundness, seg, squishy);
      case "donut":
        return this.createDonut(roundness, seg, squishy);
      case "butter":
        return this.createButter(roundness, seg, squishy);
    }
  }

  /** Super-ellipsoïde : e1/e2 = 1 → sphère lisse, < 1 → forme carrée adoucie. */
  private superEllipsoid(
    a: number,
    b: number,
    c: number,
    e1: number,
    e2: number
  ): PointFn {
    return (u: number, v: number, out: THREE.Vector3) => {
      const ang = u * Math.PI * 2;
      const th = -Math.PI / 2 + v * Math.PI;
      const cvE = signedPow(Math.cos(th), e1);
      const svE = signedPow(Math.sin(th), e1);
      out.set(
        a * cvE * signedPow(Math.cos(ang), e2),
        b * svE,
        c * cvE * signedPow(Math.sin(ang), e2)
      );
    };
  }

  private createCatPaw(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const e = 0.6 + roundness * 0.45;
    const point = this.superEllipsoid(1.05, 0.95, 1.0, e, e);

    const toes = [
      { x: -0.68, y: 0.46, z: 0.42 },
      { x: -0.24, y: 0.6, z: 0.5 },
      { x: 0.24, y: 0.6, z: 0.5 },
      { x: 0.68, y: 0.46, z: 0.42 }
    ];

    const sculpt = (p: THREE.Vector3): void => {
      if (p.y < -0.55) p.y = -0.55 + (p.y + 0.55) * 0.45;
      p.x *= 1.1;
      for (const t of toes) {
        const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
        const w = Math.exp(-((d / 0.5) * (d / 0.5)));
        if (w < 0.002) continue;
        const k = w * 0.7;
        p.x += (t.x - p.x) * k;
        p.y += (t.y - p.y) * k;
        p.z += (t.z - p.z) * k;
      }
    };

    const surface: SurfaceSpec = {
      point,
      sculpt,
      decal: { uCenter: 0.25, uHalf: 0.09, vCenter: 0.5, vHalf: 0.115 }
    };

    return {
      body: buildGrid(surface, 0, 1, 0, 1, seg, Math.round(seg * 0.75), true),
      parts: [],
      surface
    };
  }

  private createPeach(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const e = 0.6 + roundness * 0.45;
    const point = this.superEllipsoid(1.0, 1.05, 0.98, e, e);

    // Fente de la pêche, sculptée sur le dessus
    const sculpt = (p: THREE.Vector3): void => {
      const g =
        Math.exp(-((p.x / 0.18) * (p.x / 0.18))) * smoothstep(0.3, 0.95, p.y);
      p.y -= g * 0.16;
      p.z -= g * 0.05 * Math.sign(p.z);
    };

    const surface: SurfaceSpec = {
      point,
      sculpt,
      decal: { uCenter: 0.25, uHalf: 0.08, vCenter: 0.52, vHalf: 0.105 }
    };

    const parts: PartSpec[] = [];
    const leafTopping = squishy.material.toppings.find(
      t => t.type === "leaf" && t.enabled
    );
    if (leafTopping) {
      parts.push({
        geometry: buildGrid(
          {
            point: this.superEllipsoid(0.34, 0.045, 0.2, 1, 1),
            decal: { uCenter: 0, uHalf: 0, vCenter: 0, vHalf: 0 }
          },
          0,
          1,
          0,
          1,
          24,
          12,
          true
        ),
        material: this.createSolidMaterial(leafTopping.color, 0.55, 0.35),
        position: new THREE.Vector3(0.05, 1.03, -0.02),
        rotation: new THREE.Euler(0.25, 0.5, -0.35),
        scale: new THREE.Vector3(1, 1, 1),
        framing: false
      });
    }

    return {
      body: buildGrid(surface, 0, 1, 0, 1, seg, Math.round(seg * 0.75), true),
      parts,
      surface
    };
  }

  private createMilkBox(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const e = 0.25 + roundness * 0.35;
    const surface: SurfaceSpec = {
      point: this.superEllipsoid(0.46, 0.62, 0.36, e, e),
      decal: { uCenter: 0.25, uHalf: 0.1, vCenter: 0.5, vHalf: 0.145 }
    };

    const parts: PartSpec[] = [];
    const straw = squishy.material.toppings.find(
      t => t.type === "straw" && t.enabled
    );
    if (straw) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.045, 0.05, 1.15, 20, 1, false),
        material: this.createSolidMaterial(straw.color, 0.35, 0.4),
        position: new THREE.Vector3(0.16, 0.92, 0.08),
        rotation: new THREE.Euler(0.16, 0, 0.24),
        scale: new THREE.Vector3(1, 1, 1),
        framing: false
      });
    }

    return {
      body: buildGrid(surface, 0, 1, 0, 1, seg, Math.round(seg * 0.8), true),
      parts,
      surface
    };
  }

  private createMochiBunny(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const e = 0.6 + roundness * 0.45;
    const surface: SurfaceSpec = {
      point: this.superEllipsoid(1.0, 0.9, 0.95, e, e),
      decal: { uCenter: 0.25, uHalf: 0.085, vCenter: 0.5, vHalf: 0.11 }
    };

    const parts: PartSpec[] = [];
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.CapsuleGeometry(0.24, 0.8, 12, 28),
        material: this.createSolidMaterial(
          squishy.material.primaryColor,
          0.6,
          0.25
        ),
        position: new THREE.Vector3(0.42 * side, 1.02, 0),
        rotation: new THREE.Euler(0.12, 0, -0.24 * side),
        scale: new THREE.Vector3(1, 1, 0.75)
      });
    }

    return {
      body: buildGrid(surface, 0, 1, 0, 1, seg, Math.round(seg * 0.75), true),
      parts,
      surface
    };
  }

  private createBobaCup(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const profile = [
      new THREE.Vector2(0.0, -0.66),
      new THREE.Vector2(0.3, -0.655),
      new THREE.Vector2(0.5, -0.61),
      new THREE.Vector2(0.58, -0.46),
      new THREE.Vector2(0.62, -0.2),
      new THREE.Vector2(0.72, 0.34),
      new THREE.Vector2(0.78, 0.6),
      new THREE.Vector2(0.79, 0.66)
    ];

    const point: PointFn = (u, v, out) => {
      const phi = u * Math.PI * 2;
      const f = v * (profile.length - 1);
      const i0 = Math.min(profile.length - 2, Math.floor(f));
      const t = f - i0;
      const r = profile[i0].x + (profile[i0 + 1].x - profile[i0].x) * t;
      const y = profile[i0].y + (profile[i0 + 1].y - profile[i0].y) * t;
      out.set(r * Math.sin(phi), y, r * Math.cos(phi));
    };

    const surface: SurfaceSpec = {
      point,
      decal: { uCenter: 0.0, uHalf: 0.13, vCenter: 0.78, vHalf: 0.15 }
    };

    const parts: PartSpec[] = [];
    parts.push({
      geometry: new THREE.SphereGeometry(
        0.8,
        48,
        28,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2
      ),
      material: this.createSolidMaterial(
        squishy.material.secondaryColor,
        0.55,
        0.2
      ),
      position: new THREE.Vector3(0, 0.66, 0),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(1, 0.52, 1)
    });

    const straw = squishy.material.toppings.find(
      t => t.type === "straw" && t.enabled
    );
    if (straw) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.048, 0.052, 1.7, 20, 1, false),
        material: this.createSolidMaterial(straw.color, 0.3, 0.45),
        position: new THREE.Vector3(0.3, 1.1, 0.06),
        rotation: new THREE.Euler(0.14, 0, -0.2),
        scale: new THREE.Vector3(1, 1, 1),
        framing: false
      });
    }

    return {
      body: buildGrid(surface, 0, 1, 0, 1, clamp(seg, 40, 128), 48, true),
      parts,
      surface
    };
  }

  private createDonut(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const tube = 0.42 + roundness * 0.06;
    const R = 1.0;

    // Anneau dans le plan XY : le trou fait face à la caméra, le glaçage
    // correspond à la bande avant du tube (v ~ 0.25).
    const point: PointFn = (u, v, out) => {
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      const r = R + tube * Math.cos(b);
      out.set(r * Math.cos(a), r * Math.sin(a), tube * Math.sin(b));
    };

    const surface: SurfaceSpec = {
      point,
      decal: { uCenter: 0.25, uHalf: 0.055, vCenter: 0.25, vHalf: 0.11 }
    };

    return {
      body: buildGrid(
        surface,
        0,
        1,
        0,
        1,
        Math.round(clamp(seg * 1.6, 48, 200)),
        clamp(Math.round(seg * 0.6), 24, 64),
        true
      ),
      parts: [],
      surface
    };
  }

  /**
   * Plaquette de beurre : bloc rectangulaire aux bords très adoucis
   * (super-ellipsoïde aplati) + carré de beurre fondant sur le dessus.
   */
  private createButter(
    roundness: number,
    seg: number,
    squishy: Squishy
  ): ShapeSpec {
    const e = 0.22 + roundness * 0.3;
    const a = 0.6;
    const b = 0.5;
    const c = 0.52;

    // Léger biseau sur le dessus : la plaquette a été демoulée.
    const sculpt = (p: THREE.Vector3): void => {
      if (p.y > b * 0.86) {
        const t = (p.y - b * 0.86) / (b * 0.14);
        p.y -= t * t * 0.045;
      }
    };

    const surface: SurfaceSpec = {
      point: this.superEllipsoid(a, b, c, e, e),
      sculpt,
      decal: { uCenter: 0.25, uHalf: 0.08, vCenter: 0.5, vHalf: 0.1 }
    };

    const parts: PartSpec[] = [];
    const pat = squishy.material.toppings.find(
      t => t.type === "butter-pat" && t.enabled
    );
    if (pat || squishy.geometry.shape === "butter") {
      const color = pat?.color ?? squishy.material.accentColor;
      const secondary = pat?.secondaryColor ?? squishy.material.primaryColor;
      const s = pat?.scale ?? 1;

      // Carré de beurre fondant posé sur le dessus
      const melting = buildGrid(
        {
          point: this.superEllipsoid(0.26 * s, 0.1 * s, 0.26 * s, 0.55, 0.55),
          sculpt: (p: THREE.Vector3) => {
            // Les bords fondent : le carré s'affaisse vers le bas.
            const r = Math.hypot(p.x, p.z) / (0.26 * s);
            if (r > 0.55) p.y -= (r - 0.55) * 0.16 * s;
          },
          decal: { uCenter: 0, uHalf: 0, vCenter: 0, vHalf: 0 }
        },
        0,
        1,
        0,
        1,
        32,
        20,
        true
      );
      parts.push({
        geometry: melting,
        material: this.createSolidMaterial(color, 0.42, 0.55),
        position: new THREE.Vector3(0.02, b + 0.02, 0),
        rotation: new THREE.Euler(0, 0.35, 0),
        scale: new THREE.Vector3(1, 1, 1),
        framing: false
      });

      // Gouttes de beurre qui coulent sur les bords
      for (let i = 0; i < 3; i++) {
        const angle = 0.5 + i * 2.1;
        const drop = buildGrid(
          {
            point: this.superEllipsoid(0.1 * s, 0.13 * s, 0.1 * s, 0.75, 0.75),
            decal: { uCenter: 0, uHalf: 0, vCenter: 0, vHalf: 0 }
          },
          0,
          1,
          0,
          1,
          20,
          14,
          true
        );
        parts.push({
          geometry: drop,
          material: this.createSolidMaterial(secondary, 0.4, 0.6),
          position: new THREE.Vector3(
            Math.cos(angle) * a * 0.86,
            b * 0.62,
            Math.sin(angle) * c * 0.86
          ),
          rotation: new THREE.Euler(0, 0, Math.cos(angle) * 0.25),
          scale: new THREE.Vector3(1, 1, 1),
          framing: false
        });
      }
    }

    return {
      body: buildGrid(surface, 0, 1, 0, 1, seg, Math.round(seg * 0.75), true),
      parts,
      surface
    };
  }

  // --- matériaux -----------------------------------------------------------

  private createMaterial(
    mat: SquishyMaterialProps,
    map: THREE.Texture
  ): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({
      map,
      roughness: mat.roughness,
      metalness: 0,
      clearcoat: mat.clearcoat,
      clearcoatRoughness: 0.25,
      transmission: mat.transmission,
      thickness: 0.9,
      ior: 1.35,
      envMapIntensity: 0.9
    });
    this.applyMaterial(m, mat);
    return m;
  }

  private applyMaterial(
    m: THREE.MeshPhysicalMaterial,
    mat: SquishyMaterialProps
  ): void {
    m.roughness = clamp(mat.roughness, 0.02, 1);
    m.clearcoat = clamp(mat.clearcoat, 0, 1);
    m.transmission = clamp(mat.transmission, 0, 0.95);
    m.metalness = 0;
    m.ior = 1.35;
    m.envMapIntensity = 0.9;

    switch (mat.finish) {
      case "glossy-jelly":
        m.roughness = Math.min(m.roughness, 0.2);
        m.clearcoat = Math.max(m.clearcoat, 0.8);
        m.clearcoatRoughness = 0.08;
        m.thickness = 1.2;
        break;
      case "matte-foam":
        m.roughness = Math.max(m.roughness, 0.5);
        m.clearcoat = Math.min(m.clearcoat, 0.3);
        m.clearcoatRoughness = 0.6;
        m.thickness = 0.5;
        m.sheen = 0.3;
        m.sheenRoughness = 0.9;
        break;
      case "velvet-mochi":
        m.roughness = Math.max(m.roughness, 0.6);
        m.clearcoat = Math.min(m.clearcoat, 0.22);
        m.thickness = 0.7;
        m.sheen = 1;
        m.sheenRoughness = 0.65;
        break;
      case "pearlescent":
        m.roughness = Math.min(m.roughness, 0.4);
        m.clearcoat = Math.max(m.clearcoat, 0.6);
        m.iridescence = 1;
        m.iridescenceIOR = 1.3;
        m.iridescenceThicknessRange = [120, 620];
        break;
      case "sugar-coated":
        m.roughness = Math.min(m.roughness, 0.45);
        m.clearcoat = Math.max(m.clearcoat, 0.5);
        m.sheen = 0.5;
        m.sheenRoughness = 0.4;
        break;
    }
    m.needsUpdate = true;
  }

  private createSolidMaterial(
    color: string,
    roughness: number,
    clearcoat: number
  ): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness: 0,
      clearcoat,
      clearcoatRoughness: 0.25
    });
  }

  // --- décalque de visage --------------------------------------------------

  private createFaceDecal(geometry: THREE.BufferGeometry): {
    mesh: THREE.Mesh;
    texture: THREE.CanvasTexture;
  } {
    const canvas = document.createElement("canvas");
    canvas.width = SquishyMeshFactory.FACE_TEXTURE_SIZE;
    canvas.height = SquishyMeshFactory.FACE_TEXTURE_SIZE;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // Le visage est un décalque sur la face avant : il reste lisible même
      // quand la surface se déforme fortement.
      depthTest: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 3;
    return { mesh, texture };
  }

  private drawFace(
    texture: THREE.CanvasTexture,
    face: SquishyFaceProps,
    style: SquishyFaceStyle,
    squished: boolean
  ): void {
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const S = canvas.width;
    ctx.clearRect(0, 0, S, S);
    if (style === "none" && !squished) return;

    const cx = S / 2;
    const eyeY = S * 0.44;
    const dx = S * 0.155 * face.scale;
    const r = S * 0.075 * face.scale;

    // Blush
    if (face.blushIntensity > 0) {
      ctx.globalAlpha = clamp(face.blushIntensity, 0, 1) * 0.75;
      ctx.fillStyle = face.blushColor;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          cx + s * dx * 1.95,
          eyeY + S * 0.11,
          S * 0.075,
          S * 0.05,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = face.eyeColor;
    ctx.fillStyle = face.eyeColor;
    ctx.lineWidth = S * 0.026;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (squished) {
      // Expression « écrasée » : > < et bouche ondulée
      const arm = S * 0.055;
      for (const s of [-1, 1]) {
        const x = cx + s * dx;
        ctx.beginPath();
        if (s < 0) {
          ctx.moveTo(x - arm, eyeY - arm);
          ctx.lineTo(x + arm, eyeY);
          ctx.lineTo(x - arm, eyeY + arm);
        } else {
          ctx.moveTo(x + arm, eyeY - arm);
          ctx.lineTo(x - arm, eyeY);
          ctx.lineTo(x + arm, eyeY + arm);
        }
        ctx.stroke();
      }
      const w = S * 0.075;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const x = cx - w + t * w * 2;
        const y = eyeY + S * 0.19 + Math.sin(t * Math.PI * 4) * S * 0.022;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    switch (style) {
      case "kawaii-happy": {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + s * dx, eyeY, r * 0.82, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(
            cx + s * dx - r * 0.28,
            eyeY - r * 0.35,
            r * 0.26,
            r * 0.32,
            0,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        ctx.fillStyle = face.eyeColor;
        ctx.beginPath();
        ctx.arc(cx, eyeY + S * 0.11, S * 0.055, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        break;
      }
      case "sleepy-zen": {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(
            cx + s * dx,
            eyeY + r * 0.35,
            r * 0.95,
            1.15 * Math.PI,
            1.85 * Math.PI
          );
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, eyeY + S * 0.12, S * 0.032, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
        break;
      }
      case "starry-eyed": {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + s * dx, eyeY, r * 0.95, r * 1.1, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        for (const s of [-1, 1]) {
          drawStar(ctx, cx + s * dx, eyeY, r * 0.45, r * 0.18, 5);
        }
        ctx.fillStyle = face.eyeColor;
        ctx.beginPath();
        ctx.arc(cx, eyeY + S * 0.12, S * 0.04, 0.1 * Math.PI, 0.9 * Math.PI);
        ctx.stroke();
        break;
      }
      case "cheeky-wink": {
        ctx.beginPath();
        ctx.ellipse(cx - dx, eyeY, r * 0.85, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.ellipse(
          cx - dx - r * 0.26,
          eyeY - r * 0.35,
          r * 0.25,
          r * 0.3,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = face.eyeColor;
        ctx.beginPath();
        ctx.moveTo(cx + dx - r * 0.7, eyeY - r * 0.35);
        ctx.quadraticCurveTo(
          cx + dx,
          eyeY + r * 0.55,
          cx + dx + r * 0.7,
          eyeY - r * 0.35
        );
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - S * 0.05, eyeY + S * 0.13);
        ctx.quadraticCurveTo(
          cx + S * 0.02,
          eyeY + S * 0.17,
          cx + S * 0.07,
          eyeY + S * 0.1
        );
        ctx.stroke();
        break;
      }
      case "none":
        break;
    }
  }

  // --- texture du corps ----------------------------------------------------

  private createBodyTexture(squishy: Squishy): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = SquishyMeshFactory.BODY_TEXTURE_SIZE;
    canvas.height = SquishyMeshFactory.BODY_TEXTURE_SIZE;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this.drawBody(canvas, squishy);
    return texture;
  }

  private drawBody(canvas: HTMLCanvasElement, squishy: Squishy): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const S = canvas.width;
    const mat = squishy.material;
    const shape = squishy.geometry.shape;

    ctx.clearRect(0, 0, S, S);

    // Dégradé principal -> secondaire
    const grad = ctx.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, mat.primaryColor);
    grad.addColorStop(1, mat.secondaryColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);

    // gradientStrength = 0 => couleur unie
    if (mat.gradientStrength < 1) {
      ctx.globalAlpha = 1 - clamp(mat.gradientStrength, 0, 1);
      ctx.fillStyle = mat.primaryColor;
      ctx.fillRect(0, 0, S, S);
      ctx.globalAlpha = 1;
    }

    // Reflet doux
    const glow = ctx.createRadialGradient(
      S * 0.3,
      S * 0.24,
      0,
      S * 0.3,
      S * 0.24,
      S * 0.62
    );
    glow.addColorStop(0, "rgba(255,255,255,0.4)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);

    // Grain velouté
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const a = Math.random() * 0.05;
      ctx.fillStyle =
        Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 2, 2);
    }

    this.drawShapeDetails(ctx, S, shape, squishy);
    this.drawToppings(ctx, S, shape, squishy);
  }

  private drawShapeDetails(
    ctx: CanvasRenderingContext2D,
    S: number,
    shape: SquishyShapeType,
    squishy: Squishy
  ): void {
    switch (shape) {
      case "cat-paw": {
        // coussinets roses des orteils (haut de la face avant, u = 0.25)
        const bean = squishy.material.toppings.find(
          t => t.type === "cat-beans"
        );
        ctx.fillStyle =
          bean && bean.enabled ? bean.color : squishy.material.accentColor;
        for (let i = 0; i < 4; i++) {
          const x = S * 0.25 + (i - 1.5) * S * 0.05;
          const y = S * 0.2;
          ctx.beginPath();
          ctx.ellipse(x, y, S * 0.024, S * 0.03, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "peach": {
        ctx.fillStyle = "rgba(255,120,140,0.35)";
        for (let i = 0; i < 26; i++) {
          const x = S * 0.25 + (Math.random() - 0.5) * S * 0.35;
          const y = S * 0.45 + (Math.random() - 0.5) * S * 0.5;
          ctx.beginPath();
          ctx.ellipse(x, y, S * 0.008, S * 0.011, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "milk-box": {
        // motif fraise
        const x = S * 0.25;
        const y = S * 0.72;
        ctx.fillStyle = squishy.material.accentColor;
        ctx.beginPath();
        ctx.moveTo(x, y - S * 0.05);
        ctx.bezierCurveTo(
          x + S * 0.06,
          y - S * 0.02,
          x + S * 0.045,
          y + S * 0.055,
          x,
          y + S * 0.07
        );
        ctx.bezierCurveTo(
          x - S * 0.045,
          y + S * 0.055,
          x - S * 0.06,
          y - S * 0.02,
          x,
          y - S * 0.05
        );
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(
            x + Math.cos(a) * S * 0.018,
            y + Math.sin(a) * S * 0.022,
            S * 0.004,
            S * 0.006,
            0,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        break;
      }
      case "mochi-bunny": {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.beginPath();
        ctx.ellipse(S * 0.25, S * 0.78, S * 0.11, S * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "boba-cup": {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(0, S * 0.68, S, S * 0.04);
        break;
      }
      case "butter": {
        // Dessus fondu et crémeux (v proche de 1 => haut du canvas)
        const melt = ctx.createLinearGradient(0, 0, 0, S * 0.12);
        melt.addColorStop(0, "rgba(255,255,255,0.28)");
        melt.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = melt;
        ctx.fillRect(0, 0, S, S * 0.12);

        // Reflets doux sur la face avant (u = 0.25)
        const side = ctx.createRadialGradient(
          S * 0.25,
          S * 0.55,
          0,
          S * 0.25,
          S * 0.55,
          S * 0.32
        );
        side.addColorStop(0, "rgba(255,255,255,0.16)");
        side.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = side;
        ctx.fillRect(0, 0, S, S);
        break;
      }
      case "donut": {
        const top = S * 0.7;
        const bottom = S * 0.84;
        const icing = ctx.createLinearGradient(0, top, 0, bottom);
        icing.addColorStop(0, squishy.material.secondaryColor);
        icing.addColorStop(1, squishy.material.accentColor);
        ctx.fillStyle = icing;
        ctx.beginPath();
        ctx.moveTo(0, bottom);
        for (let x = 0; x <= S; x += 16) {
          const y = top + Math.sin((x / S) * Math.PI * 8) * S * 0.02;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(S, bottom);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }

  private drawToppings(
    ctx: CanvasRenderingContext2D,
    S: number,
    shape: SquishyShapeType,
    squishy: Squishy
  ): void {
    for (const topping of squishy.material.toppings) {
      if (!topping.enabled) continue;
      switch (topping.type) {
        case "sprinkles":
          this.drawSprinkles(ctx, S, shape, topping);
          break;
        case "cat-beans":
          this.drawCatBeans(ctx, S, topping);
          break;
        case "pearl-boba":
          this.drawBobaPearls(ctx, S, topping);
          break;
        case "blush-hearts":
          this.drawHearts(ctx, S, topping);
          break;
        case "icing-drip":
          this.drawIcingDrip(ctx, S, topping);
          break;
        case "butter-pat":
          this.drawButterPat(ctx, S, topping);
          break;
        case "leaf":
        case "straw":
          // décorations 3D : rien à peindre sur la texture
          break;
      }
    }
  }

  private drawSprinkles(
    ctx: CanvasRenderingContext2D,
    S: number,
    shape: SquishyShapeType,
    topping: SquishyTopping
  ): void {
    const colors = [
      topping.color,
      topping.secondaryColor ?? "#ffffff",
      "#ff9ecb",
      "#9ad9ff",
      "#ffe08a"
    ];
    const band = shape === "donut";
    const count = 90;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * S;
      const y = band ? S * 0.68 + Math.random() * S * 0.16 : Math.random() * S;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      const w = S * 0.016 * topping.scale;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -w / 4, w, w / 2, w / 4);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCatBeans(
    ctx: CanvasRenderingContext2D,
    S: number,
    topping: SquishyTopping
  ): void {
    ctx.fillStyle = topping.color;
    for (let i = 0; i < 18; i++) {
      const x = S * 0.25 + (Math.random() - 0.5) * S * 0.26;
      const y = S * 0.2 + (Math.random() - 0.5) * S * 0.1;
      ctx.beginPath();
      ctx.ellipse(x, y, S * 0.016, S * 0.022, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBobaPearls(
    ctx: CanvasRenderingContext2D,
    S: number,
    topping: SquishyTopping
  ): void {
    ctx.fillStyle = topping.color;
    for (let i = 0; i < 44; i++) {
      const x = Math.random() * S;
      const y = S * 0.92 - Math.random() * S * 0.2;
      ctx.beginPath();
      ctx.ellipse(x, y, S * 0.022, S * 0.022, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = topping.secondaryColor ?? topping.color;
    for (let i = 0; i < 22; i++) {
      const x = Math.random() * S;
      const y = S * 0.92 - Math.random() * S * 0.2;
      ctx.beginPath();
      ctx.ellipse(x, y, S * 0.012, S * 0.012, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHearts(
    ctx: CanvasRenderingContext2D,
    S: number,
    topping: SquishyTopping
  ): void {
    ctx.fillStyle = topping.color;
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = S * 0.014 * topping.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, r * 0.6);
      ctx.bezierCurveTo(-r * 1.3, -r * 0.4, -r * 0.4, -r * 1.2, 0, -r * 0.35);
      ctx.bezierCurveTo(r * 0.4, -r * 1.2, r * 1.3, -r * 0.4, 0, r * 0.6);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Carré de beurre fondant peint sur le dessus de la plaquette. */
  private drawButterPat(
    ctx: CanvasRenderingContext2D,
    S: number,
    topping: SquishyTopping
  ): void {
    const w = S * 0.1 * topping.scale;
    const x = S * 0.25 - w / 2;
    const y = S * 0.015;
    ctx.fillStyle = topping.color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, w * 0.55, w * 0.12);
    ctx.fill();
    ctx.fillStyle = topping.secondaryColor ?? topping.color;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.roundRect(x + w * 0.12, y + w * 0.08, w * 0.76, w * 0.4, w * 0.1);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawIcingDrip(
    ctx: CanvasRenderingContext2D,
    S: number,
    topping: SquishyTopping
  ): void {
    ctx.fillStyle = topping.color;
    for (let x = 0; x < S; x += S * 0.05) {
      const h = S * (0.02 + Math.random() * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, S * 0.68);
      ctx.lineTo(x + S * 0.025, S * 0.68);
      ctx.lineTo(x + S * 0.0125, S * 0.68 + h);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
