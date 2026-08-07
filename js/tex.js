// ============================================================
// tex.js — 程序化纹理生成器（Canvas 2D）
// 与下载的真实纹理（砖墙/草地/贴花/烟雾/HDR）配合使用
// ============================================================
import * as THREE from 'three';

// ---------- 确定性噪声工具 ----------
function hash2(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, seed = 0, oct = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp; amp *= 0.5; freq *= 2.15;
  }
  return sum / norm;
}

function makeCanvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  return { c, ctx };
}
function toTexture(c, repeatX = 1, repeatY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// ---------- 凹凸贴图（视差感：沙粒/草地起伏，无镜面高光） ----------
export function texBump(repX = 12, repY = 9, seed = 77) {
  const { c, ctx } = makeCanvas(256);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      // 多层噪声：大起伏 + 细颗粒
      const n = fbm(x / 42, y / 42, seed, 4);
      const fine = vnoise(x / 8, y / 8, seed + 31);
      const g = 108 + (n - 0.5) * 76 + (fine - 0.5) * 30;
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, repX, repY, false);
}

// ---------- 混凝土（墙/楼板） ----------
export function texConcrete(repeat = 4, seed = 11) {
  const { c, ctx } = makeCanvas(512);
  const img = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const n = fbm(x / 64, y / 64, seed, 4);
      const g = 122 + (n - 0.5) * 44;
      const i = (y * 512 + x) * 4;
      img.data[i] = g + 2; img.data[i + 1] = g; img.data[i + 2] = g - 4; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 裂纹
  ctx.strokeStyle = 'rgba(60,60,62,0.85)';
  for (let k = 0; k < 14; k++) {
    let px = hash2(k, 7, seed) * 512, py = hash2(k, 13, seed) * 512;
    ctx.beginPath(); ctx.moveTo(px, py);
    const segs = 6 + Math.floor(hash2(k, 3, seed) * 10);
    for (let s = 0; s < segs; s++) {
      px += (hash2(k, s, seed) - 0.5) * 60;
      py += (hash2(k, s + 40, seed) - 0.5) * 60;
      ctx.lineTo(px, py);
    }
    ctx.lineWidth = 0.6 + hash2(k, 5, seed) * 1.2;
    ctx.stroke();
  }
  // 污渍
  for (let k = 0; k < 40; k++) {
    ctx.fillStyle = `rgba(${40 + hash2(k, 9, seed) * 40},${40 + hash2(k, 11, seed) * 40},45,${0.03 + hash2(k, 21, seed) * 0.07})`;
    ctx.beginPath();
    ctx.ellipse(hash2(k, 1, seed) * 512, hash2(k, 2, seed) * 512, 8 + hash2(k, 3, seed) * 40, 5 + hash2(k, 4, seed) * 26, hash2(k, 5, seed) * 3.14, 0, 6.28);
    ctx.fill();
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 沙漠沙地 ----------
export function texSand(repeat = 6, seed = 23) {
  const { c, ctx } = makeCanvas(512);
  const img = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const n = fbm(x / 56, y / 56, seed, 4);
      const wave = vnoise(x / 22, y / 22, seed + 9) * 0.5 + 0.5;
      const r = 196 + (n - 0.5) * 30 + (wave - 0.5) * 18;
      const g = 174 + (n - 0.5) * 28 + (wave - 0.5) * 16;
      const b = 130 + (n - 0.5) * 26;
      const i = (y * 512 + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 沙粒斑点
  for (let k = 0; k < 900; k++) {
    const x = hash2(k, 3, seed) * 512, y = hash2(k, 7, seed) * 512;
    const v = hash2(k, 11, seed);
    ctx.fillStyle = v > 0.5 ? `rgba(150,124,86,${0.1 + v * 0.15})` : `rgba(230,208,160,${0.08 + v * 0.12})`;
    ctx.fillRect(x, y, 1 + v * 2, 1 + v * 2);
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 拉丝金属 ----------
export function texMetal(repeat = 3, seed = 31) {
  const { c, ctx } = makeCanvas(512);
  const img = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const n = fbm(x / 90, y / 20, seed, 3);
      const line = vnoise(x / 3.2, y, seed + 55) * 0.5;
      const g = 74 + (n - 0.5) * 26 + (line - 0.5) * 12;
      const i = (y * 512 + x) * 4;
      img.data[i] = g + 5; img.data[i + 1] = g; img.data[i + 2] = g + 8; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 锈斑
  for (let k = 0; k < 26; k++) {
    const x = hash2(k, 1, seed) * 512, y = hash2(k, 2, seed) * 512;
    const r = 110 + hash2(k, 3, seed) * 60, g2 = 55 + hash2(k, 4, seed) * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 14 + hash2(k, 5, seed) * 34);
    grad.addColorStop(0, `rgba(${r},${g2},30,${0.25 + hash2(k, 6, seed) * 0.2})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 50, y - 50, 100, 100);
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 木板（箱体/掩体） ----------
export function texWood(repeat = 2, seed = 41) {
  const { c, ctx } = makeCanvas(512);
  ctx.fillStyle = '#8a6a3c'; ctx.fillRect(0, 0, 512, 512);
  const planks = 7;
  for (let p = 0; p < planks; p++) {
    const y0 = (512 / planks) * p;
    const shade = 0.86 + hash2(p, 1, seed) * 0.28;
    ctx.fillStyle = `rgb(${138 * shade},${106 * shade},${60 * shade})`;
    ctx.fillRect(0, y0, 512, 512 / planks + 1);
    // 木纹
    ctx.strokeStyle = `rgba(70,48,22,${0.35 + hash2(p, 2, seed) * 0.3})`;
    for (let k = 0; k < 26; k++) {
      const yy = y0 + hash2(p, k, seed) * (512 / planks);
      ctx.beginPath();
      for (let x = 0; x <= 512; x += 16) {
        const wob = Math.sin(x * 0.02 + k * 1.7 + p * 3) * 3 + (hash2(p, k + 9, seed) - 0.5) * 4;
        if (x === 0) ctx.moveTo(x, yy + wob); else ctx.lineTo(x, yy + wob);
      }
      ctx.lineWidth = 0.8; ctx.stroke();
    }
    // 板缝
    ctx.fillStyle = 'rgba(30,18,8,0.85)';
    ctx.fillRect(0, y0 + 512 / planks - 2, 512, 2.5);
  }
  // 钉子
  for (let p = 0; p < planks; p++) {
    for (const fx of [0.12, 0.88]) {
      ctx.fillStyle = '#3a3a3c';
      ctx.beginPath();
      ctx.arc(512 * fx, 512 / planks * (p + 0.5), 3, 0, 6.28);
      ctx.fill();
    }
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 迷彩（制服） ----------
export function texCamo(colors, seed = 51, repeat = 2) {
  const { c, ctx } = makeCanvas(256);
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 22; k++) {
    const x = hash2(k, 1, seed) * 256, y = hash2(k, 2, seed) * 256;
    const r = 18 + hash2(k, 3, seed) * 42;
    const col = colors[1 + Math.floor(hash2(k, 4, seed) * (colors.length - 1))];
    ctx.fillStyle = col;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hash2(k, 5, seed) * 6.28);
    ctx.scale(0.7 + hash2(k, 6, seed) * 0.8, 0.5 + hash2(k, 7, seed) * 0.8);
    ctx.beginPath();
    const pts = 5 + Math.floor(hash2(k, 8, seed) * 4);
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * 6.28;
      const rr = r * (0.6 + hash2(k, i + 20, seed) * 0.6);
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.restore();
  }
  // 布纹噪点
  for (let k = 0; k < 2600; k++) {
    const x = hash2(k, 9, seed) * 256, y = hash2(k, 10, seed) * 256;
    ctx.fillStyle = hash2(k, 11, seed) > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  return toTexture(c, repeat, repeat);
}
export const camoDesert = () => texCamo(['#b9a06c', '#8a7347', '#6e5c38', '#a08a58', '#55472a'], 61, 3);
export const camoForest = () => texCamo(['#4a5d3a', '#37492b', '#5c7148', '#2c3a20', '#6d7f52'], 71, 3);
export const camoGrey = () => texCamo(['#6d7378', '#555b61', '#7d838a', '#494f55', '#8b9197'], 81, 3);

// ---------- 泥土（战壕/战场地面） ----------
export function texDirt(repeat = 8, seed = 91) {
  const { c, ctx } = makeCanvas(512);
  const img = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const n = fbm(x / 60, y / 60, seed, 4);
      const g = 108 + (n - 0.5) * 40;
      const i = (y * 512 + x) * 4;
      img.data[i] = g + 10; img.data[i + 1] = g - 4; img.data[i + 2] = g - 22; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < 700; k++) {
    const x = hash2(k, 3, seed) * 512, y = hash2(k, 5, seed) * 512;
    const v = hash2(k, 7, seed);
    ctx.fillStyle = v > 0.5 ? `rgba(60,50,34,${0.1 + v * 0.12})` : `rgba(150,138,110,${0.07 + v * 0.1})`;
    ctx.fillRect(x, y, 1.5 + v * 2.5, 1.5 + v * 2.5);
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 沥青（道路） ----------
export function texAsphalt(repeat = 4, seed = 101) {
  const { c, ctx } = makeCanvas(512);
  const img = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const n = fbm(x / 70, y / 70, seed, 4);
      const g = 62 + (n - 0.5) * 20;
      const i = (y * 512 + x) * 4;
      img.data[i] = g + 2; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(30,30,32,0.9)';
  for (let k = 0; k < 10; k++) {
    let px = hash2(k, 1, seed) * 512, py = hash2(k, 2, seed) * 512;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let s = 0; s < 7; s++) {
      px += (hash2(k, s, seed) - 0.5) * 80; py += (hash2(k, s + 30, seed) - 0.5) * 80;
      ctx.lineTo(px, py);
    }
    ctx.lineWidth = 0.8; ctx.stroke();
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 军绿帆布（帐篷/沙袋） ----------
export function texTarp(repeat = 2, seed = 111) {
  const { c, ctx } = makeCanvas(256);
  ctx.fillStyle = '#45543a'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    for (let x = 0; x < 256; x += 4) {
      const v = vnoise(x / 18, y / 18, seed);
      ctx.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${0.045 + Math.abs(v - 0.5) * 0.05})`;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  for (let k = 0; k < 30; k++) {
    const x = hash2(k, 3, seed) * 256, y = hash2(k, 4, seed) * 256;
    ctx.fillStyle = `rgba(30,40,24,${0.08 + hash2(k, 5, seed) * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + hash2(k, 6, seed) * 16, 4 + hash2(k, 7, seed) * 10, 0, 0, 6.28);
    ctx.fill();
  }
  return toTexture(c, repeat, repeat);
}

// ---------- 旗帜 ----------
export function texFlag(rgb, seed = 121) {
  const { c, ctx } = makeCanvas(128, 64);
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.fillRect(0, 0, 128, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const v = vnoise(x / 16, y / 12, seed);
      ctx.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${0.06})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(c, 1, 1);
}

// ---------- 程序天空（背景） ----------
export function texSky() {
  const { c, ctx } = makeCanvas(1024, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#1e3c66');
  grad.addColorStop(0.38, '#3d6a96');
  grad.addColorStop(0.58, '#c98f5e');
  grad.addColorStop(0.64, '#e8b97e');
  grad.addColorStop(0.72, '#d9a265');
  grad.addColorStop(1, '#8a6a42');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);
  // 云
  for (let k = 0; k < 16; k++) {
    const x = hash2(k, 1, 5) * 1024, y = 40 + hash2(k, 2, 5) * 190;
    const r = 20 + hash2(k, 3, 5) * 55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,244,224,0.5)');
    g.addColorStop(1, 'rgba(255,244,224,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.9, r * 0.55, 0, 0, 6.28);
    ctx.fill();
  }
  // 太阳
  const sx = 780, sy = 110;
  const sgrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
  sgrad.addColorStop(0, 'rgba(255,240,200,0.95)');
  sgrad.addColorStop(0.12, 'rgba(255,220,160,0.7)');
  sgrad.addColorStop(1, 'rgba(255,210,150,0)');
  ctx.fillStyle = sgrad;
  ctx.fillRect(sx - 100, sy - 100, 200, 200);
  ctx.fillStyle = '#fff6dd';
  ctx.beginPath(); ctx.arc(sx, sy, 22, 0, 6.28); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// ---------- 弹孔贴花（红/棕圆斑，配合下载的 decal 纹理） ----------
export function texBloodDecal() {
  const { c, ctx } = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0, 'rgba(120,10,10,0.95)');
  g.addColorStop(0.5, 'rgba(90,8,8,0.8)');
  g.addColorStop(1, 'rgba(60,6,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // 飞溅
  for (let k = 0; k < 14; k++) {
    const a = hash2(k, 1, 7) * 6.28, d = 20 + hash2(k, 2, 7) * 42;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    ctx.fillStyle = `rgba(110,10,10,${0.5 + hash2(k, 3, 7) * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + hash2(k, 4, 7) * 4, 0, 6.28);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function texScorchDecal() {
  const { c, ctx } = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0, 'rgba(8,8,8,0.92)');
  g.addColorStop(0.6, 'rgba(20,18,14,0.65)');
  g.addColorStop(1, 'rgba(30,26,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
