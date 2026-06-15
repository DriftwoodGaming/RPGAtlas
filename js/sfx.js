/* RPGAtlas — sfx.js
   Procedural WebAudio sound effects + generative chiptune music. GPL-3.0-or-later (see LICENSE). */
"use strict";

const Sfx = (() => {
  let actx = null;
  function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function tone(freq, dur, type, vol, slideTo) {
    try {
      const a = ctx(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(vol || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  function noise(dur, vol, lp) {
    try {
      const a = ctx(), t = a.currentTime;
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource(); src.buffer = buf;
      const g = a.createGain();
      g.gain.setValueAtTime(vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = src;
      if (lp) {
        const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp;
        src.connect(f); node = f;
      }
      node.connect(g); g.connect(a.destination);
      src.start(t);
    } catch (e) { /* audio unavailable */ }
  }
  function arp(freqs, step, dur, type, vol) {
    freqs.forEach((f, i) => setTimeout(() => tone(f, dur, type, vol), i * step));
  }

  const fx = {
    cursor: () => tone(880, 0.05, "square", 0.04, 1100),
    ok: () => { tone(660, 0.06, "square", 0.05); setTimeout(() => tone(990, 0.08, "square", 0.05), 50); },
    cancel: () => tone(330, 0.09, "square", 0.05, 220),
    buzzer: () => tone(160, 0.18, "sawtooth", 0.07),
    hit: () => { noise(0.12, 0.12, 1200); tone(220, 0.1, "square", 0.06, 90); },
    crit: () => { noise(0.16, 0.15, 2000); tone(330, 0.14, "square", 0.08, 80); },
    magic: () => { tone(440, 0.22, "sine", 0.07, 1760); setTimeout(() => noise(0.1, 0.05, 4000), 80); },
    heal: () => arp([523, 659, 784, 1047], 70, 0.18, "triangle", 0.07),
    item: () => arp([700, 940], 70, 0.1, "square", 0.05),
    chest: () => arp([392, 523, 659, 784], 80, 0.16, "square", 0.05),
    door: () => { tone(180, 0.08, "square", 0.05); setTimeout(() => noise(0.06, 0.05, 800), 40); },
    levelup: () => arp([523, 659, 784, 1047, 1319], 90, 0.24, "triangle", 0.08),
    save: () => arp([784, 988, 1175], 90, 0.22, "sine", 0.06),
    escape: () => { noise(0.18, 0.07, 2500); tone(300, 0.18, "square", 0.04, 900); },
    miss: () => tone(500, 0.07, "sine", 0.04, 300),
    encounter: () => { tone(110, 0.3, "sawtooth", 0.07, 55); noise(0.2, 0.08, 600); },
    gameover: () => arp([392, 370, 349, 330], 220, 0.4, "triangle", 0.07),
  };

  function play(name) { if (fx[name]) fx[name](); }

  // ---------- generative music ----------
  function mulberry(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const THEMES = {
    title:   { tempo: 84,  root: 57, scale: [0, 3, 5, 7, 10], seed: 11, lead: "triangle", density: 0.55, bassEvery: 4 },
    town:    { tempo: 104, root: 60, scale: [0, 2, 4, 7, 9],  seed: 23, lead: "square",   density: 0.6,  bassEvery: 2 },
    field:   { tempo: 112, root: 55, scale: [0, 2, 4, 7, 9],  seed: 37, lead: "square",   density: 0.65, bassEvery: 2 },
    cave:    { tempo: 80,  root: 50, scale: [0, 2, 3, 7, 8],  seed: 53, lead: "triangle", density: 0.4,  bassEvery: 4 },
    battle:  { tempo: 148, root: 52, scale: [0, 2, 3, 5, 7, 8, 11], seed: 71, lead: "sawtooth", density: 0.8, bassEvery: 1, drums: true },
    gameover:{ tempo: 60,  root: 48, scale: [0, 2, 3, 7, 8],  seed: 5,  lead: "triangle", density: 0.3,  bassEvery: 4 },
  };
  let musicTimer = null, currentTheme = null, stepIdx = 0, melodyPos = 0, themeRng = null;

  function noteFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function musicStep(th) {
    const beat = stepIdx % 16;
    // bass
    if (beat % (th.bassEvery * 2) === 0) {
      const prog = [0, 0, -4, -2];                       // simple progression by bar
      const bar = Math.floor(stepIdx / 16) % 4;
      tone(noteFreq(th.root - 12 + prog[bar]), 0.22, "triangle", 0.055);
    }
    // drums (battle)
    if (th.drums) {
      if (beat % 4 === 0) noise(0.06, 0.07, 400);
      else if (beat % 2 === 0) noise(0.03, 0.03, 6000);
    }
    // melody — seeded random walk on the scale
    if (themeRng() < th.density) {
      const move = Math.floor(themeRng() * 5) - 2;
      melodyPos = Math.max(0, Math.min(th.scale.length * 2 - 1, melodyPos + move));
      const oct = Math.floor(melodyPos / th.scale.length);
      const deg = th.scale[melodyPos % th.scale.length];
      tone(noteFreq(th.root + 12 + oct * 12 + deg), 0.14, th.lead, 0.035);
    }
    stepIdx++;
  }

  const Music = {
    enabled: true,
    current: null,
    play(name) {
      if (!this.enabled) { this.current = name; return; }
      if (name === this.current && musicTimer) return;
      this.stop();
      const th = THEMES[name];
      this.current = name;
      if (!th || name === "none") return;
      currentTheme = th; stepIdx = 0; melodyPos = th.scale.length;
      themeRng = mulberry(th.seed);
      const interval = (60 / th.tempo / 2) * 1000; // 8th notes
      musicStep(th);
      musicTimer = setInterval(() => musicStep(th), interval);
    },
    stop() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      this.current = null;
    },
    setEnabled(on) {
      this.enabled = on;
      if (!on) { const c = this.current; this.stop(); this.current = c; }
      else if (this.current) { const c = this.current; this.current = null; this.play(c); }
    },
  };

  return { play, tone, noise, Music, THEMES: Object.keys(THEMES) };
})();
const Music = Sfx.Music;
if (typeof window !== "undefined") {
  window.Sfx = Sfx;
  window.Music = Music;
}
