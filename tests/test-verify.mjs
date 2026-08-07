// ============================================================
// test-verify.mjs — 无头集成测试（mock DOM，验证后）
// 运行: npm install three@0.185.1 --no-save && node tests/test-verify.mjs
// ============================================================
globalThis.document = {
  createElement: (tag) => {
    if (tag === 'canvas') return { width: 512, height: 512, style: {}, getContext: () => ctx2d };
    return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, dataset: {}, disabled: false, textContent: '', innerHTML: '' };
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  exitPointerLock: () => {},
};
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = f => f(0);

const ctx2d = {
  fillRect() {}, fillText() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, closePath() {},
  fill() {}, stroke() {}, strokeRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
  scale() {}, clearRect() {}, putImageData() {}, drawImage() {}, ellipse() {},
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  measureText: () => ({ width: 0 }),
};

import * as THREE from 'three';
import * as TEX from '../js/tex.js';
import { buildArenaMap } from '../js/maps/arena.js';
import { buildBattlefieldMap } from '../js/maps/battlefield.js';
import { Player } from '../js/player.js';
import { Enemy, WaveManager } from '../js/enemy.js';
import { WeaponSystem } from '../js/weapons.js';
import { FX } from '../js/fx.js';
import { rayAABB } from '../js/enemy.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}

// ---------- 通用 mock 场景 ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 1200);
const dummyTex = new THREE.Texture();
const tex = {
  brick: dummyTex, brickBump: dummyTex, brickRough: dummyTex, decal: dummyTex,
  sand: TEX.texSand(10), concrete: TEX.texConcrete(3), metal: TEX.texMetal(2.5), wood: TEX.texWood(1.5),
  tarp: TEX.texTarp(2), dirt: TEX.texDirt(6), grass: dummyTex,
  flagRed: TEX.texFlag([190, 45, 40]), flagBlue: TEX.texFlag([50, 140, 220]),
};

const silentAudio = new Proxy({}, { get: (t, k) => (...a) => {} });

function makeGame(map) {
  const game = {
    scene, camera, map, mode: 'arena', enemies: [], projectiles: [], ammoPacks: [],
    audio: silentAudio, heardShot: null, kills: 0, headshots: 0, interactHint: null,
    hud: { popup() {}, killFeed() {}, centerMsg() {}, showDamageDir() {}, update() {} },
  };
  game.fx = new FX(scene);
  game.fx.groundHeight = (x, z) => map.groundHeight(x, z);
  game.player = new Player(game);
  game.weapons = new WeaponSystem(camera, scene, silentAudio, game.fx);
  game.player.respawn(map.playerSpawn, map.playerSpawnYaw);
  // 复制 main.js 的射线实现
  game.rayMap = (origin, dir, maxDist = 300) => {
    let best = null;
    for (const b of map.colliders) {
      const h = rayAABB(origin, dir,
        new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
        new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2));
      if (h && h.t < maxDist && (!best || h.t < best.t)) best = h;
    }
    let t = (0 - origin.y) / dir.y;
    if (t > 0 && t < maxDist) {
      const p = origin.clone().addScaledVector(dir, t);
      const gh = map.groundHeight(p.x, p.z);
      if (!best || t < best.t) best = { t, point: p, normal: new THREE.Vector3(0, 1, 0) };
      void gh;
    }
    return best;
  };
  game.worldRay = (origin, dir, def, fromPlayer) => {
    let best = null, bestT = Infinity;
    for (const e of game.enemies) {
      const h = e.raycast(origin, dir);
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, enemy: e }; }
    }
    const mh = game.rayMap(origin, dir, bestT);
    if (mh && mh.t < bestT) { bestT = mh.t; best = mh; }
    if (best && best.enemy && fromPlayer) {
      const dmg = (best.head ? def.damage * def.hsMult : def.damage);
      best.enemy.takeDamage(dmg, dir.clone(), best.head, game.player.pos);
    }
    return best;
  };
  game.rayPlayer = (origin, dir, maxDist = 100) => {
    const p = game.player;
    const min = new THREE.Vector3(p.pos.x - 0.4, p.pos.y, p.pos.z - 0.4);
    const max = new THREE.Vector3(p.pos.x + 0.4, p.pos.y + 1.75, p.pos.z + 0.4);
    const h = rayAABB(origin, dir, min, max);
    if (!h || h.t > maxDist) return null;
    const mh = game.rayMap(origin, dir, h.t);
    if (mh && mh.t < h.t) return null;
    return h;
  };
  game.throwGrenade = () => {};
  game.fireRocket = () => {};
  game.onEnemyKilled = () => {};
  return game;
}

