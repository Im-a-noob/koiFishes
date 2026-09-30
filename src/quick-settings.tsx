import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsColorInput, SettingsSlider } from "./settings-controls";
import { useSetting } from "./settings/react";
import { settings } from "./settings/store";
import type { SectionId } from "./settings/definition";
import { WEATHER_PRESETS, type WeatherPresetId } from "./weather";

interface QuickSettingsProps {
  weather: WeatherPresetId;
  rainEnabled: boolean;
  soundEnabled: boolean;
  dayNightCycleEnabled: boolean;
  dayNightPhase: number;
  dayNightLabel: string;
  dayNightIcon: string;
  volumetricRaysEnabled: boolean;
  canopyShadowEnabled: boolean;
  volumetricMistEnabled: boolean;
  onWeatherChange: (id: WeatherPresetId) => void;
  onRainChange: (enabled: boolean) => void;
  onSoundChange: (enabled: boolean) => void;
  onDayNightCycleChange: (enabled: boolean) => void;
  onDayNightPhaseChange: (phase: number) => void;
  onVolumetricRaysChange: (enabled: boolean) => void;
  onCanopyShadowChange: (enabled: boolean) => void;
  onVolumetricMistChange: (enabled: boolean) => void;
  onResetSection: (sectionIds: readonly SectionId[]) => void;
  onResetAtmosphere: () => void;
  selectedFamily: number;
  previewFamily: number | null;
  onFamilyChange: (index: number) => void;
  onPreviewFamilyChange: (index: number | null) => void;
}

function SettingSlider({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="quick-setting" data-base-ui-swipe-ignore>
      <div className="quick-setting__copy">
        <span className="quick-setting__label">{label}</span>
        <small>{description}</small>
      </div>
      <SettingsSlider
        label={label}
        aria-label={label}
        showLabel={false}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={onChange}
        className="drawer-elastic-slider"
      />
    </div>
  );
}

function hexFromRgb(value: readonly [number, number, number]): string {
  return `#${new THREE.Color().setRGB(...value).getHexString(THREE.SRGBColorSpace)}`;
}

function hexFromInt(value: number): string {
  return `#${value.toString(16).padStart(6, "0").slice(-6)}`;
}

function QuickColor({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="quick-color" data-base-ui-swipe-ignore>
      <Label htmlFor={id}>{label}</Label>
      <SettingsColorInput id={id} value={value} onChange={onChange} />
    </div>
  );
}

