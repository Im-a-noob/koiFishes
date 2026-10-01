import * as THREE from "three";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  KOI_PALETTES,
  MAX_FISH,
  SPINE_NODES,
  WATER,
} from "./config";
import { ButterflyPass } from "./butterflies";
import { DragonflyPass } from "./dragonfly";
import { DuckweedPass } from "./duckweed";
import {
  createFishAppearance,
  patchesFor,
  type FishAppearance,
} from "./fish-appearance";
import { Koi, SwimState } from "./koi";
import { LotusLeavesPass } from "./lotus-leaves";
import {
  add,
  clamp,
  fromAngle,
  lerp,
  mul,
  normalize,
  perpendicular,
  sub,
  type Vec2,
} from "./math";
import { FloatingPetalsPass, type PetalType } from "./floating-petals";
import { PondBedPass } from "./pond-bed";
import { School } from "./school";
import { SurfaceDisturbancePass } from "./surface-disturbance";
import { TinyFishRenderer } from "./tiny-fish-renderer";
import { WaterSurfacePass } from "./water-surface";
import { WeatherPass } from "./weather-pass";
import type { WeatherPresetId } from "./weather";
import {
  DAY_NIGHT_CYCLE_DURATION,
  evaluateDayNightCycle,
  type EvaluatedDayNightState,
} from "./day-night-cycle";

const TRIANGLE_FLOAT_CAPACITY = 360_000;
const LINE_FLOAT_CAPACITY = 36_000;
const DEFAULT_COLOR = new THREE.Color(0xffffff);

const shadowVertexShader = /* glsl */ `
  varying float vStrength;
  void main() {
    vStrength = color.r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shadowFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vStrength;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vStrength);
  }
`;

function shadowMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(FISH.shadow.color) },
      uOpacity: { value: opacity },
    },
    vertexShader: shadowVertexShader,
    fragmentShader: shadowFragmentShader,
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

const fishVertexShader = /* glsl */ `
  varying vec4 vColor;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    #if defined( USE_COLOR_ALPHA )
      vColor = color;
    #elif defined( USE_COLOR )
      vColor = vec4(color, 1.0);
    #else
      vColor = vec4(1.0);
    #endif

    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fishFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uLightDirection;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientColor;
  uniform float uTime;
  varying vec4 vColor;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    if (vColor.a <= 0.05) discard;

    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightDirection);
    vec3 V = normalize(vViewPosition);
    vec3 H = normalize(L + V);

    // Half-Lambert wrap diffuse for organic, translucent aquatic skin
    float NdotL = dot(N, L);
    float wrapDiffuse = clamp(NdotL * 0.52 + 0.48, 0.0, 1.0);

    // Subtle skylight ambient gradient from water surface above (+Z)
    float skylight = clamp(N.z * 0.35 + 0.65, 0.25, 1.0);

    // Wet scale specular highlight (gives the distinct glistening 3D koi sheen)
    float specBase = clamp(dot(N, H), 0.0, 1.0);
    float specular = pow(specBase, 32.0) * 0.72;

    // Subsurface translucency (dorsal crest and fin edges glow when backlit)
    float backScatter = clamp(dot(-N, L), 0.0, 1.0) * 0.24;

    // Sunlight caustics dancing on the dorsal back and fins
    vec2 cCoord = vViewPosition.xy * 0.048;
    vec2 cMove1 = cCoord + vec2(uTime * 0.042, uTime * 0.024);
    vec2 cMove2 = cCoord * 1.38 - vec2(uTime * 0.035, -uTime * 0.041);
    float cLine1 = pow(clamp(1.0 - abs(sin(cMove1.x * 6.28) * cos(cMove1.y * 6.28)) * 2.2, 0.0, 1.0), 3.0);
    float cLine2 = pow(clamp(1.0 - abs(sin(cMove2.x * 6.28 + 1.2) * cos(cMove2.y * 6.28)) * 2.2, 0.0, 1.0), 3.0);
    float causticIntensity = (cLine1 + cLine2 * 0.85 + cLine1 * cLine2 * 2.5);
    float topExposure = clamp(N.z * 0.75 + 0.25, 0.0, 1.0);
    vec3 causticOnFish = uSunColor * (causticIntensity * topExposure * 0.48);

    vec3 lighting = uAmbientColor * skylight + uSunColor * (wrapDiffuse + backScatter) + causticOnFish;
    vec3 litColor = vColor.rgb * lighting + vec3(specular * 0.8);

    gl_FragColor = vec4(litColor, vColor.a);
  }
`;

function createFishMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDirection: { value: new THREE.Vector3(-0.45, 0.65, 0.75).normalize() },
      uSunColor: { value: new THREE.Color(0xfff8ee) },
      uAmbientColor: { value: new THREE.Color(0x607870) },
      uTime: { value: 0 },
    },
    vertexShader: fishVertexShader,
    fragmentShader: fishFragmentShader,
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

function createReflectionMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDirection: { value: new THREE.Vector3(-0.45, 0.65, 0.75).normalize() },
      uSunColor: { value: new THREE.Color(0xfff8ee) },
      uAmbientColor: { value: new THREE.Color(0x607870) },
      uTime: { value: 0 },
    },
    vertexShader: fishVertexShader,
    fragmentShader: fishFragmentShader,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

const blurVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const blurFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec2 uDirection;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    vec2 texel = uDirection * uRadius;
    vec4 c0  = texture2D(uTexture, vUv);
    vec4 c1p = texture2D(uTexture, vUv + texel * 1.3333333);
    vec4 c1m = texture2D(uTexture, vUv - texel * 1.3333333);
    vec4 c2p = texture2D(uTexture, vUv + texel * 3.1111111);
    vec4 c2m = texture2D(uTexture, vUv - texel * 3.1111111);

    float k0 = 0.2734375;
    float k1 = 0.328125;
    float k2 = 0.03515625;

    // Weight color samples strictly by alpha to prevent transparent black background from darkening the fish
    float w0  = k0 * c0.a;
    float w1p = k1 * c1p.a;
    float w1m = k1 * c1m.a;
    float w2p = k2 * c2p.a;
    float w2m = k2 * c2m.a;
    float totalColorWeight = w0 + w1p + w1m + w2p + w2m;

    float blurredAlpha = c0.a * k0 + (c1p.a + c1m.a) * k1 + (c2p.a + c2m.a) * k2;

    if (totalColorWeight > 0.0001 && blurredAlpha > 0.001) {
      vec3 color = (c0.rgb * w0 + c1p.rgb * w1p + c1m.rgb * w1m + c2p.rgb * w2p + c2m.rgb * w2m) / totalColorWeight;
      gl_FragColor = vec4(color, blurredAlpha);
    } else {
      gl_FragColor = vec4(0.0);
    }
  }
`;

const deepCompositeFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uTexture;
  varying vec2 vUv;

  void main() {
    vec4 col = texture2D(uTexture, vUv);
    if (col.a <= 0.001) discard;
    gl_FragColor = col;
  }
`;

class GeometryBatch {
  private readonly values: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private readonly colorValues?: Float32Array;
  private readonly colorAttribute?: THREE.BufferAttribute;
  private readonly normalValues?: Float32Array;
  private readonly normalAttribute?: THREE.BufferAttribute;
  private cursor = 0;
  private previewOrigin: Vec2 | null = null;
  private previewScale = 1;

