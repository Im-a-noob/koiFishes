import * as THREE from "three";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  LOTUS,
  LOTUS_LEAVES,
  viewportPoint,
} from "./config";
import {
  SurfaceGeometryBatch,
  type SurfacePoint,
} from "./surface-geometry";
import {
  add,
  clamp,
  fromAngle,
  length,
  lerp,
  mul,
  normalize,
  perpendicular,
  sub,
  vec,
  wrapAngle,
  type Vec2,
  XorShift32,
} from "./math";
import type { School } from "./school";

export interface DragonflyPalette {
  name: string;
  thorax: THREE.Color;
  thoraxHighlight: THREE.Color;
  abdomenBase: THREE.Color;
  abdomenStripe: THREE.Color;
  eyes: THREE.Color;
  eyesGlint: THREE.Color;
  wingBase: THREE.Color;
  wingTip: THREE.Color;
  wingSheen: THREE.Color;
  pterostigma: THREE.Color;
}

const DRAGONFLY_PALETTES: readonly DragonflyPalette[] = [
  // 1. Akiakane (赤蜻蛉 / Crimson Autumn Darter)
  {
    name: "Akiakane (Crimson Darter)",
    thorax: new THREE.Color(0x8a1c14),
    thoraxHighlight: new THREE.Color(0xd32f2f),
    abdomenBase: new THREE.Color(0xc62828),
    abdomenStripe: new THREE.Color(0xff8a80),
    eyes: new THREE.Color(0x4a0e08),
    eyesGlint: new THREE.Color(0xffb4ab),
    wingBase: new THREE.Color(0xfff3e0),
    wingTip: new THREE.Color(0xe0f2f1),
    wingSheen: new THREE.Color(0xffcc80),
    pterostigma: new THREE.Color(0x5c0d08),
  },
  // 2. Gin-yanma (ギンヤンマ / Emerald Emperor Skimmer)
  {
    name: "Gin-yanma (Emerald Skimmer)",
    thorax: new THREE.Color(0x1b5e20),
    thoraxHighlight: new THREE.Color(0x4caf50),
    abdomenBase: new THREE.Color(0x0288d1),
    abdomenStripe: new THREE.Color(0x81d4fa),
    eyes: new THREE.Color(0x004d40),
    eyesGlint: new THREE.Color(0xa7ffeb),
    wingBase: new THREE.Color(0xe0f7fa),
    wingTip: new THREE.Color(0xf5f5f5),
    wingSheen: new THREE.Color(0x80deea),
    pterostigma: new THREE.Color(0x004d40),
  },
  // 3. Shio-kara Tonbo (オオシオカラトンボ / Blue Dasher)
  {
    name: "Shiokara (Blue Dasher)",
    thorax: new THREE.Color(0x263238),
    thoraxHighlight: new THREE.Color(0x455a64),
    abdomenBase: new THREE.Color(0x42a5f5),
    abdomenStripe: new THREE.Color(0xb3e5fc),
    eyes: new THREE.Color(0x0d47a1),
    eyesGlint: new THREE.Color(0x90caf9),
    wingBase: new THREE.Color(0xe1f5fe),
    wingTip: new THREE.Color(0xffffff),
    wingSheen: new THREE.Color(0xb3e5fc),
    pterostigma: new THREE.Color(0x1a237e),
  },
  // 4. Kiiro (キイトトンボ / Amber Goldenwing)
  {
    name: "Kiiro (Amber Goldenwing)",
    thorax: new THREE.Color(0xe65100),
    thoraxHighlight: new THREE.Color(0xffb74d),
    abdomenBase: new THREE.Color(0xfbc02d),
    abdomenStripe: new THREE.Color(0xfff59d),
    eyes: new THREE.Color(0x4e342e),
    eyesGlint: new THREE.Color(0xffe082),
    wingBase: new THREE.Color(0xfff8e1),
    wingTip: new THREE.Color(0xffffff),
    wingSheen: new THREE.Color(0xffe082),
    pterostigma: new THREE.Color(0xbf360c),
  },
];

type DragonflyFlightState =
  | "waiting"
  | "enter"
  | "approach"
  | "hover"
  | "dart"
  | "exit";

