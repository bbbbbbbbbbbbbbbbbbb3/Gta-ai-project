// Procedural Web Audio: no files to download, works offline and in sandboxes.
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private engine!: OscillatorNode;
  private engineGain!: GainNode;
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;
  muted = false;
  musicOn = true;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Looping wind tied to speed
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    src.connect(this.windFilter).connect(this.wind).connect(this.sfxBus);
    src.start();

    // Engine hum
    this.engine = ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 50;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(lp).connect(this.engineGain).connect(this.sfxBus);
    this.engine.start();
    this.startMusic();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, when = 0, bus?: GainNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', slide?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  fire() {
    this.tone(880, 0.12, 'square', 0.12, 220);
    this.tone(1760, 0.06, 'sine', 0.08, 600);
  }
  hit() {
    this.tone(160, 0.18, 'sine', 0.45, 60);
    this.burst(0.12, 0.3, 1800);
    this.tone(620, 0.1, 'triangle', 0.15, 900, 0.05);
  }
  spark() {
    this.burst(0.08, 0.15, 3000, 'highpass');
  }
  ring() {
    this.tone(988, 0.25, 'sine', 0.22);
    this.tone(1319, 0.35, 'sine', 0.2, undefined, 0.08);
    this.tone(1976, 0.4, 'triangle', 0.08, undefined, 0.16);
  }
  thwip() {
    this.burst(0.18, 0.3, 600, 'bandpass', 4000);
  }
  release() {
    this.burst(0.1, 0.12, 2500, 'bandpass', 800);
  }
  land(power: number) {
    this.tone(90, 0.2, 'sine', Math.min(0.5, 0.1 + power * 0.03), 45);
    this.burst(0.15, Math.min(0.25, power * 0.02), 700);
  }
  grab() {
    this.tone(300, 0.06, 'square', 0.06, 180);
  }
  crash(power: number) {
    this.burst(0.35, Math.min(0.6, power * 0.04), 900);
    this.tone(70, 0.3, 'sine', Math.min(0.5, power * 0.03), 40);
  }
  horn() {
    this.tone(392, 0.35, 'square', 0.12);
    this.tone(494, 0.35, 'square', 0.1);
  }
  door() {
    this.tone(220, 0.08, 'square', 0.1, 110);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.18, undefined, i * 0.12));
  }
  ui() {
    this.tone(660, 0.05, 'sine', 0.08);
  }

  setWind(speed: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.max(0, Math.min(1, (speed - 6) / 30));
    this.wind.gain.setTargetAtTime(v * 0.35, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + v * 1400, t, 0.1);
  }

  setEngine(on: boolean, speed: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.07 + Math.min(0.06, speed * 0.002) : 0, t, 0.08);
    this.engine.frequency.setTargetAtTime(45 + Math.abs(speed) * 4.5, t, 0.08);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.1);
  }

  // Bouncy 4-chord loop, scheduled with lookahead so it stays in time.
  private startMusic() {
    const ctx = this.ctx!;
    const chords = [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ];
    const bpm = 112;
    const sixteenth = 60 / bpm / 4;
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    this.nextNote = ctx.currentTime + 0.1;
    const tick = () => {
      while (this.nextNote < ctx.currentTime + 0.2) {
        const bar = Math.floor(this.step / 16) % 4;
        const s = this.step % 16;
        const ch = chords[bar];
        const when = this.nextNote - ctx.currentTime;
        if (s % 2 === 0) this.tone(midi(ch[(s / 2) % 3] + 12), sixteenth * 1.6, 'triangle', 0.18, undefined, when, this.musicBus);
        if (s === 0 || s === 8) this.tone(midi(ch[0] - 12), sixteenth * 6, 'sine', 0.5, undefined, when, this.musicBus);
        if (s === 6 || s === 14) this.tone(midi(ch[0] - 12), sixteenth * 1.5, 'sine', 0.35, undefined, when, this.musicBus);
        if (s % 4 === 0) this.tone(120, 0.12, 'sine', 0.5, 45, when, this.musicBus); // kick
        if (s % 8 === 4) this.burstAt(when, 0.1, 0.25, 2500); // snare-ish
        this.nextNote += sixteenth;
        this.step++;
      }
    };
    this.musicTimer = window.setInterval(tick, 50);
  }

  private burstAt(when: number, dur: number, vol: number, freq: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  dispose() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
