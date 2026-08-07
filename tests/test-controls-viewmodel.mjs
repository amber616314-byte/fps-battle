const ctx2d = {
  fillRect() {}, fillText() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, closePath() {},
  fill() {}, stroke() {}, strokeRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
  scale() {}, clearRect() {}, putImageData() {}, drawImage() {}, ellipse() {},
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  measureText: () => ({ width: 0 }),
};
globalThis.document = {
  createElement: tag => tag === 'canvas'
    ? { width: 512, height: 512, style: {}, getContext: () => ctx2d }
    : { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {} },
  getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, exitPointerLock() {},
};
globalThis.window = globalThis;

globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;

import fs from 'node:fs';
import * as THREE from 'three';
import { WeaponSystem } from '../js/weapons.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.045, 1200);
const silentAudio = new Proxy({}, { get: () => () => {} });
const fx = { addMuzzle() {}, addTracer() {}, addShell() {} };
const w = new WeaponSystem(camera, scene, silentAudio, fx);
const player = {
  vel: new THREE.Vector3(), onGround: true, sprinting: false, crouching: false,
  mouseDX: 0, mouseDY: 0,
};

console.log('\n[操作模式]');
w.setGameplayMode('arena');
w.showSlot(0);
w.setADS(true);
assert(!w.ads && !w.canADS(), '竞技场步枪右键不进入开镜');
w.showSlot(1);
w.setADS(true);
assert(!w.ads && !w.canADS(), '竞技场手枪右键不进入开镜');
w.showSlot(2);
w.toggleADS();
assert(w.ads && w.canADS(), '竞技场狙击枪支持右键切换镜头');
w.toggleADS();
assert(!w.ads, '竞技场狙击镜可再次右键关闭');

w.setGameplayMode('battlefield');
w.showSlot(0);
w.setADS(true);
for (let i = 0; i < 30; i++) w.update(1 / 60, player);
assert(w.canADS() && w.adsAmount > 0.8, '大战场步枪支持按住右键机械瞄具');
const aimedFov = w.getTargetFov(75);
assert(aimedFov < 65 && aimedFov > 55, `大战场步枪 FOV 合理（${aimedFov.toFixed(1)}）`);
player.sprinting = true;
for (let i = 0; i < 30; i++) w.update(1 / 60, player);
assert(w.adsAmount < 0.2, '冲刺会压下瞄准姿态');

console.log('\n[环境受光]');
w.setEnvironmentFactor(0.18, 0.05, 0.16);
const darkKey = w.viewKey.intensity;
w.setEnvironmentFactor(0.95, 0.95, 0.85);
assert(w.viewKey.intensity > darkKey * 2, '第一人称枪械补光会随环境明暗显著变化');
assert(w.viewKey.isDirectionalLight && w.viewFill.isDirectionalLight && w.viewRim.isDirectionalLight,
  '三把枪改用无距离衰减的统一方向补光');
let weaponLayerOk = true;
for (const model of w.models.slice(0, 3)) model.traverse(ch => { if (ch.isMesh && ch.layers.mask !== 2) weaponLayerOk = false; });
assert(weaponLayerOk && camera.layers.isEnabled(1), '枪械使用独立视角灯光层，不再受模型长度造成的补光差异影响');

console.log('\n[模型比例]');
const src = fs.readFileSync(new URL('../js/weapons.js', import.meta.url), 'utf8');
function scaleOf(name) {
  const re = name === 'rifle'
    ? /m4a1\.obj', \{ scale: ([0-9.]+)/
    : name === 'pistol'
      ? /Pistol\.obj', \{[^}]*scale: ([0-9.]+)/
      : /SniperRifle\.obj', \{ scale: ([0-9.]+)/;
  const m = src.match(re);
  return m ? Number(m[1]) : NaN;
}
const rifleLen = 0.85884 * scaleOf('rifle');
const pistolLen = 9.735438 * scaleOf('pistol');
const sniperLen = 9.787275 * scaleOf('sniper');
assert(rifleLen > 0.78 && rifleLen < 0.9, `M4 显示长度约 ${rifleLen.toFixed(2)}m`);
assert(pistolLen > 0.18 && pistolLen < 0.23, `USP 显示长度约 ${pistolLen.toFixed(2)}m`);
assert(sniperLen > 1.0 && sniperLen < 1.18, `AWP 显示长度约 ${sniperLen.toFixed(2)}m`);
assert(pistolLen < rifleLen && rifleLen < sniperLen, '三把枪真实相对比例正确');

if (failures) {
  console.error(`\n❌ ${failures} 项操作/模型测试失败`);
  process.exit(1);
}
console.log('\n✅ 操作模式、环境受光与模型比例测试全部通过');
