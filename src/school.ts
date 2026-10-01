import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  MAX_FISH,
  SPINE_NODES,
} from "./config";
import { Koi, SwimState } from "./koi";
import { TinyFishSchools } from "./tiny-fish";
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
  type Vec2,
  vec,
  wrapAngle,
  XorShift32,
} from "./math";
import { RippleSystem } from "./ripple-system";
import { VortexSystem } from "./vortices";
import { FoodPelletsPass } from "./food-pellets";
import { SiltParticlePass } from "./silt-particles";

export class School {
  public readonly fish: Koi[] = Array.from({ length: MAX_FISH }, () => new Koi());
  public readonly ripples = new RippleSystem();
  public readonly tinyFish = new TinyFishSchools();
  public readonly vortices = new VortexSystem();
  public readonly foodPellets = new FoodPelletsPass();
  public readonly siltParticles = new SiltParticlePass();

  public count: number = FISH.initialCount;
  public targetActive = false;

  private random = new XorShift32();
  private target = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
  private targetAge = 0;

  public constructor() {
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
  }

  public setCount(count: number): void {
    this.count = clamp(Math.round(count), 1, MAX_FISH);
  }

  public updateBodyProportions(previous: {
    regularLength: readonly [number, number];
    tinyLength: readonly [number, number];
    regularWidthRatio: readonly [number, number];
    tinyWidthRatio: readonly [number, number];
    tinyEvery: number;
  }): void {
    const midpoint = (range: readonly [number, number]): number =>
      (range[0] + range[1]) * 0.5;
    for (const [index, fish] of this.fish.entries()) {
      const wasTiny = index % previous.tinyEvery === previous.tinyEvery - 1;
      const isTiny = index % FISH.tinyEvery === FISH.tinyEvery - 1;
      const oldLength = midpoint(wasTiny ? previous.tinyLength : previous.regularLength);
      const newLength = midpoint(isTiny ? FISH.tinyLength : FISH.regularLength);
      const oldWidth = midpoint(
        wasTiny ? previous.tinyWidthRatio : previous.regularWidthRatio,
      );
      const newWidth = midpoint(isTiny ? FISH.tinyWidthRatio : FISH.regularWidthRatio);
      const lengthRatio = newLength / Math.max(oldLength, 0.001);
      fish.bodyLength *= lengthRatio;
      fish.bodyWidth *= lengthRatio * newWidth / Math.max(oldWidth, 0.001);
    }
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const fish of this.fish) {
      const nextX = fish.position.x * scaleX;
      const nextY = fish.position.y * scaleY;
      const shiftX = nextX - fish.position.x;
      const shiftY = nextY - fish.position.y;
      fish.position.x = nextX;
      fish.position.y = nextY;
      for (const node of fish.spine) {
        node.x += shiftX;
        node.y += shiftY;
      }
      for (const node of fish.renderSpine) {
        node.x += shiftX;
        node.y += shiftY;
      }
    }
    this.target.x *= scaleX;
    this.target.y *= scaleY;
    this.tinyFish.resize(scaleX, scaleY);
    for (const ripple of this.ripples.instances) {
      ripple.center.x *= scaleX;
      ripple.center.y *= scaleY;
    }
  }

  public reset(): void {
    this.random.state = 0x00c0ffee;
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
    this.tinyFish.reset();
    this.ripples.reset();
    this.vortices.reset();
    this.foodPellets.pellets.length = 0;
    this.siltParticles.reset();
    this.targetActive = false;
  }

  public setRainIntensity(intensity: number): void {
    this.ripples.setRainIntensity(intensity);
  }

  public callTo(point: Vec2): void {
    this.target = { ...point };
    this.targetActive = true;
    this.targetAge = 0;
    this.foodPellets.dropPelletCluster(point.x, point.y, 3, this.ripples);
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      const response = FISH.callResponse;
      const distanceToCall = length(sub(fish.position, point));
      const distanceAmount = Math.pow(
        clamp(distanceToCall / response.distanceAtMaximumDelay, 0, 1),
        response.distanceExponent,
      );
      fish.callDelay =
        response.minimumDelaySeconds +
        distanceAmount * response.maximumDistanceDelaySeconds +
        this.random.range(0, response.randomJitterSeconds) +
        (1 - fish.reactivity) * response.temperamentDelaySeconds;
      fish.respondedToCall = false;
      fish.callResponseAge = 0;
    }
    this.tinyFish.fleeFrom(point);
    this.ripples.trigger("touch", point);
  }

  public scatter(): void {
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      fish.heading += this.random.range(-1.35, 1.35);
      fish.speed = fish.maximumSpeed;
      fish.angularVelocity += this.random.range(-2, 2);
      this.enterState(fish, SwimState.Burst);
    }
    this.targetActive = false;
  }

  public scareNear(x: number, y: number, radius = 46): void {
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      const dx = fish.position.x - x;
      const dy = fish.position.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < radius && dist > 0.01) {
        fish.heading = Math.atan2(dy, dx);
        fish.speed = fish.maximumSpeed * 1.15;
        this.enterState(fish, SwimState.Burst);
        // Startle Dive: koi immediately dives into the deep water column to seek shelter
        fish.targetDepth = 0.85;
        fish.depthTransitionRate = 5.2;
        fish.inDeepPeriod = true;
        fish.depthStateAge = 0;
        fish.depthStateDuration = 5.5;
        this.siltParticles.spawnSiltPuff(fish.position.x, fish.position.y, fish.heading, fish.speed, 1, 2);
      }
    }
  }

  public update(dt: number, time: number): void {
    this.targetAge += dt;
    if (
      this.targetActive &&
      this.targetAge > FISH.callResponse.targetLifetimeSeconds
    ) {
      this.targetActive = false;
    }

    this.updateDraftingAndCollisions(dt);

    const desired: Vec2[] = [];
    const desiredSpeed: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      fish.callDelay = Math.max(0, fish.callDelay - dt);
      if (this.targetActive && fish.respondedToCall) {
        fish.callResponseAge += dt;
      }
      if (this.targetActive && fish.callDelay <= 0 && !fish.respondedToCall) {
        fish.respondedToCall = true;
        fish.callResponseAge = 0;
        fish.targetDepth = FISH.depth.callRiseDepth;
        fish.depthTransitionRate = 3 / Math.max(FISH.depth.callRiseSeconds, 0.1);
        this.enterState(fish, SwimState.Burst);
      }
      this.updateNaturalState(fish, dt);
      this.updateDepth(fish, dt);
      this.updateFeeding(fish, dt);
      desired[index] = this.steeringFor(index, time);
      desiredSpeed[index] = this.desiredSpeedFor(index);
    }
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      this.integrate(fish, desired[index], desiredSpeed[index], dt);
    }
    this.tinyFish.update(dt, time);
    this.vortices.update(dt);
    this.foodPellets.update(time, this.vortices, this.ripples);
    this.siltParticles.update(dt, time, this.vortices);

    this.ripples.update(dt);
  }

  private updateDepth(fish: Koi, dt: number): void {
    fish.depthStateAge += dt;
    const risingForCall = this.targetActive && fish.respondedToCall;
    if (risingForCall) {
      fish.targetDepth = 0.06;
      fish.depthTransitionRate = 4.2;
    } else if (fish.depthStateAge >= fish.depthStateDuration) {
      fish.depthStateAge = 0;
      if (this.behaviorUnit(fish) < FISH.depth.changeProbability) {
        fish.inDeepPeriod = !fish.inDeepPeriod;
      }
      const range = fish.inDeepPeriod
        ? FISH.depth.deepRange
        : FISH.depth.shallowRange;
      const durations = fish.inDeepPeriod
        ? FISH.depth.deepDurationSeconds
        : FISH.depth.surfaceDurationSeconds;
      fish.targetDepth = this.behaviorRange(fish, range[0], range[1]);
      fish.depthStateDuration = this.behaviorRange(
        fish,
        durations[0],
        durations[1],
      );
      const transitionSeconds = this.behaviorRange(
        fish,
        FISH.depth.transitionSeconds[0],
        FISH.depth.transitionSeconds[1],
      );
      fish.depthTransitionRate = 3 / Math.max(transitionSeconds, 0.1);
    }

    fish.depth +=
      (fish.targetDepth - fish.depth) *
      (1 - Math.exp(-fish.depthTransitionRate * dt));
  }

  private updateFeeding(fish: Koi, dt: number): void {
    fish.gulpAnimation = Math.max(0, fish.gulpAnimation - dt);

    const forwardX = Math.cos(fish.heading);
    const forwardY = Math.sin(fish.heading);
    const mouthDistance = fish.bodyWidth * FISH.feeding.mouthForwardOffset;
    const mouthPos = {
      x: fish.position.x + forwardX * mouthDistance,
      y: fish.position.y + forwardY * mouthDistance,
    };

    // 1. Interactive Buccal Suction towards floating food pellets
    const nearestPellet = this.foodPellets.getNearestPellet(mouthPos.x, mouthPos.y, 85);
    if (nearestPellet && fish.depth < 0.28) {
      const consumed = this.foodPellets.applySuction(nearestPellet, mouthPos.x, mouthPos.y, dt);
      if (consumed) {
        this.ripples.trigger("mouth", mouthPos);
        fish.gulpAnimation = FISH.feeding.animationDurationSeconds;
        fish.gulpCountdown = this.behaviorRange(
          fish,
          FISH.feeding.intervalSeconds[0],
          FISH.feeding.intervalSeconds[1],
        );
        return;
      }
    }

    fish.gulpCountdown -= dt;
    if (fish.gulpCountdown > 0) return;

    const calmState =
      fish.state === SwimState.Hover ||
      fish.state === SwimState.Coast ||
      fish.state === SwimState.Glide;
    const chasing = this.targetActive && fish.respondedToCall;
    const eligible =
      calmState &&
      !chasing &&
      fish.depth <= FISH.feeding.eligibleDepth &&
      fish.speed <= fish.cruiseSpeed * FISH.feeding.eligibleSpeedFraction;

    if (!eligible) {
      fish.gulpCountdown = this.behaviorRange(
        fish,
        FISH.feeding.retryDelaySeconds[0],
        FISH.feeding.retryDelaySeconds[1],
      );
      return;
    }

    this.ripples.trigger("mouth", mouthPos);
    fish.gulpAnimation = FISH.feeding.animationDurationSeconds;
    fish.gulpCountdown = this.behaviorRange(
      fish,
      FISH.feeding.intervalSeconds[0],
      FISH.feeding.intervalSeconds[1],
    );
  }

  private behaviorUnit(fish: Koi): number {
    let value = fish.behaviorRng >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    fish.behaviorRng = value >>> 0;
    return (fish.behaviorRng & 0x00ffffff) / 0x01000000;
  }

  private behaviorRange(fish: Koi, low: number, high: number): number {
    return low + (high - low) * this.behaviorUnit(fish);
  }

  private enterState(fish: Koi, next: SwimState): void {
    fish.state = next;
    fish.stateAge = 0;
    switch (next) {
      case SwimState.Glide:
        fish.stateDuration = this.behaviorRange(fish, 1.7, 5.2);
        break;
      case SwimState.Coast:
        fish.stateDuration = this.behaviorRange(fish, 0.7, 2.1);
        break;
      case SwimState.Hover:
        fish.stateDuration = this.behaviorRange(fish, 0.65, 3.1);
        break;
      case SwimState.Burst:
        fish.stateDuration = this.behaviorRange(fish, 0.32, 0.92);
        break;
      case SwimState.Pivot: {
        fish.stateDuration = this.behaviorRange(fish, 0.3, 0.78);
        const direction = this.behaviorUnit(fish) < 0.5 ? -1 : 1;
        fish.pivotHeading = wrapAngle(
          fish.heading + direction * this.behaviorRange(fish, 0.85, 2.35),
        );
        break;
      }
    }
  }

  private updateNaturalState(fish: Koi, dt: number): void {
    fish.stateAge += dt;
    if (fish.stateAge < fish.stateDuration) return;

    const roll = this.behaviorUnit(fish);
    switch (fish.state) {
      case SwimState.Glide:
        if (roll < 0.25) this.enterState(fish, SwimState.Coast);
        else if (roll < 0.43) this.enterState(fish, SwimState.Hover);
        else if (roll < 0.61) this.enterState(fish, SwimState.Pivot);
        else if (roll < 0.72) this.enterState(fish, SwimState.Burst);
        else this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Coast:
        if (roll < 0.38) this.enterState(fish, SwimState.Hover);
        else if (roll < 0.72) this.enterState(fish, SwimState.Glide);
        else if (roll < 0.9) this.enterState(fish, SwimState.Pivot);
        else this.enterState(fish, SwimState.Burst);
        break;
      case SwimState.Hover:
        if (roll < 0.34) this.enterState(fish, SwimState.Pivot);
        else if (roll < 0.55) this.enterState(fish, SwimState.Burst);
        else this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Burst:
        this.enterState(fish, SwimState.Coast);
        break;
      case SwimState.Pivot:
        this.enterState(fish, roll < 0.38 ? SwimState.Burst : SwimState.Glide);
        break;
    }
  }

  private steeringFor(index: number, time: number): Vec2 {
    const fish = this.fish[index];
    const forward = fromAngle(fish.heading);
    let steering = mul(forward, 0.95);

    if (fish.state === SwimState.Pivot) {
      steering = mul(fromAngle(fish.pivotHeading), 4.7);
    } else if (fish.state !== SwimState.Hover) {
      const wander =
        Math.sin(time * 0.29 + fish.wanderSeed) * 0.7 +
        Math.sin(time * 0.113 + fish.wanderSeed * 1.73) * 0.45;
      steering = add(steering, mul(fromAngle(fish.heading + wander), 0.62));
    }

    let separation = vec();
    let alignment = vec();
    let cohesion = vec();
    let neighbours = 0;

    for (let other = 0; other < this.count; other += 1) {
      if (other === index) continue;
      const offset = sub(fish.position, this.fish[other].position);
      const distance = length(offset);
      if (distance > 0.001 && distance < 37) {
        neighbours += 1;
        cohesion = add(cohesion, this.fish[other].position);
        alignment = add(alignment, normalize(this.fish[other].velocity));
        if (distance < 14) {
          separation = add(separation, mul(normalize(offset), (14 - distance) / 14));
        }
      }
    }

    if (neighbours > 0) {
      cohesion = normalize(sub(mul(cohesion, 1 / neighbours), fish.position), forward);
      alignment = normalize(alignment, forward);
      steering = add(steering, mul(cohesion, 0.25));
      steering = add(steering, mul(alignment, 0.42));
      steering = add(steering, mul(separation, 2.8));
    }

    const margin = 32;
    const edgeForce = vec();
    if (fish.position.x < margin) edgeForce.x += (margin - fish.position.x) / margin;
    if (fish.position.x > CANVAS_WIDTH - margin) {
      edgeForce.x -= (fish.position.x - (CANVAS_WIDTH - margin)) / margin;
    }
    if (fish.position.y < margin) edgeForce.y += (margin - fish.position.y) / margin;
    if (fish.position.y > CANVAS_HEIGHT - margin) {
      edgeForce.y -= (fish.position.y - (CANVAS_HEIGHT - margin)) / margin;
    }
    steering = add(steering, mul(edgeForce, 4.8));

    if (this.targetActive && fish.callDelay <= 0) {
      const toTarget = sub(this.target, fish.position);
      const distance = length(toTarget);
      if (distance > 13) {
        const chasePull =
          fish.callResponseAge < FISH.callResponse.chaseBoostSeconds
            ? 3.35
            : 2.45;
        steering = add(steering, mul(normalize(toTarget), chasePull));
      } else {
        const targetDirection = normalize(toTarget, forward);
        steering = add(steering, mul(perpendicular(targetDirection), 2.2));
        steering = add(steering, mul(targetDirection, -0.5));
      }
    }

    const nearestPellet = this.foodPellets.getNearestPellet(fish.position.x, fish.position.y, 120);
    if (nearestPellet) {
      const toPellet = sub(vec(nearestPellet.x, nearestPellet.y), fish.position);
      steering = add(steering, mul(normalize(toPellet), 3.4));
    }

    return normalize(steering, forward);
  }

  private desiredSpeedFor(index: number): number {
    const fish = this.fish[index];
    const chaseDuration = FISH.callResponse.chaseBoostSeconds;
    const chasing =
      this.targetActive &&
      fish.respondedToCall &&
      fish.callResponseAge < chaseDuration;
    if (chasing) {
      const chaseFade = 1 - clamp(fish.callResponseAge / chaseDuration, 0, 1);
      return (
        fish.maximumSpeed *
        (FISH.callResponse.chaseSpeedMultiplier +
          chaseFade * FISH.callResponse.initialExtraSpeedMultiplier)
      );
    }

    const nearestPellet = this.foodPellets.getNearestPellet(fish.position.x, fish.position.y, 120);
    if (nearestPellet) {
      return fish.cruiseSpeed * 1.35;
    }

    let intention = fish.cruiseSpeed;
    if (this.targetActive && fish.callDelay <= 0) {
      const distance = length(sub(this.target, fish.position));
      const urgency = clamp(distance / 105, 0.2, 1);
      intention = fish.cruiseSpeed + (fish.maximumSpeed - fish.cruiseSpeed) * urgency;
    }

    // 5. Hydrodynamic Slipstream Drafting Speed Boost
    if (fish.draftingFactor > 0.05) {
      intention *= (1.0 + fish.draftingFactor * 0.24);
    }

    switch (fish.state) {
      case SwimState.Glide:
        return intention;
      case SwimState.Coast:
        return intention * 0.28;
      case SwimState.Hover:
        return 0;
      case SwimState.Burst:
        return fish.maximumSpeed * 1.08;
      case SwimState.Pivot:
        return fish.cruiseSpeed * 0.16;
    }
  }

  /**
   * 5. Hydrodynamic Schooling: Multi-Segment Hull Collision & Slipstream Drafting
   */
  private updateDraftingAndCollisions(dt: number): void {
    // 1. Reset collision impulses and drafting metrics
    for (let i = 0; i < this.count; i += 1) {
      const fish = this.fish[i];
      fish.collisionRepulsion = vec(0, 0);
      fish.draftingFactor = 0;
    }

    // 2. Multi-Segment Capsule Hull Collision Response between nearby koi
    for (let i = 0; i < this.count; i += 1) {
      const fishA = this.fish[i];
      for (let j = i + 1; j < this.count; j += 1) {
        const fishB = this.fish[j];

        // 3D vertical depth separation check (koi can swim freely over/under each other)
        const depthDelta = Math.abs(fishA.depth - fishB.depth);
        if (depthDelta > 0.26) continue;
        const depthCushion = 1.0 - depthDelta / 0.26;

        // Sample key hull nodes along spine: head (0), mid-torso, and tail peduncle
        const sampleNodes = [0, Math.floor(SPINE_NODES * 0.38), SPINE_NODES - 2];
        for (const nodeA of sampleNodes) {
          const posA = fishA.spine[nodeA];
          const widthA = fishA.bodyWidth * (nodeA === 0 ? 0.9 : nodeA === sampleNodes[1] ? 1.0 : 0.65);

          for (const nodeB of sampleNodes) {
            const posB = fishB.spine[nodeB];
            const widthB = fishB.bodyWidth * (nodeB === 0 ? 0.9 : nodeB === sampleNodes[1] ? 1.0 : 0.65);

            const dx = posA.x - posB.x;
            const dy = posA.y - posB.y;
            const distSq = dx * dx + dy * dy;
            const minDist = (widthA + widthB) * 0.82;

            if (distSq < minDist * minDist && distSq > 0.001) {
              const dist = Math.sqrt(distSq);
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = (minDist - dist) * depthCushion;

              // Elastic boundary repulsion with fluid lubrication cushioning
              const impulse = overlap * 18.0;
              fishA.collisionRepulsion.x += nx * impulse;
              fishA.collisionRepulsion.y += ny * impulse;
              fishB.collisionRepulsion.x -= nx * impulse;
              fishB.collisionRepulsion.y -= ny * impulse;

              // Gentle glancing torque: deflect headings to glide past gracefully
              const relHeading = wrapAngle(fishA.heading - fishB.heading);
              if (Math.abs(relHeading) < 1.2) {
                const sideSign = (nx * -Math.sin(fishA.heading) + ny * Math.cos(fishA.heading)) > 0 ? 1 : -1;
                fishA.angularVelocity += sideSign * 0.9 * overlap * dt;
                fishB.angularVelocity -= sideSign * 0.9 * overlap * dt;
              }
            }
          }
        }
      }
    }

    // 3. Hydrodynamic Slipstream Drafting (Wake capture & energy conservation)
    for (let i = 0; i < this.count; i += 1) {
      const trailing = this.fish[i];
      let maxDraft = 0;

      for (let j = 0; j < this.count; j += 1) {
        if (i === j) continue;
        const leader = this.fish[j];
        if (leader.speed < 8.0) continue; // Leader must be moving forward

        // Check vertical depth alignment
        const depthDelta = Math.abs(trailing.depth - leader.depth);
        if (depthDelta > 0.22) continue;
        const depthFactor = 1.0 - depthDelta / 0.22;

        const forwardL = fromAngle(leader.heading);
        const perpL = perpendicular(forwardL);

        // Vector from leader to trailing fish
        const toTrailX = trailing.position.x - leader.position.x;
        const toTrailY = trailing.position.y - leader.position.y;

        // Downstream projection (behind leader along backward heading)
        const downstream = -(toTrailX * forwardL.x + toTrailY * forwardL.y);
        if (downstream < 14.0 || downstream > 85.0) continue;

        // Cross-stream lateral offset
        const crossStream = Math.abs(toTrailX * perpL.x + toTrailY * perpL.y);
        const wakeHalfWidth = leader.bodyWidth * 1.6 + downstream * 0.26;
        if (crossStream > wakeHalfWidth) continue;

        // Heading alignment check (trailing fish must be heading roughly in same direction)
        const headingDiff = Math.abs(wrapAngle(trailing.heading - leader.heading));
        if (headingDiff > 1.1) continue;

        // Drafting efficiency (peaks right in sweet spot behind leader)
        const longitudinalQuality = Math.sin((downstream - 14.0) / (85.0 - 14.0) * Math.PI);
        const lateralQuality = 1.0 - crossStream / wakeHalfWidth;
        const alignmentQuality = Math.cos(headingDiff);

        const draftScore = longitudinalQuality * lateralQuality * alignmentQuality * depthFactor;
        if (draftScore > maxDraft) {
          maxDraft = draftScore;
        }
      }

      trailing.draftingFactor = maxDraft;
    }
  }

  private integrate(fish: Koi, desired: Vec2, desiredSpeed: number, dt: number): void {
    const desiredHeading = Math.atan2(desired.y, desired.x);
    const headingError = wrapAngle(desiredHeading - fish.heading);
    const pivoting = fish.state === SwimState.Pivot;
    const turnMultiplier = pivoting ? 2.65 : 1;
    const angularDamping = pivoting ? 2.15 : 3.8;
    const angularAcceleration =
      headingError * fish.turnStrength * turnMultiplier - fish.angularVelocity * angularDamping;
    fish.angularVelocity += angularAcceleration * dt;
    const maximumTurnRate = pivoting ? 4.35 : 2.25;
    fish.angularVelocity = clamp(fish.angularVelocity, -maximumTurnRate, maximumTurnRate);
    fish.heading = wrapAngle(fish.heading + fish.angularVelocity * dt);

    let speedResponse = 1.65;
    let desiredTailEffort = 0.62;
    switch (fish.state) {
      case SwimState.Glide:
        break;
      case SwimState.Coast:
        speedResponse = 1.05;
        desiredTailEffort = 0.16;
        break;
      case SwimState.Hover:
        speedResponse = 3.6;
        desiredTailEffort = 0.05;
        break;
      case SwimState.Burst:
        speedResponse = 6.4;
        desiredTailEffort = 1.22;
        break;
      case SwimState.Pivot:
        speedResponse = 4.2;
        desiredTailEffort = 1;
        break;
    }

    // Energy conservation when drafting in a leading fish's slipstream
    if (fish.draftingFactor > 0.05) {
      desiredTailEffort *= (1.0 - fish.draftingFactor * 0.35);
    }

    fish.speed += (desiredSpeed - fish.speed) * (1 - Math.exp(-speedResponse * dt));
    fish.tailEffort += (desiredTailEffort - fish.tailEffort) * (1 - Math.exp(-4.5 * dt));
    fish.velocity = mul(fromAngle(fish.heading), fish.speed);
    fish.position = add(fish.position, mul(fish.velocity, dt));

    // Apply accumulated multi-segment hull collision repulsion
    fish.position = add(fish.position, mul(fish.collisionRepulsion, dt));

    const beatRate = 0.45 + (fish.speed / fish.maximumSpeed) * 4.6 + fish.tailEffort * 0.9;
    fish.swimPhase += beatRate * dt;

    // Detect tail stroke reversal to shed fluid vortices & stir benthic sediment
    const tailSign = Math.sign(Math.sin(fish.swimPhase));
    if (tailSign !== 0 && tailSign !== fish.previousTailSign && fish.speed > 5.0) {
      fish.previousTailSign = tailSign;
      const tailTip = fish.spine[SPINE_NODES - 1];
      this.vortices.shedVortex(tailTip.x, tailTip.y, fish.heading, fish.speed, tailSign);

      // 6. Benthic Sediment Plumes (delicate sunlit mica shimmer when swimming near riverbed stones)
      if (fish.depth > 0.78 && fish.speed > 8.0) {
        this.siltParticles.spawnSiltPuff(
          tailTip.x,
          tailTip.y,
          fish.heading,
          fish.speed,
          tailSign,
          1,
        );
      }
    }

    fish.spine[0] = { ...fish.position };
    const spacing = fish.bodyLength / (SPINE_NODES - 1);
    for (let node = 1; node < SPINE_NODES; node += 1) {
      const fallback = mul(fromAngle(fish.heading), -1);
      const direction = normalize(sub(fish.spine[node], fish.spine[node - 1]), fallback);
      const constrained = add(fish.spine[node - 1], mul(direction, spacing));
      const tailAmount = node / (SPINE_NODES - 1);
      const stiffness = 0.94 - tailAmount * 0.17;
      fish.spine[node] = lerp(fish.spine[node], constrained, stiffness);
    }
  }

}
