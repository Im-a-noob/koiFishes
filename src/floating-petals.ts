import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH, viewportPoint } from "./config";
import type { RippleSystem } from "./ripple-system";
import { SurfaceGeometryBatch } from "./surface-geometry";
import type { VortexSystem } from "./vortices";

export type PetalType = "momiji" | "sakura";

export interface FloatingPetal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  scale: number;
  bob: number;
  bobVel: number;
  pitch: number;
  roll: number;
  type: PetalType;
  paletteIndex: number;
  inAir: boolean;
  fallHeight: number; // 1.0 (air) to 0.0 (water)
  fallRate: number;
  shadowDistance: number;
}

const MOMIJI_PALETTES = [
  { base: new THREE.Color(0xb82e1f), light: new THREE.Color(0xdc4b28), vein: new THREE.Color(0x73140b) }, // Crimson
  { base: new THREE.Color(0xc94c18), light: new THREE.Color(0xe67324), vein: new THREE.Color(0x822507) }, // Fiery orange
  { base: new THREE.Color(0xcb7519), light: new THREE.Color(0xebb034), vein: new THREE.Color(0x854308) }, // Golden amber
  { base: new THREE.Color(0x8e1e24), light: new THREE.Color(0xb53238), vein: new THREE.Color(0x540c11) }, // Deep scarlet
];

const SAKURA_PALETTES = [
  { base: new THREE.Color(0xffccd9), light: new THREE.Color(0xffe6ee), vein: new THREE.Color(0xf598b0) }, // Soft sakura pink
  { base: new THREE.Color(0xffb8cb), light: new THREE.Color(0xffd4e2), vein: new THREE.Color(0xeb7895) }, // Rose blush
  { base: new THREE.Color(0xffedf2), light: new THREE.Color(0xffffff), vein: new THREE.Color(0xf7b5c8) }, // Pure white petal
];

const TAU = Math.PI * 2;
const MAX_PETALS = 36;

