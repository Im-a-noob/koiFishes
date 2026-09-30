import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./config";
import type { VortexSystem } from "./vortices";

export interface SiltParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vz: number;     // Height above riverbed pebbles (0 = resting, >0 = suspended)
  vzVel: number;  // Vertical lift velocity
  radius: number;
  baseRadius: number;
  expansionRate: number;
  color: THREE.Color;
  opacity: number;
  age: number;
  maxAge: number;
  alive: boolean;
}

const MAX_SILT = 64;

// Luminous sunlit riverbed sand & mica mineral shimmer (warm, light, never dark/muddy)
const SILT_COLORS = [
  new THREE.Color(0xfcf5e5), // Warm quartz sand
  new THREE.Color(0xf4e6c8), // Golden mica shimmer
  new THREE.Color(0xfff8eb), // Sunlit river silt
  new THREE.Color(0xeddcb7), // Decomposed granite sand
];

const vertexShader = `
  attribute vec4 color;
  varying vec4 vColor;
  void main() {
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec4 vColor;
  void main() {
    if (vColor.a <= 0.0005) discard;
    gl_FragColor = vColor;
  }
`;

export class SiltParticlePass {
  public readonly group = new THREE.Group();

  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;

  private readonly material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });

  public readonly particles: SiltParticle[] = [];
  public enabled = true;

  public constructor() {
    this.geometry.name = "benthic silt particles";
    // 64 particles * 8 segments * 3 vertices * 3/4 floats
    const maxVertices = MAX_SILT * 8 * 3;
    this.positions = new Float32Array(maxVertices * 3);
    this.colors = new Float32Array(maxVertices * 4);

    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 4);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("color", this.colAttr);
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT),
    );

    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /**
   * Spawns a subtle, ethereal puff of sunlit river sand when deep fish sweep their
   * caudal fins near the gravel bottom.
   */
  public spawnSiltPuff(
    x: number,
    y: number,
    heading: number,
    thrustSpeed: number,
    finSign = 1,
    particleCount = 2,
  ): void {
    if (!this.enabled) return;

    const backwardX = -Math.cos(heading);
    const backwardY = -Math.sin(heading);
    const normalX = -Math.sin(heading) * finSign;
    const normalY = Math.cos(heading) * finSign;

    const count = Math.min(2, Math.max(1, particleCount));
    for (let i = 0; i < count; i += 1) {
      if (this.particles.length >= MAX_SILT) {
        this.particles.shift();
      }

      const spread = (Math.random() - 0.5) * 4.0;
      const jitterAngle = (Math.random() - 0.5) * 1.0;
      const cosJ = Math.cos(jitterAngle);
      const sinJ = Math.sin(jitterAngle);
      const dirX = backwardX * cosJ - backwardY * sinJ;
      const dirY = backwardX * sinJ + backwardY * cosJ;

      const ejectionSpeed = thrustSpeed * 0.12 + 2.0;
      const baseRadius = 2.5 + Math.random() * 2.0;
      const color = SILT_COLORS[Math.floor(Math.random() * SILT_COLORS.length)];

      this.particles.push({
        x: x + normalX * (finSign * 1.8) + spread,
        y: y + normalY * (finSign * 1.8) + spread,
        vx: dirX * ejectionSpeed + normalX * (finSign * 1.5),
        vy: dirY * ejectionSpeed + normalY * (finSign * 1.5),
        vz: 0.5 + Math.random() * 1.2,
        vzVel: 2.2 + Math.random() * 2.5,
        radius: baseRadius,
        baseRadius,
        expansionRate: 1.2 + Math.random() * 1.0,
        color,
        opacity: 0.08 + Math.random() * 0.06, // Soft translucent shimmer (never dark!)
        age: 0,
        maxAge: 2.0 + Math.random() * 1.5,
        alive: true,
      });
    }
  }

  public update(dt: number, time: number, vortices?: VortexSystem): void {
    if (!this.enabled && this.particles.length === 0) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    // Ambient bed undercurrent
    const bedCurrentX = Math.cos(time * 0.08) * 0.7 + 0.4;
    const bedCurrentY = Math.sin(time * 0.10) * 0.5 + 0.2;

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }

      let flowVx = bedCurrentX;
      let flowVy = bedCurrentY;
      if (vortices) {
        const v = vortices.getVelocityAt(p.x, p.y);
        flowVx += v.vx * 0.45;
        flowVy += v.vy * 0.45;
      }

      p.vx += (flowVx - p.vx) * 1.2 * dt;
      p.vy += (flowVy - p.vy) * 1.2 * dt;

      // Vertical lift and gentle gravitational sedimentation
      p.vzVel -= 3.5 * dt;
      p.vz += p.vzVel * dt;
      if (p.vz < 0) {
        p.vz = 0;
        p.vzVel = 0;
        p.vx *= 0.85;
        p.vy *= 0.85;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.radius = p.baseRadius + p.expansionRate * p.age;

      if (p.x < -10) p.x = CANVAS_WIDTH + 5;
      if (p.x > CANVAS_WIDTH + 10) p.x = -5;
      if (p.y < -10) p.y = CANVAS_HEIGHT + 5;
      if (p.y > CANVAS_HEIGHT + 10) p.y = -5;
    }

    // Dynamic procedural geometry with soft radial alpha falloff
    let posCursor = 0;
    let colCursor = 0;
    const segments = 8;

    for (const p of this.particles) {
      const lifeFraction = p.age / p.maxAge;
      const fadeIn = Math.min(1.0, p.age / 0.3);
      const fadeOut = Math.max(0, 1.0 - lifeFraction * lifeFraction);
      const centerAlpha = p.opacity * fadeIn * fadeOut;
      if (centerAlpha <= 0.002) continue;

      const r = p.color.r;
      const g = p.color.g;
      const b = p.color.b;

      // Ensure buffer capacity for 8 triangles = 24 vertices
      if (posCursor + segments * 3 * 3 > this.positions.length) break;

      const cx = p.x;
      const cy = p.y;
      const rad = p.radius;

      for (let s = 0; s < segments; s += 1) {
        const a1 = (s / segments) * Math.PI * 2;
        const a2 = ((s + 1) / segments) * Math.PI * 2;
        const p1x = cx + Math.cos(a1) * rad;
        const p1y = cy + Math.sin(a1) * rad;
        const p2x = cx + Math.cos(a2) * rad;
        const p2y = cy + Math.sin(a2) * rad;

        // Vertex 0: Center (peak alpha)
        this.positions[posCursor] = cx;
        this.positions[posCursor + 1] = cy;
        this.positions[posCursor + 2] = 0;
        this.colors[colCursor] = r;
        this.colors[colCursor + 1] = g;
        this.colors[colCursor + 2] = b;
        this.colors[colCursor + 3] = centerAlpha;

        // Vertex 1: Edge 1 (feathered 0 alpha)
        this.positions[posCursor + 3] = p1x;
        this.positions[posCursor + 4] = p1y;
        this.positions[posCursor + 5] = 0;
        this.colors[colCursor + 4] = r;
        this.colors[colCursor + 5] = g;
        this.colors[colCursor + 6] = b;
        this.colors[colCursor + 7] = 0.0;

        // Vertex 2: Edge 2 (feathered 0 alpha)
        this.positions[posCursor + 6] = p2x;
        this.positions[posCursor + 7] = p2y;
        this.positions[posCursor + 8] = 0;
        this.colors[colCursor + 8] = r;
        this.colors[colCursor + 9] = g;
        this.colors[colCursor + 10] = b;
        this.colors[colCursor + 11] = 0.0;

        posCursor += 9;
        colCursor += 12;
      }
    }

    const vertexCount = posCursor / 3;
    this.geometry.setDrawRange(0, vertexCount);
    if (vertexCount > 0) {
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(0, posCursor);
      this.posAttr.needsUpdate = true;

      this.colAttr.clearUpdateRanges();
      this.colAttr.addUpdateRange(0, colCursor);
      this.colAttr.needsUpdate = true;
    }
  }

  public reset(): void {
    this.particles.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}
