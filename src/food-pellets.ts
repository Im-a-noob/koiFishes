import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./config";
import type { RippleSystem } from "./ripple-system";
import { SurfaceGeometryBatch } from "./surface-geometry";
import type { VortexSystem } from "./vortices";

export interface FoodPellet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  bob: number;
  bobVel: number;
  age: number;
  maxAge: number;
  alive: boolean;
  beingSucked: boolean;
}

const MAX_PELLETS = 48;
const PELLET_COLOR = new THREE.Color(0xb58238); // Golden tan
const PELLET_CORE = new THREE.Color(0xd49b4d);  // Baked highlight
const PELLET_SHADOW = new THREE.Color(0x061410);

export class FoodPelletsPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly pelletGeometry = new THREE.BufferGeometry();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x051210,
    opacity: 0.40,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly pelletMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  private readonly shadowBatch = new SurfaceGeometryBatch(this.shadowGeometry, 16_000);
  private readonly pelletBatch = new SurfaceGeometryBatch(this.pelletGeometry, 16_000, true);

  public readonly pellets: FoodPellet[] = [];
  private lastTime = 0;

  public constructor() {
    this.shadowGeometry.name = "food pellets shadow";
    this.pelletGeometry.name = "food pellets";

    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const pelletMesh = new THREE.Mesh(this.pelletGeometry, this.pelletMaterial);
    shadowMesh.frustumCulled = false;
    pelletMesh.frustumCulled = false;
    this.shadowGroup.add(shadowMesh);
    this.group.add(pelletMesh);
  }

  public dropPelletCluster(centerX: number, centerY: number, count = 3, ripples?: RippleSystem): void {
    for (let i = 0; i < count; i += 1) {
      if (this.pellets.length >= MAX_PELLETS) {
        this.pellets.shift();
      }

      const spread = Math.random() * 14.0 + 3.0;
      const angle = Math.random() * Math.PI * 2;
      const px = Math.max(10, Math.min(CANVAS_WIDTH - 10, centerX + Math.cos(angle) * spread));
      const py = Math.max(10, Math.min(CANVAS_HEIGHT - 10, centerY + Math.sin(angle) * spread));

      this.pellets.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * (Math.random() * 6.0 + 2.0),
        vy: Math.sin(angle) * (Math.random() * 6.0 + 2.0),
        radius: 2.6 + Math.random() * 0.8,
        bob: 0.6,
        bobVel: -8.0,
        age: 0,
        maxAge: 25.0, // Lifespan before dissolving
        alive: true,
        beingSucked: false,
      });

      ripples?.trigger("rain", { x: px, y: py });
    }
  }

  public getNearestPellet(
    x: number,
    y: number,
    maxDistance = 140,
  ): FoodPellet | null {
    let bestDistSq = maxDistance * maxDistance;
    let bestPellet: FoodPellet | null = null;

    for (const p of this.pellets) {
      if (!p.alive) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestPellet = p;
      }
    }

    return bestPellet;
  }

  /**
   * Applies buccal suction towards a fish's mouth.
   * Returns true if the pellet was sucked into mouth and consumed.
   */
  public applySuction(
    pellet: FoodPellet,
    mouthX: number,
    mouthY: number,
    dt: number,
  ): boolean {
    if (!pellet.alive) return false;
    const dx = mouthX - pellet.x;
    const dy = mouthY - pellet.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 4.5) {
      // Consumed!
      pellet.alive = false;
      return true;
    }

    if (dist < 28.0) {
      pellet.beingSucked = true;
      const suctionStrength = Math.min(1.0, 1.0 - dist / 28.0);
      const accel = (85.0 + suctionStrength * 160.0);
      pellet.vx += (dx / dist) * accel * dt;
      pellet.vy += (dy / dist) * accel * dt;
    }

    return false;
  }

  public applyImpulse(x: number, y: number, vx: number, vy: number, radius = 30): void {
    const rSq = radius * radius;
    for (const p of this.pellets) {
      if (!p.alive) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < rSq && dSq > 0.01) {
        const d = Math.sqrt(dSq);
        const factor = (1.0 - d / radius);
        p.vx += (vx * 0.9 + (dx / d) * 15.0) * factor;
        p.vy += (vy * 0.9 + (dy / d) * 15.0) * factor;
        p.bobVel += factor * 9.0;
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

    const lightDir = lightDirection ?? new THREE.Vector2(-0.5, 0.8);
    const shadowDist = (1.0 - Math.min(1.0, Math.max(0.1, sunAltitude)) * 0.6) * 10.0;

    // Ambient water current
    const currentVx = Math.cos(time * 0.12) * 0.8 + 1.2;
    const currentVy = Math.sin(time * 0.15) * 0.6 + 0.5;

    for (let i = this.pellets.length - 1; i >= 0; i -= 1) {
      const p = this.pellets[i];
      p.age += dt;
      if (p.age >= p.maxAge || !p.alive) {
        this.pellets.splice(i, 1);
        continue;
      }

      // Advection by current and vortices
      let flowX = currentVx;
      let flowY = currentVy;
      if (vortices) {
        const v = vortices.getVelocityAt(p.x, p.y);
        flowX += v.vx * 1.2;
        flowY += v.vy * 1.2;
      }

      if (!p.beingSucked) {
        p.vx += (flowX - p.vx) * 2.2 * dt;
        p.vy += (flowY - p.vy) * 2.2 * dt;
      }
      p.beingSucked = false;

      // 1. Rigid-Body / Surface Tension Collisions between nearby pellets
      for (let j = i - 1; j >= 0; j -= 1) {
        const other = this.pellets[j];
        if (!other.alive) continue;
        const dx = other.x - p.x;
        const dy = other.y - p.y;
        const dSq = dx * dx + dy * dy;
        const minDist = (p.radius + other.radius) * 1.05;

        if (dSq < minDist * minDist && dSq > 0.001) {
          const d = Math.sqrt(dSq);
          const nx = dx / d;
          const ny = dy / d;
          const overlap = minDist - d;

          // Elastic separation
          p.x -= nx * overlap * 0.5;
          p.y -= ny * overlap * 0.5;
          other.x += nx * overlap * 0.5;
          other.y += ny * overlap * 0.5;

          const relVx = p.vx - other.vx;
          const relVy = p.vy - other.vy;
          const impulse = (relVx * nx + relVy * ny) * 0.65;
          p.vx -= nx * impulse;
          p.vy -= ny * impulse;
          other.vx += nx * impulse;
          other.vy += ny * impulse;
        }
      }

      // 2. Collision against lotus leaves
      if (lotusOccluders) {
        for (const oc of lotusOccluders) {
          const dx = p.x - oc.x;
          const dy = p.y - oc.y;
          const d = Math.hypot(dx, dy);
          const safeDist = oc.radius * 0.98 + p.radius;
          if (d < safeDist && d > 0.01) {
            const nx = dx / d;
            const ny = dy / d;
            p.x = oc.x + nx * safeDist;
            p.y = oc.y + ny * safeDist;
            p.vx = (p.vx - 2 * (p.vx * nx + p.vy * ny) * nx) * 0.5;
            p.vy = (p.vy - 2 * (p.vx * nx + p.vy * ny) * ny) * 0.5;
          }
        }
      }

      // 3. Ripple wave reaction
      if (ripples) {
        for (const rip of ripples.instances) {
          if (!rip.alive || rip.age < 0) continue;
          const dx = p.x - rip.center.x;
          const dy = p.y - rip.center.y;
          const d = Math.hypot(dx, dy);
          const waveRadius = rip.age * 90.0;
          const distFromFront = Math.abs(d - waveRadius);
          if (distFromFront < 14.0) {
            const factor = (1.0 - distFromFront / 14.0) * rip.strength;
            p.bobVel += factor * 7.5 * dt;
          }
        }
      }

      // Buoyancy spring-damper
      p.bobVel += (-26.0 * p.bob - 6.5 * p.bobVel) * dt;
      p.bob += p.bobVel * dt;

      // Integration & boundary damping
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;

      if (p.x < 6) { p.x = 6; p.vx *= -0.5; }
      if (p.x > CANVAS_WIDTH - 6) { p.x = CANVAS_WIDTH - 6; p.vx *= -0.5; }
      if (p.y < 6) { p.y = 6; p.vy *= -0.5; }
      if (p.y > CANVAS_HEIGHT - 6) { p.y = CANVAS_HEIGHT - 6; p.vy *= -0.5; }
    }

    // Geometry batching
    this.shadowBatch.reset();
    this.pelletBatch.reset();

    for (const p of this.pellets) {
      if (!p.alive) continue;
      const sx = -lightDir.x * shadowDist;
      const sy = -lightDir.y * shadowDist;

      // Drop shadow on pond bed
      this.shadowBatch.circle(
        { x: p.x + sx, y: p.y + sy },
        p.radius * 0.85,
        PELLET_SHADOW,
        8,
      );

      // Pellet outer surface tension rim
      const displayRadius = p.radius * (1.0 + p.bob * 0.12);
      this.pelletBatch.circle(
        { x: p.x, y: p.y },
        displayRadius,
        PELLET_COLOR,
        10,
      );

      // Pellet baked core highlight
      this.pelletBatch.circle(
        { x: p.x - 0.4, y: p.y - 0.4 },
        displayRadius * 0.55,
        PELLET_CORE,
        8,
      );
    }

    this.shadowBatch.commit();
    this.pelletBatch.commit();
  }
}
