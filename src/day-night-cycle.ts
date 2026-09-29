import * as THREE from "three";
import type { ColorTriplet } from "./weather";

export const DAY_NIGHT_CYCLE_DURATION = 600; // 10 minutes in seconds

export interface DayNightKeyframe {
  phase: number; // 0.0 to 1.0
  label: string;
  icon: string;
  tint: ColorTriplet;
  brightness: number;
  contrast: number;
  saturation: number;
  vignette: number;
  cloudStrength: number;
  lightColor: ColorTriplet;
  lightStrength: number;
  lightDirection: readonly [number, number];
  pondBedDeep: ColorTriplet;
  pondBedShallow: ColorTriplet;
  verticalTone: number;
  edgeDarkening: number;
  waterTint: ColorTriplet;
  waterCurrentColor: ColorTriplet;
  waterCurrentCore: ColorTriplet;
  shadowColor: number;
}

export const DAY_NIGHT_KEYFRAMES: readonly DayNightKeyframe[] = [
  {
    // 0:00 (0s) - Early dawn, soft lavender-rose horizon
    phase: 0.0,
    label: "Dawn",
    icon: "🌅",
    tint: [0.94, 0.86, 0.96],
    brightness: 0.82,
    contrast: 0.98,
    saturation: 0.92,
    vignette: 0.16,
    cloudStrength: 0.20,
    lightColor: [1.0, 0.76, 0.62],
    lightStrength: 0.14,
    lightDirection: [0.72, 0.68],
    pondBedDeep: [0.36, 0.62, 0.55],
    pondBedShallow: [0.12, 0.32, 0.22],
    verticalTone: 0.82,
    edgeDarkening: 0.58,
    waterTint: [0.98, 1.01, 1.0],
    waterCurrentColor: [0.018, 0.062, 0.048],
    waterCurrentCore: [0.042, 0.142, 0.112],
    shadowColor: 0x0c2420,
  },
  {
    // 1:40 (100s) - Morning golden sun climbing
    phase: 0.167,
    label: "Morning",
    icon: "🌤️",
    tint: [1.0, 0.98, 0.96],
    brightness: 0.98,
    contrast: 1.0,
    saturation: 1.0,
    vignette: 0.05,
    cloudStrength: 0.18,
    lightColor: [1.0, 0.92, 0.76],
    lightStrength: 0.18,
    lightDirection: [0.35, 0.88],
    pondBedDeep: [0.44, 0.68, 0.60],
    pondBedShallow: [0.14, 0.36, 0.24],
    verticalTone: 0.80,
    edgeDarkening: 0.57,
    waterTint: [0.97, 1.02, 1.0],
    waterCurrentColor: [0.020, 0.066, 0.047],
    waterCurrentCore: [0.048, 0.150, 0.108],
    shadowColor: 0x0b211e,
  },
  {
    // 3:20 (200s) - Midday / Zenith, crystal clear vibrant sun
    phase: 0.333,
    label: "Midday",
    icon: "☀️",
    tint: [1.0, 1.0, 1.0],
    brightness: 1.02,
    contrast: 1.0,
    saturation: 1.02,
    vignette: 0.02,
    cloudStrength: 0.22,
    lightColor: [1.0, 0.96, 0.82],
    lightStrength: 0.22,
    lightDirection: [-0.18, 0.94],
    pondBedDeep: [0.486, 0.718, 0.631],
    pondBedShallow: [0.145, 0.395, 0.255],
    verticalTone: 0.80,
    edgeDarkening: 0.57,
    waterTint: [0.96, 1.02, 1.0],
    waterCurrentColor: [0.022, 0.068, 0.047],
    waterCurrentCore: [0.052, 0.155, 0.108],
    shadowColor: 0x0b211e,
  },
  {
    // 5:00 (300s) - Late Afternoon, warming sunlight
    phase: 0.50,
    label: "Afternoon",
    icon: "⛅",
    tint: [1.06, 0.94, 0.84],
    brightness: 0.98,
    contrast: 1.04,
    saturation: 1.10,
    vignette: 0.10,
    cloudStrength: 0.28,
    lightColor: [1.0, 0.74, 0.42],
    lightStrength: 0.24,
    lightDirection: [-0.55, 0.78],
    pondBedDeep: [0.46, 0.65, 0.55],
    pondBedShallow: [0.16, 0.36, 0.23],
    verticalTone: 0.82,
    edgeDarkening: 0.58,
    waterTint: [0.98, 1.01, 0.98],
    waterCurrentColor: [0.026, 0.060, 0.038],
    waterCurrentCore: [0.060, 0.130, 0.075],
    shadowColor: 0x121b16,
  },
  {
    // 6:20 (380s) - Golden Hour & Sunset, rich amber-copper glow
    phase: 0.633,
    label: "Sunset",
    icon: "🌇",
    tint: [1.14, 0.84, 0.66],
    brightness: 0.92,
    contrast: 1.08,
    saturation: 1.18,
    vignette: 0.22,
    cloudStrength: 0.38,
    lightColor: [1.0, 0.42, 0.14],
    lightStrength: 0.28,
    lightDirection: [-0.78, 0.62],
    pondBedDeep: [0.44, 0.56, 0.46],
    pondBedShallow: [0.18, 0.32, 0.19],
    verticalTone: 0.85,
    edgeDarkening: 0.60,
    waterTint: [1.02, 0.98, 0.94],
    waterCurrentColor: [0.032, 0.052, 0.024],
    waterCurrentCore: [0.070, 0.105, 0.043],
    shadowColor: 0x1e120c,
  },
  {
    // 7:40 (460s) - Twilight & Dusk, deep indigo blue hour
    phase: 0.767,
    label: "Twilight",
    icon: "🌆",
    tint: [0.66, 0.72, 0.96],
    brightness: 0.72,
    contrast: 1.06,
    saturation: 0.82,
    vignette: 0.32,
    cloudStrength: 0.32,
    lightColor: [0.62, 0.58, 0.94],
    lightStrength: 0.10,
    lightDirection: [-0.82, 0.54],
    pondBedDeep: [0.24, 0.38, 0.46],
    pondBedShallow: [0.08, 0.20, 0.21],
    verticalTone: 0.88,
    edgeDarkening: 0.64,
    waterTint: [0.88, 0.94, 1.02],
    waterCurrentColor: [0.016, 0.048, 0.062],
    waterCurrentCore: [0.038, 0.115, 0.148],
    shadowColor: 0x09141c,
  },
  {
    // 9:00 (540s) - Midnight / Full Moon, ethereal silver-blue glow
    phase: 0.90,
    label: "Moonlight",
    icon: "🌙",
    tint: [0.46, 0.64, 1.02],
    brightness: 0.54,
    contrast: 1.12,
    saturation: 0.74,
    vignette: 0.44,
    cloudStrength: 0.28,
    lightColor: [0.48, 0.72, 1.0],
    lightStrength: 0.16,
    lightDirection: [0.68, 0.74],
    pondBedDeep: [0.10, 0.18, 0.28],
    pondBedShallow: [0.04, 0.10, 0.15],
    verticalTone: 0.92,
    edgeDarkening: 0.68,
    waterTint: [0.82, 0.92, 1.06],
    waterCurrentColor: [0.011, 0.053, 0.071],
    waterCurrentCore: [0.025, 0.115, 0.175],
    shadowColor: 0x040c18,
  },
];