  public constructor(
    private readonly geometry: THREE.BufferGeometry,
    capacity: number,
    includeColors = false,
    includeNormals = true,
  ) {
    this.values = new Float32Array(capacity);
    this.attribute = new THREE.BufferAttribute(this.values, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.attribute);
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT) * 2,
    );
    if (includeColors) {
      this.colorValues = new Float32Array((capacity / 3) * 4);
      this.colorAttribute = new THREE.BufferAttribute(this.colorValues, 4);
      this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute("color", this.colorAttribute);
    }
    if (includeNormals) {
      this.normalValues = new Float32Array(capacity);
      this.normalAttribute = new THREE.BufferAttribute(this.normalValues, 3);
      this.normalAttribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute("normal", this.normalAttribute);
    }
  }

  public get hasContent(): boolean {
    return this.cursor > 0;
  }

  public reset(): void {
    this.cursor = 0;
  }

  public setPreviewTransform(origin: Vec2 | null, scale = 1): void {
    this.previewOrigin = origin;
    this.previewScale = scale;
  }

  public point3D(
    x: number,
    y: number,
    z: number,
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
    nx = 0,
    ny = 0,
    nz = 1,
  ): void {
    if (this.cursor + 3 > this.values.length) return;
    const vertexIndex = this.cursor / 3;
    this.values[this.cursor] = this.previewOrigin
      ? CANVAS_WIDTH * 0.5 + (x - this.previewOrigin.x) * this.previewScale
      : x;
    this.values[this.cursor + 1] = this.previewOrigin
      ? CANVAS_HEIGHT * 0.5 + (y - this.previewOrigin.y) * this.previewScale
      : y;
    this.values[this.cursor + 2] = this.previewOrigin
      ? z * this.previewScale
      : z;

    if (this.colorValues) {
      const colorIndex = vertexIndex * 4;
      this.colorValues[colorIndex] = color.r;
      this.colorValues[colorIndex + 1] = color.g;
      this.colorValues[colorIndex + 2] = color.b;
      this.colorValues[colorIndex + 3] = alpha;
    }
    if (this.normalValues) {
      this.normalValues[this.cursor] = nx;
      this.normalValues[this.cursor + 1] = ny;
      this.normalValues[this.cursor + 2] = nz;
    }
    this.cursor += 3;
  }

  public point(point: Vec2, color: THREE.Color = DEFAULT_COLOR, alpha = 1): void {
    this.point3D(point.x, point.y, 0, color, alpha, 0, 0, 1);
  }

  public triangle(
    a: Vec2,
    b: Vec2,
    c: Vec2,
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
  ): void {
    if (this.cursor + 9 > this.values.length) return;
    this.point(a, color, alpha);
    this.point(b, color, alpha);
    this.point(c, color, alpha);
  }

  public triangle3D(
    p0: { x: number; y: number; z: number },
    p1: { x: number; y: number; z: number },
    p2: { x: number; y: number; z: number },
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
    n0?: { x: number; y: number; z: number },
    n1?: { x: number; y: number; z: number },
    n2?: { x: number; y: number; z: number },
    c0?: THREE.Color,
    c1?: THREE.Color,
    c2?: THREE.Color,
  ): void {
    if (this.cursor + 9 > this.values.length) return;
    let norm0 = n0;
    let norm1 = n1;
    let norm2 = n2;
    if (!norm0 || !norm1 || !norm2) {
      const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
      const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
      let fnx = ay * bz - az * by;
      let fny = az * bx - ax * bz;
      let fnz = ax * by - ay * bx;
      const len = Math.hypot(fnx, fny, fnz) || 1;
      fnx /= len; fny /= len; fnz /= len;
      const computed = { x: fnx, y: fny, z: fnz };
      norm0 = norm0 || computed;
      norm1 = norm1 || computed;
      norm2 = norm2 || computed;
    }
    const col0 = c0 || color;
    const col1 = c1 || color;
    const col2 = c2 || color;
    this.point3D(p0.x, p0.y, p0.z, col0, alpha, norm0.x, norm0.y, norm0.z);
    this.point3D(p1.x, p1.y, p1.z, col1, alpha, norm1.x, norm1.y, norm1.z);
    this.point3D(p2.x, p2.y, p2.z, col2, alpha, norm2.x, norm2.y, norm2.z);
  }

  public quad3D(
    p0: { x: number; y: number; z: number },
    p1: { x: number; y: number; z: number },
    p2: { x: number; y: number; z: number },
    p3: { x: number; y: number; z: number },
    c0: THREE.Color,
    c1: THREE.Color,
    c2: THREE.Color,
    c3: THREE.Color,
    alpha = 1,
    n0?: { x: number; y: number; z: number },
    n1?: { x: number; y: number; z: number },
    n2?: { x: number; y: number; z: number },
    n3?: { x: number; y: number; z: number },
  ): void {
    if (this.cursor + 18 > this.values.length) return;
    this.triangle3D(p0, p1, p2, c0, alpha, n0, n1, n2, c0, c1, c2);
    this.triangle3D(p0, p2, p3, c0, alpha, n0, n2, n3, c0, c2, c3);
  }

  public line(
    a: Vec2,
    b: Vec2,
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
  ): void {
    if (this.cursor + 6 > this.values.length) return;
    this.point(a, color, alpha);
    this.point(b, color, alpha);
  }

  public circle(
    center: Vec2,
    radius: number,
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
    segments = 12,
  ): void {
    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      this.triangle(
        center,
        add(center, mul(fromAngle(angleA), radius)),
        add(center, mul(fromAngle(angleB), radius)),
        color,
        alpha,
      );
    }
  }

  public ellipse(
    center: Vec2,
    forward: Vec2,
    normal: Vec2,
    forwardRadius: number,
    sideRadius: number,
    color: THREE.Color,
    phase: number,
    alpha = 1,
    segments = 10,
  ): void {
    const pointAt = (angle: number): Vec2 => {
      const wobble =
        1 +
        Math.sin(angle * 3 + phase) * 0.08 +
        Math.cos(angle * 2 - phase * 0.7) * 0.045;
      return add(
        add(center, mul(forward, Math.cos(angle) * forwardRadius * wobble)),
        mul(normal, Math.sin(angle) * sideRadius * wobble),
      );
    };

    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      this.triangle(center, pointAt(angleA), pointAt(angleB), color, alpha);
    }
  }

  public commit(): void {
    const vertexCount = this.cursor / 3;
    this.geometry.setDrawRange(0, vertexCount);
    this.attribute.clearUpdateRanges();
    this.attribute.addUpdateRange(0, this.cursor);
    this.attribute.needsUpdate = true;
    if (this.colorAttribute) {
      this.colorAttribute.clearUpdateRanges();
      this.colorAttribute.addUpdateRange(0, vertexCount * 4);
      this.colorAttribute.needsUpdate = true;
    }
    if (this.normalAttribute) {
      this.normalAttribute.clearUpdateRanges();
      this.normalAttribute.addUpdateRange(0, this.cursor);
      this.normalAttribute.needsUpdate = true;
    }
  }
}

