import * as THREE from "three";
import {
  DEFAULT_WEATHER_PRESET_ID,
  getWeatherPreset,
  type WeatherPreset,
  type WeatherPresetId,
} from "./weather";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uScene;
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uCloudStrength;
  uniform vec3 uLightColor;
  uniform float uLightStrength;
  uniform vec2 uLightDirection;
  uniform float uSunAltitude;
  uniform float uVolumetricRays;
  uniform float uVolumetricMist;
  uniform float uCanopyShadow;
  uniform float uVolumetricRaysEnabled;
  uniform float uCanopyShadowEnabled;
  uniform float uVolumetricMistEnabled;
  uniform vec2 uResolution;
  uniform vec4 uLotusOccluders[8];
  uniform int uLotusOccluderCount;
  varying vec2 vUv;

  // 1. Overhanging Tree Canopy "Komorebi" (Foliage silhouettes swaying over pond)
  float computeCanopyKomorebi(vec2 uv, float time, vec2 lightDir, float canopyStrength) {
    if (canopyStrength <= 0.01) return 1.0;
    
    // Wind breeze sway
    vec2 wind = vec2(sin(time * 0.42), cos(time * 0.34)) * 0.018;
    vec2 gust = vec2(sin(time * 1.05 + uv.y * 2.5), cos(time * 0.85 + uv.x * 2.5)) * 0.009;
    vec2 foliageUv = uv * 3.2 + wind + gust + lightDir * 0.12;
    
    // Multi-scale leaf dapple pattern (Japanese maple / bamboo foliage silhouettes)
    float branch = sin(foliageUv.x * 3.6 + foliageUv.y * 2.2) * cos(foliageUv.y * 4.2 - foliageUv.x * 1.8);
    float leaves1 = sin(foliageUv.x * 9.5 - foliageUv.y * 7.8 + sin(foliageUv.y * 6.2)) * 
                    cos(foliageUv.y * 10.6 + foliageUv.x * 6.4);
    float leaves2 = sin(foliageUv.x * 18.2 + foliageUv.y * 14.6) * 
                    cos(foliageUv.y * 16.8 - foliageUv.x * 12.4);
    
    // Foliage canopy denser towards perimeter and top
    float edgeDensity = smoothstep(0.12, 0.92, 1.0 - uv.y + abs(uv.x - 0.5) * 0.65);
    
    float foliage = branch * 0.42 + leaves1 * 0.38 + leaves2 * 0.20;
    float shadow = smoothstep(-0.22, 0.32, foliage);
    shadow = mix(1.0, shadow, edgeDensity * canopyStrength);
    return clamp(shadow, 0.30, 1.0);
  }

  // 2. Underwater Volumetric Light Shafts (God Rays / "Komorebi" through water)
  float computeVolumetricLightShafts(vec2 uv, float time, vec2 lightDir, float altitude, float rayStrength) {
    if (rayStrength <= 0.01) return 0.0;
    
    vec2 dir = normalize(lightDir);
    // Orthogonal projection along and perpendicular to light rays
    float perpCoord = dot(uv - 0.5, vec2(-dir.y, dir.x));
    float alongCoord = dot(uv - 0.5, dir);
    
    // Slicing ray beams with multi-frequency harmonics
    float beam1 = sin(perpCoord * 16.0 + time * 0.09) * 0.5 + 0.5;
    float beam2 = sin(perpCoord * 32.0 - time * 0.13) * 0.5 + 0.5;
    float beam3 = sin(perpCoord * 54.0 + time * 0.17) * 0.5 + 0.5;
    float shafts = pow(beam1 * 0.52 + beam2 * 0.32 + beam3 * 0.16, 2.3);
    
    // Drifting suspended organic plankton / microsilt particles catching the light
    vec2 particleUv = uv * 36.0 + vec2(time * 0.14, -time * 0.09);
    float particle = sin(particleUv.x * 3.3 + particleUv.y * 2.8) * cos(particleUv.x * 2.1 - particleUv.y * 4.3);
    particle = smoothstep(0.52, 0.95, particle) * 0.75;
    
    shafts = shafts * (1.0 + particle);
    
    // Dynamic volumetric shadow tunnels cast by lotus leaves
    float occlusion = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uLotusOccluderCount) break;
      vec2 leafCenter = uLotusOccluders[i].xy;
      float leafRadius = uLotusOccluders[i].z;
      vec2 toPixel = uv - leafCenter;
      float projAlong = dot(toPixel, dir);
      if (projAlong > -leafRadius * 0.3) {
        float distPerp = abs(dot(toPixel, vec2(-dir.y, dir.x)));
        float shadowCone = leafRadius * (1.0 + max(0.0, projAlong) * 0.35);
        if (distPerp < shadowCone) {
          float shadowFactor = smoothstep(shadowCone, shadowCone * 0.45, distPerp);
          occlusion *= (1.0 - shadowFactor * 0.88);
        }
      }
    }
    
    float altitudeFactor = mix(1.35, 0.75, clamp(altitude, 0.0, 1.0));
    return shafts * occlusion * rayStrength * altitudeFactor;
  }

  // 3. Volumetric Caustic Curtains (Subsurface undulating light sheets)
  float computeCausticCurtains(vec2 uv, float time, vec2 lightDir, float altitude) {
    vec2 dir = normalize(lightDir);
    vec2 projectedUv = uv + dir * 0.05 * (1.0 - altitude);
    float waveA = sin(projectedUv.x * 22.0 + projectedUv.y * 16.0 + time * 0.75);
    float waveB = cos(projectedUv.x * 30.0 - projectedUv.y * 26.0 - time * 0.95);
    float waveC = sin((projectedUv.x + projectedUv.y) * 42.0 + time * 1.25);
    float caustics = pow(max(0.0, (waveA + waveB + waveC) / 3.0), 3.2);
    return caustics * 0.32;
  }

  // 4. Surface Morning Mist & Forward Crepuscular Scattering (Asagiri)
  float computeSurfaceMist(vec2 uv, float time, vec2 lightDir, float altitude, float mistStrength) {
    if (mistStrength <= 0.01) return 0.0;
    
    // Slow gentle breeze drift
    vec2 drift = vec2(time * 0.012, time * 0.007);
    vec2 mUv = uv * 3.4 + drift;
    
    // Multi-octave domain-warped FBM noise for curling mist banks
    float n1 = sin(mUv.x * 3.4 + mUv.y * 2.2) + cos(mUv.y * 3.1 - mUv.x * 1.7);
    vec2 warp = vec2(sin(mUv.y * 3.8 + n1), cos(mUv.x * 3.8 + n1)) * 0.22;
    vec2 warpedUv = mUv + warp;
    
    float mist1 = sin(warpedUv.x * 4.4 + warpedUv.y * 2.9) * 0.5 + 0.5;
    float mist2 = sin(warpedUv.x * 8.8 - warpedUv.y * 6.6 + time * 0.035) * 0.5 + 0.5;
    float mist3 = cos(warpedUv.x * 14.8 + warpedUv.y * 12.2) * 0.5 + 0.5;
    
    float mistPattern = mist1 * 0.52 + mist2 * 0.32 + mist3 * 0.16;
    mistPattern = smoothstep(0.26, 0.82, mistPattern);
    
    // Low-angle grazing forward scattering (crepuscular grazing glow through mist)
    float lowAngle = 1.0 - smoothstep(0.05, 0.70, altitude);
    float forwardScatter = dot(normalize(lightDir), normalize(uv - 0.5)) * 0.5 + 0.5;
    float mistGlow = 1.0 + forwardScatter * lowAngle * 1.4;
    
    return mistPattern * mistStrength * mistGlow * 0.40;
  }

  void main() {
    vec3 color = texture2D(uScene, vUv).rgb;

    // Drifting cloud cover
    float cloudWave =
      sin(vUv.x * 5.2 + vUv.y * 2.1 + uTime * 0.035)
      + sin(vUv.x * 2.3 - vUv.y * 4.7 - uTime * 0.022)
      + sin((vUv.x + vUv.y) * 8.1 + uTime * 0.016);
    cloudWave = cloudWave / 6.0 + 0.5;
    color *= 1.0 - uCloudStrength * (0.06 + cloudWave * 0.20);

    // Apply Overhanging Tree Canopy "Komorebi" shadows
    if (uCanopyShadowEnabled > 0.5) {
      float komorebi = computeCanopyKomorebi(vUv, uTime, uLightDirection, uCanopyShadow);
      color *= komorebi;
    }

    // Color grading & exposure
    color *= uTint * uBrightness;
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, uSaturation);
    color = (color - 0.5) * uContrast + 0.5;

    // Directional sunlight tint
    vec2 centered = vUv - 0.5;
    float directionalLight = dot(centered, normalize(uLightDirection)) + 0.5;
    directionalLight = smoothstep(0.05, 0.95, directionalLight);
    color += uLightColor * directionalLight * uLightStrength;

    // Apply Underwater Volumetric Light Shafts (God rays) and Subsurface Caustic Curtains
    if (uVolumetricRaysEnabled > 0.5) {
      float shafts = computeVolumetricLightShafts(vUv, uTime, uLightDirection, uSunAltitude, uVolumetricRays);
      float caustics = computeCausticCurtains(vUv, uTime, uLightDirection, uSunAltitude) * (uVolumetricRays * 0.5);
      vec3 rayColor = mix(uLightColor, vec3(1.0), 0.35);
      color += rayColor * (shafts * 0.38 + caustics * 0.22);
    }

    // Apply Floating Surface Morning Mist (Asagiri) with low-angle crepuscular forward scattering
    if (uVolumetricMistEnabled > 0.5) {
      float mist = computeSurfaceMist(vUv, uTime, uLightDirection, uSunAltitude, uVolumetricMist);
      vec3 mistColor = mix(vec3(0.82, 0.90, 0.94), uLightColor, 0.45);
      color = mix(color, mistColor, mist);
    }

    // Natural peripheral vignette
    float edge = smoothstep(0.36, 0.76, length(centered * vec2(1.0, 1.3)));
    color *= 1.0 - edge * uVignette;

    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  }
