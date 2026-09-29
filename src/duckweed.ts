import * as THREE from "three";
import { DUCKWEED, DUCKWEED_PATCHES, RIPPLES, viewportPoint } from "./config";
import type { RippleSystem } from "./ripple-system";
import {
  SurfaceGeometryBatch,
  type SurfacePoint,
} from "./surface-geometry";

interface DuckweedPalette {
  base: THREE.Color;
  light: THREE.Color;
  shade: THREE.Color;
  center: THREE.Color;
}

interface DuckweedLeaf {
  patchIndex: number;
  offsetX: number;
  offsetY: number;
  radius: number;
  angle: number;
  phase: number;
  tone: number;
  paired: boolean;
}

interface LeafPhysicsState {
  offsetX: number;
  offsetY: number;
  velX: number;
  velY: number;
  bob: number;
  bobVel: number;
  rotationOffset: number;
  rotationVel: number;
}

const PALETTES: readonly DuckweedPalette[] = DUCKWEED.palettes.map((palette) => ({
  base: new THREE.Color(palette.base),
  light: new THREE.Color(palette.light),
  shade: new THREE.Color(palette.shade),
  center: new THREE.Color(palette.center),
}));

function randomUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export class DuckweedPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly leafGeometry = new THREE.BufferGeometry();
  private readonly detailGeometry = new THREE.BufferGeometry();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: DUCKWEED.shadow.color,
    opacity: DUCKWEED.shadow.opacity,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly shadowBatch = new SurfaceGeometryBatch(
    this.shadowGeometry,
    120_000,
  );
  private readonly leafBatch = new SurfaceGeometryBatch(
    this.leafGeometry,
    120_000,
    true,
  );
  private readonly detailBatch = new SurfaceGeometryBatch(
    this.detailGeometry,
    32_000,
    true,
  );
  private leaves: readonly DuckweedLeaf[];
  private lastTime = 0;
  private leafPhysics: LeafPhysicsState[] = [];

  public constructor() {
    this.leaves = this.createLeaves();
    this.initLeafPhysics();
    this.shadowGeometry.name = "duckweed shadows";
    this.leafGeometry.name = "duckweed leaves";
    this.detailGeometry.name = "duckweed highlights";

    const leafMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const leafMesh = new THREE.Mesh(this.leafGeometry, leafMaterial);
    const detailMesh = new THREE.Mesh(this.detailGeometry, leafMaterial);
    shadowMesh.frustumCulled = false;
    leafMesh.frustumCulled = false;
    detailMesh.frustumCulled = false;
    shadowMesh.renderOrder = 0;
    leafMesh.renderOrder = 0;
    detailMesh.renderOrder = 1;
    this.shadowGroup.add(shadowMesh);
    this.group.add(leafMesh, detailMesh);
    this.refreshConfig();
  }

  private initLeafPhysics(): void {
    this.leafPhysics = Array.from({ length: this.leaves.length }, () => ({
      offsetX: 0,
      offsetY: 0,
      velX: 0,
      velY: 0,
      bob: 0,
      bobVel: 0,
      rotationOffset: 0,
      rotationVel: 0,
    }));
  }

  public refreshConfig(): void {
    this.shadowMaterial.color.setHex(DUCKWEED.shadow.color);
    this.shadowMaterial.opacity = DUCKWEED.shadow.opacity;
    for (const [index, palette] of DUCKWEED.palettes.entries()) {
      const target = PALETTES[index];
      if (!target) continue;
      target.base.setHex(palette.base);
      target.light.setHex(palette.light);
      target.shade.setHex(palette.shade);
      target.center.setHex(palette.center);
    }
    this.leaves = this.createLeaves();
    this.initLeafPhysics();
  }

  public update(time: number, ripples?: RippleSystem): void {
    this.updatePhysics(time, ripples);

    this.shadowBatch.reset();
    this.leafBatch.reset();
    this.detailBatch.reset();

    const visiblePatchCount = Math.min(
      DUCKWEED.visiblePatchCount,
      DUCKWEED_PATCHES.length,
    );
    for (let i = 0; i < this.leaves.length; i += 1) {
      const leaf = this.leaves[i];
      if (leaf.patchIndex >= visiblePatchCount) continue;
      const patch = DUCKWEED_PATCHES[leaf.patchIndex];
      const p = this.leafPhysics[i];
      const physOffsetX = p ? p.offsetX : 0;
      const physOffsetY = p ? p.offsetY : 0;
      const physRotation = p ? p.rotationOffset : 0;
      const physBob = p ? p.bob : 0;

      const driftX = Math.sin(time * 0.1 + patch.phase) * DUCKWEED.driftX;
      const driftY =
        Math.cos(time * 0.13 + patch.phase * 1.4) * DUCKWEED.driftY;
      const patchRotation =
        Math.sin(time * 0.075 + patch.phase) * DUCKWEED.rotationAmount;
      const cosine = Math.cos(patchRotation);
      const sine = Math.sin(patchRotation);
      const placement = viewportPoint(patch.x, patch.y);
      const center = {
        x:
          placement.x +
          leaf.offsetX * cosine -
          leaf.offsetY * sine +
          driftX +
          physOffsetX,
        y:
          placement.y +
          leaf.offsetX * sine +
          leaf.offsetY * cosine +
          driftY +
          physOffsetY,
      };
      const angle = leaf.angle + patchRotation + physRotation;
      const pulse =
        1 +
        Math.sin(time * 0.16 + leaf.phase) * 0.018 +
        physBob * 0.06;
      const radius = leaf.radius * pulse;
      const palette = PALETTES[patch.palette % PALETTES.length];
      const color =
        leaf.tone < 0.24
          ? palette.light
          : leaf.tone > 0.82
            ? palette.shade
            : palette.base;

      this.drawLeaf(
        this.shadowBatch,
        {
          x: center.x + DUCKWEED.shadow.offset.x + physBob * 1.2,
          y: center.y + DUCKWEED.shadow.offset.y + physBob * 2.5,
        },
        radius,
        angle,
        undefined,
      );
      this.drawLeaf(this.leafBatch, center, radius, angle, color);
      if (radius > 1.55) {
        const highlightCenter = {
          x: center.x - Math.cos(angle) * radius * 0.18,
          y: center.y - Math.sin(angle) * radius * 0.18,
        };
        this.detailBatch.circle(
          highlightCenter,
          Math.max(0.22, radius * 0.14),
          palette.center,
          5,
        );
      }

      if (leaf.paired) {
        const pairCenter = {
          x: center.x + Math.cos(angle + 0.8) * radius * 0.92,
          y: center.y + Math.sin(angle + 0.8) * radius * 0.92,
        };
        const pairRadius = radius * 0.72;
        this.drawLeaf(
          this.shadowBatch,
          {
            x: pairCenter.x + DUCKWEED.shadow.offset.x + physBob * 1.2,
            y: pairCenter.y + DUCKWEED.shadow.offset.y + physBob * 2.5,
          },
          pairRadius,
          angle + 1.15,
          undefined,
        );
        this.drawLeaf(
          this.leafBatch,
          pairCenter,
          pairRadius,
          angle + 1.15,
          palette.light,
        );
      }
    }

    this.shadowBatch.commit();
    this.leafBatch.commit();
    this.detailBatch.commit();
  }

  private updatePhysics(time: number, ripples?: RippleSystem): void {
    if (this.lastTime === 0) {
      this.lastTime = time;
      return;
    }
    const rawDt = time - this.lastTime;
    this.lastTime = time;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    const visiblePatchCount = Math.min(
      DUCKWEED.visiblePatchCount,
      DUCKWEED_PATCHES.length,
    );

    const rippleReaction = DUCKWEED.rippleReaction ?? 0.45;
    const windBreeze = DUCKWEED.windBreeze ?? 0.55;

    // Precompute patch frame origins to avoid redundant math per leaf
    const patchTransforms: {
      originX: number;
      originY: number;
      cosine: number;
      sine: number;
      rotation: number;
    }[] = [];

    for (let patchIndex = 0; patchIndex < visiblePatchCount; patchIndex += 1) {
      const patch = DUCKWEED_PATCHES[patchIndex];
      const placement = viewportPoint(patch.x, patch.y);
      const driftX = Math.sin(time * 0.1 + patch.phase) * DUCKWEED.driftX;
      const driftY =
        Math.cos(time * 0.13 + patch.phase * 1.4) * DUCKWEED.driftY;
      const patchRotation =
        Math.sin(time * 0.075 + patch.phase) * DUCKWEED.rotationAmount;
      patchTransforms[patchIndex] = {
        originX: placement.x + driftX,
        originY: placement.y + driftY,
        cosine: Math.cos(patchRotation),
        sine: Math.sin(patchRotation),
        rotation: patchRotation,
      };
    }

    // 1. Ripple wave forces on each INDIVIDUAL duckweed leaf
    if (ripples && rippleReaction > 0.001) {
      for (const ripple of ripples.instances) {
        if (!ripple.alive || ripple.age < 0) continue;
        const profile = RIPPLES.types[ripple.type];
        if (!profile) continue;

        const waveRadius =
          profile.startRadius + ripple.age * profile.expansionSpeed;
        const waveWidth = 22.0;
        const ageFade = Math.max(0, 1.0 - ripple.age / profile.lifetime);
        if (ageFade <= 0.001) continue;

        for (let i = 0; i < this.leaves.length; i += 1) {
          const leaf = this.leaves[i];
          if (leaf.patchIndex >= visiblePatchCount) continue;
          const pt = patchTransforms[leaf.patchIndex];
          if (!pt) continue;

          const p = this.leafPhysics[i];
          if (!p) continue;

          // Exact pond coordinate of this specific leaf
          const leafBaseX =
            pt.originX + leaf.offsetX * pt.cosine - leaf.offsetY * pt.sine;
          const leafBaseY =
            pt.originY + leaf.offsetX * pt.sine + leaf.offsetY * pt.cosine;
          const currentX = leafBaseX + p.offsetX;
          const currentY = leafBaseY + p.offsetY;

          const dx = currentX - ripple.center.x;
          const dy = currentY - ripple.center.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.1) continue;

          const distFromFront = dist - waveRadius;
          if (Math.abs(distFromFront) > waveWidth * 1.6) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          const u = distFromFront / waveWidth;
          const envelope = Math.exp(-u * u * 2.0);
          const waveHeight = Math.sin(-u * Math.PI) * envelope;
          const waveSlope = Math.cos(-u * Math.PI) * envelope;
          const distDecay = 1.0 / Math.sqrt(Math.max(1.0, dist * 0.03));
          const rippleAmp =
            ripple.strength * ageFade * distDecay * rippleReaction;

          // Each individual leaf is pushed and bobbed separately according to its exact distance to wave front
          p.bobVel += waveHeight * rippleAmp * 14.0 * dt;
          p.velX += nx * waveHeight * rippleAmp * 12.0 * dt;
          p.velY += ny * waveHeight * rippleAmp * 12.0 * dt;

          // Individual spin based on leaf angle vs wave incidence angle
          const leafAngle = leaf.angle + pt.rotation + p.rotationOffset;
          const torque = nx * Math.sin(leafAngle) - ny * Math.cos(leafAngle);
          p.rotationVel += torque * waveSlope * rippleAmp * 14.0 * dt;
        }
      }
    }

    // 2. Gentle ambient breeze on each INDIVIDUAL duckweed leaf
    if (windBreeze > 0.001) {
      const breezeBreath = Math.sin(time * 0.35) * 0.5 + 0.5;
      const breezeGust =
        (breezeBreath * 0.6 + Math.sin(time * 0.88 + 0.9) * 0.4) * windBreeze;

      for (let i = 0; i < this.leaves.length; i += 1) {
        const leaf = this.leaves[i];
        if (leaf.patchIndex >= visiblePatchCount) continue;
        const pt = patchTransforms[leaf.patchIndex];
        if (!pt) continue;

        const p = this.leafPhysics[i];
        if (!p) continue;

        const leafBaseX =
          pt.originX + leaf.offsetX * pt.cosine - leaf.offsetY * pt.sine;
        const leafBaseY =
          pt.originY + leaf.offsetX * pt.sine + leaf.offsetY * pt.cosine;

        // Individual spatial phase and micro-variations
        const leafWindPhase =
          time * 0.8 + leafBaseX * 0.009 + leafBaseY * 0.007 + leaf.phase;
        const localGust = Math.max(
          0,
          breezeGust * (0.75 + Math.sin(leafWindPhase) * 0.4),
        );

        p.velX += (0.88 * localGust * 1.3 - p.offsetX * 0.35) * 1.6 * dt;
        p.velY += (0.47 * localGust * 1.3 - p.offsetY * 0.35) * 1.6 * dt;

        // Micro spin in gentle eddies
        const spinOsc =
          Math.sin(time * 1.5 + leaf.phase * 3.7) * 0.06 * localGust;
        p.rotationVel += (spinOsc - p.rotationOffset) * 2.5 * dt;

        // Micro bobbing
        const bobOsc =
          Math.sin(time * 2.2 + leaf.phase * 2.9) * 0.02 * localGust;
        p.bobVel += (bobOsc - p.bob) * 3.0 * dt;
      }
    }

    // 3. Spring-damper relaxation for each INDIVIDUAL leaf
    for (let i = 0; i < this.leaves.length; i += 1) {
      const leaf = this.leaves[i];
      if (leaf.patchIndex >= visiblePatchCount) continue;
      const p = this.leafPhysics[i];
      if (!p) continue;

      p.velX += (-16.0 * p.offsetX - 5.0 * p.velX) * dt;
      p.velY += (-16.0 * p.offsetY - 5.0 * p.velY) * dt;
      p.offsetX += p.velX * dt;
      p.offsetY += p.velY * dt;

      p.bobVel += (-22.0 * p.bob - 5.4 * p.bobVel) * dt;
      p.bob += p.bobVel * dt;

      p.rotationVel += (-18.0 * p.rotationOffset - 4.8 * p.rotationVel) * dt;
      p.rotationOffset += p.rotationVel * dt;

      p.offsetX = Math.max(-7, Math.min(7, p.offsetX));
      p.offsetY = Math.max(-7, Math.min(7, p.offsetY));
      p.bob = Math.max(-0.2, Math.min(0.25, p.bob));
      p.rotationOffset = Math.max(-0.6, Math.min(0.6, p.rotationOffset));
    }
  }

  private createLeaves(): readonly DuckweedLeaf[] {
    const leaves: DuckweedLeaf[] = [];
    for (const [patchIndex, patch] of DUCKWEED_PATCHES.entries()) {
      for (let index = 0; index < patch.count; index += 1) {
        const seed = patchIndex * 1013 + index * 37 + 11;
        const radiusAmount = Math.pow(
          randomUnit(seed + 1),
          DUCKWEED.spreadExponent,
        );
        const distance = patch.radius * radiusAmount;
        const angle = randomUnit(seed + 2) * Math.PI * 2;
        leaves.push({
          patchIndex,
          offsetX: Math.cos(angle) * distance,
          offsetY: Math.sin(angle) * distance * 0.74,
          radius:
            DUCKWEED.minimumLeafRadius +
            randomUnit(seed + 3) *
              (DUCKWEED.maximumLeafRadius - DUCKWEED.minimumLeafRadius),
          angle: randomUnit(seed + 4) * Math.PI * 2,
          phase: randomUnit(seed + 5) * Math.PI * 2,
          tone: randomUnit(seed + 6),
          paired: randomUnit(seed + 7) < DUCKWEED.pairChance,
        });
      }
    }
    return leaves;
  }

  private drawLeaf(
    batch: SurfaceGeometryBatch,
    center: SurfacePoint,
    radius: number,
    angle: number,
    color?: THREE.Color,
  ): void {
    const segments = 7;
    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      batch.triangle(
        center,
        this.ellipsePoint(center, radius, angle, angleA),
        this.ellipsePoint(center, radius, angle, angleB),
        color,
      );
    }
  }

  private ellipsePoint(
    center: SurfacePoint,
    radius: number,
    rotation: number,
    angle: number,
  ): SurfacePoint {
    const localX = Math.cos(angle) * radius;
    const localY = Math.sin(angle) * radius * DUCKWEED.verticalScale;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return {
      x: center.x + localX * cosine - localY * sine,
      y: center.y + localX * sine + localY * cosine,
    };
  }
}
