// 核心优化回归测试：导航、碰撞体、AI 推进、友军射击
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
globalThis.devicePixelRatio = 1;

import * as THREE from 'three';
import * as TEX from '../js/tex.js';
import { buildBattlefieldMap } from '../js/maps/battlefield.js';
import { GridNavigator } from '../js/navigation.js';
import { Enemy } from '../js/enemy.js';
import { Ally } from '../js/allies.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}

const dummyTex = new THREE.Texture();
const tex = {
  brick: dummyTex, brickBump: dummyTex, brickRough: dummyTex, decal: dummyTex,
  sand: TEX.texSand(10), concrete: TEX.texConcrete(3), metal: TEX.texMetal(2.5), wood: TEX.texWood(1.5),
  tarp: TEX.texTarp(2), dirt: TEX.texDirt(6), grass: dummyTex,
  flagRed: TEX.texFlag([190, 45, 40]), flagBlue: TEX.texFlag([50, 140, 220]), ph: {}, sceneModels: {},
};
const silentAudio = new Proxy({}, { get: () => () => {} });

console.log('\n[优化 1] 大战场碰撞体');
const scene = new THREE.Scene();
const battlefield = buildBattlefieldMap(scene, tex);
const slender = battlefield.colliders.filter(b => Math.max(b.w / Math.max(0.01, b.d), b.d / Math.max(0.01, b.w)) > 8);
assert(slender.length > 0, '细长墙体保持细长碰撞盒，没有被扩大成正方形');
const accidentalGiants = battlefield.colliders.filter(b => b.w > 18 && b.d > 18 && b.h < 5);
assert(accidentalGiants.length < 10, `低矮巨型空气墙数量受控（${accidentalGiants.length}）`);

console.log('\n[优化 2] A* 绕障');
const simpleMap = {
  bounds: [-12, 12, -12, 12],
  groundHeight: () => 0,
  colliders: [
    { x: 0, y: 1, z: -4, w: 1, h: 2, d: 14 },
    { x: 0, y: 1, z: 8, w: 1, h: 2, d: 5 },
  ],
  objectives: [], enemySpawns: [], supplyPoints: [],
};
const nav = new GridNavigator(simpleMap, 1, 0.35);
const path = nav.findPath(new THREE.Vector3(-8, 0, 0), new THREE.Vector3(8, 0, 0));
assert(path.length >= 3, `生成绕墙路径（${path.length} 个平滑节点）`);
assert(path.some(p => Math.abs(p.z) > 3), '路径确实绕开墙体而非直穿');

console.log('\n[优化 3] 敌人主动推进');
const game = {
  scene: new THREE.Scene(), map: battlefield, navigator: new GridNavigator(battlefield, 4, 0.45),
  enemies: [], allies: [], vehicles: [], mode: 'battlefield', time: 0, heardShot: null, bomb: null,
  audio: silentAudio,
  fx: { addBlood() {}, addMuzzle() {}, addImpact() {}, addExplosion() {} },
  hud: { popup() {}, killFeed() {}, centerMsg() {} },
  rayMap: () => null, fireRocket() {}, onEnemyKilled() {},
};
game.player = {
  pos: battlefield.playerSpawn.clone(), eye: battlefield.playerSpawn.clone().add(new THREE.Vector3(0, 1.6, 0)),
  alive: true, takeDamage() {},
};
const farSpawn = battlefield.enemySpawns.find(s => s.x > 150 && s.z > 150).clone();
const enemy = new Enemy('grunt', farSpawn, game);
enemy.state = 'advance';
game.enemies.push(enemy);
const objective = battlefield.objectives.reduce((a, b) => enemy.pos.distanceTo(a.pos) < enemy.pos.distanceTo(b.pos) ? a : b);
const before = enemy.pos.distanceTo(objective.pos);
for (let i = 0; i < 1200; i++) { game.time += 1 / 60; enemy.update(1 / 60); }
const after = enemy.pos.distanceTo(objective.pos);
assert(before - after > 20, `敌人 20 秒内向战线推进 ${Math.round(before - after)} 米`);
assert(enemy.pos.distanceTo(farSpawn) > 20, '敌人不再只在出生点附近巡逻');

console.log('\n[优化 4] 友军命中链路');
const fireMap = { ...simpleMap, colliders: [], objectives: [] };
const fireGame = {
  scene: new THREE.Scene(), map: fireMap, navigator: new GridNavigator(fireMap, 1, 0.4),
  enemies: [], allies: [], time: 0, audio: silentAudio,
  fx: { addMuzzle() {}, addImpact() {} }, hud: { popup() {}, killFeed() {} },
  rayMap: () => null, onEnemyKilled() {}, kills: 0, headshots: 0,
};
fireGame.player = { pos: new THREE.Vector3(-5, 0, -5), alive: true };
const ally = new Ally(fireGame, 0);
fireGame.allies.push(ally);
let damaged = 0;
const fakeEnemy = {
  alive: true, hp: 60, pos: ally.pos.clone().add(new THREE.Vector3(0, 0, -10)),
  raycast: () => ({ t: 10, point: ally.pos.clone().add(new THREE.Vector3(0, 1, -10)), normal: new THREE.Vector3(0, 0, 1), head: false }),
  takeDamage: dmg => { damaged += dmg; fakeEnemy.hp -= dmg; },
};
fireGame.enemies.push(fakeEnemy);
ally.target = fakeEnemy;
ally.tryFire();
assert(damaged > 0, '友军命中后正确找到 enemy 引用并造成伤害');

if (failures) {
  console.error(`\n❌ ${failures} 项优化测试失败`);
  process.exit(1);
}
console.log('\n✅ 核心优化回归测试全部通过');