const TAU = Math.PI * 2;
const SHADOW_BASE_COLOR = new THREE.Color(0x050d10);

export class DragonflyPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly bodyGeometry = new THREE.BufferGeometry();
  private readonly wingGeometry = new THREE.BufferGeometry();
  private readonly lineGeometry = new THREE.BufferGeometry();

  private readonly shadowBatch = new SurfaceGeometryBatch(this.shadowGeometry, 2_048);
  private readonly bodyBatch = new SurfaceGeometryBatch(this.bodyGeometry, 4_096, true);
  private readonly wingBatch = new SurfaceGeometryBatch(this.wingGeometry, 4_096, true);
  private readonly lineBatch = new SurfaceGeometryBatch(this.lineGeometry, 1_024, true);

  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x050d10,
    opacity: 0.32,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  private readonly wingMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  private readonly random = new XorShift32(0x89abcdef);

  // State variables
  private state: DragonflyFlightState = "waiting";
  private waitTimer = 3.5; // Initial quick appearance so user enjoys it immediately!
  private stateTime = 0;
  private hoverDuration = 2.4;
  private currentPaletteIndex = 0;

  // Spatial variables
  private position: Vec2 = vec(0, 0);
  private velocity: Vec2 = vec(0, 0);
  private heading = 0;
  private targetHeading = 0;
  private targetPosition: Vec2 = vec(0, 0);
  private altitude = 18; // Height above water
  private targetAltitude = 18;

  // Hover and lily pad tour stats
  private visitedPadsCount = 0;
  private targetPadsCount = 2;
  private currentPadIndex = -1;
  private hasRippledThisHover = false;
  private lastTime = -1;

  public constructor() {
    this.shadowGeometry.name = "dragonfly shadows";
    this.bodyGeometry.name = "dragonfly body";
    this.wingGeometry.name = "dragonfly wings";
    this.lineGeometry.name = "dragonfly veins";

    const bodyMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const bodyMesh = new THREE.Mesh(this.bodyGeometry, bodyMaterial);
    const wingMesh = new THREE.Mesh(this.wingGeometry, this.wingMaterial);
    const lines = new THREE.LineSegments(this.lineGeometry, lineMaterial);

    shadowMesh.frustumCulled = false;
    bodyMesh.frustumCulled = false;
    wingMesh.frustumCulled = false;
    lines.frustumCulled = false;

    shadowMesh.renderOrder = 4;
    wingMesh.renderOrder = 14;
    bodyMesh.renderOrder = 15;
    lines.renderOrder = 16;

    this.shadowGroup.add(shadowMesh);
    this.group.add(wingMesh, bodyMesh, lines);
  }

  public resize(scaleX: number, scaleY: number): void {
    this.position.x *= scaleX;
    this.position.y *= scaleY;
    this.targetPosition.x *= scaleX;
    this.targetPosition.y *= scaleY;
  }

  /** Trigger an immediate flight across the screen */
  public triggerExcursion(): void {
    this.waitTimer = 0;
    this.startExcursion();
  }

  public update(time: number, school?: School): void {
    const deltaTime =
      this.lastTime < 0 ? 0.016 : Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    this.shadowBatch.reset();
    this.bodyBatch.reset();
    this.wingBatch.reset();
    this.lineBatch.reset();

    this.updateLogic(time, deltaTime, school);

    if (this.state !== "waiting") {
      this.draw(time);
    }

    this.shadowBatch.commit();
    this.bodyBatch.commit();
    this.wingBatch.commit();
    this.lineBatch.commit();
  }

  private updateLogic(time: number, dt: number, school?: School): void {
    this.stateTime += dt;

    if (this.state === "waiting") {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        this.startExcursion();
      }
      return;
    }

    // Altitude smoothing
    this.altitude += (this.targetAltitude - this.altitude) * Math.min(1, dt * 6);

    // State machine updates
    switch (this.state) {
      case "enter":
      case "approach": {
        const toTarget = sub(this.targetPosition, this.position);
        const dist = length(toTarget);

        this.targetHeading = Math.atan2(toTarget.y, toTarget.x);
        let turnDiff = wrapAngle(this.targetHeading - this.heading);
        this.heading += turnDiff * Math.min(1, dt * 8);

        // Speed management
        const cruiseSpeed = this.state === "enter" ? 280 : 190;
        const currentSpeed = length(this.velocity);
        const desiredSpeed = dist < 65 ? Math.max(35, (dist / 65) * cruiseSpeed) : cruiseSpeed;
        const speed = currentSpeed + (desiredSpeed - currentSpeed) * Math.min(1, dt * 5);

        const dir = fromAngle(this.heading);
        this.velocity = mul(dir, speed);
        this.position = add(this.position, mul(this.velocity, dt));

        if (dist < 75 && this.state === "enter") {
          this.state = "approach";
          this.targetAltitude = 6.0; // descend towards lily pad
        }

        if (dist < 12 || (dist < 28 && speed < 45)) {
          this.enterHover();
        }
        break;
      }

      case "hover": {
        // Natural micro-bobbing and hover drift
        const bob = Math.sin(time * 7.5) * 0.8;
        const drift = Math.cos(time * 5.2) * 0.6;
        const hoverOffset = vec(
          Math.cos(this.heading + Math.PI / 2) * drift,
          Math.sin(this.heading + Math.PI / 2) * drift + bob
        );
        this.position = add(this.targetPosition, hoverOffset);
        this.velocity = mul(this.velocity, Math.max(0, 1 - dt * 10));

        // Subtle micro-heading adjustments while hovering
        this.heading += Math.sin(time * 3.5) * 0.012;

        // Mid-hover water kiss: dragonfly dips down and triggers a water ripple
        if (!this.hasRippledThisHover && this.stateTime > this.hoverDuration * 0.45) {
          this.hasRippledThisHover = true;
          this.targetAltitude = 3.2; // brief low dip
          if (school) {
            school.ripples.trigger("mouth", {
              x: this.position.x,
              y: this.position.y,
            });
          }
        }

        // Return altitude after dip
        if (this.stateTime > this.hoverDuration * 0.65) {
          this.targetAltitude = 5.5;
        }

        // Startle if a koi fish swims right under it
        if (school && school.fish) {
          const visibleCount = Math.min(school.count, school.fish.length);
          for (let i = 0; i < visibleCount; i++) {
            const koi = school.fish[i];
            const distKoi = length(sub(this.position, koi.position));
            if (distKoi < 32 && koi.depth < 0.25) {
              // Startled! Dart away prematurely
              this.dartAway();
              return;
            }
          }
        }

        if (this.stateTime >= this.hoverDuration) {
          this.dartAway();
        }
        break;
      }

      case "dart": {
        // Rapid acceleration dart
        const toTarget = sub(this.targetPosition, this.position);
        const dist = length(toTarget);

        this.targetHeading = Math.atan2(toTarget.y, toTarget.x);
        const turnDiff = wrapAngle(this.targetHeading - this.heading);
        this.heading += turnDiff * Math.min(1, dt * 12);

        const dartSpeed = 340;
        const currentSpeed = length(this.velocity);
        const speed = currentSpeed + (dartSpeed - currentSpeed) * Math.min(1, dt * 10);
        this.velocity = mul(fromAngle(this.heading), speed);
        this.position = add(this.position, mul(this.velocity, dt));

        if (dist < 80) {
          this.state = "approach";
          this.targetAltitude = 6.0;
        }
        break;
      }

      case "exit": {
        // High speed cruising away offscreen
        const exitSpeed = 320;
        this.velocity = mul(fromAngle(this.heading), exitSpeed);
        this.position = add(this.position, mul(this.velocity, dt));

        // Check if fully offscreen
        const margin = 60;
        const isOffscreen =
          this.position.x < -margin ||
          this.position.x > CANVAS_WIDTH + margin ||
          this.position.y < -margin ||
          this.position.y > CANVAS_HEIGHT + margin;

        if (isOffscreen && this.stateTime > 0.8) {
          this.state = "waiting";
          // Schedule next periodic flight (between 12 and 22 seconds)
          this.waitTimer = this.random.range(12.0, 22.0);
        }
        break;
      }
    }
  }

  private startExcursion(): void {
    this.currentPaletteIndex = Math.floor(this.random.unit() * DRAGONFLY_PALETTES.length) % DRAGONFLY_PALETTES.length;
    this.visitedPadsCount = 0;
    this.targetPadsCount = this.random.unit() > 0.4 ? 2 : 3;

    // Pick spawn origin outside screen
    const side = Math.floor(this.random.unit() * 4);
    let startX = 0;
    let startY = 0;
    const margin = 50;

    switch (side) {
      case 0: // Left
        startX = -margin;
        startY = this.random.range(CANVAS_HEIGHT * 0.1, CANVAS_HEIGHT * 0.9);
        break;
      case 1: // Right
        startX = CANVAS_WIDTH + margin;
        startY = this.random.range(CANVAS_HEIGHT * 0.1, CANVAS_HEIGHT * 0.9);
        break;
      case 2: // Top
        startX = this.random.range(CANVAS_WIDTH * 0.1, CANVAS_WIDTH * 0.9);
        startY = -margin;
        break;
      default: // Bottom
        startX = this.random.range(CANVAS_WIDTH * 0.1, CANVAS_WIDTH * 0.9);
        startY = CANVAS_HEIGHT + margin;
        break;
    }

    this.position = vec(startX, startY);
    this.altitude = 20;
    this.targetAltitude = 18;

    // Target a lily pad
    this.pickNextPadTarget();

    const toTarget = sub(this.targetPosition, this.position);
    this.heading = Math.atan2(toTarget.y, toTarget.x);
    this.targetHeading = this.heading;
    this.velocity = mul(fromAngle(this.heading), 200);

    this.state = "enter";
    this.stateTime = 0;
  }

  private pickNextPadTarget(): boolean {
    const visibleLeaves = LOTUS_LEAVES.slice(0, LOTUS.visibleLeafCount);
    if (visibleLeaves.length === 0) {
      // Fallback center of pond
      this.targetPosition = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
      return false;
    }

    // Pick a leaf index that is not the same as the current pad
    let candidates = visibleLeaves.map((_, i) => i);
    if (visibleLeaves.length > 1 && this.currentPadIndex >= 0) {
      candidates = candidates.filter((i) => i !== this.currentPadIndex);
    }

    const chosenIndex = candidates[Math.floor(this.random.unit() * candidates.length)];
    this.currentPadIndex = chosenIndex;
    const leaf = visibleLeaves[chosenIndex];

    const vp = viewportPoint(leaf.x, leaf.y);
    // Slight natural jitter over the pad
    const padOffsetAngle = this.random.range(0, TAU);
    const padOffsetDist = this.random.range(0, leaf.radius * 0.35);

    this.targetPosition = vec(
      vp.x + Math.cos(padOffsetAngle) * padOffsetDist,
      vp.y + Math.sin(padOffsetAngle) * padOffsetDist
    );
    return true;
  }

  private enterHover(): void {
    this.state = "hover";
    this.stateTime = 0;
    this.hoverDuration = this.random.range(1.8, 3.2);
    this.targetAltitude = 5.0;
    this.hasRippledThisHover = false;
  }

  private dartAway(): void {
    this.visitedPadsCount++;
    this.stateTime = 0;

    if (this.visitedPadsCount < this.targetPadsCount) {
      // Dart to another lily pad
      this.pickNextPadTarget();
      this.targetAltitude = 14;
      this.state = "dart";
    } else {
      // Dart away offscreen
      this.targetAltitude = 22;
      this.state = "exit";

      // Pick an exit heading away from center
      const center = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
      const awayDir = normalize(sub(this.position, center), fromAngle(this.heading));
      const angleJitter = this.random.range(-0.5, 0.5);
      const exitAngle = Math.atan2(awayDir.y, awayDir.x) + angleJitter;
      this.heading = exitAngle;
      this.targetHeading = exitAngle;

      this.targetPosition = add(this.position, mul(fromAngle(exitAngle), 600));
    }
  }

  // ---------------------------------------------------------------------------
  // DRAWING PROCEDURAL DRAGONFLY
  // ---------------------------------------------------------------------------
  private draw(time: number): void {
    const palette = DRAGONFLY_PALETTES[this.currentPaletteIndex] || DRAGONFLY_PALETTES[0];
    const pos = this.position;
    const angle = this.heading;
    const alt = this.altitude;

    const forward = fromAngle(angle);
    const right = perpendicular(forward);

    // Calculate dynamic wing flap
    const isHovering = this.state === "hover";
    const flapFreq = isHovering ? 46.0 : 34.0;
    const flapAmp = isHovering ? 0.42 : 0.22;
    const sweepBack = isHovering ? 0.05 : 0.35; // wings sweep back during high-speed dart

    // Forewings & Hindwings beat with out-of-phase anti-phase oscillation
    const flapFore = Math.sin(time * flapFreq) * flapAmp;
    const flapHind = Math.sin(time * flapFreq + Math.PI * 0.72) * flapAmp;

    // 1. SHADOW (cast on water surface)
    this.drawShadow(pos, forward, right, alt, sweepBack, flapFore, flapHind);

    // 2. BODY (thorax, abdomen, head, eyes)
    this.drawBody(pos, forward, right, palette);

    // 3. WINGS (iridescent translucent wings with pterostigma and veins)
    this.drawWings(pos, forward, right, palette, sweepBack, flapFore, flapHind);
  }

  private drawShadow(
    pos: Vec2,
    f: Vec2,
    r: Vec2,
    alt: number,
    sweepBack: number,
    flapFore: number,
    flapHind: number
  ): void {
    // Offset shadow diagonally based on sunlight & height
    const shadowOffset = vec(4.0 + alt * 0.45, 6.0 + alt * 0.65);
    const sp = add(pos, shadowOffset);

    // Shadow opacity softens as altitude increases
    const shadowAlpha = clamp(0.42 - (alt - 4) * 0.012, 0.16, 0.42);
    this.shadowMaterial.opacity = shadowAlpha;

    // Thorax shadow
    const tCenter = add(sp, mul(f, 0.5));
    this.shadowBatch.circle(tCenter, 2.6, SHADOW_BASE_COLOR);

    // Head shadow
    const hCenter = add(sp, mul(f, 3.8));
    this.shadowBatch.circle(hCenter, 2.2, SHADOW_BASE_COLOR);

    // Abdomen shadow (tapered needle)
    const abdStart = add(sp, mul(f, -1.5));
    const abdEnd = add(sp, mul(f, -16.5));
    this.drawTaperedSegment(this.shadowBatch, abdStart, abdEnd, 1.8, 0.7, SHADOW_BASE_COLOR);

    // Wings shadow (projected thin blades)
    const wingLen = 15.0;
    const foreRootL = add(add(sp, mul(f, 1.2)), mul(r, -1.2));
    const foreRootR = add(add(sp, mul(f, 1.2)), mul(r, 1.2));

    const fScaleL = Math.cos(flapFore);
    const fScaleR = Math.cos(flapFore);

    const fTipL = add(foreRootL, add(mul(r, -wingLen * fScaleL), mul(f, -sweepBack * 8)));
    const fTipR = add(foreRootR, add(mul(r, wingLen * fScaleR), mul(f, -sweepBack * 8)));

    this.shadowBatch.triangle(foreRootL, fTipL, add(foreRootL, mul(r, -wingLen * 0.4)), SHADOW_BASE_COLOR);
    this.shadowBatch.triangle(foreRootR, fTipR, add(foreRootR, mul(r, wingLen * 0.4)), SHADOW_BASE_COLOR);

    const hindRootL = add(add(sp, mul(f, -0.6)), mul(r, -1.0));
    const hindRootR = add(add(sp, mul(f, -0.6)), mul(r, 1.0));
    const hScaleL = Math.cos(flapHind);
    const hScaleR = Math.cos(flapHind);

    const hTipL = add(hindRootL, add(mul(r, -wingLen * 0.9 * hScaleL), mul(f, -sweepBack * 9)));
    const hTipR = add(hindRootR, add(mul(r, wingLen * 0.9 * hScaleR), mul(f, -sweepBack * 9)));

    this.shadowBatch.triangle(hindRootL, hTipL, add(hindRootL, mul(r, -wingLen * 0.4)), SHADOW_BASE_COLOR);
    this.shadowBatch.triangle(hindRootR, hTipR, add(hindRootR, mul(r, wingLen * 0.4)), SHADOW_BASE_COLOR);
  }

  private drawBody(pos: Vec2, f: Vec2, r: Vec2, pal: DragonflyPalette): void {
    // A. Thorax (Chitin armor chest)
    const thoraxStart = add(pos, mul(f, -2.2));
    const thoraxEnd = add(pos, mul(f, 2.6));
    this.drawTaperedSegment(this.bodyBatch, thoraxStart, thoraxEnd, 2.6, 2.0, pal.thorax);

    // Thorax dorsal highlight stripe
    const tHighStart = add(pos, mul(f, -1.8));
    const tHighEnd = add(pos, mul(f, 2.2));
    this.drawTaperedSegment(this.bodyBatch, tHighStart, tHighEnd, 1.0, 0.8, pal.thoraxHighlight);

    // B. Abdomen (8-segment slender needle tail)
    const totalSegments = 8;
    const abdLen = 16.5;
    let segStart = add(pos, mul(f, -2.2));

    for (let s = 0; s < totalSegments; s++) {
      const t0 = s / totalSegments;
      const t1 = (s + 1) / totalSegments;
      const w0 = lerp(vec(1.8, 0), vec(0.7, 0), t0).x;
      const w1 = lerp(vec(1.8, 0), vec(0.7, 0), t1).x;

      const segEnd = add(pos, mul(f, -2.2 - t1 * abdLen));
      const isStripe = s % 2 === 1;
      const segColor = isStripe ? pal.abdomenStripe : pal.abdomenBase;

      this.drawTaperedSegment(this.bodyBatch, segStart, segEnd, w0, w1, segColor);
      segStart = segEnd;
    }

    // Abdomen claspers (tiny delicate prongs at very tip)
    const tip = add(pos, mul(f, -2.2 - abdLen));
    const clasperL = add(add(tip, mul(f, -1.4)), mul(r, -0.6));
    const clasperR = add(add(tip, mul(f, -1.4)), mul(r, 0.6));
    this.bodyBatch.triangle(tip, clasperL, add(tip, mul(f, -0.6)), pal.thorax);
    this.bodyBatch.triangle(tip, clasperR, add(tip, mul(f, -0.6)), pal.thorax);

    // C. Head
    const headCenter = add(pos, mul(f, 3.6));
    this.bodyBatch.circle(headCenter, 1.6, pal.thorax);

    // D. Big Compound Eyes (Prominent hemispherical jewel eyes)
    const eyeRadius = 1.6;
    const eyeLeft = add(add(pos, mul(f, 4.0)), mul(r, -1.6));
    const eyeRight = add(add(pos, mul(f, 4.0)), mul(r, 1.6));

    this.bodyBatch.circle(eyeLeft, eyeRadius, pal.eyes);
    this.bodyBatch.circle(eyeRight, eyeRadius, pal.eyes);

    // Eye glint / highlight dots (gives living glassy depth)
    const glintLeft = add(add(eyeLeft, mul(f, 0.5)), mul(r, -0.4));
    const glintRight = add(add(eyeRight, mul(f, 0.5)), mul(r, 0.4));
    this.bodyBatch.circle(glintLeft, 0.65, pal.eyesGlint);
    this.bodyBatch.circle(glintRight, 0.65, pal.eyesGlint);
  }

  private drawWings(
    pos: Vec2,
    f: Vec2,
    r: Vec2,
    pal: DragonflyPalette,
    sweepBack: number,
    flapFore: number,
    flapHind: number
  ): void {
    const foreLen = 17.5;
    const hindLen = 15.0;

    // Forewings roots
    const foreRootL = add(add(pos, mul(f, 1.4)), mul(r, -1.2));
    const foreRootR = add(add(pos, mul(f, 1.4)), mul(r, 1.2));

    // Hindwings roots
    const hindRootL = add(add(pos, mul(f, -0.6)), mul(r, -1.0));
    const hindRootR = add(add(pos, mul(f, -0.6)), mul(r, 1.0));

    // Draw Hindwings first (layered underneath forewings)
    this.drawSingleWing(
      hindRootL,
      -1,
      hindLen,
      5.2,
      f,
      r,
      sweepBack + 0.12,
      flapHind,
      pal
    );
    this.drawSingleWing(
      hindRootR,
      1,
      hindLen,
      5.2,
      f,
      r,
      sweepBack + 0.12,
      flapHind,
      pal
    );

    // Draw Forewings
    this.drawSingleWing(
      foreRootL,
      -1,
      foreLen,
      4.2,
      f,
      r,
      sweepBack,
      flapFore,
      pal
    );
    this.drawSingleWing(
      foreRootR,
      1,
      foreLen,
      4.2,
      f,
      r,
      sweepBack,
      flapFore,
      pal
    );
  }

  private drawSingleWing(
    root: Vec2,
    side: number, // -1 for left, 1 for right
    length: number,
    maxWidth: number,
    f: Vec2,
    r: Vec2,
    sweep: number,
    flap: number,
    pal: DragonflyPalette
  ): void {
    // Project wing stroke via flapping cosine foreshortening and sweep
    const flapFactor = Math.cos(flap);
    const sideVec = mul(r, side * flapFactor);
    const backVec = mul(f, -sweep);

    const wingDir = normalize(add(sideVec, mul(backVec, 0.35)));
    const wingPerp = perpendicular(wingDir);

    // Key points along the aerodynamic wing contour
    const pRoot = root;
    const pMidLeading = add(add(root, mul(wingDir, length * 0.5)), mul(wingPerp, side * maxWidth * 0.45));
    const pTip = add(root, mul(wingDir, length));
    const pMidTrailing = add(add(root, mul(wingDir, length * 0.45)), mul(wingPerp, -side * maxWidth * 0.55));
    const pBaseTrailing = add(add(root, mul(wingDir, length * 0.15)), mul(wingPerp, -side * maxWidth * 0.35));

    // Translucent wing triangles with subtle gradient (iridescent sheen base to crystal tip)
    this.wingBatch.triangleColors(pRoot, pMidLeading, pTip, pal.wingBase, pal.wingSheen, pal.wingTip);
    this.wingBatch.triangleColors(pRoot, pTip, pMidTrailing, pal.wingBase, pal.wingTip, pal.wingSheen);
    this.wingBatch.triangleColors(pRoot, pMidTrailing, pBaseTrailing, pal.wingBase, pal.wingSheen, pal.wingBase);

    // Wing Veins (Fine chitin structural lines)
    // 1. Main leading edge costal vein
    this.lineBatch.line(pRoot, pMidLeading, pal.pterostigma);
    this.lineBatch.line(pMidLeading, pTip, pal.pterostigma);
    // 2. Center radial vein
    const pCenterVeinMid = add(root, mul(wingDir, length * 0.6));
    this.lineBatch.line(pRoot, pCenterVeinMid, pal.wingSheen);
    this.lineBatch.line(pCenterVeinMid, pTip, pal.wingTip);
    // 3. Trailing cross vein
    this.lineBatch.line(pCenterVeinMid, pMidTrailing, pal.wingSheen);

    // Pterostigma (The iconic dark rectangular navigational flight cell on dragonfly wingtips)
    const pStigmaStart = add(root, mul(wingDir, length * 0.76));
    const pStigmaEnd = add(root, mul(wingDir, length * 0.92));
    const pStigmaOut1 = add(pStigmaStart, mul(wingPerp, side * 0.9));
    const pStigmaOut2 = add(pStigmaEnd, mul(wingPerp, side * 0.7));

    this.wingBatch.triangle(pStigmaStart, pStigmaOut1, pStigmaEnd, pal.pterostigma);
    this.wingBatch.triangle(pStigmaEnd, pStigmaOut1, pStigmaOut2, pal.pterostigma);
  }

  private drawTaperedSegment(
    batch: SurfaceGeometryBatch,
    start: Vec2,
    end: Vec2,
    wStart: number,
    wEnd: number,
    color: THREE.Color
  ): void {
    const dir = sub(end, start);
    const len = length(dir);
    if (len < 0.001) return;

    const perp = mul(vec(-dir.y / len, dir.x / len), 0.5);

    const a = add(start, mul(perp, wStart));
    const b = sub(start, mul(perp, wStart));
    const c = add(end, mul(perp, wEnd));
    const d = sub(end, mul(perp, wEnd));

    batch.triangle(a, b, c, color);
    batch.triangle(b, d, c, color);
  }
}
