import * as THREE from "three";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  LOTUS,
  LOTUS_FLOWERS,
  LOTUS_LEAVES,
  RIPPLES,
  viewportPoint,
} from "./config";
import type { RippleSystem } from "./ripple-system";

interface Point {
  x: number;
  y: number;
}

interface LeafPalette {
  base: THREE.Color;
  light: THREE.Color;
  shade: THREE.Color;
  vein: THREE.Color;
  center: THREE.Color;
}

interface FlowerPalette {
  outerPetal: THREE.Color;
  innerPetal: THREE.Color;
  petalLight: THREE.Color;
  center: THREE.Color;
  centerDark: THREE.Color;
}

interface LeafPhysicsState {
  offsetX: number;
  offsetY: number;
  velX: number;
  velY: number;
  tiltAngle: number;
  tiltVel: number;
  bob: number;
  bobVel: number;
}

interface FlowerPhysicsState {
  offsetX: number;
  offsetY: number;
  velX: number;
  velY: number;
  tiltX: number;
  tiltY: number;
  tiltVelX: number;
  tiltVelY: number;
  petalFlutter: number;
  petalFlutterVel: number;
  bob: number;
  bobVel: number;
  rotationOffset: number;
  rotationVel: number;
}

const TAU = Math.PI * 2;
const DEFAULT_COLOR = new THREE.Color(0xffffff);

const PALETTES: readonly LeafPalette[] = LOTUS.leafPalettes.map((palette) => ({
  base: new THREE.Color(palette.base),
  light: new THREE.Color(palette.light),
  shade: new THREE.Color(palette.shade),
  vein: new THREE.Color(palette.vein),
  center: new THREE.Color(palette.center),
}));

const FLOWER_PALETTES: readonly FlowerPalette[] = LOTUS.flowerPalettes.map(
  (palette) => ({
    outerPetal: new THREE.Color(palette.outerPetal),
    innerPetal: new THREE.Color(palette.innerPetal),
    petalLight: new THREE.Color(palette.petalLight),
    center: new THREE.Color(palette.center),
    centerDark: new THREE.Color(palette.centerDark),
  }),
);

class LotusGeometryBatch {
  private readonly positions: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colors?: Float32Array;
  private readonly colorAttribute?: THREE.BufferAttribute;
  private cursor = 0;

  public constructor(
    geometry: THREE.BufferGeometry,
    capacity: number,
    includeColors: boolean,
  ) {
    this.positions = new Float32Array(capacity);
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.positionAttribute);
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT),
    );

    if (includeColors) {
      this.colors = new Float32Array(capacity);
      this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
      this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("color", this.colorAttribute);
    }
  }

  public reset(): void {
    this.cursor = 0;
  }

  public point(point: Point, color: THREE.Color = DEFAULT_COLOR): void {
    if (this.cursor + 3 > this.positions.length) return;
    this.positions[this.cursor] = point.x;
    this.positions[this.cursor + 1] = point.y;
    this.positions[this.cursor + 2] = 0;
    if (this.colors) {
      this.colors[this.cursor] = color.r;
      this.colors[this.cursor + 1] = color.g;
      this.colors[this.cursor + 2] = color.b;
    }
    this.cursor += 3;
  }

  public triangle(
    a: Point,
    b: Point,
    c: Point,
    color: THREE.Color = DEFAULT_COLOR,
  ): void {
    this.point(a, color);
    this.point(b, color);
    this.point(c, color);
  }

  public triangleColors(
    a: Point,
    b: Point,
    c: Point,
    colorA: THREE.Color,
    colorB: THREE.Color,
    colorC: THREE.Color,
  ): void {
    this.point(a, colorA);
    this.point(b, colorB);
    this.point(c, colorC);
  }

  public line(a: Point, b: Point, color: THREE.Color): void {
    this.point(a, color);
    this.point(b, color);
  }

  public circle(
    center: Point,
    radius: number,
    color: THREE.Color = DEFAULT_COLOR,
  ): void {
    for (let index = 0; index < 8; index += 1) {
      const angleA = (index / 8) * TAU;
      const angleB = ((index + 1) / 8) * TAU;
      this.triangle(
        center,
        {
          x: center.x + Math.cos(angleA) * radius,
          y: center.y + Math.sin(angleA) * radius,
        },
        {
          x: center.x + Math.cos(angleB) * radius,
          y: center.y + Math.sin(angleB) * radius,
        },
        color,
      );
    }
  }

  public commit(geometry: THREE.BufferGeometry): void {
    geometry.setDrawRange(0, this.cursor / 3);
    this.positionAttribute.clearUpdateRanges();
    this.positionAttribute.addUpdateRange(0, this.cursor);
    this.positionAttribute.needsUpdate = true;
    if (this.colorAttribute) {
      this.colorAttribute.clearUpdateRanges();
      this.colorAttribute.addUpdateRange(0, this.cursor);
      this.colorAttribute.needsUpdate = true;
    }
  }
}

