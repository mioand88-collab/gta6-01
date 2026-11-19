// audio.js — every sound in SOLMARA is synthesised with WebAudio: no audio
// files are shipped. Engine hum, sirens, gunshots, pickups, UI clicks and a
// looping synthwave-ish music track, all generated from oscillators and noise.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.musicOn = true;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = null;
    this.nextNoteTime = 0;
    this.step = 0;
    this.started = false;
  }

  // Must be called from a user gesture at least once.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this.startMusic();
    this.started = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ---- music: a slow 8-step loop, Am – F – C – G, pad + bass + hats ----
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    // Chords as frequencies (Hz). A minor, F major, C major, G major.
    this.chords = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [130.81, 196.0, 261.63],
      [196.0, 246.94, 293.66],
    ];
    this.bassNotes = [55.0, 43.65, 65.41, 49.0];
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    const tick = () => {
      if (!this.ctx) return;
      const stepDur = 0.42;
      while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
        this.scheduleStep(this.step, this.nextNoteTime, stepDur);
        this.nextNoteTime += stepDur;
        this.step = (this.step + 1) % 32;
      }
    };
    this.musicTimer = setInterval(tick, 120);
  }

  scheduleStep(step, t, dur) {
    if (!this.musicOn || this.muted) return;
    const chord = this.chords[Math.floor(step / 8) % 4];
    const bass = this.bassNotes[Math.floor(step / 8) % 4];
    // Pad chord on the first step of each bar.
    if (step % 8 === 0) {
      for (const f of chord) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = 4;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.4);
        g.gain.linearRampToValueAtTime(0.0, t + dur * 8);
        const flt = this.ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = 900;
        o.connect(flt); flt.connect(g); g.connect(this.musicGain);
        o.start(t); o.stop(t + dur * 8 + 0.1);
      }
    }
    // Bass on beats 0 and 4.
    if (step % 8 === 0 || step % 8 === 4) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = bass;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 3.5);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + dur * 3.6);
    }
    // Hat tick on odd steps.
    if (step % 2 === 1) {
      const n = this.noiseBuffer();
      const src = this.ctx.createBufferSource();
      src.buffer = n;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'highpass';
      flt.frequency.value = 6000;
      src.connect(flt); flt.connect(g); g.connect(this.musicGain);
      src.start(t); src.stop(t + 0.06);
    }
  }

  noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  // ---- car engine: two detuned saws whose pitch follows speed ----
  startEngine() {
    if (!this.ctx || this.engineOsc) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 27;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  setEngine(speedNorm, on) {
    if (!this.ctx) return;
    this.startEngine();
    const t = this.ctx.currentTime;
    const target = on ? 0.05 + speedNorm * 0.06 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.1);
    const f = 52 + speedNorm * 140;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(380 + speedNorm * 900, t, 0.1);
  }

  // ---- police siren: alternating two-tone square wave ----
  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'square';
      this.sirenOsc.frequency.value = 700;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.9;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 180;
      this.sirenLfo.connect(lfoGain);
      lfoGain.connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0.028;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.sirenLfo.start();
    } else if (!on && this.sirenOsc) {
      try { this.sirenOsc.stop(); this.sirenLfo.stop(); } catch (e) { /* already stopped */ }
      this.sirenOsc.disconnect();
      this.sirenLfo.disconnect();
      this.sirenOsc = null;
      this.sirenLfo = null;
    }
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shoot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 1800;
    src.connect(flt); flt.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + 0.14);
    this.blip(160, 0.09, 'square', 0.25);
  }

  punch() {
    this.blip(90, 0.08, 'square', 0.3);
  }

  explosion() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.playbackRate.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 500;
    src.connect(flt); flt.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + 1);
    this.blip(55, 0.7, 'sine', 0.5);
  }

  pickup() {
    this.blip(660, 0.1, 'sine', 0.25);
    setTimeout(() => this.blip(990, 0.14, 'sine', 0.25), 90);
  }

  cash() {
    this.blip(880, 0.08, 'triangle', 0.25);
    setTimeout(() => this.blip(1174, 0.08, 'triangle', 0.25), 80);
    setTimeout(() => this.blip(1568, 0.16, 'triangle', 0.25), 160);
  }

  busted() {
    this.blip(220, 0.3, 'sawtooth', 0.25);
    setTimeout(() => this.blip(174, 0.5, 'sawtooth', 0.25), 220);
  }

  horn() {
    this.blip(370, 0.18, 'square', 0.12);
    setTimeout(() => this.blip(370, 0.18, 'square', 0.12), 220);
  }

  click() {
    this.blip(520, 0.06, 'sine', 0.2);
  }

  missionDone() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.18, 'triangle', 0.28), i * 110));
  }
}
