export interface FluidVortex {
  x: number;
  y: number;
  vx: number;
  vy: number;
  circulation: number; // positive = CCW, negative = CW
  coreRadius: number;
  age: number;
  maxAge: number;
}

const MAX_VORTICES = 64;

export class VortexSystem {
  public readonly vortices: FluidVortex[] = [];

  public shedVortex(
    x: number,
    y: number,
    heading: number,
    speed: number,
    tailSign: number,
  ): void {
    if (this.vortices.length >= MAX_VORTICES) {
      // Reuse oldest vortex
      this.vortices.shift();
    }

    const backwardX = -Math.cos(heading);
    const backwardY = -Math.sin(heading);
    const normalX = -Math.sin(heading);
    const normalY = Math.cos(heading);

    // Circulation strength proportional to swim speed and tail flick intensity
    const strength = (speed * 0.4 + 12.0) * tailSign;
    const coreRadius = Math.max(10, Math.min(26, speed * 0.35 + 14));

    this.vortices.push({
      x: x + backwardX * 4 + normalX * (tailSign * 3),
      y: y + backwardY * 4 + normalY * (tailSign * 3),
      vx: backwardX * (speed * 0.15 + 2.0),
      vy: backwardY * (speed * 0.15 + 2.0),
      circulation: strength,
      coreRadius,
      age: 0,
      maxAge: 2.8,
    });
  }

  public update(dt: number): void {
    const decayFactor = Math.exp(-dt * 0.95);

    for (let i = this.vortices.length - 1; i >= 0; i -= 1) {
      const v = this.vortices[i];
      v.age += dt;
      if (v.age >= v.maxAge) {
        this.vortices.splice(i, 1);
        continue;
      }

      // Advect center
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      v.vx *= 0.96;
      v.vy *= 0.96;

      // Diffuse core radius and decay circulation through viscous dissipation
      v.coreRadius += 6.5 * dt;
      v.circulation *= decayFactor;
    }
  }

  /**
   * Evaluates the fluid swirl velocity induced by all active vortices at (x, y)
   * using the Lamb-Oseen regularized vortex model.
   */
  public getVelocityAt(x: number, y: number): { vx: number; vy: number } {
    let vx = 0;
    let vy = 0;

    for (let i = 0; i < this.vortices.length; i += 1) {
      const v = this.vortices[i];
      const dx = x - v.x;
      const dy = y - v.y;
      const distSq = dx * dx + dy * dy;
      const maxDist = v.coreRadius * 4.0;
      if (distSq > maxDist * maxDist || distSq < 0.25) continue;

      const r = Math.sqrt(distSq);
      // Tangential unit vector: (-dy / r, dx / r)
      const tangentX = -dy / r;
      const tangentY = dx / r;

      // Lamb-Oseen tangential velocity profile
      const coreSq = v.coreRadius * v.coreRadius;
      const factor = (1.0 - Math.exp(-distSq / coreSq)) / (r + 0.1);
      const speed = (v.circulation / (Math.PI * 2.0)) * factor * 18.0;

      vx += tangentX * speed;
      vy += tangentY * speed;
    }

    return { vx, vy };
  }

  public reset(): void {
    this.vortices.length = 0;
  }
}
