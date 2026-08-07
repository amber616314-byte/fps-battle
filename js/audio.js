// ============================================================
// audio.js — 程序化音效引擎（Web Audio API 合成，支持 3D 定位）
// 所有枪声/爆炸/脚步均为实时合成，无需任何音频文件
// ============================================================

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.listener = null;
    this.noiseBuf = null;
    this.windNodes = null;
    this.initialized = false;
    this.samples = {};      // 已解码样本缓存 name -> AudioBuffer
    this.surface = 'concrete';
    this.musicSrc = null;
    this.musicGain = null;
  }

  init() {
    if (this.initialized) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    this.listener = this.ctx.listener;
    // 预生成 1 秒白噪声缓冲
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.initialized = true;
    this.startWind();
    this.loadSamples(); // 异步加载真实音效样本，不阻塞游戏
  }

  setSurface(s) { this.surface = s; }

  // ---------- 真实音效样本（本地下载的 CC0 素材，分批解码避免峰值卡顿） ----------
  async loadSamples() {
    if (!this.ctx) return;
    const base = 'assets/audio/';
    const gun = [];
    for (let i = 1; i <= 24; i++) gun.push(`${base}oga/gunshots/gunshot_${i}.wav`);
    const gr = [], co = [];
    for (let i = 0; i < 5; i++) {
      gr.push(`${base}impact/Audio/footstep_grass_00${i}.ogg`);
      co.push(`${base}impact/Audio/footstep_concrete_00${i}.ogg`);
    }
    const jobs = [
      { key: 'music', urls: [`${base}music/battleThemeA.mp3`] },
      { key: 'gun', urls: gun },
      { key: 'stepGrass', urls: gr },
      { key: 'stepConcrete', urls: co },
      { key: 'explosion', urls: [`${base}scifi/Audio/explosionCrunch_000.ogg`, `${base}scifi/Audio/explosionCrunch_001.ogg`, `${base}scifi/Audio/explosionCrunch_002.ogg`] },
      { key: 'explosionLow', urls: [`${base}scifi/Audio/lowFrequency_explosion_000.ogg`, `${base}scifi/Audio/lowFrequency_explosion_001.ogg`] },
      { key: 'hitMetal', urls: [`${base}scifi/Audio/impactMetal_000.ogg`, `${base}scifi/Audio/impactMetal_001.ogg`] },
      { key: 'hitWood', urls: [`${base}impact/Audio/impactWood_medium_000.ogg`, `${base}impact/Audio/impactWood_medium_001.ogg`] },
      { key: 'hitSoft', urls: [`${base}impact/Audio/impactSoft_medium_000.ogg`, `${base}impact/Audio/impactSoft_medium_001.ogg`] },
    ];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const decode = async url => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return await this.ctx.decodeAudioData(buf);
      } catch { return null; }
    };
    // 每批最多 6 个，批间让出主线程，避免集中解码卡顿
    for (const { key, urls } of jobs) {
      const out = [];
      for (let i = 0; i < urls.length; i += 6) {
        const batch = await Promise.all(urls.slice(i, i + 6).map(decode));
        out.push(...batch);
        await sleep(40);
      }
      this.samples[key] = out.filter(Boolean);
    }
  }

  // 播放样本：prefix 是样本组名，随机取一个变体
  _playSample(prefix, { pos = null, vol = 1, rate = 1 } = {}) {
    const group = this.samples[prefix];
    if (!this.ctx || !group || group.length === 0) return;
    const buf = group[Math.floor(Math.random() * group.length)];
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pos) {
      const p = this._panner(pos);
      src.connect(g); g.connect(p);
    } else {
      src.connect(g); g.connect(this.master);
    }
    src.start(t0);
  }

  // 背景音乐（战场主题，低音量循环）
  startMusic() {
    if (!this.ctx || this.musicSrc) return;
    const group = this.samples.music;
    if (!group || group.length === 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = group[0];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.2;
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, this.ctx.currentTime + 2);
    src.connect(g); g.connect(this.master);
    src.start();
    this.musicSrc = src;
    this.musicGain = g;
  }
  stopMusic() {
    if (this.musicSrc) {
      try { this.musicSrc.stop(); } catch { /* 已停止 */ }
      this.musicSrc = null;
      this.musicGain = null;
    }
  }

  // 子弹命中不同表面（金属/木箱/沙土）
  hitSurface(type, pos = null) {
    const key = type === 'metal' ? 'hitMetal' : type === 'wood' ? 'hitWood' : 'hitSoft';
    this._playSample(key, { pos, vol: 0.5 });
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // 每帧同步听者位置（相机）
  setListener(pos, quat) {
    if (!this.ctx || !this.listener) return;
    this.listener.positionX.value = pos.x;
    this.listener.positionY.value = pos.y;
    this.listener.positionZ.value = pos.z;
    // quat: THREE.Quaternion -> {x,y,z,w}
    this.listener.forwardX.value = -quat.z * 2; // 简化：直接由四元数推导前向
    // 标准推导
    const { x, y, z, w } = quat;
    const fx = 2 * (x * z + w * y), fy = 2 * (y * z - w * x), fz = 1 - 2 * (x * x + y * y);
    const ux = 2 * (x * y - w * z), uy = 1 - 2 * (x * x + z * z), uz = 2 * (y * z + w * x);
    this.listener.forwardX.value = fx; this.listener.forwardY.value = fy; this.listener.forwardZ.value = fz;
    this.listener.upX.value = ux; this.listener.upY.value = uy; this.listener.upZ.value = uz;
  }

  // ---------- 基础合成工具 ----------
  _env(gainNode, t0, peak, decay) {
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  }

  _playNode(node, out, t0) {
    node.connect(out || this.master);
    node.start(t0);
    const stop = t0 + 3;
    node.stop(stop);
  }

  // 3D 声源：返回 panner（已有基础 gain 衰减）
  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5;
    p.rolloffFactor = 1.1;
    p.maxDistance = 400;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  // 枪声合成：噪声明亮瞬态 + 低频枪体声
  _gunshot(profile, pos, vol = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const out = pos ? this._panner(pos) : this.master;
    const v = profile.vol * vol;

    // 瞬态爆裂
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = profile.crackFreq;
    bp.Q.value = profile.crackQ;
    const g = this.ctx.createGain();
    this._env(g, t0, v * 0.9, profile.crackDecay);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t0); src.stop(t0 + 0.5);

    // 枪体低频
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(profile.bodyFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(profile.bodyFreq * 0.35, t0 + 0.12);
    const g2 = this.ctx.createGain();
    this._env(g2, t0, v * 0.7, 0.14);
    osc.connect(g2); g2.connect(out);
    osc.start(t0); osc.stop(t0 + 0.3);

    // 机械声（短促高频咔哒）
    const src2 = this.ctx.createBufferSource();
    src2.buffer = this.noiseBuf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const g3 = this.ctx.createGain();
    this._env(g3, t0 + 0.012, v * 0.25, 0.035);
    src2.connect(hp); hp.connect(g3); g3.connect(out);
    src2.start(t0); src2.stop(t0 + 0.3);
  }

  // ---------- 公开音效 ----------
  shotRifle(pos = null, vol = 1) {
    this._playSample('gun', { pos, vol: 0.85 * vol, rate: 0.92 + Math.random() * 0.1 });
    this._gunshot({ vol: 0.7, crackFreq: 2400, crackQ: 0.8, crackDecay: 0.16, bodyFreq: 160 }, pos, vol);
  }
  shotPistol(pos = null, vol = 1) {
    this._playSample('gun', { pos, vol: 0.8 * vol, rate: 1.15 + Math.random() * 0.08 });
    this._gunshot({ vol: 0.6, crackFreq: 1800, crackQ: 1.1, crackDecay: 0.12, bodyFreq: 190 }, pos, vol);
  }
  shotSniper(pos = null, vol = 1) {
    this._playSample('gun', { pos, vol: 1.0 * vol, rate: 0.78 + Math.random() * 0.05 });
    this._playSample('explosionLow', { pos, vol: 0.5 * vol });
    this._gunshot({ vol: 1.0, crackFreq: 1500, crackQ: 0.6, crackDecay: 0.32, bodyFreq: 130 }, pos, vol);
    // 回声延迟
    if (this.ctx) {
      const t0 = this.ctx.currentTime;
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = 0.14;
      const fb = this.ctx.createGain(); fb.gain.value = 0.35;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const out = pos ? null : this.master;
      const tail = pos ? this._panner(pos) : this.master;
      delay.connect(fb); fb.connect(delay);
      delay.connect(lp); lp.connect(tail);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = this.ctx.createGain();
      this._env(g, t0 + 0.14, 0.5, 0.3);
      src.connect(delay); src.start(t0); src.stop(t0 + 0.6);
      src.connect(g); g.connect(delay);
    }
  }
  shotMG(pos = null, vol = 1) {
    this._playSample('gun', { pos, vol: 0.75 * vol, rate: 0.88 + Math.random() * 0.08 });
    this._gunshot({ vol: 0.8, crackFreq: 900, crackQ: 0.7, crackDecay: 0.18, bodyFreq: 120 }, pos, vol);
  }

  explosion(pos = null, size = 1, vol = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const out = pos ? this._panner(pos) : this.master;
    const v = 1.1 * size * vol;
    // 真实爆炸样本 + 低频冲击
    this._playSample('explosion', { pos, vol: 0.9 * Math.min(1.2, size) * vol });
    this._playSample('explosionLow', { pos, vol: 1.1 * Math.min(1.2, size) * vol });
    // 低频冲击
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.6);
    const g = this.ctx.createGain();
    this._env(g, t0, v, 0.75);
    osc.connect(g); g.connect(out);
    osc.start(t0); osc.stop(t0 + 1);
    // 噪声爆炸
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g2 = this.ctx.createGain();
    this._env(g2, t0, v * 0.8, 0.5);
    src.connect(lp); lp.connect(g2); g2.connect(out);
    src.start(t0); src.stop(t0 + 1);
  }

  footstep(running = false, pos = null) {
    // 真实脚步样本（竞技场混凝土 / 大战场草地），未加载时回退合成
    const group = this.samples[this.surface === 'grass' ? 'stepGrass' : 'stepConcrete'];
    if (group && group.length > 0) {
      this._playSample(this.surface === 'grass' ? 'stepGrass' : 'stepConcrete', { pos, vol: running ? 0.55 : 0.4, rate: 0.9 + Math.random() * 0.25 });
      return;
    }
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const out = pos ? this._panner(pos) : this.master;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240 + Math.random() * 120;
    const g = this.ctx.createGain();
    this._env(g, t0, running ? 0.2 : 0.12, 0.07);
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(t0); src.stop(t0 + 0.2);
  }

  reload() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + 0.25 + i * 0.24;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 220 + i * 160;
      const g = this.ctx.createGain();
      this._env(g, t, 0.12, 0.03);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + 0.1);
    }
  }

  bolt() { // 狙击拉栓
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.16, 0.09);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + 0.2);
  }

  hitmarker(headshot = false) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = headshot ? 1900 : 1300;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.14, 0.05);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.15);
  }

  hurt() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.2);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.5, 0.25);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.4);
    // 心跳第二下
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine'; osc2.frequency.value = 55;
    const g2 = this.ctx.createGain();
    this._env(g2, t0 + 0.28, 0.3, 0.2);
    osc2.connect(g2); g2.connect(this.master);
    osc2.start(t0); osc2.stop(t0 + 0.6);
  }

  pickup() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 660 + i * 330;
      const g = this.ctx.createGain();
      this._env(g, t0 + i * 0.09, 0.16, 0.12);
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + 0.4);
    }
  }

  throwGrenade() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(300, t0 + 0.18);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.1, 0.2);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.3);
  }

  grenadePin() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = 500;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.08, 0.04);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.1);
  }

  beep(high = false) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = high ? 1100 : 720;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.12, 0.14);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.3);
  }

  // 环境风声
  startWind() {
    if (!this.ctx || this.windNodes) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.value = 0.028;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.015;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.windNodes = [src, lfo];
  }
}

export const audio = new AudioEngine();