function overlapsAnyBox(pos, map, halfW = 0.36, height = 1.72) {
  for (const b of map.colliders) {
    const cx = pos.x, cy = pos.y + height / 2, cz = pos.z;
    if (Math.abs(cx - b.x) < b.w / 2 + halfW &&
      Math.abs(cz - b.z) < b.d / 2 + halfW &&
      Math.abs(cy - b.y) < b.h / 2 + height / 2) return b;
  }
  return null;
}

// ============ 测试 1：竞技图构建 ============
console.log('\n[1] 竞技地图构建');
const arena = buildArenaMap(scene, tex);
assert(arena.colliders.length > 60, `碰撞体数量 ${arena.colliders.length} > 60`);
assert(arena.objectives.length === 2, 'A/B 两个目标点');
assert(arena.enemySpawns.length >= 6, '敌人刷新点充足');
assert(arena.supplyPoints.length === 1, '弹药补给点存在');
assert(arena.groundHeight(0, 0) === 0, '竞技图地面平坦 y=0');

// ============ 测试 2：玩家移动与碰撞 ============
console.log('\n[2] 玩家移动/跳跃/碰撞');
{
  const game = makeGame(arena);
  const p = game.player;
  assert(p.pos.distanceTo(arena.playerSpawn) < 0.01, '出生点就位');
  // 向前跑 4 秒（朝北，yaw=0 面向 -Z）
  const input = { move: new THREE.Vector2(0, -1), jump: false, sprint: false, crouch: false };
  for (let i = 0; i < 240; i++) p.update(1 / 60, input);
  assert(p.pos.z < 31, `向前移动成功 z=${p.pos.z.toFixed(1)}`);
  assert(Math.abs(p.pos.y) < 0.01, '贴地 y=0');
  assert(!overlapsAnyBox(p.pos, arena), '未卡入墙体');
  const zAfterRun = p.pos.z;
  // 向右跑（撞墙应被阻挡）
  input.move.set(1, 0);
  const before = p.pos.x;
  for (let i = 0; i < 180; i++) p.update(1 / 60, input);
  assert(!overlapsAnyBox(p.pos, arena), '横向移动未穿墙');
  assert(Math.abs(p.pos.z - zAfterRun) < 0.6, '侧移基本不改变 z（惯性容差）');
  void before;
  // 跳跃
  input.move.set(0, 0);
  p.update(1 / 60, { ...input, jump: true });
  let jumped = false;
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60, { ...input, jump: false });
    if (p.pos.y > 0.5) jumped = true;
  }
  assert(jumped, '跳跃离地 >0.5m');
  assert(p.onGround && p.pos.y < 0.01, '落地回到地面');
  // 蹲伏
  const hStand = p.eyeHCur;
  for (let i = 0; i < 60; i++) p.update(1 / 60, { ...input, crouch: true });
  assert(p.eyeHCur < hStand - 0.3, '蹲伏降低视角');
}

