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
  fromAngle,
  lerp,
  mul,
  normalize,
  perpendicular,
  sub,
  type Vec2,
} from "./math";
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

const TRIANGLE_FLOAT_CAPACITY = 72_000;
const LINE_FLOAT_CAPACITY = 18_000;
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
  void main() {
    #if defined( USE_COLOR_ALPHA )
      vColor = color;
    #elif defined( USE_COLOR )
      vColor = vec4(color, 1.0);
    #else
      vColor = vec4(1.0);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fishFragmentShader = /* glsl */ `
  precision highp float;
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
  }
`;

function createFishMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fishVertexShader,
    fragmentShader: fishFragmentShader,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createReflectionMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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
  private cursor = 0;
  private previewOrigin: Vec2 | null = null;
  private previewScale = 1;

  public constructor(
    private readonly geometry: THREE.BufferGeometry,
    capacity: number,
    includeColors = false,
  ) {
    this.values = new Float32Array(capacity);
    this.attribute = new THREE.BufferAttribute(this.values, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.attribute);
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT),
    );
    if (includeColors) {
      this.colorValues = new Float32Array((capacity / 3) * 4);
      this.colorAttribute = new THREE.BufferAttribute(this.colorValues, 4);
      this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute("color", this.colorAttribute);
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

  public point(point: Vec2, color: THREE.Color = DEFAULT_COLOR, alpha = 1): void {
    if (this.cursor + 3 > this.values.length) return;
    const vertexIndex = this.cursor / 3;
    this.values[this.cursor] = this.previewOrigin
      ? CANVAS_WIDTH * 0.5 + (point.x - this.previewOrigin.x) * this.previewScale
      : point.x;
    this.values[this.cursor + 1] = this.previewOrigin
      ? CANVAS_HEIGHT * 0.5 + (point.y - this.previewOrigin.y) * this.previewScale
      : point.y;
    this.values[this.cursor + 2] = 0;
    if (this.colorValues) {
      const colorIndex = vertexIndex * 4;
      this.colorValues[colorIndex] = color.r;
      this.colorValues[colorIndex + 1] = color.g;
      this.colorValues[colorIndex + 2] = color.b;
      this.colorValues[colorIndex + 3] = alpha;
    }
    this.cursor += 3;
  }

  public triangle(
    a: Vec2,
    b: Vec2,
    c: Vec2,
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
  ): void {
    this.point(a, color, alpha);
    this.point(b, color, alpha);
    this.point(c, color, alpha);
  }

  public line(
    a: Vec2,
    b: Vec2,
    color: THREE.Color = DEFAULT_COLOR,
    alpha = 1,
  ): void {
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
  }
}