export function QuickSettings({
  weather,
  rainEnabled,
  soundEnabled,
  dayNightCycleEnabled,
  dayNightPhase,
  dayNightLabel,
  dayNightIcon,
  volumetricRaysEnabled,
  canopyShadowEnabled,
  volumetricMistEnabled,
  onWeatherChange,
  onRainChange,
  onSoundChange,
  onDayNightCycleChange,
  onDayNightPhaseChange,
  onVolumetricRaysChange,
  onCanopyShadowChange,
  onVolumetricMistChange,
  onResetSection,
  onResetAtmosphere,
  selectedFamily,
  previewFamily,
  onFamilyChange,
  onPreviewFamilyChange,
}: QuickSettingsProps) {
  const paletteIndex = selectedFamily;
  const palettes = settings.live["koi-palettes"];
  const selectedPalette = palettes[paletteIndex] ?? palettes[0];

  const [koiCount, setKoiCount] = useSetting<number>(["koi", "initialCount"]);
  const [base, setBase] = useSetting<number>(["koi-palettes", paletteIndex, "base"]);
  const [accent, setAccent] = useSetting<number>(["koi-palettes", paletteIndex, "accent"]);
  const [marking, setMarking] = useSetting<number>(["koi-palettes", paletteIndex, "marking"]);
  const [fin, setFin] = useSetting<number>(["koi-palettes", paletteIndex, "fin"]);

  const [deepColor, setDeepColor] = useSetting<readonly [number, number, number]>(["pond-bed", "deepColor"]);
  const [shallowColor, setShallowColor] = useSetting<readonly [number, number, number]>(["pond-bed", "shallowColor"]);
  const [clarity, setClarity] = useSetting<number>(["water", "clarity"]);
  const [underwaterBlur, setUnderwaterBlur] = useSetting<number>(["water", "underwaterBlur"]);
  const [shadowBlur, setShadowBlur] = useSetting<number>(["water", "shadowBlur"]);
  const [deepFishOpacity, setDeepFishOpacity] = useSetting<number>(["water", "deepFishOpacity"]);

  const [visibleLeafCount, setVisibleLeafCount] = useSetting<number>(["lotus", "visibleLeafCount"]);
  const [visibleFlowerCount, setVisibleFlowerCount] = useSetting<number>(["lotus", "visibleFlowerCount"]);
  const [lotusRippleReaction, setLotusRippleReaction] = useSetting<number>(["lotus", "rippleReaction"]);
  const [lotusWindBreeze, setLotusWindBreeze] = useSetting<number>(["lotus", "windBreeze"]);
  const [, setDuckweedRippleReaction] = useSetting<number>(["duckweed", "rippleReaction"]);
  const [, setDuckweedWindBreeze] = useSetting<number>(["duckweed", "windBreeze"]);
  const [visiblePatchCount, setVisiblePatchCount] = useSetting<number>(["duckweed", "visiblePatchCount"]);
  const [visibleButterflyCount, setVisibleButterflyCount] = useSetting<number>(["butterflies", "visibleCount"]);

  return (
    <div className="settings-quick">
      <section className="settings-quick__section" aria-labelledby="quick-koi-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-koi-heading">Koi</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["koi", "koi-palettes", "koi-patterns"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Choose how many koi swim in the pond and color each koi family.</p>
        </div>
        <SettingSlider
          label="Koi count"
          description="Add or remove koi without restarting the pond."
          value={koiCount}
          min={1}
          max={48}
          onChange={setKoiCount}
        />
        <div className="quick-setting" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-koi-family">Koi family</Label>
            <small>The colors below change every koi of this pattern.</small>
          </div>
          <select
            id="quick-koi-family"
            className="quick-setting__select"
            value={paletteIndex}
            onChange={(event) => onFamilyChange(Number(event.target.value))}
          >
            {palettes.map((palette, index) => (
              <option key={palette.name} value={index}>{palette.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="family-preview-toggle"
          aria-pressed={previewFamily !== null}
          onClick={() => onPreviewFamilyChange(previewFamily === null ? paletteIndex : null)}
        >
          {previewFamily === null
            ? `Preview ${selectedPalette.name} family in the pond`
            : `Showing ${selectedPalette.name} family · Show all fish`}
        </button>
        <div className="quick-colors">
          <QuickColor id="quick-koi-base" label="Body" value={hexFromInt(base)} onChange={(hex) => setBase(Number.parseInt(hex.slice(1), 16))} />
          <QuickColor id="quick-koi-accent" label="Accent patches" value={hexFromInt(accent)} onChange={(hex) => setAccent(Number.parseInt(hex.slice(1), 16))} />
          <QuickColor id="quick-koi-marking" label="Dark markings" value={hexFromInt(marking)} onChange={(hex) => setMarking(Number.parseInt(hex.slice(1), 16))} />
          <QuickColor id="quick-koi-fin" label="Fins" value={hexFromInt(fin)} onChange={(hex) => setFin(Number.parseInt(hex.slice(1), 16))} />
        </div>
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-water-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-water-heading">Water</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["pond-bed", "water", "ripples"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Change the pond colors and how clearly the koi show through the surface.</p>
        </div>
        <div className="quick-colors">
          <QuickColor
            id="quick-deep-color"
            label="Deep water"
            value={hexFromRgb(deepColor)}
            onChange={(hex) => setDeepColor(new THREE.Color(hex).toArray().map((c) => Number(c.toFixed(4))) as [number, number, number])}
          />
          <QuickColor
            id="quick-shallow-color"
            label="Shallow water"
            value={hexFromRgb(shallowColor)}
            onChange={(hex) => setShallowColor(new THREE.Color(hex).toArray().map((c) => Number(c.toFixed(4))) as [number, number, number])}
          />
        </div>
        <SettingSlider
          label="Water clarity"
          description="Soften surface patterns to make the koi easier to see."
          value={clarity}
          min={0}
          max={1}
          step={0.01}
          onChange={setClarity}
        />
        <SettingSlider
          label="Underwater blur"
          description="Softness of koi swimming at depth. Lower values create crystal-clear water."
          value={underwaterBlur}
          min={0}
          max={3}
          step={0.05}
          onChange={setUnderwaterBlur}
        />
        <SettingSlider
          label="Shadow blur"
          description="Softness of shadows on the pond floor."
          value={shadowBlur}
          min={0}
          max={3}
          step={0.05}
          onChange={setShadowBlur}
        />
        <SettingSlider
          label="Deep fish visibility"
          description="How solid and vivid koi appear when swimming deeper in the pond."
          value={deepFishOpacity}
          min={0.4}
          max={1}
          step={0.01}
          onChange={setDeepFishOpacity}
        />
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-plants-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-plants-heading">Plants &amp; life</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["lotus", "lotus-leaves", "lotus-flowers", "duckweed", "duckweed-patches", "butterflies", "butterfly-spawns"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Fill the edges without changing the koi already swimming.</p>
        </div>
        <SettingSlider
          label="Lotus leaves"
          description="Add floating leaves around the pond."
          value={visibleLeafCount}
          min={0}
          max={32}
          onChange={setVisibleLeafCount}
        />
        <SettingSlider
          label="Lotus flowers"
          description="Place more flowers on the visible leaves."
          value={visibleFlowerCount}
          min={0}
          max={16}
          onChange={setVisibleFlowerCount}
        />
        <SettingSlider
          label="Wave physics reaction"
          description="How gently lotus and floating duckweed react when ripples pass by."
          value={lotusRippleReaction}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(val) => {
            setLotusRippleReaction(val);
            setDuckweedRippleReaction(val);
          }}
        />
        <SettingSlider
          label="Gentle breeze"
          description="Soft ambient wind swaying flowers, leaves, and duckweed across the pond."
          value={lotusWindBreeze}
          min={0}
          max={2}
          step={0.05}
          onChange={(val) => {
            setLotusWindBreeze(val);
            setDuckweedWindBreeze(val);
          }}
        />
        <SettingSlider
          label="Duckweed patches"
          description="Add small clusters of floating greenery."
          value={visiblePatchCount}
          min={0}
          max={16}
          onChange={setVisiblePatchCount}
        />
        <SettingSlider
          label="Butterflies"
          description="Change how many butterflies visit the flowers."
          value={visibleButterflyCount}
          min={0}
          max={12}
          onChange={setVisibleButterflyCount}
        />
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-atmosphere-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-atmosphere-heading">Atmosphere</h3><button type="button" className="settings-section-reset" onClick={onResetAtmosphere}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Choose the light, ripples, and background river sound.</p>
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-daynight">Day/night cycle (10 min)</Label>
            <small>
              {dayNightCycleEnabled
                ? `${dayNightIcon} ${dayNightLabel} (${Math.floor((dayNightPhase * 600) / 60)}m ${String(Math.floor((dayNightPhase * 600) % 60)).padStart(2, "0")}s) — continuous 10-minute daylight & moonlight flow.`
                : "Smoothly transition ambient lighting, pond hues, and cloud shadows over 10 minutes."}
            </small>
          </div>
          <Switch id="quick-daynight" checked={dayNightCycleEnabled} onCheckedChange={onDayNightCycleChange} />
        </div>
        {dayNightCycleEnabled && (
          <div className="quick-setting" data-base-ui-swipe-ignore>
            <div className="quick-setting__copy">
              <Label htmlFor="quick-time-scrub">Time of day ({Math.floor((dayNightPhase * 600) / 60)}:{String(Math.floor((dayNightPhase * 600) % 60)).padStart(2, "0")})</Label>
              <small>Drag to jump to any point in the 10-minute cycle.</small>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
              <input
                id="quick-time-scrub"
                type="range"
                min="0"
                max="1"
                step="0.005"
                value={dayNightPhase}
                onChange={(e) => onDayNightPhaseChange(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#e6a817" }}
              />
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="settings-section-reset"
                  onClick={() => onDayNightPhaseChange(0.0)}
                >
                  🌅 Dawn
                </button>
                <button
                  type="button"
                  className="settings-section-reset"
                  onClick={() => onDayNightPhaseChange(0.33)}
                >
                  ☀️ Midday
                </button>
                <button
                  type="button"
                  className="settings-section-reset"
                  onClick={() => onDayNightPhaseChange(0.63)}
                >
                  🌇 Sunset
                </button>
                <button
                  type="button"
                  className="settings-section-reset"
                  onClick={() => onDayNightPhaseChange(0.90)}
                >
                  🌙 Moonlight
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="quick-setting" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-weather">Weather</Label>
            <small>A preset changes its own pond colors and lighting.</small>
          </div>
          <select
            id="quick-weather"
            className="quick-setting__select"
            value={weather}
            onChange={(event) => onWeatherChange(event.target.value as WeatherPresetId)}
          >
            {WEATHER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-volumetric-rays">Volumetric God rays</Label>
            <small>Luminous shafts of sunlight & moonlight slicing through the water column.</small>
          </div>
          <Switch id="quick-volumetric-rays" checked={volumetricRaysEnabled} onCheckedChange={onVolumetricRaysChange} />
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-canopy-komorebi">Canopy Komorebi</Label>
            <small>Overhanging tree branches swaying in the breeze casting dappled leaf shadows.</small>
          </div>
          <Switch id="quick-canopy-komorebi" checked={canopyShadowEnabled} onCheckedChange={onCanopyShadowChange} />
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-volumetric-mist">Morning Mist (Asagiri)</Label>
            <small>Gentle drifting surface fog with low-angle grazing crepuscular light.</small>
          </div>
          <Switch id="quick-volumetric-mist" checked={volumetricMistEnabled} onCheckedChange={onVolumetricMistChange} />
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-rain">Rain ripples</Label>
            <small>Show raindrops spreading across the surface.</small>
          </div>
          <Switch id="quick-rain" checked={rainEnabled} onCheckedChange={onRainChange} />
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-sound">River sound</Label>
            <small>Play the gentle background recording. Off by default.</small>
          </div>
          <Switch id="quick-sound" checked={soundEnabled} onCheckedChange={onSoundChange} />
        </div>
      </section>
    </div>
  );
}