export class FloatingPetalsPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly petalGeometry = new THREE.BufferGeometry();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x051210,
    opacity: 0.35,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly petalMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  private readonly shadowBatch = new SurfaceGeometryBatch(this.shadowGeometry, 24_000);
  private readonly petalBatch = new SurfaceGeometryBatch(this.petalGeometry, 24_000, true);

  public readonly petals: FloatingPetal[] = [];
  private lastTime = 0;
  private spawnCountdown = 2.0;

  public constructor() {
    this.shadowGeometry.name = "floating petals shadow";
    this.petalGeometry.name = "floating petals";

    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const petalMesh = new THREE.Mesh(this.petalGeometry, this.petalMaterial);
    shadowMesh.frustumCulled = false;
    petalMesh.frustumCulled = false;
    this.shadowGroup.add(shadowMesh);
    this.group.add(petalMesh);

    // Initial scatter of floating flora
    for (let i = 0; i < 16; i += 1) {
      const type: PetalType = Math.random() < 0.65 ? "momiji" : "sakura";
      const palettes = type === "momiji" ? MOMIJI_PALETTES : SAKURA_PALETTES;
      const initialPos = viewportPoint(
        40 + Math.random() * 400,
        30 + Math.random() * 210,
      );
      this.petals.push({
        x: initialPos.x,
        y: initialPos.y,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        angle: Math.random() * TAU,
        angularVel: (Math.random() - 0.5) * 0.4,
        scale: type === "momiji" ? 0.75 + Math.random() * 0.45 : 0.65 + Math.random() * 0.35,
        bob: 0,
        bobVel: 0,
        pitch: 0,
        roll: 0,
        type,
        paletteIndex: Math.floor(Math.random() * palettes.length),
        inAir: false,
        fallHeight: 0,
        fallRate: 0,
        shadowDistance: 12.0,
      });
    }
  }

  public spawnFallingPetal(x?: number, y?: number, forcedType?: PetalType): void {
    if (this.petals.length >= MAX_PETALS) {
      this.petals.shift();
    }
    const type: PetalType = forcedType ?? (Math.random() < 0.6 ? "momiji" : "sakura");
    const palettes = type === "momiji" ? MOMIJI_PALETTES : SAKURA_PALETTES;
    const px = x ?? (20 + Math.random() * (CANVAS_WIDTH - 40));
    const py = y ?? (20 + Math.random() * (CANVAS_HEIGHT - 40));

    this.petals.push({
      x: px,
      y: py,
      vx: (Math.random() - 0.3) * 3.5,
      vy: (Math.random() * 0.5 + 0.2) * 2.5,
      angle: Math.random() * TAU,
      angularVel: (Math.random() - 0.5) * 2.8,
      scale: type === "momiji" ? 0.8 + Math.random() * 0.4 : 0.7 + Math.random() * 0.35,
      bob: 0.5,
      bobVel: 0,
      pitch: 0.4,
      roll: 0.3,
      type,
      paletteIndex: Math.floor(Math.random() * palettes.length),
      inAir: true,
      fallHeight: 1.0,
      fallRate: 0.28 + Math.random() * 0.22,
      shadowDistance: 12.0,
    });
  }

  public applyImpulse(x: number, y: number, vx: number, vy: number, radius = 35): void {
    const rSq = radius * radius;
    for (const p of this.petals) {
      if (p.inAir) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < rSq && dSq > 0.01) {
        const d = Math.sqrt(dSq);
        const factor = (1.0 - d / radius);
        p.vx += (vx * 0.8 + (dx / d) * 12.0) * factor;
        p.vy += (vy * 0.8 + (dy / d) * 12.0) * factor;
        p.angularVel += (Math.random() - 0.5) * 4.0 * factor;
        p.bobVel += factor * 8.0;
      }
    }
  }

  public update(
    time: number,
    vortices?: VortexSystem,
    ripples?: RippleSystem,
    lotusOccluders?: readonly { x: number; y: number; radius: number }[],
    lightDirection?: THREE.Vector2,
    sunAltitude = 0.8,
  ): void {
    if (this.lastTime === 0) {
      this.lastTime = time;
      return;
    }
    const rawDt = time - this.lastTime;
    this.lastTime = time;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    // Periodic autumn leaf drift from canopy
    this.spawnCountdown -= dt;
    if (this.spawnCountdown <= 0) {
      this.spawnFallingPetal();
      this.spawnCountdown = 3.5 + Math.random() * 4.0;
    }

    const lightDir = lightDirection ?? new THREE.Vector2(-0.5, 0.8);
    const shadowDist = (1.0 - Math.min(1.0, Math.max(0.1, sunAltitude)) * 0.6) * 13.0;

    // Ambient current drift vector
    const driftCurrentX = Math.cos(time * 0.12) * 1.5 + 2.2;
    const driftCurrentY = Math.sin(time * 0.15) * 1.2 + 0.8;

    // Physics step
    for (let i = 0; i < this.petals.length; i += 1) {
      const p = this.petals[i];

      if (p.inAir) {
        p.fallHeight -= p.fallRate * dt;
        p.x += (p.vx + Math.sin(time * 3.5 + i) * 8.0) * dt;
        p.y += (p.vy + Math.cos(time * 3.0 + i) * 6.0) * dt;
        p.angle += p.angularVel * dt;
        p.pitch = Math.sin(time * 4.0 + i) * 0.45;
        p.roll = Math.cos(time * 3.8 + i) * 0.45;

        if (p.fallHeight <= 0) {
          p.fallHeight = 0;
          p.inAir = false;
          p.bob = 0.25;
          p.bobVel = -6.0;
          ripples?.trigger("rain", { x: p.x, y: p.y });
        }
        continue;
      }

      // 1. Water Current & Vortex Advection
      let flowVx = driftCurrentX;
      let flowVy = driftCurrentY;

      if (vortices) {
        const vFlow = vortices.getVelocityAt(p.x, p.y);
        flowVx += vFlow.vx * 1.4;
        flowVy += vFlow.vy * 1.4;
      }

      p.vx += (flowVx - p.vx) * 1.8 * dt;
      p.vy += (flowVy - p.vy) * 1.8 * dt;

      // 2. Capillary Attraction ("Cheerios effect" - clustering together)
      for (let j = i + 1; j < this.petals.length; j += 1) {
        const other = this.petals[j];
        if (other.inAir) continue;
        const dx = other.x - p.x;
        const dy = other.y - p.y;
        const dSq = dx * dx + dy * dy;
        const minClusterDist = 18.0;
        const contactDist = 8.0;

        if (dSq < minClusterDist * minClusterDist && dSq > 0.01) {
          const d = Math.sqrt(dSq);
          const nx = dx / d;
          const ny = dy / d;

          if (d < contactDist) {
            // Repulsion to prevent stacking directly atop each other
            const overlap = (contactDist - d) * 0.5;
            p.x -= nx * overlap * 0.5;
            p.y -= ny * overlap * 0.5;
            other.x += nx * overlap * 0.5;
            other.y += ny * overlap * 0.5;
          } else {
            // Capillary attraction towards neighbors
            const capillaryStrength = (1.0 - d / minClusterDist) * 3.5;
            p.vx += nx * capillaryStrength * dt;
            p.vy += ny * capillaryStrength * dt;
            other.vx -= nx * capillaryStrength * dt;
            other.vy -= ny * capillaryStrength * dt;
          }
        }
      }

      // 3. Lotus Leaf Boundary Deflection
      if (lotusOccluders) {
        for (const oc of lotusOccluders) {
          const dx = p.x - oc.x;
          const dy = p.y - oc.y;
          const d = Math.hypot(dx, dy);
          const safeDist = oc.radius * 0.98;
          if (d < safeDist && d > 0.01) {
            const nx = dx / d;
            const ny = dy / d;
            const push = (safeDist - d);
            p.x += nx * push * 0.6;
            p.y += ny * push * 0.6;
            // Slide tangentially along pad edge
            const tangentX = -ny;
            const tangentY = nx;
            p.vx += tangentX * 4.0 * dt;
            p.vy += tangentY * 4.0 * dt;
          }
        }
      }

      // 4. Ripple Impulse & Buoyant Rocking
      if (ripples) {
        for (const rip of ripples.instances) {
          if (!rip.alive || rip.age < 0) continue;
          const dx = p.x - rip.center.x;
          const dy = p.y - rip.center.y;
          const d = Math.hypot(dx, dy);
          const waveRadius = rip.age * 90.0;
          const distFromFront = Math.abs(d - waveRadius);
          if (distFromFront < 18.0) {
            const factor = (1.0 - distFromFront / 18.0) * rip.strength;
            p.bobVel += factor * 8.5 * dt;
            p.pitch += Math.sin(rip.age * 12.0) * factor * 0.25;
            p.roll += Math.cos(rip.age * 10.0) * factor * 0.25;
          }
        }
      }

      // Spring-damper integration for floating bobbing & tilt
      p.bobVel += (-24.0 * p.bob - 6.0 * p.bobVel) * dt;
      p.bob += p.bobVel * dt;
      p.pitch += (-12.0 * p.pitch) * dt;
      p.roll += (-12.0 * p.roll) * dt;

      // Position update & friction
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;

      p.angle += p.angularVel * dt;
      p.angularVel *= 0.97;

      // Screen wrapping
      if (p.x < -20) p.x = CANVAS_WIDTH + 15;
      if (p.x > CANVAS_WIDTH + 20) p.x = -15;
      if (p.y < -20) p.y = CANVAS_HEIGHT + 15;
      if (p.y > CANVAS_HEIGHT + 20) p.y = -15;
    }

    // Geometry batching
    this.shadowBatch.reset();
    this.petalBatch.reset();

    for (const p of this.petals) {
      const sx = -lightDir.x * (shadowDist + p.fallHeight * 22.0);
      const sy = -lightDir.y * (shadowDist + p.fallHeight * 22.0);

      if (p.type === "momiji") {
        const palettes = MOMIJI_PALETTES;
        const pal = palettes[p.paletteIndex % palettes.length];
        this.drawMomiji(this.shadowBatch, p.x + sx, p.y + sy, p.angle, p.scale, p.pitch, p.roll);
        this.drawMomiji(this.petalBatch, p.x, p.y, p.angle, p.scale, p.pitch, p.roll, pal);
      } else {
        const palettes = SAKURA_PALETTES;
        const pal = palettes[p.paletteIndex % palettes.length];
        this.drawSakura(this.shadowBatch, p.x + sx, p.y + sy, p.angle, p.scale, p.pitch, p.roll);
        this.drawSakura(this.petalBatch, p.x, p.y, p.angle, p.scale, p.pitch, p.roll, pal);
      }
    }

    this.shadowBatch.commit();
    this.petalBatch.commit();
  }

  // Draw Japanese 5-pointed Momiji maple leaf
  private drawMomiji(
    batch: SurfaceGeometryBatch,
    cx: number,
    cy: number,
    angle: number,
    scale: number,
    pitch: number,
    roll: number,
    palette?: { base: THREE.Color; light: THREE.Color; vein: THREE.Color },
  ): void {
    const r = 11.0 * scale * (1.0 + pitch * 0.15);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const cosR = 1.0 - Math.abs(roll) * 0.35;

    const rot = (x: number, y: number): { x: number; y: number } => ({
      x: cx + (x * cosA - y * sinA) * cosR,
      y: cy + (x * sinA + y * cosA),
    });

    const center = rot(0, 0);
    const lobeAngles = [-0.68, -0.34, 0.0, 0.34, 0.68];
    const lobeLengths = [0.75, 0.95, 1.05, 0.95, 0.75];

    for (let l = 0; l < 5; l += 1) {
      const la = lobeAngles[l] * Math.PI;
      const len = r * lobeLengths[l];
      const tip = rot(Math.cos(la) * len, Math.sin(la) * len);
      const left = rot(Math.cos(la - 0.18) * len * 0.45, Math.sin(la - 0.18) * len * 0.45);
      const right = rot(Math.cos(la + 0.18) * len * 0.45, Math.sin(la + 0.18) * len * 0.45);

      if (palette) {
        batch.triangleColors(center, left, tip, palette.vein, palette.base, palette.light);
        batch.triangleColors(center, tip, right, palette.vein, palette.light, palette.base);
      } else {
        batch.triangle(center, left, tip);
        batch.triangle(center, tip, right);
      }
    }

    // Stem (modeled as a slender triangle to preserve vertex triplet alignment for THREE.Mesh)
    const stemEnd = rot(-r * 0.55, 0);
    const stemWidth = 0.55 * scale;
    const normalX = -sinA * stemWidth;
    const normalY = cosA * stemWidth;
    const stemL = { x: stemEnd.x + normalX, y: stemEnd.y + normalY };
    const stemR = { x: stemEnd.x - normalX, y: stemEnd.y - normalY };
    if (palette) {
      batch.triangleColors(center, stemL, stemR, palette.vein, palette.vein, palette.vein);
    } else {
      batch.triangle(center, stemL, stemR);
    }
  }

  // Draw delicate notched Sakura cherry blossom petal
  private drawSakura(
    batch: SurfaceGeometryBatch,
    cx: number,
    cy: number,
    angle: number,
    scale: number,
    pitch: number,
    roll: number,
    palette?: { base: THREE.Color; light: THREE.Color; vein: THREE.Color },
  ): void {
    const len = 9.5 * scale * (1.0 + pitch * 0.15);
    const w = 5.5 * scale * (1.0 - Math.abs(roll) * 0.3);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const rot = (x: number, y: number): { x: number; y: number } => ({
      x: cx + (x * cosA - y * sinA),
      y: cy + (x * sinA + y * cosA),
    });

    const base = rot(-len * 0.45, 0);
    const midL = rot(0, -w * 0.5);
    const midR = rot(0, w * 0.5);
    const tipL = rot(len * 0.55, -w * 0.28);
    const tipR = rot(len * 0.55, w * 0.28);
    const notch = rot(len * 0.40, 0); // Heart indentation

    if (palette) {
      batch.triangleColors(base, midL, notch, palette.vein, palette.base, palette.light);
      batch.triangleColors(base, notch, midR, palette.vein, palette.light, palette.base);
      batch.triangleColors(midL, tipL, notch, palette.base, palette.light, palette.light);
      batch.triangleColors(notch, tipR, midR, palette.light, palette.light, palette.base);
    } else {
      batch.triangle(base, midL, notch);
      batch.triangle(base, notch, midR);
      batch.triangle(midL, tipL, notch);
      batch.triangle(notch, tipR, midR);
    }
  }
}