// ============ 测试 3：敌人 AI ============
console.log('\n[3] 敌人 AI');
{
  const game = makeGame(arena);
  const e = new Enemy('grunt', arena.enemySpawns[0], game);
  game.enemies.push(e);
  assert(e.hp === 60, '突击兵血量 60');
  for (let i = 0; i < 120; i++) e.update(1 / 60); // 巡逻 2 秒
  assert(e.alive, 'AI 更新正常存活');
  assert(!overlapsAnyBox(e.pos, arena, 0.32, 1.6), 'AI 未穿墙');
  // 伤害
  e.takeDamage(30, new THREE.Vector3(0, -1, 0), false, game.player.pos);
  assert(e.hp === 30, '受到 30 伤害');
  e.takeDamage(30, new THREE.Vector3(0, -1, 0), false, game.player.pos);
  assert(!e.alive, '击杀生效');
  // 爆头射线
  const e2 = new Enemy('sniper', arena.enemySpawns[2], game);
  game.enemies.push(e2);
  const from = game.player.eye.clone();
  const toHead = e2.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
  const dir = toHead.sub(from).normalize();
  const hit = e2.raycast(from, dir);
  assert(hit && hit.head, '狙击手头部命中判定');
  // 兵种差异
  const heavy = new Enemy('heavy', arena.enemySpawns[1], game);
  assert(heavy.hp === 200, '重甲兵血量 200');
  assert(heavy.def.speed < 3.5, '重甲兵速度慢');
  const rusher = new Enemy('rusher', arena.enemySpawns[1], game);
  assert(rusher.def.speed > 6, '自爆兵速度快');
  // 走路动画推进（walkT 不 NaN）
  for (let i = 0; i < 60; i++) heavy.update(1 / 60);
  assert(!Number.isNaN(heavy.walkT), '走路动画计时正常');
  game.enemies.forEach(en => en.remove());
}

// ============ 测试 4：武器系统 ============
console.log('\n[4] 武器系统');
{
  const game = makeGame(arena);
  const w = game.weapons;
  assert(w.mag === 30 && w.reserve === 120, '步枪初始弹药');
  assert(w.slots[1].def.type === 'pistol', '槽位 2 手枪');
  w.switchTo(1);
  assert(w.current === 1 && w.def.type === 'pistol', '切换到手枪');
  w.switchTo(0);
  assert(w.current === 0, '切回步枪');
  // 换弹
  w.mag = 5;
  w.startReload();
  assert(w.reloading, '换弹状态');
  for (let i = 0; i < 180; i++) w.update(1 / 60, game.player);
  assert(!w.reloading && w.mag === 30, '换弹完成 30 发');
  // 射击（世界射线打敌人）。先推进到中路空地——出生点有沙袋墙会挡射线（遮挡系统正常工作）
  game.player.pos.set(-3, 0, 10);
  game.player.camera.position.copy(game.player.eye);
  const e = new Enemy('grunt', new THREE.Vector3(-3, 0, -10), game);
  game.enemies.push(e);
  game.player.yaw = 0; game.player.pitch = 0;
  game.player.camera.rotation.set(0, 0, 0);
  // 瞄准敌人胸部（20m 距离俯角 0.045 rad，rotation.x 负值=向下看）
  game.player.camera.rotation.x = -Math.atan2(1.62 - 0.7, 20);
  game.player.camera.updateMatrixWorld(true);
  let shots = 0;
  for (let i = 0; i < 360; i++) {
    if (i % 6 === 0) game.weapons.update(0.1, game.player); // 推进射速冷却
    game.weapons.def = game.weapons.slots[0].def;
    if (game.weapons.tryFire(game, game.player)) shots++;
  }
  assert(shots >= 5, `步枪开火成功（${shots} 发）`);
  assert(e.hp <= 60 && (!e.alive || e.hp < 60), '敌人被击中扣血');
  game.enemies.forEach(en => en.remove());
  // 手雷槽
  w.switchTo(3);
  assert(w.isGrenadeSlot && w.grenades === 2, '手雷槽 2 颗');
  // 手雷槽 update 不应崩溃（slotAdsPos 防护）
  w.update(1 / 60, game.player);
  assert(true, '手雷槽 update 正常');
  w.switchTo(0);
}

