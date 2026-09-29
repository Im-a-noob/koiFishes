/**
 * Procedural Realistic Rain Soundscape Engine for Nagomi Pond.
 *
 * Simulates the soothing, natural acoustics of rain falling on an open water pond
 * and floating lotus leaves using Web Audio API:
 * 1. Filtered pink noise rain bed with dual-band water & spray acoustic resonance.
 * 2. Subtle wind/drift LFO modulation for dynamic atmospheric depth.
 * 3. Individual raindrop impact generator: procedural water plops, leaf thuds, and
 *    droplet splashes randomly scattered across the stereo field.
 */

export class RainAudioEngine {
  private readonly context: AudioContext;
  private readonly masterGain: GainNode;
  private readonly rainBedGain: GainNode;
  private readonly dropletGain: GainNode;

  // Rain bed audio nodes
  private rainBedSource: AudioBufferSourceNode | null = null;
  private lowpassFilter: BiquadFilterNode;
  private bandpassFilter: BiquadFilterNode;
  private highshelfFilter: BiquadFilterNode;
  private lfoGain: GainNode;
  private lfoOscillator: OscillatorNode | null = null;

  // Granular raindrop scheduler
  private dropletBuffers: AudioBuffer[] = [];
  private dropletTimer: number | null = null;
  private isRunning = false;
  private currentVolume = 0;

  public constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;

    // Master rain gain
    this.masterGain = context.createGain();
    this.masterGain.gain.setValueAtTime(0, context.currentTime);
    this.masterGain.connect(destination);

    // 1. Setup continuous rain bed path
    this.rainBedGain = context.createGain();
    this.rainBedGain.gain.value = 0.55;

    // Filter pipeline:
    // - Highpass/Lowpass shaping to simulate rain on water
    this.lowpassFilter = context.createBiquadFilter();
    this.lowpassFilter.type = "lowpass";
    this.lowpassFilter.frequency.value = 4800;
    this.lowpassFilter.Q.value = 0.6;

    this.bandpassFilter = context.createBiquadFilter();
    this.bandpassFilter.type = "peaking";
    this.bandpassFilter.frequency.value = 1600;
    this.bandpassFilter.Q.value = 0.9;
    this.bandpassFilter.gain.value = 3.5;

    this.highshelfFilter = context.createBiquadFilter();
    this.highshelfFilter.type = "highshelf";
    this.highshelfFilter.frequency.value = 6500;
    this.highshelfFilter.gain.value = -4.0;

    // LFO for subtle natural breeze swells in the rainfall
    this.lfoGain = context.createGain();
    this.lfoGain.gain.value = 1.0;

    this.rainBedGain
      .connect(this.lowpassFilter)
      .connect(this.bandpassFilter)
      .connect(this.highshelfFilter)
      .connect(this.lfoGain)
      .connect(this.masterGain);

    // 2. Setup droplet impact path
    this.dropletGain = context.createGain();
    this.dropletGain.gain.value = 0.48;
    this.dropletGain.connect(this.masterGain);

