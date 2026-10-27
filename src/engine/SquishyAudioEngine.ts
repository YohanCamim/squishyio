import { InteractionMode, SquishyAudioProps } from '../core/types';

/**
 * Moteur audio ASMR 100% synthétisé (Web Audio API pure, aucun fichier externe).
 * Chaque profil SquishyAudioProfile possède une signature sonore dédiée :
 *  - foam-slow     : souffle d'air étouffé de mousse mémoire de forme
 *  - taba-jelly    : squelch gluant de gel silicone (le "pop" Taba)
 *  - mochi-puff    : bouffée sourde et poudrée
 *  - crispy-sugar  : micro-crépitement sucré + corps mousseux
 */

type AudioCtx = AudioContext;

interface WindowWithWebkitAudio {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class SquishyAudioEngine {
  private ctx: AudioCtx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, t, 0.02);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Effet d'écrasement / pression, déclenché au pointerdown. */
  playSquish(audioProps: SquishyAudioProps, intensity: number, mode: InteractionMode): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const t0 = ctx.currentTime + 0.01;
    const vol = clamp(audioProps.volume, 0, 1) * (0.3 + 0.7 * clamp(intensity, 0, 1));
    const pitch = clamp(audioProps.pitch, 0.5, 1.8);

    switch (audioProps.profile) {
      case 'foam-slow':
        this.synthFoam(ctx, t0, vol, pitch, mode);
        break;
      case 'taba-jelly':
        this.synthJelly(ctx, t0, vol, pitch, mode);
        break;
      case 'mochi-puff':
        this.synthPuff(ctx, t0, vol, pitch, mode);
        break;
      case 'crispy-sugar':
        this.synthCrispy(ctx, t0, vol, pitch, mode);
        break;
    }
  }

  /** Souffle de reprise de forme au relâchement (durée pilotée par recoverySpeed). */
  playRelease(audioProps: SquishyAudioProps, recoverySpeed: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const t0 = ctx.currentTime + 0.01;
    const vol = clamp(audioProps.volume, 0, 1) * 0.55;
    const pitch = clamp(audioProps.pitch, 0.5, 1.8);
    const dur = 0.25 + (1 - clamp(recoverySpeed, 0, 1)) * 1.5;

    // Souffle ascendant (la mousse qui se regonfle)
    const src = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(320, t0);
    bp.frequency.exponentialRampToValueAtTime(1500 * pitch, t0 + dur * 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * 0.3, t0 + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);

    // Rebond de gelée quand la reprise est rapide
    if (recoverySpeed > 0.22) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150 * pitch, t0);
      osc.frequency.exponentialRampToValueAtTime(520 * pitch, t0 + dur * 0.7);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.linearRampToValueAtTime(vol * 0.18, t0 + 0.05);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
      osc.connect(og);
      og.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
  }

  /** Petit "pop" de fin de pression. */
  playPop(pitch = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const t0 = ctx.currentTime + 0.01;
    const p = clamp(pitch, 0.5, 1.8);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(780 * p, t0);
    osc.frequency.exponentialRampToValueAtTime(130 * p, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.28, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.18);

    const src = this.noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.linearRampToValueAtTime(0.1, t0 + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.05);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
    }
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  // --- synthèse interne ---------------------------------------------------

  private ensureContext(): AudioCtx | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const w = window as unknown as WindowWithWebkitAudio;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private noise(ctx: AudioCtx): AudioBuffer {
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== ctx.sampleRate) {
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  private noiseSource(ctx: AudioCtx): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    return src;
  }

  private synthFoam(ctx: AudioCtx, t0: number, vol: number, pitch: number, mode: InteractionMode): void {
    const dur = (mode === 'squeeze' ? 0.58 : mode === 'slap' ? 0.24 : 0.42) * (0.8 + pitch * 0.2);

    const src = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(1500 * pitch, t0);
    lp.frequency.exponentialRampToValueAtTime(320, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * 0.5, t0 + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.05);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(85 * pitch, t0 + dur * 0.9);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.linearRampToValueAtTime(vol * 0.22, t0 + 0.025);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
    osc.connect(og);
    og.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private synthJelly(ctx: AudioCtx, t0: number, vol: number, pitch: number, mode: InteractionMode): void {
    // Corps "gluant" : sinus glissant vers le grave
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(80 * pitch, t0 + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * 0.5, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.34);

    // Bruit humide (squelch du gel)
    const src = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(1100 * pitch, t0);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + 0.24);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.linearRampToValueAtTime(vol * 0.28, t0 + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.master!);
    src.start(t0);
    src.stop(t0 + 0.32);

    if (mode === 'slap') {
      const click = this.noiseSource(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2600;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(vol * 0.35, t0 + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      click.connect(hp);
      hp.connect(cg);
      cg.connect(this.master!);
      click.start(t0);
      click.stop(t0 + 0.06);
    }
  }

  private synthPuff(ctx: AudioCtx, t0: number, vol: number, pitch: number, mode: InteractionMode): void {
    const dur = mode === 'squeeze' ? 0.36 : 0.26;

    const src = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(900 * pitch, t0);
    lp.frequency.exponentialRampToValueAtTime(260, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * 0.42, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.05);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(120 * pitch, t0 + dur * 0.8);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.linearRampToValueAtTime(vol * 0.18, t0 + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
    osc.connect(og);
    og.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private synthCrispy(ctx: AudioCtx, t0: number, vol: number, pitch: number, mode: InteractionMode): void {
    // Corps mousseux
    const src = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400 * pitch, t0);
    lp.frequency.exponentialRampToValueAtTime(400, t0 + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * 0.3, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start(t0);
    src.stop(t0 + 0.32);

    // Grains de sucre
    const grains = mode === 'slap' ? 12 : 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < grains; i++) {
      const t = t0 + i * (0.012 + Math.random() * 0.03);
      const gs = this.noiseSource(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200 + Math.random() * 1800;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(vol * 0.16, t + 0.001);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
      gs.connect(hp);
      hp.connect(gg);
      gg.connect(this.master!);
      gs.start(t);
      gs.stop(t + 0.03);
    }
  }
}