export class LotusLeavesPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();
  public readonly leafOccluders: { x: number; y: number; radius: number }[] = [];

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly leafGeometry = new THREE.BufferGeometry();
  private readonly veinGeometry = new THREE.BufferGeometry();
  private readonly flowerGeometry = new THREE.BufferGeometry();
  private readonly leafCenterColor = new THREE.Color();
  private readonly leafEdgeColorA = new THREE.Color();
  private readonly leafEdgeColorB = new THREE.Color();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: LOTUS.shadow.color,
    opacity: LOTUS.shadow.opacity,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly shadowBatch = new LotusGeometryBatch(
    this.shadowGeometry,
    20_000,
    false,
  );
  private readonly leafBatch = new LotusGeometryBatch(
    this.leafGeometry,
    20_000,
    true,
  );
  private readonly veinBatch = new LotusGeometryBatch(
    this.veinGeometry,
    8_000,
    true,
  );
  private readonly flowerBatch = new LotusGeometryBatch(
    this.flowerGeometry,
    10_000,
    true,
  );

  private lastTime = 0;
  private readonly leafPhysics: LeafPhysicsState[] = Array.from(
    { length: 64 },
    () => ({
      offsetX: 0,
      offsetY: 0,
      velX: 0,
      velY: 0,
      tiltAngle: 0,
      tiltVel: 0,
      bob: 0,
      bobVel: 0,
    }),
  );
  private readonly flowerPhysics: FlowerPhysicsState[] = Array.from(
    { length: 64 },
    () => ({
      offsetX: 0,
      offsetY: 0,
      velX: 0,
      velY: 0,
      tiltX: 0,
      tiltY: 0,
      tiltVelX: 0,
      tiltVelY: 0,
      petalFlutter: 0,
      petalFlutterVel: 0,
      bob: 0,
      bobVel: 0,
      rotationOffset: 0,
      rotationVel: 0,
    }),
  );

  public constructor() {
    this.shadowGeometry.name = "lotus shadows";
    this.leafGeometry.name = "lotus leaves";
    this.veinGeometry.name = "lotus veins";
    this.flowerGeometry.name = "lotus flowers";

    const leafMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const veinMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const flowerMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const leafMesh = new THREE.Mesh(this.leafGeometry, leafMaterial);
    const veins = new THREE.LineSegments(this.veinGeometry, veinMaterial);
    const flowers = new THREE.Mesh(this.flowerGeometry, flowerMaterial);
    shadowMesh.frustumCulled = false;
    leafMesh.frustumCulled = false;
    veins.frustumCulled = false;
    flowers.frustumCulled = false;
    leafMesh.renderOrder = 1;
    veins.renderOrder = 2;
    flowers.renderOrder = 3;
    this.shadowGroup.add(shadowMesh);
    this.group.add(leafMesh, veins, flowers);
    this.refreshConfig();
  }

  public refreshConfig(): void {
    this.shadowMaterial.color.setHex(LOTUS.shadow.color);
    this.shadowMaterial.opacity = LOTUS.shadow.opacity;
    for (const [index, palette] of LOTUS.leafPalettes.entries()) {
      const target = PALETTES[index];
      if (!target) continue;
      target.base.setHex(palette.base);
      target.light.setHex(palette.light);
      target.shade.setHex(palette.shade);
      target.vein.setHex(palette.vein);
      target.center.setHex(palette.center);
    }
    for (const [index, palette] of LOTUS.flowerPalettes.entries()) {
      const target = FLOWER_PALETTES[index];
      if (!target) continue;
      target.outerPetal.setHex(palette.outerPetal);
      target.innerPetal.setHex(palette.innerPetal);
      target.petalLight.setHex(palette.petalLight);
      target.center.setHex(palette.center);
      target.centerDark.setHex(palette.centerDark);
    }
  }

  public update(
    time: number,
    ripples?: RippleSystem,
    lightDirection?: THREE.Vector2,
    sunAltitude = 0.8,
  ): void {
    this.updatePhysics(time, ripples);

    this.shadowBatch.reset();
    this.leafBatch.reset();
    this.veinBatch.reset();
    this.flowerBatch.reset();
    this.leafOccluders.length = 0;

    const visibleLeaves = LOTUS_LEAVES.slice(0, LOTUS.visibleLeafCount);
    const visibleFlowers = LOTUS_FLOWERS.slice(0, LOTUS.visibleFlowerCount);

    const lightDir = lightDirection ?? new THREE.Vector2(-0.5, 0.8);
    const shadowDist = (1.0 - Math.min(1.0, Math.max(0.1, sunAltitude)) * 0.65) * 14.0;
    const flowerShadowDist = (1.0 - Math.min(1.0, Math.max(0.1, sunAltitude)) * 0.65) * 17.0;

    for (const [leafIndex, leaf] of visibleLeaves.entries()) {
      const leafPhys = this.leafPhysics[leafIndex];
      const placement = viewportPoint(leaf.x, leaf.y);
      const center = {
        x:
          placement.x +
          Math.sin(time * 0.12 + leaf.phase) * LOTUS.driftX +
          (leafPhys ? leafPhys.offsetX : 0),
        y:
          placement.y +
          Math.cos(time * 0.15 + leaf.phase * 1.3) * LOTUS.driftY +
          (leafPhys ? leafPhys.offsetY : 0),
      };
      const angle =
        leaf.angle +
        Math.sin(time * 0.085 + leaf.phase) * LOTUS.rotationAmount +
        (leafPhys ? leafPhys.tiltAngle : 0);
      const radius =
        leaf.radius *
        LOTUS.radiusScale *
        (1 +
          Math.sin(time * 0.11 + leaf.phase) * 0.012 +
          (leafPhys ? leafPhys.bob * 0.08 : 0));
      const palette = PALETTES[
        ((leaf.palette % PALETTES.length) + PALETTES.length) % PALETTES.length
      ];

      this.leafOccluders.push({ x: center.x, y: center.y, radius });

      this.drawLeaf(
        this.shadowBatch,
        {
          x: center.x - lightDir.x * shadowDist + (leafPhys ? leafPhys.bob * 1.5 : 0),
          y: center.y - lightDir.y * shadowDist + (leafPhys ? leafPhys.bob * 3.0 : 0),
        },
        radius * 1.02,
        angle,
        leaf.phase,
      );
      this.drawLeaf(this.leafBatch, center, radius, angle, leaf.phase, palette);
      this.drawVeins(center, radius, angle, leaf.phase, palette);

      for (const [flowerIndex, flower] of visibleFlowers.entries()) {
        if (flower.leafIndex !== leafIndex) continue;
        const fPhys = this.flowerPhysics[flowerIndex];
        const flowerCenter = {
          x: center.x + flower.offsetX + (fPhys ? fPhys.offsetX : 0),
          y: center.y + flower.offsetY + (fPhys ? fPhys.offsetY : 0),
        };
        const flowerRadius =
          flower.radius *
          LOTUS.flowerRadiusScale *
          (1 + (fPhys ? fPhys.bob * 0.15 : 0));
        const flowerRotation =
          flower.rotation +
          Math.sin(time * 0.12 + leaf.phase) * 0.04 +
          (fPhys ? fPhys.rotationOffset : 0);

        // Flower shadow on the pond floor reacting to height and tilt
        this.shadowBatch.circle(
          {
            x:
              flowerCenter.x -
              lightDir.x * flowerShadowDist +
              (fPhys ? fPhys.tiltX * 2.5 + fPhys.bob * 1.2 : 0),
            y:
              flowerCenter.y -
              lightDir.y * flowerShadowDist +
              (fPhys ? fPhys.tiltY * 2.5 + fPhys.bob * 2.8 : 0),
          },
          flowerRadius * 0.65,
        );

        this.drawFlower(
          flowerCenter,
          flowerRadius,
          flowerRotation,
          FLOWER_PALETTES[
            ((flower.palette % FLOWER_PALETTES.length) +
              FLOWER_PALETTES.length) %
              FLOWER_PALETTES.length
          ],
          fPhys,
          time,
        );
      }
    }

    this.shadowBatch.commit(this.shadowGeometry);
    this.leafBatch.commit(this.leafGeometry);
    this.veinBatch.commit(this.veinGeometry);
    this.flowerBatch.commit(this.flowerGeometry);
  }

  private updatePhysics(time: number, ripples?: RippleSystem): void {
    if (this.lastTime === 0) {
      this.lastTime = time;
      return;
    }
    const rawDt = time - this.lastTime;
    this.lastTime = time;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    const visibleLeaves = LOTUS_LEAVES.slice(0, LOTUS.visibleLeafCount);
    const visibleFlowers = LOTUS_FLOWERS.slice(0, LOTUS.visibleFlowerCount);

    const rippleReaction = LOTUS.rippleReaction ?? 0.35;
    const windBreeze = LOTUS.windBreeze ?? 0.45;

    // 1. Gentle Ripple Wave Impulse
    if (ripples && rippleReaction > 0.001) {
      for (const ripple of ripples.instances) {
        if (!ripple.alive || ripple.age < 0) continue;
        const profile = RIPPLES.types[ripple.type];
        if (!profile) continue;

        const waveRadius = profile.startRadius + ripple.age * profile.expansionSpeed;
        const waveWidth = 22.0;
        const ageFade = Math.max(0, 1.0 - ripple.age / profile.lifetime);
        if (ageFade <= 0.001) continue;

        // Force on leaves
        for (const [leafIndex, leaf] of visibleLeaves.entries()) {
          const placement = viewportPoint(leaf.x, leaf.y);
          const leafCenter = {
            x: placement.x + Math.sin(time * 0.12 + leaf.phase) * LOTUS.driftX,
            y: placement.y + Math.cos(time * 0.15 + leaf.phase * 1.3) * LOTUS.driftY,
          };
          const dx = leafCenter.x - ripple.center.x;
          const dy = leafCenter.y - ripple.center.y;
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
          const rippleAmp = ripple.strength * ageFade * distDecay * rippleReaction;

          const p = this.leafPhysics[leafIndex];
          if (!p) continue;
          p.bobVel += waveHeight * rippleAmp * 12.0 * dt;
          p.velX += nx * waveHeight * rippleAmp * 6.5 * dt;
          p.velY += ny * waveHeight * rippleAmp * 6.5 * dt;
          p.tiltVel += (nx * 0.5 - ny * 0.3) * waveSlope * rippleAmp * 4.0 * dt;
        }

        // Force on flowers
        for (const [flowerIndex, flower] of visibleFlowers.entries()) {
          const leaf = visibleLeaves[flower.leafIndex];
          if (!leaf) continue;
          const placement = viewportPoint(leaf.x, leaf.y);
          const flowerPos = {
            x:
              placement.x +
              Math.sin(time * 0.12 + leaf.phase) * LOTUS.driftX +
              flower.offsetX,
            y:
              placement.y +
              Math.cos(time * 0.15 + leaf.phase * 1.3) * LOTUS.driftY +
              flower.offsetY,
          };
          const dx = flowerPos.x - ripple.center.x;
          const dy = flowerPos.y - ripple.center.y;
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
          const rippleAmp = ripple.strength * ageFade * distDecay * rippleReaction;

          const p = this.flowerPhysics[flowerIndex];
          if (!p) continue;

          p.bobVel += waveHeight * rippleAmp * 18.0 * dt;
          p.velX += nx * waveHeight * rippleAmp * 10.0 * dt;
          p.velY += ny * waveHeight * rippleAmp * 10.0 * dt;
          p.tiltVelX += nx * waveSlope * rippleAmp * 22.0 * dt;
          p.tiltVelY += ny * waveSlope * rippleAmp * 22.0 * dt;
          p.petalFlutterVel += Math.abs(waveSlope) * rippleAmp * 28.0 * dt;
          p.rotationVel += (nx * 0.6 - ny * 0.3) * waveSlope * rippleAmp * 6.0 * dt;
        }
      }
    }

    // 2. Gentle Ambient Breeze ("Gió thổi nhè nhẹ")
    if (windBreeze > 0.001) {
      // Slow organic breeze breath cycle
      const breezeBreath = Math.sin(time * 0.35) * 0.5 + 0.5;
      const breezeGust = (breezeBreath * 0.65 + Math.sin(time * 0.85 + 1.1) * 0.35) * windBreeze;

      // Leaves react to breeze
      for (const [leafIndex, leaf] of visibleLeaves.entries()) {
        const p = this.leafPhysics[leafIndex];
        if (!p) continue;
        const leafPhase = time * 0.7 + leaf.x * 0.008 + leaf.y * 0.005;
        const sway = Math.sin(leafPhase) * breezeGust;
        p.tiltVel += (sway * 0.06 - p.tiltAngle * 0.25) * 2.2 * dt;
        p.velX += (0.85 * breezeGust * 1.2 - p.offsetX * 0.4) * 1.8 * dt;
        p.velY += (0.45 * breezeGust * 1.2 - p.offsetY * 0.4) * 1.8 * dt;
      }

      // Flowers react to breeze (subtle leaning, soft nodding, petal fluttering)
      for (const [flowerIndex, flower] of visibleFlowers.entries()) {
        const p = this.flowerPhysics[flowerIndex];
        if (!p) continue;
        const leaf = visibleLeaves[flower.leafIndex];
        const px = leaf ? leaf.x : 200;
        const py = leaf ? leaf.y : 150;
        const windPhase = time * 0.85 + px * 0.008 + py * 0.006 + flowerIndex * 0.6;
        const localGust = Math.max(0, breezeGust * (0.8 + Math.sin(windPhase) * 0.3));

        // Stems gently lean downwind
        const targetTiltX = 0.85 * localGust * 0.12 + Math.sin(time * 1.1 + flowerIndex) * 0.02 * localGust;
        const targetTiltY = 0.45 * localGust * 0.12 + Math.cos(time * 0.95 + flowerIndex * 1.3) * 0.015 * localGust;
        p.tiltVelX += (targetTiltX - p.tiltX) * 3.8 * dt;
        p.tiltVelY += (targetTiltY - p.tiltY) * 3.8 * dt;

        // Gentle petal flutter in breeze
        const petalBreeze = Math.max(0, Math.sin(time * 3.8 + flowerIndex * 1.9)) * localGust * 0.12;
        p.petalFlutterVel += petalBreeze * 14.0 * dt;

        // Gentle stem nodding
        const stemNod = Math.sin(time * 1.25 + flowerIndex * 0.9) * 0.025 * localGust;
        p.bobVel += (stemNod - p.bob) * 3.0 * dt;

        // Soft rotation sway
        const rotSway = Math.sin(time * 0.55 + flowerIndex * 1.1) * 0.03 * localGust;
        p.rotationVel += (rotSway - p.rotationOffset) * 2.4 * dt;
      }
    }

    // 3. Spring-damper integration
    for (let i = 0; i < visibleLeaves.length; i += 1) {
      const p = this.leafPhysics[i];
      p.velX += (-20.0 * p.offsetX - 5.5 * p.velX) * dt;
      p.velY += (-20.0 * p.offsetY - 5.5 * p.velY) * dt;
      p.offsetX += p.velX * dt;
      p.offsetY += p.velY * dt;
      p.bobVel += (-24.0 * p.bob - 5.2 * p.bobVel) * dt;
      p.bob += p.bobVel * dt;
      p.tiltVel += (-20.0 * p.tiltAngle - 5.2 * p.tiltVel) * dt;
      p.tiltAngle += p.tiltVel * dt;

      p.offsetX = Math.max(-5, Math.min(5, p.offsetX));
      p.offsetY = Math.max(-5, Math.min(5, p.offsetY));
      p.bob = Math.max(-0.2, Math.min(0.25, p.bob));
      p.tiltAngle = Math.max(-0.16, Math.min(0.16, p.tiltAngle));
    }

    for (let i = 0; i < visibleFlowers.length; i += 1) {
      const p = this.flowerPhysics[i];
      p.velX += (-22.0 * p.offsetX - 5.8 * p.velX) * dt;
      p.velY += (-22.0 * p.offsetY - 5.8 * p.velY) * dt;
      p.offsetX += p.velX * dt;
      p.offsetY += p.velY * dt;

      p.tiltVelX += (-28.0 * p.tiltX - 6.2 * p.tiltVelX) * dt;
      p.tiltVelY += (-28.0 * p.tiltY - 6.2 * p.tiltVelY) * dt;
      p.tiltX += p.tiltVelX * dt;
      p.tiltY += p.tiltVelY * dt;

      p.bobVel += (-26.0 * p.bob - 5.8 * p.bobVel) * dt;
      p.bob += p.bobVel * dt;

      p.petalFlutterVel += (-48.0 * p.petalFlutter - 7.5 * p.petalFlutterVel) * dt;
      p.petalFlutter += p.petalFlutterVel * dt;

      p.rotationVel += (-20.0 * p.rotationOffset - 5.0 * p.rotationVel) * dt;
      p.rotationOffset += p.rotationVel * dt;

      p.offsetX = Math.max(-6, Math.min(6, p.offsetX));
      p.offsetY = Math.max(-6, Math.min(6, p.offsetY));
      p.tiltX = Math.max(-0.35, Math.min(0.35, p.tiltX));
      p.tiltY = Math.max(-0.35, Math.min(0.35, p.tiltY));
      p.bob = Math.max(-0.2, Math.min(0.25, p.bob));
      p.petalFlutter = Math.max(0, Math.min(0.45, p.petalFlutter));
    }
  }

  private edgePoint(
    center: Point,
    radius: number,
    angle: number,
    phase: number,
  ): Point {
    const wobble =
      1 + Math.sin(angle * 3 + phase) * 0.035 + Math.cos(angle * 5 - phase) * 0.025;
    return {
      x: center.x + Math.cos(angle) * radius * wobble,
      y: center.y + Math.sin(angle) * radius * LOTUS.verticalScale * wobble,
    };
  }

  private drawLeaf(
    batch: LotusGeometryBatch,
    center: Point,
    radius: number,
    angle: number,
    phase: number,
    palette?: LeafPalette,
  ): void {
    const start = angle + LOTUS.notchHalfAngle;
    const span = TAU - LOTUS.notchHalfAngle * 2;

    if (palette) this.leafCenterColor.copy(palette.center);

    for (let index = 0; index < LOTUS.leafSegments; index += 1) {
      const angleA = start + (index / LOTUS.leafSegments) * span;
      const angleB = start + ((index + 1) / LOTUS.leafSegments) * span;
      if (palette) {
        this.leafColorAt(this.leafEdgeColorA, palette, angleA, phase);
        this.leafColorAt(this.leafEdgeColorB, palette, angleB, phase);
        batch.triangleColors(
          center,
          this.edgePoint(center, radius, angleA, phase),
          this.edgePoint(center, radius, angleB, phase),
          this.leafCenterColor,
          this.leafEdgeColorA,
          this.leafEdgeColorB,
        );
        continue;
      }
      batch.triangle(
        center,
        this.edgePoint(center, radius, angleA, phase),
        this.edgePoint(center, radius, angleB, phase),
        DEFAULT_COLOR,
      );
    }
  }

  private leafColorAt(
    target: THREE.Color,
    palette: LeafPalette,
    angle: number,
    phase: number,
  ): void {
    const directionalLight = 0.5 + Math.cos(angle + 2.2) * 0.42;
    const organicVariation = Math.sin(angle * 3 + phase * 0.7) * 0.045;
    const tone = Math.max(0, Math.min(1, directionalLight + organicVariation));
    if (tone < 0.5) {
      target.copy(palette.shade).lerp(palette.base, tone * 2);
      return;
    }
    target.copy(palette.base).lerp(palette.light, (tone - 0.5) * 2);
  }

  private drawVeins(
    center: Point,
    radius: number,
    angle: number,
    phase: number,
    palette: LeafPalette,
  ): void {
    const start = angle + LOTUS.notchHalfAngle;
    const span = TAU - LOTUS.notchHalfAngle * 2;
    for (let index = 1; index <= LOTUS.veinCount; index += 1) {
      const veinAngle = start + (index / (LOTUS.veinCount + 1)) * span;
      this.veinBatch.line(
        center,
        this.edgePoint(center, radius * 0.68, veinAngle, phase),
        palette.vein,
      );
    }
    this.leafBatch.circle(center, Math.max(1, radius * 0.075), palette.center);
  }

  private drawFlower(
    center: Point,
    radius: number,
    rotation: number,
    palette: FlowerPalette,
    physics?: FlowerPhysicsState,
    time = 0,
  ): void {
    const tiltX = physics ? physics.tiltX : 0;
    const tiltY = physics ? physics.tiltY : 0;
    const flutter = physics ? physics.petalFlutter : 0;

    const drawPetalRing = (
      count: number,
      length: number,
      width: number,
      angleOffset: number,
      primary: THREE.Color,
      alternate: THREE.Color,
      ringTiltMultiplier = 1.0,
    ): void => {
      for (let index = 0; index < count; index += 1) {
        const angle = rotation + angleOffset + (index / count) * TAU;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        const side = { x: -direction.y, y: direction.x };

        // 3D tilt perspective projection: petals leaning with the tilt extend, opposite compress
        const tiltDot = direction.x * tiltX + direction.y * tiltY;
        const petalFlutterWave =
          flutter > 0.001
            ? Math.sin(time * 20.0 + index * 1.5 + angleOffset * 2.5) *
              flutter *
              0.1
            : 0;
        const effectiveLength = Math.max(
          0.2,
          (length + petalFlutterWave) *
            (1.0 + tiltDot * 0.35 * ringTiltMultiplier),
        );

        const base = {
          x:
            center.x +
            direction.x * radius * 0.12 +
            tiltX * radius * 0.1 * ringTiltMultiplier,
          y:
            center.y +
            direction.y * radius * 0.12 +
            tiltY * radius * 0.1 * ringTiltMultiplier,
        };
        const tip = {
          x:
            center.x +
            direction.x * radius * effectiveLength +
            tiltX * radius * 0.3 * ringTiltMultiplier,
          y:
            center.y +
            direction.y * radius * effectiveLength +
            tiltY * radius * 0.3 * ringTiltMultiplier,
        };
        const halfWidth =
          radius *
          width *
          (1.0 +
            (side.x * tiltX + side.y * tiltY) * 0.15 +
            petalFlutterWave * 0.3);
        const color = index % 3 === 0 ? alternate : primary;
        this.flowerBatch.triangle(
          {
            x: base.x + side.x * halfWidth,
            y: base.y + side.y * halfWidth,
          },
          tip,
          {
            x: base.x - side.x * halfWidth,
            y: base.y - side.y * halfWidth,
          },
          color,
        );
      }
    };

    drawPetalRing(8, 1, 0.22, 0, palette.outerPetal, palette.petalLight, 1.0);
    drawPetalRing(
      6,
      0.66,
      0.19,
      Math.PI / 6,
      palette.innerPetal,
      palette.petalLight,
      0.75,
    );
    const coreCenter = {
      x: center.x + tiltX * radius * 0.22,
      y: center.y + tiltY * radius * 0.22,
    };
    this.flowerBatch.circle(coreCenter, radius * 0.28, palette.centerDark);
    this.flowerBatch.circle(coreCenter, radius * 0.18, palette.center);
  }
}