    // Pre-generate audio buffers
    this.buildRainBedBuffer();
    this.buildDropletBuffers();
  }

  /**
   * Pre-renders a 6-second seamless looping pink noise rain texture
   */
  private buildRainBedBuffer(): void {
    const sampleRate = this.context.sampleRate;
    const length = sampleRate * 6; // 6 seconds
    const buffer = this.context.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      // Paul Kellet's refined pink noise algorithm
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;

        // Apply smooth boundary windowing so the loop seams seamlessly
        const edgeWindow =
          i < 2048
            ? i / 2048
            : i > length - 2048
              ? (length - i) / 2048
              : 1.0;

        data[i] = pink * 0.11 * edgeWindow;
      }
    }

    this.startRainBed(buffer);
  }

  private startRainBed(buffer: AudioBuffer): void {
    if (this.rainBedSource) {
      try {
        this.rainBedSource.stop();
        this.rainBedSource.disconnect();
      } catch {
        // Ignore
      }
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.rainBedGain);
    source.start();
    this.rainBedSource = source;

    // Start subtle atmospheric LFO oscillator
    try {
      const lfo = this.context.createOscillator();
      const lfoAmp = this.context.createGain();
      lfo.type = "sine";
      lfo.frequency.value = 0.18; // Very slow atmospheric breathing
      lfoAmp.gain.value = 0.14; // Subtle +/- 14% modulation
      lfo.connect(lfoAmp);
      lfoAmp.connect(this.lfoGain.gain);
      lfo.start();
      this.lfoOscillator = lfo;
    } catch {
      // Ignore if LFO fails
    }
  }

  /**
   * Synthesizes a diverse palette of 20 realistic raindrop impact wavelets:
   * - Water surface bubble pings & plops (rapid pitch sweep)
   * - Lotus leaf hollow taps
   * - Crisp surface splashes
   */
  private buildDropletBuffers(): void {
    const sampleRate = this.context.sampleRate;
    const count = 20;

    for (let i = 0; i < count; i++) {
      // Durations between 20ms and 55ms
      const isLeafTap = i >= 12 && i < 17;
      const isSplash = i >= 17;
      const durationSeconds = isLeafTap ? 0.045 : isSplash ? 0.022 : 0.038;
      const length = Math.floor(sampleRate * durationSeconds);
      const buffer = this.context.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      // Pitch sweep parameters
      const startFreq = isLeafTap
        ? 380 + Math.random() * 260
        : isSplash
          ? 3200 + Math.random() * 1800
          : 1800 + Math.random() * 1400;

      const endFreq = isLeafTap
        ? startFreq * 0.75
        : isSplash
          ? startFreq * 0.45
          : startFreq * 0.52;

      let phase = 0;
      for (let s = 0; s < length; s++) {
        const t = s / length;
        // Exponential decay envelope
        const envelope = Math.exp(-t * (isLeafTap ? 7.0 : isSplash ? 12.0 : 8.5));
        // Instant micro-attack
        const attack = Math.min(1.0, s / (sampleRate * 0.0015));

        // Frequency sweep
        const currentFreq = startFreq + (endFreq - startFreq) * Math.pow(t, 0.7);
        phase += (2 * Math.PI * currentFreq) / sampleRate;

        // Waveform: Sine tone + subtle harmonic/noise crackle
        const tone = Math.sin(phase);
        const noise = (Math.random() * 2 - 1) * 0.15;
        const sample = (tone * 0.85 + noise) * envelope * attack;

        data[s] = sample * (isLeafTap ? 0.35 : 0.28);
      }

      this.dropletBuffers.push(buffer);
    }
  }

  /**
   * Starts playback and schedules realistic granular raindrops
   */
  public start(targetVolume = 0.4, fadeSeconds = 0.8): void {
    this.isRunning = true;
    this.setVolume(targetVolume, fadeSeconds);

    if (this.dropletTimer === null) {
      this.scheduleDroplets();
    }
  }

  /**
   * Smoothly changes volume with linear or exponential ramp
   */
  public setVolume(volume: number, fadeSeconds = 0.6): void {
    this.currentVolume = Math.max(0, volume);
    const now = this.context.currentTime;
    const gain = this.masterGain.gain;

    gain.cancelAndHoldAtTime(now);
    gain.linearRampToValueAtTime(this.currentVolume, now + fadeSeconds);
  }

  /**
   * Fade out and pause droplet scheduler
   */
  public stop(fadeSeconds = 0.8): void {
    this.isRunning = false;
    this.setVolume(0, fadeSeconds);

    if (this.dropletTimer !== null) {
      window.clearTimeout(this.dropletTimer);
      this.dropletTimer = null;
    }
  }

  /**
   * Schedules bursts of raindrops across the stereo image
   */
  private scheduleDroplets = (): void => {
    if (!this.isRunning && this.currentVolume <= 0.001) {
      this.dropletTimer = null;
      return;
    }

    if (this.context.state === "running" && this.currentVolume > 0.01) {
      // Spawn 1 to 3 drops per scheduling cycle
      const dropCount = Math.floor(Math.random() * 3) + 1;

      for (let i = 0; i < dropCount; i++) {
        const bufferIndex = Math.floor(Math.random() * this.dropletBuffers.length);
        const buffer = this.dropletBuffers[bufferIndex];
        if (!buffer) continue;

        try {
          const source = this.context.createBufferSource();
          source.buffer = buffer;
          // Randomize playback rate for infinite acoustic variety
          source.playbackRate.value = 0.88 + Math.random() * 0.28;

          const dropGain = this.context.createGain();
          dropGain.gain.value = 0.15 + Math.random() * 0.35;

          // Stereo placement across the pond
          if (typeof this.context.createStereoPanner === "function") {
            const panner = this.context.createStereoPanner();
            panner.pan.value = (Math.random() * 2 - 1) * 0.85;
            source.connect(dropGain).connect(panner).connect(this.dropletGain);
          } else {
            source.connect(dropGain).connect(this.dropletGain);
          }

          const delay = Math.random() * 0.04;
          source.start(this.context.currentTime + delay);
        } catch {
          // Ignore transient playback errors
        }
      }
    }

    // Schedule next cycle in 25ms - 55ms
    const nextInterval = 25 + Math.random() * 35;
    this.dropletTimer = window.setTimeout(this.scheduleDroplets, nextInterval);
  };

  public dispose(): void {
    this.stop(0.1);
    if (this.dropletTimer !== null) {
      window.clearTimeout(this.dropletTimer);
      this.dropletTimer = null;
    }
    try {
      this.rainBedSource?.stop();
      this.rainBedSource?.disconnect();
      this.lfoOscillator?.stop();
      this.lfoOscillator?.disconnect();
      this.masterGain.disconnect();
    } catch {
      // Ignore
    }
  }
}