export interface EvaluatedDayNightState {
  label: string;
  icon: string;
  progress: number;
  tint: THREE.Color;
  brightness: number;
  contrast: number;
  saturation: number;
  vignette: number;
  cloudStrength: number;
  lightColor: THREE.Color;
  lightStrength: number;
  lightDirection: THREE.Vector2;
  pondBedDeep: THREE.Color;
  pondBedShallow: THREE.Color;
  verticalTone: number;
  edgeDarkening: number;
  waterTint: THREE.Color;
  waterCurrentColor: THREE.Color;
  waterCurrentCore: THREE.Color;
  shadowColor: THREE.Color;
}

const colorA = new THREE.Color();
const colorB = new THREE.Color();

function lerpColorTriplet(
  target: THREE.Color,
  a: ColorTriplet,
  b: ColorTriplet,
  t: number,
): void {
  colorA.setRGB(a[0], a[1], a[2]);
  colorB.setRGB(b[0], b[1], b[2]);
  target.copy(colorA).lerp(colorB, t);
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function evaluateDayNightCycle(timeInSeconds: number): EvaluatedDayNightState {
  const normTime = ((timeInSeconds % DAY_NIGHT_CYCLE_DURATION) + DAY_NIGHT_CYCLE_DURATION) % DAY_NIGHT_CYCLE_DURATION;
  const cyclePhase = normTime / DAY_NIGHT_CYCLE_DURATION;

  const keyframes = DAY_NIGHT_KEYFRAMES;
  const count = keyframes.length;

  let k1Index = count - 1;
  let k2Index = 0;

  for (let i = 0; i < count; i += 1) {
    const nextIndex = (i + 1) % count;
    const p1 = keyframes[i].phase;
    const p2 = nextIndex === 0 ? 1.0 : keyframes[nextIndex].phase;
    if (cyclePhase >= p1 && cyclePhase <= p2) {
      k1Index = i;
      k2Index = nextIndex;
      break;
    }
  }

  const k1 = keyframes[k1Index];
  const k2 = keyframes[k2Index];
  const p1 = k1.phase;
  const p2 = k2Index === 0 ? 1.0 : k2.phase;
  const rawT = (cyclePhase - p1) / Math.max(0.0001, p2 - p1);
  // Smooth cubic S-curve Hermite interpolation between keyframes
  const t = rawT * rawT * (3.0 - 2.0 * rawT);

  const tint = new THREE.Color();
  lerpColorTriplet(tint, k1.tint, k2.tint, t);

  const lightColor = new THREE.Color();
  lerpColorTriplet(lightColor, k1.lightColor, k2.lightColor, t);

  const pondBedDeep = new THREE.Color();
  lerpColorTriplet(pondBedDeep, k1.pondBedDeep, k2.pondBedDeep, t);

  const pondBedShallow = new THREE.Color();
  lerpColorTriplet(pondBedShallow, k1.pondBedShallow, k2.pondBedShallow, t);

  const waterTint = new THREE.Color();
  lerpColorTriplet(waterTint, k1.waterTint, k2.waterTint, t);

  const waterCurrentColor = new THREE.Color();
  lerpColorTriplet(waterCurrentColor, k1.waterCurrentColor, k2.waterCurrentColor, t);

  const waterCurrentCore = new THREE.Color();
  lerpColorTriplet(waterCurrentCore, k1.waterCurrentCore, k2.waterCurrentCore, t);

  colorA.setHex(k1.shadowColor);
  colorB.setHex(k2.shadowColor);
  const shadowColor = new THREE.Color().copy(colorA).lerp(colorB, t);

  const lightDirection = new THREE.Vector2(
    lerpNum(k1.lightDirection[0], k2.lightDirection[0], t),
    lerpNum(k1.lightDirection[1], k2.lightDirection[1], t),
  ).normalize();

  const label = t < 0.5 ? k1.label : k2.label;
  const icon = t < 0.5 ? k1.icon : k2.icon;

  return {
    label,
    icon,
    progress: cyclePhase,
    tint,
    brightness: lerpNum(k1.brightness, k2.brightness, t),
    contrast: lerpNum(k1.contrast, k2.contrast, t),
    saturation: lerpNum(k1.saturation, k2.saturation, t),
    vignette: lerpNum(k1.vignette, k2.vignette, t),
    cloudStrength: lerpNum(k1.cloudStrength, k2.cloudStrength, t),
    lightColor,
    lightStrength: lerpNum(k1.lightStrength, k2.lightStrength, t),
    lightDirection,
    pondBedDeep,
    pondBedShallow,
    verticalTone: lerpNum(k1.verticalTone, k2.verticalTone, t),
    edgeDarkening: lerpNum(k1.edgeDarkening, k2.edgeDarkening, t),
    waterTint,
    waterCurrentColor,
    waterCurrentCore,
    shadowColor,
  };
}
