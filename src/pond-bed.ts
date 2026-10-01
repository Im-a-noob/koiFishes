import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH, POND_BED } from "./config";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uLightDirection;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSpeckColor;
  uniform float uVerticalTone;
  uniform float uGrainScale;
  uniform float uEdgeDarkening;
  varying vec2 vUv;

  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.5000 * valueNoise(p); p *= 2.02;
    v += 0.2500 * valueNoise(p); p *= 2.03;
    v += 0.1250 * valueNoise(p);
    return v;
  }

  struct StoneResult {
    float d1;
    float d2;
    vec2 cellId;
    float height;
    vec3 normal;
  };

  StoneResult getStones(vec2 uv, float scale) {
    vec2 p = uv * scale;
    vec2 i = floor(p);
    vec2 f = fract(p);

    float d1 = 8.0;
    float d2 = 8.0;
    vec2 bestCell = vec2(0.0);
    vec2 bestCenter = vec2(0.0);

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 h = hash22(i + g);
        vec2 pt = g + 0.14 + 0.72 * h;
        vec2 diff = pt - f;

        // Gentle organic pebble elongation
        float angle = h.x * 3.14159;
        float ca = cos(angle);
        float sa = sin(angle);
        vec2 rDiff = vec2(diff.x * ca - diff.y * sa, diff.x * sa + diff.y * ca);
        float stretch = 0.82 + h.y * 0.40;
        float d = length(rDiff * vec2(1.0, stretch));

        if (d < d1) {
          d2 = d1;
          d1 = d;
          bestCell = i + g;
          bestCenter = pt;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }

    float h = sqrt(max(0.0, 1.0 - pow(clamp(d1 * 1.85, 0.0, 1.0), 2.0)));
    vec2 delta = f - bestCenter;
    vec3 norm = normalize(vec3(-delta.x * 2.8, -delta.y * 2.8, 0.70));

    StoneResult res;
    res.d1 = d1;
    res.d2 = d2;
    res.cellId = bestCell;
    res.height = h;
    res.normal = norm;
    return res;
  }

  vec3 getPebbleColor(vec2 cellId, vec2 uv) {
    vec2 h = hash22(cellId);
    float t = h.x;

    // Palette of natural Japanese river rocks:
    vec3 quartz = vec3(0.88, 0.82, 0.72);        // Warm quartz pebble
    vec3 riverGranite = vec3(0.72, 0.68, 0.62);   // River granite
    vec3 goldenOchre = vec3(0.90, 0.78, 0.56);    // Sunlit river stone
    vec3 riverBasalt = vec3(0.50, 0.52, 0.50);    // River basalt / dark slate
    vec3 riverSandstone = vec3(0.82, 0.65, 0.50); // Terracotta river sandstone

    vec3 c = quartz;
    if (t < 0.25) {
      c = mix(quartz, goldenOchre, h.y);
    } else if (t < 0.50) {
      c = mix(riverGranite, quartz, h.y);
    } else if (t < 0.75) {
      c = mix(riverBasalt, riverGranite, h.y);
    } else {
      c = mix(riverSandstone, goldenOchre, h.y);
    }

    // Mineral specks
    float grain = hash21(floor(uv * 220.0));
    c += (grain - 0.5) * 0.05;
    return c;
  }

  float mapleLeaf(vec2 p, float size) {
    p /= size;
    float r = length(p);
    if (r > 1.25) return 0.0;
    float a = atan(p.y, p.x);
    // 5 pointed lobes of a momiji leaf
    float lobes = 0.52 + 0.38 * cos(5.0 * a) + 0.12 * cos(10.0 * a);
    if (p.y < -0.32 && abs(p.x) < 0.05) return 0.85; // Stem
    return smoothstep(0.0, 0.07, lobes - r);
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = vUv * vec2(aspect, 1.0);

    // 1. Primary River Boulders & Stones
    StoneResult primaryStones = getStones(uv, 7.5);
    // 2. Secondary Fine Pebbles & Gravel
    StoneResult finePebbles = getStones(uv + vec2(3.1, 7.9), 16.5);

    // Composite stone height & normal
    float primaryMask = smoothstep(0.08, 0.28, primaryStones.d2 - primaryStones.d1);
    float stoneHeight = mix(finePebbles.height * 0.65, primaryStones.height, primaryMask);
    vec3 stoneNormal = normalize(mix(finePebbles.normal, primaryStones.normal, primaryMask));

    // Base stone colors
    vec3 colPrimary = getPebbleColor(primaryStones.cellId, uv);
    vec3 colFine = getPebbleColor(finePebbles.cellId + vec2(11.2, 5.7), uv * 2.0);
    vec3 bedBase = mix(colFine, colPrimary, primaryMask);

    // Dark crevices between pebbles (sediment & silt)
    float crevice = min(primaryStones.d2 - primaryStones.d1, finePebbles.d2 - finePebbles.d1);
    float creviceDarkness = smoothstep(0.015, 0.12, crevice);
    bedBase *= mix(0.42, 1.0, creviceDarkness);

    // 3D Sunlit relief shading on stones
    vec3 lightDir = normalize(vec3(-uLightDirection.x, -uLightDirection.y, max(0.35, uLightDirection.z)));
    float diffuse = clamp(dot(stoneNormal, lightDir) * 0.45 + 0.55, 0.0, 1.0);
    vec3 stoneLit = bedBase * diffuse;

    // 2. Submerged Green Moss & Algae
    float mossNoiseVal = fbm(uv * 14.0) * 0.7 + valueNoise(uv * 26.0) * 0.3;
    float mossPatch = smoothstep(0.44, 0.72, mossNoiseVal);
    // Moss clings to upper crown of stones and sheltered crevice shelves
    float mossCling = (1.0 - smoothstep(0.05, 0.35, stoneHeight)) * 0.55 + smoothstep(0.65, 0.95, stoneHeight) * 0.65;
    float mossAmount = clamp(mossPatch * mossCling * 1.5, 0.0, 1.0);

    vec3 deepMoss = vec3(0.18, 0.32, 0.12);      // Velvet forest moss
    vec3 lushMoss = vec3(0.28, 0.48, 0.18);      // Fresh river moss
    vec3 sunlitMoss = vec3(0.52, 0.68, 0.24);    // Sunlit chartreuse-olive moss tips
    float sunDot = clamp(dot(stoneNormal, lightDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 mossColor = mix(deepMoss, lushMoss, sunDot);
    mossColor = mix(mossColor, sunlitMoss, pow(sunDot, 2.0) * 0.65);

    vec3 bedColor = mix(stoneLit, mossColor, mossAmount);

    // 3. Submerged Autumn Maple Leaves (Momiji)
    vec2 leafGrid = uv * 3.6;
    vec2 lCell = floor(leafGrid);
    vec2 lFract = fract(leafGrid);

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 h = hash22(lCell + g + vec2(17.4, 83.1));
        if (h.x < 0.36) { // 36% chance of sunken leaf
          vec2 leafPos = g + 0.25 + 0.50 * h;
          vec2 delta = lFract - leafPos;
          float rot = h.y * 6.28;
          mat2 rMat = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
          vec2 rDelta = rMat * delta;

          float leafScale = 0.20 + h.x * 0.10;
          float leaf = mapleLeaf(rDelta, leafScale);

          if (leaf > 0.01) {
            // Amber russet and golden ochre leaf colors
            vec3 leafCol = mix(vec3(0.86, 0.48, 0.14), vec3(0.72, 0.26, 0.08), h.y);
            leafCol = mix(leafCol, vec3(0.94, 0.68, 0.18), (1.0 - h.x));
            float vein = smoothstep(0.012, 0.002, abs(rDelta.x) * (rDelta.y + 0.18));
            leafCol += vein * 0.10;

            // Leaf drop shadow
            vec2 shadowDelta = rDelta + vec2(-lightDir.x, -lightDir.y) * 0.04;
            float lShadow = mapleLeaf(shadowDelta, leafScale * 1.05) * 0.45;
            bedColor *= (1.0 - lShadow * (1.0 - leaf));
            bedColor = mix(bedColor, leafCol, leaf * 0.94);
          }
        }
      }
    }

    // 4. Subtle Submerged Water Weeds
    float weedNoise = sin(uv.x * 8.0 + uTime * 0.45) * cos(uv.y * 6.0 - uTime * 0.35);
    float weedMask = smoothstep(0.78, 0.95, valueNoise(uv * 10.0 + vec2(weedNoise * 0.1, 0.0)));
    vec3 weedColor = vec3(0.14, 0.38, 0.22);
    bedColor = mix(bedColor, weedColor, weedMask * 0.45);

    // 5. Beer-Lambert Optical Depth Extinction
    // Shallow sunlit sandbars & high boulder tops keep warm golden clarity
    // Deep crevices and bottom pool fade to deep emerald-cyan
    float depthLevel = 0.22 + (1.0 - vUv.y) * 0.42;
    depthLevel += (1.0 - stoneHeight) * 0.38;
    float edgeDepth = smoothstep(0.45, 0.85, length((vUv - 0.5) * vec2(1.0, 1.25)));
    depthLevel += edgeDepth * uEdgeDarkening * 0.45;

    // Spectral absorption: Red light is absorbed ~8x faster than green/blue in water
    vec3 sigmaAbsorb = vec3(1.48, 0.54, 0.16);
    vec3 waterTransmission = exp(-sigmaAbsorb * depthLevel * 1.6);
    vec3 deepCyanScatter = mix(uDeepColor, vec3(0.06, 0.30, 0.34), 0.68);

    vec3 finalColor = bedColor * waterTransmission + deepCyanScatter * (1.0 - waterTransmission.y) * 0.70;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

interface RuntimePondBedAppearance {
  deepColor: THREE.Color;
  shallowColor: THREE.Color;
  speckColor: THREE.Color;
  verticalTone: number;
  grainScale: number;
  edgeDarkening: number;
}

function pondBedAppearanceFromConfig(): RuntimePondBedAppearance {
  return {
    deepColor: new THREE.Color().setRGB(...POND_BED.deepColor),
    shallowColor: new THREE.Color().setRGB(...POND_BED.shallowColor),
    speckColor: new THREE.Color().setRGB(...POND_BED.speckColor),
    verticalTone: POND_BED.verticalTone,
    grainScale: POND_BED.grainScale,
    edgeDarkening: POND_BED.edgeDarkening,
  };
}

export class PondBedPass {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;

  private readonly material: THREE.MeshLambertMaterial;
  private readonly uniforms: {
    uResolution: THREE.IUniform<THREE.Vector2>;
    uTime: THREE.IUniform<number>;
    uDeepColor: THREE.IUniform<THREE.Color>;
    uShallowColor: THREE.IUniform<THREE.Color>;
    uSpeckColor: THREE.IUniform<THREE.Color>;
    uVerticalTone: THREE.IUniform<number>;
    uGrainScale: THREE.IUniform<number>;
    uEdgeDarkening: THREE.IUniform<number>;
  };
  private readonly currentAppearance = pondBedAppearanceFromConfig();
  private targetAppearance = pondBedAppearanceFromConfig();
  private previousTime = -1;

  public constructor() {
    this.uniforms = {
      uResolution: { value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT) },
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color() },
      uShallowColor: { value: new THREE.Color() },
      uSpeckColor: { value: new THREE.Color() },
      uVerticalTone: { value: 0 },
      uGrainScale: { value: 0 },
      uEdgeDarkening: { value: 0 },
    };

    this.material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });

    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n  vUvCustom = uv;'
      );
      shader.vertexShader = 'varying vec2 vUvCustom;\n' + shader.vertexShader;

      const proceduralHeader = /* glsl */ `
        uniform vec2 uResolution;
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uSpeckColor;
        uniform float uVerticalTone;
        uniform float uGrainScale;
        uniform float uEdgeDarkening;
        varying vec2 vUvCustom;

        vec2 hash22(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          v += 0.5000 * valueNoise(p); p *= 2.02;
          v += 0.2500 * valueNoise(p); p *= 2.03;
          v += 0.1250 * valueNoise(p);
          return v;
        }

        struct StoneResult {
          float d1;
          float d2;
          vec2 cellId;
          float height;
          vec3 normal;
        };

        StoneResult getStones(vec2 uv, float scale) {
          vec2 p = uv * scale;
          vec2 i = floor(p);
          vec2 f = fract(p);

          float d1 = 8.0;
          float d2 = 8.0;
          vec2 bestCell = vec2(0.0);
          vec2 bestCenter = vec2(0.0);

          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 h = hash22(i + g);
              vec2 pt = g + 0.14 + 0.72 * h;
              vec2 diff = pt - f;

              float angle = h.x * 3.14159;
              float ca = cos(angle);
              float sa = sin(angle);
              vec2 rDiff = vec2(diff.x * ca - diff.y * sa, diff.x * sa + diff.y * ca);
              float stretch = 0.82 + h.y * 0.40;
              float d = length(rDiff * vec2(1.0, stretch));

              if (d < d1) {
                d2 = d1;
                d1 = d;
                bestCell = i + g;
                bestCenter = pt;
              } else if (d < d2) {
                d2 = d;
              }
            }
          }

          float h = sqrt(max(0.0, 1.0 - pow(clamp(d1 * 1.85, 0.0, 1.0), 2.0)));
          vec2 delta = f - bestCenter;
          vec3 norm = normalize(vec3(-delta.x * 2.8, -delta.y * 2.8, 0.70));

          StoneResult res;
          res.d1 = d1;
          res.d2 = d2;
          res.cellId = bestCell;
          res.height = h;
          res.normal = norm;
          return res;
        }

        vec3 getPebbleColor(vec2 cellId, vec2 uv) {
          vec2 h = hash22(cellId);
          float t = h.x;

          vec3 quartz = vec3(0.88, 0.82, 0.72);
          vec3 riverGranite = vec3(0.72, 0.68, 0.62);
          vec3 goldenOchre = vec3(0.90, 0.78, 0.56);
          vec3 riverBasalt = vec3(0.50, 0.52, 0.50);
          vec3 riverSandstone = vec3(0.82, 0.65, 0.50);

          vec3 c = quartz;
          if (t < 0.25) {
            c = mix(quartz, goldenOchre, h.y);
          } else if (t < 0.50) {
            c = mix(riverGranite, quartz, h.y);
          } else if (t < 0.75) {
            c = mix(riverBasalt, riverGranite, h.y);
          } else {
            c = mix(riverSandstone, goldenOchre, h.y);
          }

          float grain = hash21(floor(uv * 220.0));
          c += (grain - 0.5) * 0.05;
          return c;
        }

        float mapleLeaf(vec2 p, float size) {
          p /= size;
          float r = length(p);
          if (r > 1.25) return 0.0;
          float a = atan(p.y, p.x);
          float lobes = 0.52 + 0.38 * cos(5.0 * a) + 0.12 * cos(10.0 * a);
          if (p.y < -0.32 && abs(p.x) < 0.05) return 0.85;
          return smoothstep(0.0, 0.07, lobes - r);
        }

        vec3 computeRiverbedColor(vec2 vUv) {
          float aspect = uResolution.x / uResolution.y;
          vec2 uv = vUv * vec2(aspect, 1.0);

          StoneResult primaryStones = getStones(uv, 7.5);
          StoneResult finePebbles = getStones(uv + vec2(3.1, 7.9), 16.5);

          float primaryMask = smoothstep(0.08, 0.28, primaryStones.d2 - primaryStones.d1);
          float stoneHeight = mix(finePebbles.height * 0.65, primaryStones.height, primaryMask);
          vec3 stoneNormal = normalize(mix(finePebbles.normal, primaryStones.normal, primaryMask));

          vec3 colPrimary = getPebbleColor(primaryStones.cellId, uv);
          vec3 colFine = getPebbleColor(finePebbles.cellId + vec2(11.2, 5.7), uv * 2.0);
          vec3 bedBase = mix(colFine, colPrimary, primaryMask);

          float crevice = min(primaryStones.d2 - primaryStones.d1, finePebbles.d2 - finePebbles.d1);
          float creviceDarkness = smoothstep(0.015, 0.12, crevice);
          bedBase *= mix(0.42, 1.0, creviceDarkness);

          vec3 lightDir = normalize(vec3(0.5, -0.6, 0.7));
          float diffuse = clamp(dot(stoneNormal, lightDir) * 0.45 + 0.55, 0.0, 1.0);
          vec3 stoneLit = bedBase * diffuse;

          float mossNoiseVal = fbm(uv * 14.0) * 0.7 + valueNoise(uv * 26.0) * 0.3;
          float mossPatch = smoothstep(0.44, 0.72, mossNoiseVal);
          float mossCling = (1.0 - smoothstep(0.05, 0.35, stoneHeight)) * 0.55 + smoothstep(0.65, 0.95, stoneHeight) * 0.65;
          float mossAmount = clamp(mossPatch * mossCling * 1.5, 0.0, 1.0);

          vec3 deepMoss = vec3(0.18, 0.32, 0.12);
          vec3 lushMoss = vec3(0.28, 0.48, 0.18);
          vec3 sunlitMoss = vec3(0.52, 0.68, 0.24);
          float sunDot = clamp(dot(stoneNormal, lightDir) * 0.5 + 0.5, 0.0, 1.0);
          vec3 mossColor = mix(deepMoss, lushMoss, sunDot);
          mossColor = mix(mossColor, sunlitMoss, pow(sunDot, 2.0) * 0.65);

          vec3 bedColor = mix(stoneLit, mossColor, mossAmount);

          vec2 leafGrid = uv * 3.6;
          vec2 lCell = floor(leafGrid);
          vec2 lFract = fract(leafGrid);

          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 h = hash22(lCell + g + vec2(17.4, 83.1));
              if (h.x < 0.36) {
                vec2 leafPos = g + 0.25 + 0.50 * h;
                vec2 delta = lFract - leafPos;
                float rot = h.y * 6.28;
                mat2 rMat = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
                vec2 rDelta = rMat * delta;

                float leafScale = 0.20 + h.x * 0.10;
                float leaf = mapleLeaf(rDelta, leafScale);

                if (leaf > 0.01) {
                  vec3 leafCol = mix(vec3(0.86, 0.48, 0.14), vec3(0.72, 0.26, 0.08), h.y);
                  leafCol = mix(leafCol, vec3(0.94, 0.68, 0.18), (1.0 - h.x));
                  float vein = smoothstep(0.012, 0.002, abs(rDelta.x) * (rDelta.y + 0.18));
                  leafCol += vein * 0.10;

                  vec2 shadowDelta = rDelta + vec2(-lightDir.x, -lightDir.y) * 0.04;
                  float lShadow = mapleLeaf(shadowDelta, leafScale * 1.05) * 0.45;
                  bedColor *= (1.0 - lShadow * (1.0 - leaf));
                  bedColor = mix(bedColor, leafCol, leaf * 0.94);
                }
              }
            }
          }

          float weedNoise = sin(uv.x * 8.0 + uTime * 0.45) * cos(uv.y * 6.0 - uTime * 0.35);
          float weedMask = smoothstep(0.78, 0.95, valueNoise(uv * 10.0 + vec2(weedNoise * 0.1, 0.0)));
          vec3 weedColor = vec3(0.14, 0.38, 0.22);
          bedColor = mix(bedColor, weedColor, weedMask * 0.45);

          float depthLevel = 0.22 + (1.0 - vUv.y) * 0.42;
          depthLevel += (1.0 - stoneHeight) * 0.38;
          float edgeDepth = smoothstep(0.45, 0.85, length((vUv - 0.5) * vec2(1.0, 1.25)));
          depthLevel += edgeDepth * uEdgeDarkening * 0.45;

          vec3 sigmaAbsorb = vec3(1.48, 0.54, 0.16);
          vec3 waterTransmission = exp(-sigmaAbsorb * depthLevel * 1.6);
          vec3 deepCyanScatter = mix(uDeepColor, vec3(0.06, 0.30, 0.34), 0.68);

          return bedColor * waterTransmission + deepCyanScatter * (1.0 - waterTransmission.y) * 0.70;
        }
      `;

      shader.fragmentShader = proceduralHeader + '\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( computeRiverbedColor(vUvCustom), opacity );'
      );
    };

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CANVAS_WIDTH, CANVAS_HEIGHT),
      this.material,
    );
    this.mesh.position.set(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, -16);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    this.applyUniforms();
  }

  public refreshConfig(): void {
    this.targetAppearance = pondBedAppearanceFromConfig();
  }

  public setDayNightAppearance(
    deepColor: THREE.Color,
    shallowColor: THREE.Color,
    verticalTone: number,
    edgeDarkening: number,
  ): void {
    this.targetAppearance.deepColor.copy(deepColor);
    this.targetAppearance.shallowColor.copy(shallowColor);
    this.targetAppearance.verticalTone = verticalTone;
    this.targetAppearance.edgeDarkening = edgeDarkening;
  }

  public resize(width: number, height: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height);
    this.mesh.position.set(width * 0.5, height * 0.5, -16);
    this.uniforms.uResolution.value.set(width, height);
  }

  public update(time: number, _lightDir?: THREE.Vector3): void {
    this.uniforms.uTime.value = time;
    if (this.previousTime >= 0) {
      const deltaTime = Math.min(0.1, Math.max(0, time - this.previousTime));
      const blend = 1 - Math.exp(-deltaTime * 2.25);
      const current = this.currentAppearance;
      const target = this.targetAppearance;
      current.deepColor.lerp(target.deepColor, blend);
      current.shallowColor.lerp(target.shallowColor, blend);
      current.speckColor.lerp(target.speckColor, blend);
      current.verticalTone +=
        (target.verticalTone - current.verticalTone) * blend;
      current.grainScale += (target.grainScale - current.grainScale) * blend;
      current.edgeDarkening +=
        (target.edgeDarkening - current.edgeDarkening) * blend;
    }
    this.previousTime = time;
    this.applyUniforms();
  }

  private applyUniforms(): void {
    const current = this.currentAppearance;
    this.uniforms.uDeepColor.value.copy(current.deepColor);
    this.uniforms.uShallowColor.value.copy(current.shallowColor);
    this.uniforms.uSpeckColor.value.copy(current.speckColor);
    this.uniforms.uVerticalTone.value = current.verticalTone;
    this.uniforms.uGrainScale.value = current.grainScale;
    this.uniforms.uEdgeDarkening.value = current.edgeDarkening;
  }
}