export class FishRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly bedScene = new THREE.Scene();
  private readonly shadowScene = new THREE.Scene();
  private readonly fishShadowScene = new THREE.Scene();
  private readonly deepFishScene = new THREE.Scene();
  private readonly shallowFishScene = new THREE.Scene();
  private readonly surfaceScene = new THREE.Scene();
  private readonly surfaceShadowScene = new THREE.Scene();
  private readonly surfaceObjectScene = new THREE.Scene();
  private readonly weatherScene = new THREE.Scene();
  private readonly blurScene = new THREE.Scene();
  private readonly deepCompositeScene = new THREE.Scene();
  private readonly shadowCompositeScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(
    0,
    CANVAS_WIDTH,
    0,
    CANVAS_HEIGHT,
    -10,
    10,
  );
  private readonly surfaceCamera = new THREE.Camera();
  private readonly underwaterTarget: THREE.WebGLRenderTarget;
  private readonly compositeTarget: THREE.WebGLRenderTarget;
  private readonly deepFishTarget: THREE.WebGLRenderTarget;
  private readonly blurIntermediateTarget: THREE.WebGLRenderTarget;
  private readonly deepFishBlurredTarget: THREE.WebGLRenderTarget;
  private readonly underwaterShadowTarget: THREE.WebGLRenderTarget;
  private readonly underwaterShadowBlurredTarget: THREE.WebGLRenderTarget;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blurMesh: THREE.Mesh;
  private readonly deepCompositeMaterial: THREE.ShaderMaterial;
  private readonly deepCompositeMesh: THREE.Mesh;
  private readonly shadowCompositeMaterial: THREE.ShaderMaterial;
  private readonly shadowCompositeMesh: THREE.Mesh;
  private readonly pondBed: PondBedPass;
  private readonly surfaceDisturbance = new SurfaceDisturbancePass();
  private readonly waterSurface: WaterSurfacePass;
  private readonly weather: WeatherPass;
  private readonly tinyFishRenderer = new TinyFishRenderer();
  private readonly duckweed = new DuckweedPass();
  private readonly lotusLeaves = new LotusLeavesPass();
  private readonly butterflies = new ButterflyPass();
  private readonly dragonfly = new DragonflyPass();
  private readonly fishShadowMaterial = shadowMaterial(1);
  private readonly shadowTriangles: GeometryBatch;
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

    this.underwaterTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
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

    this.deepFishTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.deepFishTarget.texture.generateMipmaps = false;

    this.blurIntermediateTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.blurIntermediateTarget.texture.generateMipmaps = false;

    this.deepFishBlurredTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.deepFishBlurredTarget.texture.generateMipmaps = false;

    this.underwaterShadowTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.underwaterShadowTarget.texture.generateMipmaps = false;

    this.underwaterShadowBlurredTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.underwaterShadowBlurredTarget.texture.generateMipmaps = false;

    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uDirection: { value: new THREE.Vector2() },
        uRadius: { value: 2.0 },
      },
      vertexShader: blurVertexShader,
      fragmentShader: blurFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blurMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    this.blurMesh.frustumCulled = false;
    this.blurScene.add(this.blurMesh);

    this.deepCompositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
      },
      vertexShader: blurVertexShader,
      fragmentShader: deepCompositeFragmentShader,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.deepCompositeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.deepCompositeMaterial,
    );
    this.deepCompositeMesh.frustumCulled = false;
    this.deepCompositeScene.add(this.deepCompositeMesh);

    this.shadowCompositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
      },
      vertexShader: blurVertexShader,
      fragmentShader: deepCompositeFragmentShader,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.shadowCompositeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.shadowCompositeMaterial,
    );
    this.shadowCompositeMesh.frustumCulled = false;
    this.shadowCompositeScene.add(this.shadowCompositeMesh);

    this.pondBed = new PondBedPass();
    this.waterSurface = new WaterSurfacePass(
      this.underwaterTarget.texture,
      this.surfaceDisturbance.texture,
    );
    this.weather = new WeatherPass(this.compositeTarget.texture);
    this.bedScene.add(this.pondBed.mesh);
    this.shadowScene.add(
      this.lotusLeaves.shadowGroup,
      this.tinyFishRenderer.shadowGroup,
    );
    this.shallowFishScene.add(this.tinyFishRenderer.group);
    this.surfaceScene.add(this.waterSurface.mesh);
    this.surfaceShadowScene.add(
      this.duckweed.shadowGroup,
      this.butterflies.shadowGroup,
      this.dragonfly.shadowGroup,
    );
    this.surfaceObjectScene.add(
      this.duckweed.group,
      this.lotusLeaves.group,
      this.butterflies.group,
      this.dragonfly.group,
    );
    this.weatherScene.add(this.weather.mesh);

    const shadowGeometry = new THREE.BufferGeometry();
    shadowGeometry.name = "fish shadows";
    this.shadowTriangles = new GeometryBatch(
      shadowGeometry,
      TRIANGLE_FLOAT_CAPACITY,
      true,
    );
    const shadowMesh = new THREE.Mesh(shadowGeometry, this.fishShadowMaterial);
    shadowMesh.frustumCulled = false;
    this.fishShadowScene.add(shadowMesh);

    // Deep fish layer geometry and meshes (softly blurred in rendering loop)
    const deepWhiteGeometry = new THREE.BufferGeometry();
    const deepBlackGeometry = new THREE.BufferGeometry();
    const deepLineGeometry = new THREE.BufferGeometry();
    const deepReflectionGeometry = new THREE.BufferGeometry();
    deepWhiteGeometry.name = "deep fish silhouettes";
    deepBlackGeometry.name = "deep fish markings";
    deepLineGeometry.name = "deep fish debug lines";
    deepReflectionGeometry.name = "deep fish reflections";
    this.deepOuterTriangles = new GeometryBatch(deepWhiteGeometry, TRIANGLE_FLOAT_CAPACITY, true);
    this.deepBodyTriangles = new GeometryBatch(deepBlackGeometry, TRIANGLE_FLOAT_CAPACITY, true);
    this.deepOutlineLines = new GeometryBatch(deepLineGeometry, LINE_FLOAT_CAPACITY, true);
    this.deepReflectionTriangles = new GeometryBatch(deepReflectionGeometry, TRIANGLE_FLOAT_CAPACITY, true);

    const deepOuterMesh = new THREE.Mesh(deepWhiteGeometry, createFishMaterial());
    const deepBodyMesh = new THREE.Mesh(deepBlackGeometry, createFishMaterial());
    const deepLines = new THREE.LineSegments(deepLineGeometry, createFishMaterial());
    const deepReflectionMesh = new THREE.Mesh(deepReflectionGeometry, createReflectionMaterial());
    deepOuterMesh.frustumCulled = false;
    deepBodyMesh.frustumCulled = false;
    deepLines.frustumCulled = false;
    deepReflectionMesh.frustumCulled = false;
    deepOuterMesh.renderOrder = 1;
    deepBodyMesh.renderOrder = 2;
    deepLines.renderOrder = 3;
    deepReflectionMesh.renderOrder = 4;
    this.deepFishScene.add(deepOuterMesh, deepBodyMesh, deepLines, deepReflectionMesh);

    // Shallow fish layer geometry and meshes (pin-sharp foreground surface fish)
    const whiteGeometry = new THREE.BufferGeometry();
    const blackGeometry = new THREE.BufferGeometry();
    const lineGeometry = new THREE.BufferGeometry();
    const shallowReflectionGeometry = new THREE.BufferGeometry();
    whiteGeometry.name = "fish silhouettes";
    blackGeometry.name = "fish markings";
    lineGeometry.name = "fish debug lines";
    shallowReflectionGeometry.name = "shallow fish reflections";
    this.shallowOuterTriangles = new GeometryBatch(whiteGeometry, TRIANGLE_FLOAT_CAPACITY, true);
    this.shallowBodyTriangles = new GeometryBatch(blackGeometry, TRIANGLE_FLOAT_CAPACITY, true);
    this.shallowOutlineLines = new GeometryBatch(lineGeometry, LINE_FLOAT_CAPACITY, true);
    this.shallowReflectionTriangles = new GeometryBatch(shallowReflectionGeometry, TRIANGLE_FLOAT_CAPACITY, true);

    const outerMesh = new THREE.Mesh(whiteGeometry, createFishMaterial());
    const bodyMesh = new THREE.Mesh(blackGeometry, createFishMaterial());
    const lines = new THREE.LineSegments(lineGeometry, createFishMaterial());
    const shallowReflectionMesh = new THREE.Mesh(shallowReflectionGeometry, createReflectionMaterial());
    outerMesh.frustumCulled = false;
    bodyMesh.frustumCulled = false;
    lines.frustumCulled = false;
    shallowReflectionMesh.frustumCulled = false;
    outerMesh.renderOrder = 1;
    bodyMesh.renderOrder = 2;
    lines.renderOrder = 3;
    shallowReflectionMesh.renderOrder = 4;
    this.shallowFishScene.add(outerMesh, bodyMesh, lines, shallowReflectionMesh);
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
    this.deepFishTarget.setSize(width, height);
    this.blurIntermediateTarget.setSize(width, height);
    this.deepFishBlurredTarget.setSize(width, height);
    this.underwaterShadowTarget.setSize(width, height);
    this.underwaterShadowBlurredTarget.setSize(width, height);
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
    this.deepFishTarget.dispose();
    this.blurIntermediateTarget.dispose();
    this.deepFishBlurredTarget.dispose();
    this.underwaterShadowTarget.dispose();
    this.underwaterShadowBlurredTarget.dispose();
    this.surfaceDisturbance.dispose();
    this.fishShadowMaterial.dispose();
    this.blurMaterial.dispose();
    this.deepCompositeMaterial.dispose();
    this.shadowCompositeMaterial.dispose();
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
    }

    this.weather.update(time);

    if (this.previousAppearanceTime >= 0) {
      const deltaTime = Math.min(
        0.1,
        Math.max(0, time - this.previousAppearanceTime),
      );
      const blend = 1 - Math.exp(-deltaTime * 2.25);
      this.fishShadowMaterial.uniforms.uColor.value.lerp(
        this.targetFishShadowColor,
        blend,
      );
    }
    this.previousAppearanceTime = time;
    this.shadowTriangles.reset();
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
      this.shadowTriangles,
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

    this.shadowTriangles.commit();
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
    this.lotusLeaves.update(time, school.ripples);
    this.butterflies.update(time);
    this.dragonfly.update(time, school);

    // 1. Render all underwater shadows and apply soft Gaussian blur if enabled
    const shadowBlurRadius = WATER.shadowBlur ?? 1.0;
    if (shadowBlurRadius > 0.05) {
      this.renderer.setRenderTarget(this.underwaterShadowTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.shadowScene, this.camera);
      this.renderer.render(this.fishShadowScene, this.camera);

      // Horizontal blur pass on underwater shadows
      this.renderer.setRenderTarget(this.blurIntermediateTarget);
      this.renderer.clear();
      this.blurMaterial.uniforms.uTexture.value = this.underwaterShadowTarget.texture;
      this.blurMaterial.uniforms.uDirection.value.set(1.0 / CANVAS_WIDTH, 0.0);
      this.blurMaterial.uniforms.uRadius.value = shadowBlurRadius;
      this.renderer.render(this.blurScene, this.surfaceCamera);

      // Vertical blur pass on underwater shadows
      this.renderer.setRenderTarget(this.underwaterShadowBlurredTarget);
      this.renderer.clear();
      this.blurMaterial.uniforms.uTexture.value = this.blurIntermediateTarget.texture;
      this.blurMaterial.uniforms.uDirection.value.set(0.0, 1.0 / CANVAS_HEIGHT);
      this.blurMaterial.uniforms.uRadius.value = shadowBlurRadius;
      this.renderer.render(this.blurScene, this.surfaceCamera);
    } else {
      this.renderer.setRenderTarget(this.underwaterShadowBlurredTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.shadowScene, this.camera);
      this.renderer.render(this.fishShadowScene, this.camera);
    }

    // 2. If deep fish exist, render and apply separable Gaussian blur
    if (this.deepOuterTriangles.hasContent) {
      const fishBlurRadius = WATER.underwaterBlur ?? 0.75;
      if (fishBlurRadius > 0.05) {
        this.renderer.setRenderTarget(this.deepFishTarget);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
        this.renderer.render(this.deepFishScene, this.camera);

        // Horizontal blur pass
        this.renderer.setRenderTarget(this.blurIntermediateTarget);
        this.renderer.clear();
        this.blurMaterial.uniforms.uTexture.value = this.deepFishTarget.texture;
        this.blurMaterial.uniforms.uDirection.value.set(1.0 / CANVAS_WIDTH, 0.0);
        this.blurMaterial.uniforms.uRadius.value = fishBlurRadius;
        this.renderer.render(this.blurScene, this.surfaceCamera);

        // Vertical blur pass
        this.renderer.setRenderTarget(this.deepFishBlurredTarget);
        this.renderer.clear();
        this.blurMaterial.uniforms.uTexture.value = this.blurIntermediateTarget.texture;
        this.blurMaterial.uniforms.uDirection.value.set(0.0, 1.0 / CANVAS_HEIGHT);
        this.blurMaterial.uniforms.uRadius.value = fishBlurRadius;
        this.renderer.render(this.blurScene, this.surfaceCamera);
      } else {
        this.renderer.setRenderTarget(this.deepFishBlurredTarget);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
        this.renderer.render(this.deepFishScene, this.camera);
      }
    }

    // 3. Render underwater target with depth-parallax composition
    this.renderer.setRenderTarget(this.underwaterTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.autoClear = false;

    // 3a. Pond bed
    this.renderer.render(this.bedScene, this.camera);

    // 3b. Soft blurred underwater shadows
    this.shadowCompositeMaterial.uniforms.uTexture.value = this.underwaterShadowBlurredTarget.texture;
    this.renderer.render(this.shadowCompositeScene, this.surfaceCamera);

    // 3c. Composite blurred deep fish under shallow fish
    if (this.deepOuterTriangles.hasContent) {
      this.deepCompositeMaterial.uniforms.uTexture.value = this.deepFishBlurredTarget.texture;
      this.renderer.render(this.deepCompositeScene, this.surfaceCamera);
    }

    // 3d. Render sharp surface fish on top!
    this.renderer.render(this.shallowFishScene, this.camera);
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.clear();
    this.renderer.render(this.surfaceScene, this.surfaceCamera);
    this.renderer.autoClear = false;
    this.renderer.render(this.surfaceShadowScene, this.camera);
    this.renderer.render(this.surfaceObjectScene, this.camera);
    this.renderer.autoClear = true;
    this.weather.update(time);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.weatherScene, this.surfaceCamera);
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
    this.applyDepthColor(source.base, target.base, visualDepth);
    this.applyDepthColor(source.accent, target.accent, visualDepth);
    this.applyDepthColor(source.marking, target.marking, visualDepth);
    this.applyDepthColor(source.fin, target.fin, visualDepth);
    this.applyDepthColor(source.eye, target.eye, visualDepth);
  }

  private applyDepthColor(
    source: THREE.Color,
    target: THREE.Color,
    visualDepth: number,
  ): void {
    // Preserve crystal clarity and luminosity underwater ("độ trong của nước")
    const depthDim = 1.0 - visualDepth * 0.06; // Very subtle dimming to preserve pristine transparency
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

  private addShadowTriangle(a: Vec2, b: Vec2, c: Vec2): void {
    const shadowOffset = {
      x:
        FISH.shadow.offset.x +
        FISH.shadow.depthOffset.x * this.currentVisualDepth,
      y:
        FISH.shadow.offset.y +
        FISH.shadow.depthOffset.y * this.currentVisualDepth,
    };
    // Deep fish cast softer diffuse shadows because water scatters sunlight
    const opacity =
      (FISH.shadow.surfaceOpacity +
      (FISH.shadow.deepOpacity - FISH.shadow.surfaceOpacity) *
        this.currentVisualDepth) *
      (1.0 - this.currentVisualDepth * 0.45);
    this.shadowStrengthColor.setRGB(
      opacity,
      opacity,
      opacity,
    );
    this.shadowTriangles.triangle(
      add(a, shadowOffset),
      add(b, shadowOffset),
      add(c, shadowOffset),
      this.shadowStrengthColor,
    );
  }

  private addShadowCircle(center: Vec2, radius: number): void {
    const shadowOffset = {
      x:
        FISH.shadow.offset.x +
        FISH.shadow.depthOffset.x * this.currentVisualDepth,
      y:
        FISH.shadow.offset.y +
        FISH.shadow.depthOffset.y * this.currentVisualDepth,
    };
    const opacity =
      (FISH.shadow.surfaceOpacity +
      (FISH.shadow.deepOpacity - FISH.shadow.surfaceOpacity) *
        this.currentVisualDepth) *
      (1.0 - this.currentVisualDepth * 0.45);
    this.shadowStrengthColor.setRGB(
      opacity,
      opacity,
      opacity,
    );
    this.shadowTriangles.circle(
      add(center, shadowOffset),
      radius,
      this.shadowStrengthColor,
    );
  }

  private drawKoiShadow(fish: Koi): void {
    const left: Vec2[] = [];
    const right: Vec2[] = [];

    for (let node = 0; node < SPINE_NODES; node += 1) {
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(
        sub(fish.renderSpine[previous], fish.renderSpine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(tangent);
      const halfWidth = this.widthAt(fish, node);
      left[node] = add(fish.renderSpine[node], mul(normal, halfWidth));
      right[node] = add(fish.renderSpine[node], mul(normal, -halfWidth));
    }

    const pectoralFront = 3;
    const pectoralCenter = 4;
    const pectoralBack = 6;
    const pectoralTangent = normalize(
      sub(fish.renderSpine[pectoralCenter - 1], fish.renderSpine[pectoralCenter + 1]),
      fromAngle(fish.heading),
    );
    const pectoralNormal = perpendicular(pectoralTangent);
    const gulpProgress =
      fish.gulpAnimation / Math.max(FISH.feeding.animationDurationSeconds, 0.001);
    const gulpPaddle = Math.sin(Math.PI * gulpProgress) * 0.85;
    const paddleActivity =
      (fish.state === SwimState.Hover ? 1 : fish.state === SwimState.Pivot ? 0.85 : 0.45)
      + gulpPaddle;
    const finPulse =
      0.82 +
      paddleActivity * 0.25 * Math.sin(fish.swimPhase * 0.64 + fish.phaseOffset);
    const pectoralReach =
      fish.bodyWidth * (0.55 + paddleActivity * 0.25) * finPulse;
    const leftPectoral = add(
      add(left[pectoralCenter], mul(pectoralNormal, pectoralReach)),
      mul(pectoralTangent, -fish.bodyWidth * 0.22),
    );
    const rightPectoral = add(
      add(right[pectoralCenter], mul(pectoralNormal, -pectoralReach)),
      mul(pectoralTangent, -fish.bodyWidth * 0.22),
    );
    this.addShadowTriangle(left[pectoralFront], leftPectoral, left[pectoralBack]);
    this.addShadowTriangle(right[pectoralFront], rightPectoral, right[pectoralBack]);

    const pelvicFront = 7;
    const pelvicCenter = 8;
    const pelvicBack = 9;
    const pelvicTangent = normalize(
      sub(fish.renderSpine[pelvicCenter - 1], fish.renderSpine[pelvicCenter + 1]),
      fromAngle(fish.heading),
    );
    const pelvicNormal = perpendicular(pelvicTangent);
    const pelvicReach = fish.bodyWidth * (0.28 + 0.05 * finPulse);
    const leftPelvic = add(left[pelvicCenter], mul(pelvicNormal, pelvicReach));
    const rightPelvic = add(right[pelvicCenter], mul(pelvicNormal, -pelvicReach));
    this.addShadowTriangle(left[pelvicFront], leftPelvic, left[pelvicBack]);
    this.addShadowTriangle(right[pelvicFront], rightPelvic, right[pelvicBack]);

    for (let node = SPINE_NODES - 2; node >= 0; node -= 1) {
      this.addShadowTriangle(left[node], right[node], right[node + 1]);
      this.addShadowTriangle(left[node], right[node + 1], left[node + 1]);
    }

    const headForward = normalize(
      sub(fish.renderSpine[0], fish.renderSpine[1]),
      fromAngle(fish.heading),
    );
    const headNormal = perpendicular(headForward);
    const noseCenter = add(fish.renderSpine[0], mul(headForward, fish.bodyWidth * 0.43));
    const noseHalfWidth = this.widthAt(fish, 0) * 0.72;
    const noseLeft = add(noseCenter, mul(headNormal, noseHalfWidth));
    const noseRight = add(noseCenter, mul(headNormal, -noseHalfWidth));
    this.addShadowTriangle(left[0], noseLeft, noseRight);
    this.addShadowTriangle(left[0], noseRight, right[0]);
    this.addShadowCircle(noseCenter, Math.max(1, noseHalfWidth * 0.72));

    const tailNode = SPINE_NODES - 1;
    const tailForward = normalize(
      sub(fish.renderSpine[tailNode - 1], fish.renderSpine[tailNode]),
      fromAngle(fish.heading),
    );
    const tailNormal = perpendicular(tailForward);
    const tailBackward = mul(tailForward, -1);
    const tailSpread =
      fish.bodyWidth * (0.58 + 0.08 * Math.sin(fish.swimPhase - 0.8));
    const upperFin = add(
      add(fish.renderSpine[tailNode], mul(tailBackward, fish.bodyWidth * 1.38)),
      mul(tailNormal, tailSpread),
    );
    const lowerFin = add(
      add(fish.renderSpine[tailNode], mul(tailBackward, fish.bodyWidth * 1.38)),
      mul(tailNormal, -tailSpread),
    );
    const tailNotch = add(
      fish.renderSpine[tailNode],
      mul(tailBackward, fish.bodyWidth * 0.86),
    );
    this.addShadowTriangle(fish.renderSpine[tailNode], upperFin, tailNotch);
    this.addShadowTriangle(fish.renderSpine[tailNode], tailNotch, lowerFin);

    // Dorsal fin shadow (vây lưng) along mid-spine
    const dorsalStart = 4;
    const dorsalEnd = 8;
    const dorsalTips: Vec2[] = [];
    for (let node = dorsalStart; node <= dorsalEnd; node += 1) {
      const prev = Math.max(0, node - 1);
      const nxt = Math.min(SPINE_NODES - 1, node + 1);
      const tan = normalize(
        sub(fish.renderSpine[prev], fish.renderSpine[nxt]),
        fromAngle(fish.heading),
      );
      const norm = perpendicular(tan);
      const u = (node - dorsalStart) / (dorsalEnd - dorsalStart);
      const profile = Math.sin(u * Math.PI);
      const finHeight = fish.bodyWidth * (0.08 + profile * 0.28);
      const sway = Math.sin(fish.swimPhase - node * 0.75) * fish.bodyWidth * 0.16;
      dorsalTips[node] = add(
        add(fish.renderSpine[node], mul(tan, -finHeight * 0.7)),
        mul(norm, sway),
      );
    }
    for (let node = dorsalStart; node < dorsalEnd; node += 1) {
      this.addShadowTriangle(
        fish.renderSpine[node],
        dorsalTips[node],
        dorsalTips[node + 1],
      );
      this.addShadowTriangle(
        fish.renderSpine[node],
        dorsalTips[node + 1],
        fish.renderSpine[node + 1],
      );
    }
  }

  private drawKoiGeometry(
    fish: Koi,
    appearance: FishAppearance,
    targetOuter: GeometryBatch,
    targetBody: GeometryBatch,
    alpha: number,
    depthScale: number,
  ): void {
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    const finAlpha = alpha * 0.88;

    for (let node = 0; node < SPINE_NODES; node += 1) {
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(
        sub(fish.renderSpine[previous], fish.renderSpine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(tangent);
      const halfWidth = this.widthAt(fish, node) * depthScale;
      left[node] = add(fish.renderSpine[node], mul(normal, halfWidth));
      right[node] = add(fish.renderSpine[node], mul(normal, -halfWidth));
    }

    const pectoralFront = 3;
    const pectoralCenter = 4;
    const pectoralBack = 6;
    const pectoralTangent = normalize(
      sub(fish.renderSpine[pectoralCenter - 1], fish.renderSpine[pectoralCenter + 1]),
      fromAngle(fish.heading),
    );
    const pectoralNormal = perpendicular(pectoralTangent);
    const gulpProgress =
      fish.gulpAnimation / Math.max(FISH.feeding.animationDurationSeconds, 0.001);
    const gulpPaddle = Math.sin(Math.PI * gulpProgress) * 0.85;
    const paddleActivity =
      (fish.state === SwimState.Hover ? 1 : fish.state === SwimState.Pivot ? 0.85 : 0.45)
      + gulpPaddle;
    const finPulse =
      0.82 +
      paddleActivity * 0.25 * Math.sin(fish.swimPhase * 0.64 + fish.phaseOffset);
    const pectoralReach =
      fish.bodyWidth * depthScale * (0.55 + paddleActivity * 0.25) * finPulse;
    const leftPectoral = add(
      add(left[pectoralCenter], mul(pectoralNormal, pectoralReach)),
      mul(pectoralTangent, -fish.bodyWidth * depthScale * 0.22),
    );
    const rightPectoral = add(
      add(right[pectoralCenter], mul(pectoralNormal, -pectoralReach)),
      mul(pectoralTangent, -fish.bodyWidth * depthScale * 0.22),
    );
    targetOuter.triangle(
      left[pectoralFront],
      leftPectoral,
      left[pectoralBack],
      appearance.fin,
      finAlpha,
    );
    targetOuter.triangle(
      right[pectoralFront],
      right[pectoralBack],
      rightPectoral,
      appearance.fin,
      finAlpha,
    );

    const pelvicFront = 7;
    const pelvicCenter = 8;
    const pelvicBack = 9;
    const pelvicTangent = normalize(
      sub(fish.renderSpine[pelvicCenter - 1], fish.renderSpine[pelvicCenter + 1]),
      fromAngle(fish.heading),
    );
    const pelvicNormal = perpendicular(pelvicTangent);
    const pelvicReach = fish.bodyWidth * depthScale * (0.28 + 0.05 * finPulse);
    const leftPelvic = add(left[pelvicCenter], mul(pelvicNormal, pelvicReach));
    const rightPelvic = add(right[pelvicCenter], mul(pelvicNormal, -pelvicReach));
    targetOuter.triangle(
      left[pelvicFront],
      leftPelvic,
      left[pelvicBack],
      appearance.fin,
      finAlpha,
    );
    targetOuter.triangle(
      right[pelvicFront],
      right[pelvicBack],
      rightPelvic,
      appearance.fin,
      finAlpha,
    );

    for (let node = SPINE_NODES - 2; node >= 0; node -= 1) {
      targetOuter.triangle(
        left[node],
        right[node],
        right[node + 1],
        appearance.base,
        alpha,
      );
      targetOuter.triangle(
        left[node],
        right[node + 1],
        left[node + 1],
        appearance.base,
        alpha,
      );
    }

    const headForward = normalize(
      sub(fish.renderSpine[0], fish.renderSpine[1]),
      fromAngle(fish.heading),
    );
    const headNormal = perpendicular(headForward);
    const noseCenter = add(
      fish.renderSpine[0],
      mul(headForward, fish.bodyWidth * depthScale * 0.43),
    );
    const noseHalfWidth = this.widthAt(fish, 0) * depthScale * 0.72;
    const noseLeft = add(noseCenter, mul(headNormal, noseHalfWidth));
    const noseRight = add(noseCenter, mul(headNormal, -noseHalfWidth));
    targetOuter.triangle(left[0], noseLeft, noseRight, appearance.base, alpha);
    targetOuter.triangle(left[0], noseRight, right[0], appearance.base, alpha);
    targetOuter.circle(
      noseCenter,
      Math.max(1, noseHalfWidth * 0.72),
      appearance.base,
      alpha,
    );

    const tailNode = SPINE_NODES - 1;
    const tailForward = normalize(
      sub(fish.renderSpine[tailNode - 1], fish.renderSpine[tailNode]),
      fromAngle(fish.heading),
    );
    const tailNormal = perpendicular(tailForward);
    const tailBackward = mul(tailForward, -1);
    const tailSpread =
      fish.bodyWidth * depthScale * (0.58 + 0.08 * Math.sin(fish.swimPhase - 0.8));
    const upperFin = add(
      add(fish.renderSpine[tailNode], mul(tailBackward, fish.bodyWidth * depthScale * 1.38)),
      mul(tailNormal, tailSpread),
    );
    const lowerFin = add(
      add(fish.renderSpine[tailNode], mul(tailBackward, fish.bodyWidth * depthScale * 1.38)),
      mul(tailNormal, -tailSpread),
    );
    const tailNotch = add(
      fish.renderSpine[tailNode],
      mul(tailBackward, fish.bodyWidth * depthScale * 0.86),
    );
    targetOuter.triangle(
      fish.renderSpine[tailNode],
      upperFin,
      tailNotch,
      appearance.fin,
      finAlpha,
    );
    targetOuter.triangle(
      fish.renderSpine[tailNode],
      tailNotch,
      lowerFin,
      appearance.fin,
      finAlpha,
    );

    // Pattern positions are authored in normalized body space. The shapes sample
    // the live spine, so they stay attached when the fish bends and turns.
    for (const [patchIndex, patch] of patchesFor(appearance).entries()) {
      const spinePosition = patch.position * (SPINE_NODES - 1);
      const node = Math.min(SPINE_NODES - 2, Math.floor(spinePosition));
      const amount = spinePosition - node;
      const center = lerp(fish.renderSpine[node], fish.renderSpine[node + 1], amount);
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 2);
      const forward = normalize(
        sub(fish.renderSpine[previous], fish.renderSpine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(forward);
      const localWidth =
        (this.widthAt(fish, node) * (1 - amount) +
          this.widthAt(fish, node + 1) * amount) *
        depthScale;
      const patchCenter = add(center, mul(normal, localWidth * patch.offset));
      const patchColor =
        patch.color === "accent" ? appearance.accent : appearance.marking;

      targetBody.ellipse(
        patchCenter,
        forward,
        normal,
        fish.bodyLength * depthScale * patch.length,
        localWidth * patch.width,
        patchColor,
        patchIndex * 1.73 + patch.position * 5.1,
        alpha,
      );
    }

    const eyeAnchor = add(
      fish.renderSpine[0],
      mul(headForward, fish.bodyWidth * depthScale * 0.08),
    );
    const eyeOffset = this.widthAt(fish, 0) * depthScale * 0.58;
    const eyeRadius = Math.max(0.58, fish.bodyWidth * depthScale * 0.11);
    targetBody.circle(
      add(eyeAnchor, mul(headNormal, eyeOffset)),
      eyeRadius,
      appearance.eye,
      alpha,
      6,
    );
    targetBody.circle(
      add(eyeAnchor, mul(headNormal, -eyeOffset)),
      eyeRadius,
      appearance.eye,
      alpha,
      6,
    );

    // Dorsal fin (vây lưng) along mid-spine (nodes 4 to 8)
    const dorsalStart = 4;
    const dorsalEnd = 8;
    const dorsalTips: Vec2[] = [];
    for (let node = dorsalStart; node <= dorsalEnd; node += 1) {
      const prev = Math.max(0, node - 1);
      const nxt = Math.min(SPINE_NODES - 1, node + 1);
      const tan = normalize(
        sub(fish.renderSpine[prev], fish.renderSpine[nxt]),
        fromAngle(fish.heading),
      );
      const norm = perpendicular(tan);
      const u = (node - dorsalStart) / (dorsalEnd - dorsalStart);
      const profile = Math.sin(u * Math.PI);
      const finHeight = fish.bodyWidth * depthScale * (0.08 + profile * 0.28);
      const sway = Math.sin(fish.swimPhase - node * 0.75) * fish.bodyWidth * depthScale * 0.16;
      dorsalTips[node] = add(
        add(fish.renderSpine[node], mul(tan, -finHeight * 0.7)),
        mul(norm, sway),
      );
    }

    for (let node = dorsalStart; node < dorsalEnd; node += 1) {
      targetBody.triangle(
        fish.renderSpine[node],
        dorsalTips[node],
        dorsalTips[node + 1],
        appearance.fin,
        finAlpha * 0.95,
      );
      targetBody.triangle(
        fish.renderSpine[node],
        dorsalTips[node + 1],
        fish.renderSpine[node + 1],
        appearance.fin,
        finAlpha * 0.95,
      );
    }
  }

  private drawKoi(fish: Koi, appearance: FishAppearance, isPreview = false): void {
    this.currentVisualDepth = this.visualDepth(fish.depth);
    this.drawKoiShadow(fish);

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