`;

const scalarProperties = [
  "brightness",
  "contrast",
  "saturation",
  "vignette",
  "cloudStrength",
  "lightStrength",
  "sunAltitude",
  "volumetricRays",
  "volumetricMist",
  "canopyShadow",
] as const;

interface WeatherState {
  tint: THREE.Color;
  lightColor: THREE.Color;
  lightDirection: THREE.Vector2;
  brightness: number;
  contrast: number;
  saturation: number;
  vignette: number;
  cloudStrength: number;
  lightStrength: number;
  sunAltitude: number;
  volumetricRays: number;
  volumetricMist: number;
  canopyShadow: number;
}

function stateFromPreset(preset: WeatherPreset): WeatherState {
  return {
    tint: new THREE.Color().setRGB(...preset.tint),
    lightColor: new THREE.Color().setRGB(...preset.lightColor),
    lightDirection: new THREE.Vector2(...preset.lightDirection),
    brightness: preset.brightness,
    contrast: preset.contrast,
    saturation: preset.saturation,
    vignette: preset.vignette,
    cloudStrength: preset.cloudStrength,
    lightStrength: preset.lightStrength,
    sunAltitude: preset.sunAltitude,
    volumetricRays: preset.volumetricRays,
    volumetricMist: preset.volumetricMist,
    canopyShadow: preset.canopyShadow,
  };
}

export class WeatherPass {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  private readonly material: THREE.ShaderMaterial;
  private readonly current = stateFromPreset(
    getWeatherPreset(DEFAULT_WEATHER_PRESET_ID),
  );
  private target = stateFromPreset(getWeatherPreset(DEFAULT_WEATHER_PRESET_ID));
  private previousTime = -1;
  private volumetricRaysEnabled = true;
  private canopyShadowEnabled = true;
  private volumetricMistEnabled = true;

  public constructor(sceneTexture: THREE.Texture) {
    const occluderUniforms: THREE.Vector4[] = Array.from(
      { length: 8 },
      () => new THREE.Vector4(0, 0, 0, 0),
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: sceneTexture },
        uTime: { value: 0 },
        uTint: { value: this.current.tint },
        uBrightness: { value: this.current.brightness },
        uContrast: { value: this.current.contrast },
        uSaturation: { value: this.current.saturation },
        uVignette: { value: this.current.vignette },
        uCloudStrength: { value: this.current.cloudStrength },
        uLightColor: { value: this.current.lightColor },
        uLightStrength: { value: this.current.lightStrength },
        uLightDirection: { value: this.current.lightDirection },
        uSunAltitude: { value: this.current.sunAltitude },
        uVolumetricRays: { value: this.current.volumetricRays },
        uVolumetricMist: { value: this.current.volumetricMist },
        uCanopyShadow: { value: this.current.canopyShadow },
        uVolumetricRaysEnabled: { value: 1.0 },
        uCanopyShadowEnabled: { value: 1.0 },
        uVolumetricMistEnabled: { value: 1.0 },
        uResolution: { value: new THREE.Vector2(480, 270) },
        uLotusOccluders: { value: occluderUniforms },
        uLotusOccluderCount: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
  }

  public setPreset(id: WeatherPresetId): void {
    this.target = stateFromPreset(getWeatherPreset(id));
  }

  public setDayNightState(state: {
    tint: THREE.Color;
    brightness: number;
    contrast: number;
    saturation: number;
    vignette: number;
    cloudStrength: number;
    lightColor: THREE.Color;
    lightStrength: number;
    lightDirection: THREE.Vector2;
    sunAltitude: number;
    volumetricRays: number;
    volumetricMist: number;
    canopyShadow: number;
  }): void {
    this.target.tint.copy(state.tint);
    this.target.lightColor.copy(state.lightColor);
    this.target.lightDirection.copy(state.lightDirection);
    this.target.brightness = state.brightness;
    this.target.contrast = state.contrast;
    this.target.saturation = state.saturation;
    this.target.vignette = state.vignette;
    this.target.cloudStrength = state.cloudStrength;
    this.target.lightStrength = state.lightStrength;
    this.target.sunAltitude = state.sunAltitude;
    this.target.volumetricRays = state.volumetricRays;
    this.target.volumetricMist = state.volumetricMist;
    this.target.canopyShadow = state.canopyShadow;
  }

  public setLotusOccluders(
    occluders: readonly { x: number; y: number; radius: number }[],
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const list = this.material.uniforms.uLotusOccluders.value as THREE.Vector4[];
    const count = Math.min(occluders.length, list.length);
    for (let i = 0; i < count; i += 1) {
      const oc = occluders[i];
      list[i].set(
        oc.x / canvasWidth,
        1.0 - oc.y / canvasHeight,
        oc.radius / canvasWidth,
        0,
      );
    }
    this.material.uniforms.uLotusOccluderCount.value = count;
    this.material.uniforms.uResolution.value.set(canvasWidth, canvasHeight);
  }

  public setVolumetricRaysEnabled(enabled: boolean): void {
    this.volumetricRaysEnabled = enabled;
    this.material.uniforms.uVolumetricRaysEnabled.value = enabled ? 1.0 : 0.0;
  }

  public setCanopyShadowEnabled(enabled: boolean): void {
    this.canopyShadowEnabled = enabled;
    this.material.uniforms.uCanopyShadowEnabled.value = enabled ? 1.0 : 0.0;
  }

  public setVolumetricMistEnabled(enabled: boolean): void {
    this.volumetricMistEnabled = enabled;
    this.material.uniforms.uVolumetricMistEnabled.value = enabled ? 1.0 : 0.0;
  }

  public update(time: number): void {
    const deltaTime =
      this.previousTime < 0 ? 0 : Math.min(0.1, time - this.previousTime);
    this.previousTime = time;
    const blend = 1 - Math.exp(-deltaTime * 2.25);

    this.current.tint.lerp(this.target.tint, blend);
    this.current.lightColor.lerp(this.target.lightColor, blend);
    this.current.lightDirection.lerp(this.target.lightDirection, blend);
    for (const property of scalarProperties) {
      this.current[property] +=
        (this.target[property] - this.current[property]) * blend;
    }

    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uBrightness.value = this.current.brightness;
    this.material.uniforms.uContrast.value = this.current.contrast;
    this.material.uniforms.uSaturation.value = this.current.saturation;
    this.material.uniforms.uVignette.value = this.current.vignette;
    this.material.uniforms.uCloudStrength.value = this.current.cloudStrength;
    this.material.uniforms.uLightStrength.value = this.current.lightStrength;
    this.material.uniforms.uSunAltitude.value = this.current.sunAltitude;
    this.material.uniforms.uVolumetricRays.value = this.current.volumetricRays;
    this.material.uniforms.uVolumetricMist.value = this.current.volumetricMist;
    this.material.uniforms.uCanopyShadow.value = this.current.canopyShadow;
  }

  public getCloudShadowAt(u: number, v: number, time: number): {
    cloudDensity: number;
    sunClearance: number;
    gradientX: number;
    gradientY: number;
  } {
    const p1 = u * 5.2 + v * 2.1 + time * 0.035;
    const p2 = u * 2.3 - v * 4.7 - time * 0.022;
    const p3 = (u + v) * 8.1 + time * 0.016;

    const s1 = Math.sin(p1);
    const s2 = Math.sin(p2);
    const s3 = Math.sin(p3);
    const cloudWave = (s1 + s2 + s3) / 6.0 + 0.5;
    const cloudDensity = Math.max(0, Math.min(1, cloudWave * this.current.cloudStrength));
    const sunClearance = Math.max(0.08, 1.0 - cloudDensity * 1.15);

    const du = (5.2 * Math.cos(p1) + 2.3 * Math.cos(p2) + 8.1 * Math.cos(p3)) / 6.0;
    const dv = (2.1 * Math.cos(p1) - 4.7 * Math.cos(p2) + 8.1 * Math.cos(p3)) / 6.0;

    return {
      cloudDensity,
      sunClearance,
      gradientX: du,
      gradientY: dv,
    };
  }

  public get lightColor(): THREE.Color {
    return this.current.lightColor;
  }

  public get lightDirection(): THREE.Vector2 {
    return this.current.lightDirection;
  }

  public get lightStrength(): number {
    return this.current.lightStrength;
  }

  public get sunAltitude(): number {
    return this.current.sunAltitude;
  }

  public get cloudStrength(): number {
    return this.current.cloudStrength;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