// ============ 测试 5：大战场 ============
console.log('\n[5] 大战场地图');
{
  const bf = buildBattlefieldMap(scene, tex);
  assert(bf.objectives.length === 5, '5 个据点');
  assert(bf.colliders.length > 80, `碰撞体数量 ${bf.colliders.length}`);
  assert(bf.playerSpawn, '玩家基地出生点');
  // 地形高度一致性：地面网格 vs groundHeight
  const g = bf.groundHeight;
  let maxErr = 0;
  for (let i = 0; i < 200; i++) {
    const x = -190 + Math.random() * 380, z = -190 + Math.random() * 380;
    const h = g(x, z);
    if (h < -10 || h > 20) maxErr = 999;
    const h2 = g(x + 0.37, z + 0.21); // 邻近采样应平滑
    maxErr = Math.max(maxErr, Math.abs(h - h2));
  }
  assert(maxErr < 3, `地形平滑（邻近采样差 < 3m，实际 ${maxErr.toFixed(2)}）`);
  assert(g(-160, -160) > -6 && g(-160, -160) < 10, '基地高度合理');
  // 玩家在大战场移动
  const game = makeGame(bf);
  game.mode = 'battlefield';
  const input = { move: new THREE.Vector2(0, -1), jump: false, sprint: true, crouch: false };
  for (let i = 0; i < 240; i++) game.player.update(1 / 60, input);
  assert(game.player.pos.y >= bf.groundHeight(game.player.pos.x, game.player.pos.z) - 0.02, '玩家贴地（高度场）');
  assert(!overlapsAnyBox(game.player.pos, bf), '战场移动未穿墙');
  // 敌人刷点远离基地
  let ok = true;
  for (const s of bf.enemySpawns) if (s.distanceTo(bf.playerSpawn) < 20) ok = false;
  assert(ok, '敌人刷点远离基地');
}

// ============ 测试 6：波次 ============
console.log('\n[6] 波次系统');
{
  const wm = new WaveManager({ enemies: [], maxEnemies: 15, mode: 'arena', hud: { centerMsg() {} }, audio: silentAudio });
  wm.start(8);
  assert(wm.totalWaves === 8, '竞技图 8 波');
  const w1 = wm.buildWave(1);
  assert(w1.every(t => t === 'grunt') && w1.length >= 4, '旧波次构建器兼容：第 1 组全突击兵');
  const w8 = wm.buildWave(8);
  assert(w8.includes('heavy') && w8.includes('sniper') && w8.includes('rusher'), '旧波次构建器兼容：后期多兵种');
  const wm2 = new WaveManager({ enemies: [], maxEnemies: 15, mode: 'battlefield', hud: { centerMsg() {} }, audio: silentAudio });
  const bw = wm2.buildWave(7);
  assert(bw.includes('rocket'), '旧波次构建器兼容：可构建火箭兵');
}

// ============ 测试 7：特效系统 ============
console.log('\n[7] 特效系统');
{
  const game = makeGame(arena);
  const fx = game.fx;
  fx.addImpact(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 1, 0), 'bullet');
  let visible = fx.decalPool.filter(d => d.mesh.visible).length;
  assert(visible >= 1, '子弹贴花显示');
  fx.clear(); // 模拟地图切换
  fx.addImpact(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 1, 0), 'blood');
  visible = fx.decalPool.filter(d => d.mesh.visible).length;
  assert(visible >= 1, '地图切换后贴花池重建可用');
  fx.addTracer(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, -5));
  fx.addMuzzle(new THREE.Vector3(0, 1, 0));
  fx.addExplosion(new THREE.Vector3(0, 1, -5), 1.2);
  fx.addSmoke(new THREE.Vector3(0, 1, -5), 0.3);
  for (let i = 0; i < 200; i++) fx.update(1 / 60);
  assert(fx.tracers.length === 0 && fx.sprites.length === 0, '特效全部到期清理');
}

console.log(failures === 0 ? '\n✅ 全部测试通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