export class FishRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly bedGroup = new THREE.Group();
  private readonly fishGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly surfaceGroup = new THREE.Group();
  private readonly atmosphereGroup = new THREE.Group();
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly camera = new THREE.OrthographicCamera(
    0,
    CANVAS_WIDTH,
    0,
    CANVAS_HEIGHT,
    -500,
    500,
  );
  private readonly surfaceCamera = new THREE.Camera();
  private readonly underwaterTarget: THREE.WebGLRenderTarget;
  private readonly compositeTarget: THREE.WebGLRenderTarget;
  private readonly pondBed: PondBedPass;
  private readonly surfaceDisturbance = new SurfaceDisturbancePass();
  private readonly waterSurface: WaterSurfacePass;
  private readonly weather: WeatherPass;
  private readonly tinyFishRenderer = new TinyFishRenderer();
  private readonly duckweed = new DuckweedPass();
  private readonly lotusLeaves = new LotusLeavesPass();
  public readonly floatingPetals = new FloatingPetalsPass();
  private foodPelletsSceneAdded = false;
  private siltParticlesSceneAdded = false;
  private readonly butterflies = new ButterflyPass();
  private readonly dragonfly = new DragonflyPass();
  private readonly shallowFishMaterial: THREE.ShaderMaterial;
  private readonly deepFishMaterial: THREE.ShaderMaterial;
  private readonly deepOuterTriangles: GeometryBatch;
  private readonly deepBodyTriangles: GeometryBatch;
  private readonly deepOutlineLines: GeometryBatch;
  private readonly deepReflectionTriangles: GeometryBatch;
  private readonly shallowOuterTriangles: GeometryBatch;
  private readonly shallowBodyTriangles: GeometryBatch;
  private readonly shallowOutlineLines: GeometryBatch;
  private readonly shallowReflectionTriangles: GeometryBatch;
  private currentTime = 0;
  private dayNightCycleEnabled = true;
  private dayNightTimeOffset = 0;
  private is3DViewEnabled = false;
  private cameraTilt = 0;
  private readonly appearances = Array.from(
    { length: MAX_FISH },
    (_, index) => createFishAppearance(index),
  );
  private readonly depthAppearances = Array.from(
    { length: MAX_FISH },
    (_, index) => createFishAppearance(index),
  );
  private readonly shadowStrengthColor = new THREE.Color();
  private readonly targetFishShadowColor = new THREE.Color(FISH.shadow.color);
  private readonly currentLightDirection = new THREE.Vector2(-0.58, 0.82);
  private currentSunAltitude = 0.85;
  private previousAppearanceTime = -1;
  private currentVisualDepth = 0;
  private previewFamilyIndex: number | null = null;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.underwaterTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.underwaterTarget.texture.generateMipmaps = false;

    this.compositeTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.compositeTarget.texture.generateMipmaps = false;

    this.pondBed = new PondBedPass();
    this.waterSurface = new WaterSurfacePass(
      this.underwaterTarget.texture,
      this.surfaceDisturbance.texture,
    );
    this.weather = new WeatherPass(this.compositeTarget.texture);

    // 1 Master Scene: Assemble logical layer groups
    this.scene.add(this.bedGroup);
    this.scene.add(this.fishGroup);
    this.scene.add(this.waterGroup);
    this.scene.add(this.surfaceGroup);
    this.scene.add(this.atmosphereGroup);

    // True GPU Sun Light & Soft Shadow Setup
    this.sunLight = new THREE.DirectionalLight(0xfff8ee, 1.35);
    this.sunLight.position.set(-150, -250, 320);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 1000;
    this.sunLight.shadow.camera.left = -CANVAS_WIDTH * 0.75;
    this.sunLight.shadow.camera.right = CANVAS_WIDTH * 0.75;
    this.sunLight.shadow.camera.top = CANVAS_HEIGHT * 0.75;
    this.sunLight.shadow.camera.bottom = -CANVAS_HEIGHT * 0.75;
    this.sunLight.shadow.bias = -0.0015;
    this.sunLight.shadow.radius = 3.2; // Soft PCF shadow
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.ambientLight = new THREE.AmbientLight(0x567066, 0.85);
    this.scene.add(this.ambientLight);

    // Add pond bed to bedGroup (Z = -16, receives real 3D shadows!)
    this.bedGroup.add(this.pondBed.mesh);

    // Water surface plane at Z = 0
    this.waterGroup.add(this.waterSurface.mesh);

    // Surface floating objects
    this.lotusLeaves.group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = true;
      }
    });
    this.surfaceGroup.add(
      this.duckweed.group,
      this.floatingPetals.group,
      this.lotusLeaves.group,
    );

    // Atmospheric flying insects and weather
    this.atmosphereGroup.add(
      this.butterflies.group,
      this.dragonfly.group,
      this.weather.mesh,
    );

    // Deep fish layer geometry and meshes
    const deepWhiteGeometry = new THREE.BufferGeometry();
    const deepBlackGeometry = new THREE.BufferGeometry();
    const deepLineGeometry = new THREE.BufferGeometry();
    const deepReflectionGeometry = new THREE.BufferGeometry();
    deepWhiteGeometry.name = "deep fish silhouettes";
    deepBlackGeometry.name = "deep fish markings";
    deepLineGeometry.name = "deep fish debug lines";
    deepReflectionGeometry.name = "deep fish reflections";
    this.deepFishMaterial = createFishMaterial();
    this.shallowFishMaterial = createFishMaterial();

    this.deepOuterTriangles = new GeometryBatch(deepWhiteGeometry, TRIANGLE_FLOAT_CAPACITY, true, true);
    this.deepBodyTriangles = new GeometryBatch(deepBlackGeometry, TRIANGLE_FLOAT_CAPACITY, true, true);
    this.deepOutlineLines = new GeometryBatch(deepLineGeometry, LINE_FLOAT_CAPACITY, true, false);
    this.deepReflectionTriangles = new GeometryBatch(deepReflectionGeometry, TRIANGLE_FLOAT_CAPACITY, true, true);

    const deepOuterMesh = new THREE.Mesh(deepWhiteGeometry, this.deepFishMaterial);
    const deepBodyMesh = new THREE.Mesh(deepBlackGeometry, this.deepFishMaterial);
    const deepLines = new THREE.LineSegments(deepLineGeometry, this.deepFishMaterial);
    const deepReflectionMesh = new THREE.Mesh(deepReflectionGeometry, createReflectionMaterial());
    deepOuterMesh.frustumCulled = false;
    deepBodyMesh.frustumCulled = false;
    deepLines.frustumCulled = false;
    deepReflectionMesh.frustumCulled = false;
    deepOuterMesh.renderOrder = 1;
    deepBodyMesh.renderOrder = 2;
    deepLines.renderOrder = 3;
    deepReflectionMesh.renderOrder = 4;

    // Shallow fish layer geometry and meshes
    const whiteGeometry = new THREE.BufferGeometry();
    const blackGeometry = new THREE.BufferGeometry();
    const lineGeometry = new THREE.BufferGeometry();
    const shallowReflectionGeometry = new THREE.BufferGeometry();
    whiteGeometry.name = "fish silhouettes";
    blackGeometry.name = "fish markings";
    lineGeometry.name = "fish debug lines";
    shallowReflectionGeometry.name = "shallow fish reflections";
    this.shallowOuterTriangles = new GeometryBatch(whiteGeometry, TRIANGLE_FLOAT_CAPACITY, true, true);
    this.shallowBodyTriangles = new GeometryBatch(blackGeometry, TRIANGLE_FLOAT_CAPACITY, true, true);
    this.shallowOutlineLines = new GeometryBatch(lineGeometry, LINE_FLOAT_CAPACITY, true, false);
    this.shallowReflectionTriangles = new GeometryBatch(shallowReflectionGeometry, TRIANGLE_FLOAT_CAPACITY, true, true);

    const outerMesh = new THREE.Mesh(whiteGeometry, this.shallowFishMaterial);
    const bodyMesh = new THREE.Mesh(blackGeometry, this.shallowFishMaterial);
    const lines = new THREE.LineSegments(lineGeometry, this.shallowFishMaterial);
    const shallowReflectionMesh = new THREE.Mesh(shallowReflectionGeometry, createReflectionMaterial());
    outerMesh.frustumCulled = false;
    bodyMesh.frustumCulled = false;
    lines.frustumCulled = false;
    shallowReflectionMesh.frustumCulled = false;
    outerMesh.renderOrder = 5;
    bodyMesh.renderOrder = 6;
    lines.renderOrder = 7;
    shallowReflectionMesh.renderOrder = 8;

    // Real 3D GPU Shadow casting from fish onto pond bed
    const fishDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    outerMesh.castShadow = true;
    bodyMesh.castShadow = true;
    deepOuterMesh.castShadow = true;
    deepBodyMesh.castShadow = true;
    outerMesh.customDepthMaterial = fishDepthMaterial;
    bodyMesh.customDepthMaterial = fishDepthMaterial;
    deepOuterMesh.customDepthMaterial = fishDepthMaterial;
    deepBodyMesh.customDepthMaterial = fishDepthMaterial;

    this.fishGroup.add(
      deepOuterMesh,
      deepBodyMesh,
      deepLines,
      deepReflectionMesh,
      outerMesh,
      bodyMesh,
      lines,
      shallowReflectionMesh,
      this.tinyFishRenderer.group,
    );
  }

  public refreshConfig(): void {
    for (const section of [
      "koi", "koi-palettes", "tiny-fish", "pond-bed", "water",
      "lotus", "duckweed", "butterflies",
    ]) this.refreshSection(section);
  }

  public refreshSection(sectionId: string): void {
    switch (sectionId) {
      case "koi":
        this.targetFishShadowColor.setHex(FISH.shadow.color);
        // Eye color and the shared koi palette are baked into appearances.
        this.refreshFishAppearances();
        break;
      case "koi-palettes":
      case "koi-patterns":
        this.refreshFishAppearances();
        break;
      case "tiny-fish":
        this.tinyFishRenderer.refreshConfig();
        break;
      case "pond-bed":
        this.pondBed.refreshConfig();
        break;
      case "water":
        this.waterSurface.refreshConfig();
        break;
      case "lotus":
        this.lotusLeaves.refreshConfig();
        break;
      case "duckweed":
      case "duckweed-patches":
        this.duckweed.refreshConfig();
        break;
      case "butterflies":
        this.butterflies.refreshConfig(true);
        break;
      case "butterfly-spawns":
        this.butterflies.refreshConfig();
        break;
      default:
        break;
    }
  }

  private refreshFishAppearances(): void {
    for (let index = 0; index < this.appearances.length; index += 1) {
      this.appearances[index] = createFishAppearance(index);
      this.depthAppearances[index] = createFishAppearance(index);
    }
  }

  public resize(width: number, height: number, oldWidth: number, oldHeight: number): void {
    this.renderer.setSize(width, height, false);
    this.underwaterTarget.setSize(width, height);
    this.compositeTarget.setSize(width, height);
    this.camera.right = width;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
    this.pondBed.resize(width, height);
    this.surfaceDisturbance.resize(width, height);
    this.waterSurface.resize(width, height);
    this.butterflies.resize(width / oldWidth, height / oldHeight);
    this.dragonfly.resize(width / oldWidth, height / oldHeight);
  }

  public dispose(): void {
    this.underwaterTarget.dispose();
    this.compositeTarget.dispose();
    this.surfaceDisturbance.dispose();
    this.weather.dispose();
    this.renderer.dispose();
  }

  public setWeatherPreset(id: WeatherPresetId): void {
    this.weather.setPreset(id);
  }

  public setPreviewFamily(index: number | null): void {
    this.previewFamilyIndex = index;
  }

  public isDayNightCycleEnabled(): boolean {
    return this.dayNightCycleEnabled;
  }

  public setDayNightCycleEnabled(enabled: boolean): void {
    this.dayNightCycleEnabled = enabled;
    if (!enabled) {
      this.pondBed.refreshConfig();
      this.waterSurface.refreshConfig();
    }
  }

  public getDayNightState(time: number): EvaluatedDayNightState {
    return evaluateDayNightCycle(time + this.dayNightTimeOffset);
  }

  public setDayNightPhase(phase: number, currentTime: number): void {
    const targetSeconds = phase * DAY_NIGHT_CYCLE_DURATION;
    const currentLoopSeconds =
      ((currentTime % DAY_NIGHT_CYCLE_DURATION) + DAY_NIGHT_CYCLE_DURATION) %
      DAY_NIGHT_CYCLE_DURATION;
    this.dayNightTimeOffset = targetSeconds - currentLoopSeconds;
  }

  public triggerDragonfly(): void {
    this.dragonfly.triggerExcursion();
  }

  public spawnFallingPetal(type?: PetalType): void {
    this.floatingPetals.spawnFallingPetal(undefined, undefined, type);
  }

  public setVolumetricRaysEnabled(enabled: boolean): void {
    this.weather.setVolumetricRaysEnabled(enabled);
  }

  public setCanopyShadowEnabled(enabled: boolean): void {
    this.weather.setCanopyShadowEnabled(enabled);
  }

  public setVolumetricMistEnabled(enabled: boolean): void {
    this.weather.setVolumetricMistEnabled(enabled);
  }

  public toggle3DView(): boolean {
    this.is3DViewEnabled = !this.is3DViewEnabled;
    return this.is3DViewEnabled;
  }

  public set3DView(enabled: boolean): void {
    this.is3DViewEnabled = enabled;
  }

  public is3DView(): boolean {
    return this.is3DViewEnabled;
  }

  public draw(school: School, time: number, showDebug: boolean): void {
    this.currentTime = time;

    if (this.dayNightCycleEnabled) {
      const dn = evaluateDayNightCycle(time + this.dayNightTimeOffset);
      this.weather.setDayNightState(dn);
      this.pondBed.setDayNightAppearance(
        dn.pondBedDeep,
        dn.pondBedShallow,
        dn.verticalTone,
        dn.edgeDarkening,
      );
      this.waterSurface.setDayNightAppearance(
        dn.waterTint,
        dn.waterCurrentColor,
        dn.waterCurrentCore,
      );
      this.targetFishShadowColor.copy(dn.shadowColor);
      this.currentLightDirection.copy(dn.lightDirection);
      this.currentSunAltitude = dn.sunAltitude;
    } else {
      this.currentLightDirection.copy(this.weather.lightDirection);
      this.currentSunAltitude = this.weather.sunAltitude;
    }

    this.weather.update(time);
    const sunDir = new THREE.Vector3(
      this.currentLightDirection.x,
      this.currentLightDirection.y,
      Math.max(0.3, this.currentSunAltitude),
    ).normalize();
    this.pondBed.update(time, sunDir);

    // Update 3D Lighting uniforms on fish materials
    this.shallowFishMaterial.uniforms.uLightDirection.value.copy(sunDir);
    this.deepFishMaterial.uniforms.uLightDirection.value.copy(sunDir);
    this.shallowFishMaterial.uniforms.uSunColor.value.copy(this.weather.lightColor);
    this.deepFishMaterial.uniforms.uSunColor.value.copy(this.weather.lightColor);
    this.shallowFishMaterial.uniforms.uTime.value = time;
    this.deepFishMaterial.uniforms.uTime.value = time;

    const ambientColor = new THREE.Color(0x567066);
    if (this.dayNightCycleEnabled) {
      const nightFactor = Math.max(0.18, this.currentSunAltitude);
      ambientColor.multiplyScalar(0.4 + 0.6 * nightFactor);
    }
    this.shallowFishMaterial.uniforms.uAmbientColor.value.copy(ambientColor);
    this.deepFishMaterial.uniforms.uAmbientColor.value.copy(ambientColor);

    // Smooth camera tilt for 3D View mode
    const targetTilt = this.is3DViewEnabled ? 0.65 : 0.0;
    this.cameraTilt = THREE.MathUtils.lerp(this.cameraTilt, targetTilt, 0.06);
    if (this.cameraTilt > 0.001) {
      const cy = CANVAS_HEIGHT * 0.5;
      const tiltAngle = this.cameraTilt * 0.52;
      const tiltCos = Math.cos(tiltAngle);
      const tiltSin = Math.sin(tiltAngle);
      this.camera.position.set(0, -cy * (1.0 - tiltCos) * 0.45, 300 * tiltCos);
      this.camera.rotation.set(-tiltAngle, 0, 0);
    } else if (this.camera.position.z !== 0 || this.camera.rotation.x !== 0) {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
    }

    this.previousAppearanceTime = time;
    this.deepOuterTriangles.reset();
    this.deepBodyTriangles.reset();
    this.deepOutlineLines.reset();
    this.deepReflectionTriangles.reset();
    this.shallowOuterTriangles.reset();
    this.shallowBodyTriangles.reset();
    this.shallowOutlineLines.reset();
    this.shallowReflectionTriangles.reset();

    const previewIndex = this.previewFamilyIndex;
    let selectedFishIndex = 0;
    if (previewIndex !== null) {
      for (let index = 0; index < school.count; index += 1) {
        if (
          index % KOI_PALETTES.length === previewIndex &&
          (index + 1) % FISH.tinyEvery !== 0
        ) {
          selectedFishIndex = index;
          break;
        }
      }
    }
    const transformOrigin = previewIndex === null
      ? null
      : school.fish[selectedFishIndex].position;
    for (const batch of [
      this.deepOuterTriangles,
      this.deepBodyTriangles,
      this.deepOutlineLines,
      this.deepReflectionTriangles,
      this.shallowOuterTriangles,
      this.shallowBodyTriangles,
      this.shallowOutlineLines,
      this.shallowReflectionTriangles,
    ]) {
      batch.setPreviewTransform(transformOrigin, previewIndex === null ? 1 : 1.6);
    }

    const fishIndices: number[] = [];
    for (let index = 0; index < school.count; index += 1) {
      if (previewIndex !== null && index !== selectedFishIndex) continue;
      fishIndices.push(index);
    }
    // Sort deepest fish first so deep fish render beneath shallow fish for natural parallax
    fishIndices.sort((a, b) => school.fish[b].depth - school.fish[a].depth);

    for (const index of fishIndices) {
      const fish = school.fish[index];
      this.buildRenderSpine(fish);
      const appearanceIndex = previewIndex ?? index;
      const appearance = this.depthAppearances[appearanceIndex];
      this.updateDepthAppearance(fish, this.appearances[appearanceIndex], appearance);
      this.drawKoi(fish, appearance, previewIndex !== null);
      if (showDebug) this.drawDebug(fish, appearance);
    }

    this.deepOuterTriangles.commit();
    this.deepBodyTriangles.commit();
    this.deepOutlineLines.commit();
    this.deepReflectionTriangles.commit();
    this.shallowOuterTriangles.commit();
    this.shallowBodyTriangles.commit();
    this.shallowOutlineLines.commit();
    this.shallowReflectionTriangles.commit();
    this.tinyFishRenderer.group.visible = previewIndex === null;
    this.tinyFishRenderer.shadowGroup.visible = previewIndex === null;
    if (previewIndex === null) this.tinyFishRenderer.update(school.tinyFish);
    this.pondBed.update(time);
    this.surfaceDisturbance.render(
      this.renderer,
      school,
      time,
      previewIndex === null ? null : selectedFishIndex,
    );
    this.waterSurface.update(school, time);
    this.duckweed.update(time, school.ripples);
    this.lotusLeaves.update(
      time,
      school.ripples,
      this.currentLightDirection,
      this.currentSunAltitude,
    );
    this.weather.setLotusOccluders(
      this.lotusLeaves.leafOccluders,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );
    this.butterflies.update(time);
    this.dragonfly.update(time, school);

    if (!this.foodPelletsSceneAdded) {
      this.surfaceGroup.add(school.foodPellets.group);
      this.foodPelletsSceneAdded = true;
    }

    if (!this.siltParticlesSceneAdded) {
      this.bedGroup.add(school.siltParticles.group);
      this.siltParticlesSceneAdded = true;
    }

    this.floatingPetals.update(
      time,
      school.vortices,
      school.ripples,
      this.lotusLeaves.leafOccluders,
      this.currentLightDirection,
      this.currentSunAltitude,
    );

    // Update Sun Light Position from sun direction vector
    const sunX = CANVAS_WIDTH * 0.5 - this.currentLightDirection.x * 220;
    const sunY = CANVAS_HEIGHT * 0.5 - this.currentLightDirection.y * 220;
    const sunZ = Math.max(0.32, this.currentSunAltitude) * 400;
    this.sunLight.position.set(sunX, sunY, sunZ);
    this.sunLight.target.position.set(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0);

    // Pass 1: Render underwater world (bed + 3D fish + silt) into underwaterTarget
    // Three.js PCFSoftShadowMap automatically casts real 3D soft shadows onto the riverbed!
    this.waterGroup.visible = false;
    this.surfaceGroup.visible = false;
    this.atmosphereGroup.visible = false;
    this.bedGroup.visible = true;
    this.fishGroup.visible = true;

    this.renderer.setRenderTarget(this.underwaterTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // Pass 2: Render water surface (refracting underwaterTarget) + lotus leaves + atmosphere to screen
    this.bedGroup.visible = false;
    this.fishGroup.visible = false;
    this.waterGroup.visible = true;
    this.surfaceGroup.visible = true;
    this.atmosphereGroup.visible = true;

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // Reset visibility for next frame
    this.bedGroup.visible = true;
    this.fishGroup.visible = true;
  }

  private buildRenderSpine(fish: Koi): void {
    fish.renderSpine[0] = { ...fish.spine[0] };
    for (let node = 1; node < SPINE_NODES; node += 1) {
      const t = node / (SPINE_NODES - 1);
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(
        sub(fish.spine[previous], fish.spine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(tangent);
      const waveEnvelope = Math.pow(t, 1.72);
      const wave =
        Math.sin(fish.swimPhase - t * 6.1) *
        fish.bodyWidth *
        1.15 *
        waveEnvelope *
        (0.08 + fish.tailEffort * 0.92);
      fish.renderSpine[node] = add(fish.spine[node], mul(normal, wave));
    }
  }

  private widthAt(fish: Koi, node: number): number {
    const t = node / (SPINE_NODES - 1);
    const profile =
      t < 0.18
        ? 0.73 + (t / 0.18) * 0.27
        : Math.pow(Math.max(0, 1 - (t - 0.18) / 0.82), 0.72);
    return Math.max(0.7, fish.bodyWidth * profile);
  }

  private visualDepth(depth: number): number {
    const range = Math.max(FISH.depth.visualEnd - FISH.depth.visualStart, 0.001);
    const linear = Math.max(
      0,
      Math.min(1, (depth - FISH.depth.visualStart) / range),
    );
    return linear * linear * (3 - 2 * linear);
  }

  private updateDepthAppearance(
    fish: Koi,
    source: FishAppearance,
    target: FishAppearance,
  ): void {
    const visualDepth = this.visualDepth(fish.depth);

    // Volumetric shadow occlusion when fish swims beneath a lotus leaf
    const headPos = fish.renderSpine[0];
    let underLeafShade = 0;
    for (const occluder of this.lotusLeaves.leafOccluders) {
      const dx = headPos.x - occluder.x;
      const dy = headPos.y - occluder.y;
      const dist = Math.hypot(dx, dy);
      if (dist < occluder.radius * 1.15) {
        const factor = 1.0 - Math.min(1.0, dist / (occluder.radius * 1.15));
        underLeafShade = Math.max(underLeafShade, factor);
      }
    }
    const leafShadeFactor = 1.0 - underLeafShade * 0.35;

    this.applyDepthColor(source.base, target.base, visualDepth, leafShadeFactor);
    this.applyDepthColor(source.accent, target.accent, visualDepth, leafShadeFactor);
    this.applyDepthColor(source.marking, target.marking, visualDepth, leafShadeFactor);
    this.applyDepthColor(source.fin, target.fin, visualDepth, leafShadeFactor);
    this.applyDepthColor(source.eye, target.eye, visualDepth, leafShadeFactor);
  }

  private applyDepthColor(
    source: THREE.Color,
    target: THREE.Color,
    visualDepth: number,
    leafShade = 1.0,
  ): void {
    // Preserve crystal clarity and luminosity underwater ("độ trong của nước")
    const depthDim = (1.0 - visualDepth * 0.06) * leafShade; // Very subtle dimming to preserve pristine transparency
    const saturation = 1.0 - visualDepth * 0.12; // Natural slight desaturation
    const luminance = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722;

    // Atmospheric water scattering (subtle tint towards crystal pond water)
    const waterScatterR = 0.38;
    const waterScatterG = 0.62;
    const waterScatterB = 0.58;
    const scatterAmount = visualDepth * 0.18;

    const baseR = (luminance + (source.r - luminance) * saturation) * depthDim;
    const baseG = (luminance + (source.g - luminance) * saturation) * depthDim;
    const baseB = (luminance + (source.b - luminance) * saturation) * depthDim;

    target.setRGB(
      baseR * (1 - scatterAmount) + waterScatterR * scatterAmount,
      baseG * (1 - scatterAmount) + waterScatterG * scatterAmount,
      baseB * (1 - scatterAmount) + waterScatterB * scatterAmount,
    );
  }

  private drawKoiGeometry(
    fish: Koi,
    appearance: FishAppearance,
    targetOuter: GeometryBatch,
    targetBody: GeometryBatch,
    alpha: number,
    depthScale: number,
  ): void {
    const VERTS_PER_RING = 12;
    const finAlpha = alpha * 0.90;

    // 1. Compute 3D kinematics
    // Elevation (Z): surface fish swim near z = +2.0, deep fish descend to z = -6.0
    const zBase = (0.10 - fish.depth) * 16.0;

    // Banking roll angle: fish naturally bank inward during sharp turns
    const roll = clamp(-fish.angularVelocity * 0.22, -0.42, 0.42);

    // Diving/climbing pitch angle: nose angles down when descending, up when rising
    const pitch = clamp((fish.targetDepth - fish.depth) * 1.6, -0.28, 0.28);

    interface SpineFrame {
      center: { x: number; y: number; z: number };
      tan: { x: number; y: number; z: number };
      lat: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
      width: number;
    }

    const frames: SpineFrame[] = [];
    const cosRoll = Math.cos(roll);
    const sinRoll = Math.sin(roll);

    for (let node = 0; node < SPINE_NODES; node += 1) {
      const prev = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 1);
      const t2d = normalize(
        sub(fish.renderSpine[prev], fish.renderSpine[next]),
        fromAngle(fish.heading),
      );
      const l2d = perpendicular(t2d);
      const zOffset = (SPINE_NODES * 0.5 - node) * Math.sin(pitch) * 0.45;
      const center = {
        x: fish.renderSpine[node].x,
        y: fish.renderSpine[node].y,
        z: zBase + zOffset,
      };

      // 3D basis vectors with banking roll applied around tangent
      const lat = {
        x: l2d.x * cosRoll,
        y: l2d.y * cosRoll,
        z: sinRoll,
      };
      const up = {
        x: -l2d.x * sinRoll,
        y: -l2d.y * sinRoll,
        z: cosRoll,
      };
      const tan = {
        x: t2d.x,
        y: t2d.y,
        z: -Math.sin(pitch),
      };

      frames[node] = {
        center,
        tan,
        lat,
        up,
        width: this.widthAt(fish, node) * depthScale,
      };
    }

    // 2. Generate 3D cross-section rings
    interface RingVertex {
      pos: { x: number; y: number; z: number };
      norm: { x: number; y: number; z: number };
      color: THREE.Color;
    }

    const rings: RingVertex[][] = [];
    const patches = patchesFor(appearance);

    for (let node = 0; node < SPINE_NODES; node += 1) {
      const frame = frames[node];
      const u = node / (SPINE_NODES - 1);
      const prevWidth = frames[Math.max(0, node - 1)].width;
      const nextWidth = frames[Math.min(SPINE_NODES - 1, node + 1)].width;
      const slope = (prevWidth - nextWidth) * 0.15;
      const ring: RingVertex[] = [];

      for (let k = 0; k < VERTS_PER_RING; k += 1) {
        const theta = (k / VERTS_PER_RING) * Math.PI * 2;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        // Natural koi profile: arched dorsal ridge (sinTheta > 0), slightly tapered belly
        const vertScale = sinTheta >= 0 ? 0.95 : 0.78;
        const halfHeight = frame.width * vertScale;

        const px = frame.center.x + frame.lat.x * (frame.width * cosTheta) + frame.up.x * (halfHeight * sinTheta);
        const py = frame.center.y + frame.lat.y * (frame.width * cosTheta) + frame.up.y * (halfHeight * sinTheta);
        const pz = frame.center.z + frame.lat.z * (frame.width * cosTheta) + frame.up.z * (halfHeight * sinTheta);

        // 3D surface normal
        let nx = frame.lat.x * cosTheta + frame.up.x * sinTheta - frame.tan.x * slope;
        let ny = frame.lat.y * cosTheta + frame.up.y * sinTheta - frame.tan.y * slope;
        let nz = frame.lat.z * cosTheta + frame.up.z * sinTheta - frame.tan.z * slope;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen; ny /= nLen; nz /= nLen;

        // Evaluate markings on 3D curved surface
        // vOffset: 0 at top dorsal ridge (sinTheta = 1, theta = pi/2), +1 at left flank, -1 at right flank
        const vOffset = -cosTheta;
        const vertColor = appearance.base.clone();

        for (const patch of patches) {
          const du = (u - patch.position) / Math.max(0.01, patch.length);
          const dv = (vOffset - patch.offset) / Math.max(0.01, patch.width);
          const distSq = du * du + dv * dv;
          if (distSq < 1.0) {
            const patchColor = patch.color === "accent" ? appearance.accent : appearance.marking;
            const blend = Math.max(0, Math.min(1, 1.0 - distSq * distSq));
            vertColor.lerp(patchColor, blend);
          }
        }

        // Subtle belly counter-shading
        if (sinTheta < -0.4) {
          const bellyShade = (-sinTheta - 0.4) / 0.6;
          vertColor.lerp(new THREE.Color(0xf6f6f2), bellyShade * 0.35);
        }

        ring[k] = {
          pos: { x: px, y: py, z: pz },
          norm: { x: nx, y: ny, z: nz },
          color: vertColor,
        };
      }
      rings[node] = ring;
    }

    // 3. Loft tubular body between consecutive rings (outward-facing winding)
    for (let node = 0; node < SPINE_NODES - 1; node += 1) {
      const ringA = rings[node];
      const ringB = rings[node + 1];
      for (let k = 0; k < VERTS_PER_RING; k += 1) {
        const kNext = (k + 1) % VERTS_PER_RING;
        // Winding: p0 -> p1 -> p2 and p0 -> p2 -> p3 with p1 along +k and p3 along +spine (outward normal)
        const p0 = ringA[k].pos;
        const p1 = ringA[kNext].pos;
        const p2 = ringB[kNext].pos;
        const p3 = ringB[k].pos;

        const c0 = ringA[k].color;
        const c1 = ringA[kNext].color;
        const c2 = ringB[kNext].color;
        const c3 = ringB[k].color;

        const n0 = ringA[k].norm;
        const n1 = ringA[kNext].norm;
        const n2 = ringB[kNext].norm;
        const n3 = ringB[k].norm;

        targetOuter.quad3D(p0, p1, p2, p3, c0, c1, c2, c3, alpha, n0, n1, n2, n3);
      }
    }

    // 4. Snout / Head 3D Dome Cap (Mũi và miệng cá)
    const headFrame = frames[0];
    const gulpProgress = fish.gulpAnimation / Math.max(FISH.feeding.animationDurationSeconds, 0.001);
    const gulpOpen = Math.sin(Math.PI * gulpProgress) * 0.55;

    const snoutApex = {
      x: headFrame.center.x + headFrame.tan.x * (headFrame.width * 0.48),
      y: headFrame.center.y + headFrame.tan.y * (headFrame.width * 0.48),
      z: headFrame.center.z + headFrame.tan.z * (headFrame.width * 0.48) + headFrame.up.z * (headFrame.width * 0.08),
    };
    const snoutNorm = {
      x: headFrame.tan.x,
      y: headFrame.tan.y,
      z: headFrame.tan.z,
    };

    const ring0 = rings[0];
    for (let k = 0; k < VERTS_PER_RING; k += 1) {
      const kNext = (k + 1) % VERTS_PER_RING;
      let pA = ring0[k].pos;
      let pB = ring0[kNext].pos;

      // Animate mouth opening for gulping
      if (gulpOpen > 0.01) {
        const thetaA = (k / VERTS_PER_RING) * Math.PI * 2;
        const thetaB = (kNext / VERTS_PER_RING) * Math.PI * 2;
        if (Math.sin(thetaA) < -0.2) {
          pA = {
            x: pA.x - headFrame.tan.x * gulpOpen * 2,
            y: pA.y - headFrame.tan.y * gulpOpen * 2,
            z: pA.z - headFrame.up.z * gulpOpen * 2.5,
          };
        }
        if (Math.sin(thetaB) < -0.2) {
          pB = {
            x: pB.x - headFrame.tan.x * gulpOpen * 2,
            y: pB.y - headFrame.tan.y * gulpOpen * 2,
            z: pB.z - headFrame.up.z * gulpOpen * 2.5,
          };
        }
      }

      targetOuter.triangle3D(
        snoutApex,
        pB,
        pA,
        ring0[k].color,
        alpha,
        snoutNorm,
        ring0[kNext].norm,
        ring0[k].norm,
      );
    }

    // 5. Tail Stem 3D Cap (Gốc cuống đuôi)
    const tailFrame = frames[SPINE_NODES - 1];
    const tailStemApex = {
      x: tailFrame.center.x - tailFrame.tan.x * (tailFrame.width * 0.4),
      y: tailFrame.center.y - tailFrame.tan.y * (tailFrame.width * 0.4),
      z: tailFrame.center.z - tailFrame.tan.z * (tailFrame.width * 0.4),
    };
    const tailNorm = {
      x: -tailFrame.tan.x,
      y: -tailFrame.tan.y,
      z: -tailFrame.tan.z,
    };

    const ringTail = rings[SPINE_NODES - 1];
    for (let k = 0; k < VERTS_PER_RING; k += 1) {
      const kNext = (k + 1) % VERTS_PER_RING;
      targetOuter.triangle3D(
        tailStemApex,
        ringTail[k].pos,
        ringTail[kNext].pos,
        ringTail[k].color,
        alpha,
        tailNorm,
        ringTail[k].norm,
        ringTail[kNext].norm,
      );
    }

    // 6. 3D Bulging Glossy Eyes (Mắt 3D)
    const eyeRadius = Math.max(0.75, headFrame.width * 0.20);
    const eyeOffsetLat = headFrame.width * 0.68;
    const eyeOffsetUp = headFrame.width * 0.52;

    for (const side of [1, -1]) {
      const eyeCenter = {
        x: headFrame.center.x + headFrame.lat.x * (eyeOffsetLat * side) + headFrame.up.x * eyeOffsetUp + headFrame.tan.x * (headFrame.width * 0.18),
        y: headFrame.center.y + headFrame.lat.y * (eyeOffsetLat * side) + headFrame.up.y * eyeOffsetUp + headFrame.tan.y * (headFrame.width * 0.18),
        z: headFrame.center.z + headFrame.lat.z * (eyeOffsetLat * side) + headFrame.up.z * eyeOffsetUp + headFrame.tan.z * (headFrame.width * 0.18),
      };
      const eyeNormal = {
        x: headFrame.lat.x * (0.75 * side) + headFrame.up.x * 0.55 + headFrame.tan.x * 0.35,
        y: headFrame.lat.y * (0.75 * side) + headFrame.up.y * 0.55 + headFrame.tan.y * 0.35,
        z: headFrame.lat.z * (0.75 * side) + headFrame.up.z * 0.55 + headFrame.tan.z * 0.35,
      };
      const eLen = Math.hypot(eyeNormal.x, eyeNormal.y, eyeNormal.z) || 1;
      eyeNormal.x /= eLen; eyeNormal.y /= eLen; eyeNormal.z /= eLen;

      // Draw 3D hemispherical eye dome
      const EYE_SEGS = 8;
      const eyeApex = {
        x: eyeCenter.x + eyeNormal.x * (eyeRadius * 0.65),
        y: eyeCenter.y + eyeNormal.y * (eyeRadius * 0.65),
        z: eyeCenter.z + eyeNormal.z * (eyeRadius * 0.65),
      };
      const pupilColor = new THREE.Color(0x0c0c10);

      for (let s = 0; s < EYE_SEGS; s += 1) {
        const a1 = (s / EYE_SEGS) * Math.PI * 2;
        const a2 = ((s + 1) / EYE_SEGS) * Math.PI * 2;
        const r1 = {
          x: eyeCenter.x + (headFrame.tan.x * Math.cos(a1) + headFrame.up.x * Math.sin(a1)) * eyeRadius,
          y: eyeCenter.y + (headFrame.tan.y * Math.cos(a1) + headFrame.up.y * Math.sin(a1)) * eyeRadius,
          z: eyeCenter.z + (headFrame.tan.z * Math.cos(a1) + headFrame.up.z * Math.sin(a1)) * eyeRadius,
        };
        const r2 = {
          x: eyeCenter.x + (headFrame.tan.x * Math.cos(a2) + headFrame.up.x * Math.sin(a2)) * eyeRadius,
          y: eyeCenter.y + (headFrame.tan.y * Math.cos(a2) + headFrame.up.y * Math.sin(a2)) * eyeRadius,
          z: eyeCenter.z + (headFrame.tan.z * Math.cos(a2) + headFrame.up.z * Math.sin(a2)) * eyeRadius,
        };
        // Iris rim
        targetBody.triangle3D(eyeApex, r1, r2, appearance.eye, alpha, eyeNormal, eyeNormal, eyeNormal);
        targetBody.triangle3D(eyeApex, r2, r1, appearance.eye, alpha, eyeNormal, eyeNormal, eyeNormal);
      }
    }

    // 7. 3D Erect Dorsal Fin (VÂY LƯNG)
    // Anchored at top dorsal ridge (k = 3 in a 12-vert ring where theta = pi/2)
    const dorsalStart = 4;
    const dorsalEnd = 8;
    const dorsalRidgeK = 3;
    const dorsalTips: { x: number; y: number; z: number }[] = [];

    for (let node = dorsalStart; node <= dorsalEnd; node += 1) {
      const frame = frames[node];
      const uFin = (node - dorsalStart) / (dorsalEnd - dorsalStart);
      const finHeight = fish.bodyWidth * (0.18 + Math.sin(uFin * Math.PI) * 0.52);
      const sway = Math.sin(fish.swimPhase - node * 0.75) * fish.bodyWidth * 0.20;

      const basePos = rings[node][dorsalRidgeK].pos;
      dorsalTips[node] = {
        x: basePos.x + frame.up.x * finHeight + frame.lat.x * sway - frame.tan.x * (finHeight * 0.42),
        y: basePos.y + frame.up.y * finHeight + frame.lat.y * sway - frame.tan.y * (finHeight * 0.42),
        z: basePos.z + frame.up.z * finHeight + frame.lat.z * sway - frame.tan.z * (finHeight * 0.42),
      };
    }

    for (let node = dorsalStart; node < dorsalEnd; node += 1) {
      const b0 = rings[node][dorsalRidgeK].pos;
      const b1 = rings[node + 1][dorsalRidgeK].pos;
      const t0 = dorsalTips[node];
      const t1 = dorsalTips[node + 1];

      // Draw both front and back faces so fin is fully visible from any angle
      targetBody.quad3D(b0, b1, t1, t0, appearance.fin, appearance.fin, appearance.fin, appearance.fin, finAlpha);
      targetBody.quad3D(b0, t0, t1, b1, appearance.fin, appearance.fin, appearance.fin, appearance.fin, finAlpha);
    }

    // 8. 3D Pectoral Fins (VÂY NGỰC / VÂY BƠI) - Prominent, fan-shaped paddles
    const pecNode = 4;
    const pecFrame = frames[pecNode];
    const paddleActivity =
      (fish.state === SwimState.Hover ? 1 : fish.state === SwimState.Pivot ? 0.85 : 0.45) +
      gulpProgress * 0.85;
    const finPulse = 0.85 + paddleActivity * 0.25 * Math.sin(fish.swimPhase * 0.64 + fish.phaseOffset);
    const pecReach = fish.bodyWidth * (0.92 + paddleActivity * 0.38) * finPulse;
    const pecSweep = -fish.bodyWidth * 0.36;

    for (const side of [1, -1]) {
      const anchorK = side === 1 ? 0 : 6;
      const rootFront = rings[pecNode - 1][anchorK].pos;
      const rootMid = rings[pecNode][anchorK].pos;
      const rootBack = rings[pecNode + 1][anchorK].pos;

      const tipLead = {
        x: rootMid.x + pecFrame.lat.x * (pecReach * 0.90 * side) + pecFrame.tan.x * pecSweep - pecFrame.up.x * (pecReach * 0.16),
        y: rootMid.y + pecFrame.lat.y * (pecReach * 0.90 * side) + pecFrame.tan.y * pecSweep - pecFrame.up.y * (pecReach * 0.16),
        z: rootMid.z + pecFrame.lat.z * (pecReach * 0.90 * side) + pecFrame.tan.z * pecSweep - pecFrame.up.z * (pecReach * 0.16),
      };
      const tipMid = {
        x: rootMid.x + pecFrame.lat.x * (pecReach * 1.05 * side) + pecFrame.tan.x * (pecSweep - pecReach * 0.15) - pecFrame.up.x * (pecReach * 0.20),
        y: rootMid.y + pecFrame.lat.y * (pecReach * 1.05 * side) + pecFrame.tan.y * (pecSweep - pecReach * 0.15) - pecFrame.up.y * (pecReach * 0.20),
        z: rootMid.z + pecFrame.lat.z * (pecReach * 1.05 * side) + pecFrame.tan.z * (pecSweep - pecReach * 0.15) - pecFrame.up.z * (pecReach * 0.20),
      };
      const tipTrail = {
        x: rootBack.x + pecFrame.lat.x * (pecReach * 0.82 * side) + pecFrame.tan.x * (pecSweep - pecReach * 0.38) - pecFrame.up.x * (pecReach * 0.22),
        y: rootBack.y + pecFrame.lat.y * (pecReach * 0.82 * side) + pecFrame.tan.y * (pecSweep - pecReach * 0.38) - pecFrame.up.y * (pecReach * 0.22),
        z: rootBack.z + pecFrame.lat.z * (pecReach * 0.82 * side) + pecFrame.tan.z * (pecSweep - pecReach * 0.38) - pecFrame.up.z * (pecReach * 0.22),
      };

      // Multi-tri fan (front & back winding for two-sided visibility)
      targetOuter.triangle3D(rootFront, tipLead, rootMid, appearance.fin, finAlpha);
      targetOuter.triangle3D(rootFront, rootMid, tipLead, appearance.fin, finAlpha);

      targetOuter.triangle3D(rootMid, tipLead, tipMid, appearance.fin, finAlpha);
      targetOuter.triangle3D(rootMid, tipMid, tipLead, appearance.fin, finAlpha);

      targetOuter.triangle3D(rootMid, tipMid, tipTrail, appearance.fin, finAlpha);
      targetOuter.triangle3D(rootMid, tipTrail, tipMid, appearance.fin, finAlpha);

      targetOuter.triangle3D(rootMid, tipTrail, rootBack, appearance.fin, finAlpha);
      targetOuter.triangle3D(rootMid, rootBack, tipTrail, appearance.fin, finAlpha);
    }

    // 9. 3D Pelvic Fins (VÂY BỤNG)
    const pelvNode = 8;
    const pelvFrame = frames[pelvNode];
    const pelvReach = fish.bodyWidth * (0.46 + 0.08 * finPulse);
    const pelvSweep = -fish.bodyWidth * 0.42;

    for (const side of [1, -1]) {
      const anchorK = side === 1 ? 11 : 7;
      const rootFront = rings[pelvNode - 1][anchorK].pos;
      const rootMid = rings[pelvNode][anchorK].pos;
      const rootBack = rings[pelvNode + 1][anchorK].pos;

      const tipPos = {
        x: rootMid.x + pelvFrame.lat.x * (pelvReach * side) + pelvFrame.tan.x * pelvSweep - pelvFrame.up.x * (pelvReach * 0.25),
        y: rootMid.y + pelvFrame.lat.y * (pelvReach * side) + pelvFrame.tan.y * pelvSweep - pelvFrame.up.y * (pelvReach * 0.25),
        z: rootMid.z + pelvFrame.lat.z * (pelvReach * side) + pelvFrame.tan.z * pelvSweep - pelvFrame.up.z * (pelvReach * 0.25),
      };

      targetOuter.triangle3D(rootFront, tipPos, rootBack, appearance.fin, finAlpha * 0.92);
      targetOuter.triangle3D(rootFront, rootBack, tipPos, appearance.fin, finAlpha * 0.92);
    }

    // 10. 3D Caudal Fin (VÂY ĐUÔI) - Large, flowing, bifurcated fan
    const tailStem = frames[SPINE_NODES - 1];
    const tailLength = fish.bodyWidth * 1.68;
    const tailSpread = fish.bodyWidth * (0.82 + 0.16 * Math.sin(fish.swimPhase - 0.8));
    const tailWave = Math.sin(fish.swimPhase - 1.2) * fish.bodyWidth * 0.46 * (0.35 + fish.tailEffort * 0.65);

    const tailBackward = {
      x: -tailStem.tan.x,
      y: -tailStem.tan.y,
      z: -tailStem.tan.z,
    };
    const tailLateral = tailStem.lat; // In the horizontal swimming plane!
    const tailUp = tailStem.up;

    // 5-point bifurcated caudal fan
    const upperFinTip = {
      x: tailStemApex.x + tailBackward.x * tailLength + tailLateral.x * (tailSpread + tailWave) + tailUp.x * (tailSpread * 0.32),
      y: tailStemApex.y + tailBackward.y * tailLength + tailLateral.y * (tailSpread + tailWave) + tailUp.y * (tailSpread * 0.32),
      z: tailStemApex.z + tailBackward.z * tailLength + tailLateral.z * (tailSpread + tailWave) + tailUp.z * (tailSpread * 0.32),
    };
    const upperMidFan = {
      x: tailStemApex.x + tailBackward.x * (tailLength * 0.86) + tailLateral.x * (tailSpread * 0.55 + tailWave * 0.88) + tailUp.x * (tailSpread * 0.16),
      y: tailStemApex.y + tailBackward.y * (tailLength * 0.86) + tailLateral.y * (tailSpread * 0.55 + tailWave * 0.88) + tailUp.y * (tailSpread * 0.16),
      z: tailStemApex.z + tailBackward.z * (tailLength * 0.86) + tailLateral.z * (tailSpread * 0.55 + tailWave * 0.88) + tailUp.z * (tailSpread * 0.16),
    };
    const tailNotch = {
      x: tailStemApex.x + tailBackward.x * (tailLength * 0.62) + tailLateral.x * (tailWave * 0.78),
      y: tailStemApex.y + tailBackward.y * (tailLength * 0.62) + tailLateral.y * (tailWave * 0.78),
      z: tailStemApex.z + tailBackward.z * (tailLength * 0.62) + tailLateral.z * (tailWave * 0.78),
    };
    const lowerMidFan = {
      x: tailStemApex.x + tailBackward.x * (tailLength * 0.86) - tailLateral.x * (tailSpread * 0.55 - tailWave * 0.88) - tailUp.x * (tailSpread * 0.16),
      y: tailStemApex.y + tailBackward.y * (tailLength * 0.86) - tailLateral.y * (tailSpread * 0.55 - tailWave * 0.88) - tailUp.y * (tailSpread * 0.16),
      z: tailStemApex.z + tailBackward.z * (tailLength * 0.86) - tailLateral.z * (tailSpread * 0.55 - tailWave * 0.88) - tailUp.z * (tailSpread * 0.16),
    };
    const lowerFinTip = {
      x: tailStemApex.x + tailBackward.x * tailLength - tailLateral.x * (tailSpread - tailWave) - tailUp.x * (tailSpread * 0.32),
      y: tailStemApex.y + tailBackward.y * tailLength - tailLateral.y * (tailSpread - tailWave) - tailUp.y * (tailSpread * 0.32),
      z: tailStemApex.z + tailBackward.z * tailLength - tailLateral.z * (tailSpread - tailWave) - tailUp.z * (tailSpread * 0.32),
    };

    // Upper caudal lobe (both windings)
    targetOuter.triangle3D(tailStemApex, upperFinTip, upperMidFan, appearance.fin, finAlpha);
    targetOuter.triangle3D(tailStemApex, upperMidFan, upperFinTip, appearance.fin, finAlpha);

    targetOuter.triangle3D(tailStemApex, upperMidFan, tailNotch, appearance.fin, finAlpha);
    targetOuter.triangle3D(tailStemApex, tailNotch, upperMidFan, appearance.fin, finAlpha);

    // Lower caudal lobe (both windings)
    targetOuter.triangle3D(tailStemApex, tailNotch, lowerMidFan, appearance.fin, finAlpha);
    targetOuter.triangle3D(tailStemApex, lowerMidFan, tailNotch, appearance.fin, finAlpha);

    targetOuter.triangle3D(tailStemApex, lowerMidFan, lowerFinTip, appearance.fin, finAlpha);
    targetOuter.triangle3D(tailStemApex, lowerFinTip, lowerMidFan, appearance.fin, finAlpha);
  }

  private drawKoi(fish: Koi, appearance: FishAppearance, isPreview = false): void {
    this.currentVisualDepth = this.visualDepth(fish.depth);

    const visualDepth = isPreview ? 0 : this.currentVisualDepth;
    // Opacity based on depth and WATER settings: maintains clear, solid fish body underwater
    const deepOpacityTarget = WATER.deepFishOpacity ?? 0.90;
    const baseOpacity = isPreview ? 1.0 : 1.0 - visualDepth * (1.0 - deepOpacityTarget);
    const depthScale = isPreview ? 1.0 : 1.0 - visualDepth * 0.05;

    // Deep vs shallow weight distribution
    const deepWeight = isPreview
      ? 0
      : visualDepth <= 0.15
        ? 0
        : visualDepth >= 0.58
          ? 1
          : (visualDepth - 0.15) / 0.43;
    const shallowWeight = 1.0 - deepWeight;

    // Draw to deep layer (will be blurred in rendering loop)
    if (deepWeight > 0.005) {
      this.drawKoiGeometry(
        fish,
        appearance,
        this.deepOuterTriangles,
        this.deepBodyTriangles,
        baseOpacity * deepWeight,
        depthScale,
      );
      this.drawKoiReflections(
        fish,
        this.deepReflectionTriangles,
        deepWeight,
        depthScale,
      );
    }

    // Draw to shallow layer (remains pin-sharp in rendering loop)
    if (shallowWeight > 0.005) {
      this.drawKoiGeometry(
        fish,
        appearance,
        this.shallowOuterTriangles,
        this.shallowBodyTriangles,
        baseOpacity * shallowWeight,
        1.0,
      );
      this.drawKoiReflections(
        fish,
        this.shallowReflectionTriangles,
        shallowWeight,
        1.0,
      );
    }
  }

  private drawKoiReflections(
    fish: Koi,
    target: GeometryBatch,
    weight: number,
    depthScale: number,
  ): void {
    if (weight <= 0.001) return;

    // Sample the cloud shadow and environmental light at the fish centroid
    const fishU = Math.max(0, Math.min(1, fish.position.x / CANVAS_WIDTH));
    const fishV = Math.max(0, Math.min(1, fish.position.y / CANVAS_HEIGHT));
    const fishCloud = this.weather.getCloudShadowAt(fishU, fishV, this.currentTime);

    // Weather lighting properties
    const lightColor = this.weather.lightColor;
    const lightDir = this.weather.lightDirection;
    const lightStrength = Math.max(0.2, this.weather.lightStrength);

    // Dynamic reflection intensity and tint shifting:
    // In direct sun: high sunClearance -> brilliant warm golden/ivory specular sun glint!
    // In cloud shadow: low sunClearance -> soft cool sky reflection (diffuse sheen).
    const sunClearance = fishCloud.sunClearance;

    // Ambient sky reflection color (soft silver-cyan water sheen)
    const skyReflectionColor = new THREE.Color(0x6aa2c8);
    // Blend reflection tint based on cloud clearance at this spot
    const baseHighlightColor = new THREE.Color()
      .copy(skyReflectionColor)
      .lerp(lightColor, Math.pow(sunClearance, 0.72));

    // Depth attenuation: surface fish have crisp, intense specular glints, deep fish have soft muted glow
    const visualDepth = this.visualDepth(fish.depth);
    const depthSpecularAttenuation = Math.pow(Math.max(0, 1.0 - visualDepth * 0.75), 1.5);

    // Specular alpha intensity
    const specularAlpha =
      (0.12 + 0.68 * sunClearance) *
      lightStrength *
      depthSpecularAttenuation *
      weight;

    if (specularAlpha <= 0.002) return;

    // 1. DORSAL RIDGE SPECULAR HIGHLIGHT (Dải phản quang dọc sống lưng)
    // Runs from node 1 (behind head) to node 8 (before tail)
    const startNode = 1;
    const endNode = 8;
    const dorsalLeft: Vec2[] = [];
    const dorsalRight: Vec2[] = [];

    for (let node = startNode; node <= endNode; node += 1) {
      const p = fish.renderSpine[node];
      const prev = Math.max(0, node - 1);
      const nxt = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(
        sub(fish.renderSpine[prev], fish.renderSpine[nxt]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(tangent);
      const halfWidth = this.widthAt(fish, node) * depthScale;

      // Sample local cloud gradient for micro-shifting along the fish body
      const nodeU = Math.max(0, Math.min(1, p.x / CANVAS_WIDTH));
      const nodeV = Math.max(0, Math.min(1, p.y / CANVAS_HEIGHT));
      const nodeCloud = this.weather.getCloudShadowAt(nodeU, nodeV, this.currentTime);

      // Lateral shift of the cylindrical highlight based on:
      // 1) Sun incident light angle vs fish surface normal
      const sunNormalDot = normal.x * lightDir.x + normal.y * lightDir.y;
      // 2) Cloud shadow edge gradient: highlights shift towards the sunlit side of the cloud boundary
      const cloudGradNormalDot = normal.x * nodeCloud.gradientX + normal.y * nodeCloud.gradientY;
      const cloudShift = -cloudGradNormalDot * 0.35 * this.weather.cloudStrength;

      // Shift across the curved dorsal cylinder (-0.45 to +0.45 of halfWidth)
      const lateralShift = Math.max(-0.45, Math.min(0.45, sunNormalDot * 0.3 + cloudShift));
      const ridgePos = add(p, mul(normal, lateralShift * halfWidth));

      // Highlight ribbon width (narrower & sharper in direct sun, broader & softer in cloud shadow)
      const ribbonWidth = halfWidth * (0.28 + 0.18 * (1.0 - nodeCloud.sunClearance));
      dorsalLeft[node] = add(ridgePos, mul(normal, ribbonWidth * 0.5));
      dorsalRight[node] = add(ridgePos, mul(normal, -ribbonWidth * 0.5));
    }

    // Draw the continuous dorsal specular ribbon
    const tempColor = new THREE.Color();
    for (let node = startNode; node < endNode; node += 1) {
      const uFrac = (node - startNode) / (endNode - startNode);
      // Subtle traveling caustic water ripple modulation along the spine
      const caustic = Math.sin(node * 1.5 - this.currentTime * 3.2 + fish.swimPhase) * 0.16 + 0.84;
      const spineTaper = Math.sin(uFrac * Math.PI) * 0.35 + 0.65;
      const segAlpha = specularAlpha * caustic * spineTaper;

      tempColor.copy(baseHighlightColor);

      target.triangle(
        dorsalLeft[node],
        dorsalRight[node],
        dorsalRight[node + 1],
        tempColor,
        segAlpha,
      );
      target.triangle(
        dorsalLeft[node],
        dorsalRight[node + 1],
        dorsalLeft[node + 1],
        tempColor,
        segAlpha,
      );
    }

    // 2. SNOUT & FOREHEAD SPECULAR SHEEN (Vùng trán & chóp đầu bắt sáng)
    // The head is a curved dome that catches environmental sky and sunlight
    const headForward = normalize(
      sub(fish.renderSpine[0], fish.renderSpine[1]),
      fromAngle(fish.heading),
    );
    const headNormal = perpendicular(headForward);
    const headSunDot = headNormal.x * lightDir.x + headNormal.y * lightDir.y;
    const headCloudShift =
      -(headNormal.x * fishCloud.gradientX + headNormal.y * fishCloud.gradientY) *
      0.3 *
      this.weather.cloudStrength;
    const headLateral = Math.max(-0.4, Math.min(0.4, headSunDot * 0.28 + headCloudShift));

    const foreheadCenter = add(
      lerp(fish.renderSpine[0], fish.renderSpine[1], 0.35),
      mul(headNormal, headLateral * this.widthAt(fish, 0) * depthScale),
    );
    const headRadius = fish.bodyWidth * depthScale * (0.28 + 0.08 * (1.0 - sunClearance));
    target.circle(
      foreheadCenter,
      headRadius,
      baseHighlightColor,
      specularAlpha * 1.15,
      8,
    );

    // 3. PECTORAL FIN LEADING EDGE GLINT (Ánh sáng trên viền vây ngực)
    if (sunClearance > 0.2) {
      const finAlpha = specularAlpha * 0.5 * (sunClearance - 0.2);
      const pectoralCenter = 4;
      const pectoralNormal = perpendicular(
        normalize(
          sub(fish.renderSpine[pectoralCenter - 1], fish.renderSpine[pectoralCenter + 1]),
          fromAngle(fish.heading),
        ),
      );
      const finPulse = 0.85 + 0.2 * Math.sin(fish.swimPhase * 0.64 + fish.phaseOffset);
      const reach = fish.bodyWidth * depthScale * 0.7 * finPulse;

      const pLeft = add(fish.renderSpine[pectoralCenter], mul(pectoralNormal, reach * 0.65));
      const pRight = add(fish.renderSpine[pectoralCenter], mul(pectoralNormal, -reach * 0.65));
      target.circle(pLeft, fish.bodyWidth * depthScale * 0.12, baseHighlightColor, finAlpha, 5);
      target.circle(pRight, fish.bodyWidth * depthScale * 0.12, baseHighlightColor, finAlpha, 5);
    }
  }

  private drawDebug(fish: Koi, appearance: FishAppearance): void {
    for (let node = 0; node < SPINE_NODES - 1; node += 1) {
      this.shallowOutlineLines.line(
        fish.renderSpine[node],
        fish.renderSpine[node + 1],
        appearance.eye,
        1.0,
      );
    }
  }
}
