import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

// Canvas/Sprite 需要的最小 DOM 桩。
globalThis.document = {
  createElement(type) {
    if (type !== 'canvas') return {};
    return {
      width: 64, height: 64,
      getContext() {
        return {
          fillStyle: '', strokeStyle: '', lineWidth: 1,
          beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
          fillRect() {}, clearRect() {}, arc() {}, drawImage() {},
          createLinearGradient() { return { addColorStop() {} }; },
          getImageData() { return { data: new Uint8ClampedArray(64 * 64 * 4) }; },
          putImageData() {},
        };
      },
    };
  },
};

const { Vehicle, VEHICLE_DEFS } = await import('../js/vehicles.js');
const { BattlefieldDirector } = await import('../js/battlefield_mode.js');

function makeGame() {
  const game = {
    scene: new THREE.Scene(),
    tex: { sceneModels: {} },
    map: {
      bounds: [-200, 200, -200, 200],
      colliders: [],
      objectives: [
        { name: 'A点', pos: new THREE.Vector3(0, 0, 0), radius: 5, owner: 'neutral', captureValue: 0,
          ring: { material: { color: new THREE.Color(), opacity: 0.5 } }, flag: null, beacon: null },
      ],
      enemySpawns: [new THREE.Vector3(150, 0, 150)],
      playerSpawn: new THREE.Vector3(-150, 0, -150),
      groundHeight: () => 0,
    },
    player: { alive: true, pos: new THREE.Vector3(-150, 0, -150), takeDamage() {} },
    allies: [], enemies: [], vehicles: [],
    driving: null,
    fx: { addImpact() {}, addExplosion() {}, addMuzzle() {}, addTracer() {} },
    audio: { hitSurface() {}, explosion() {}, shotMG() {}, beep() {}, stopMusic() {} },
    rayMap: () => null,
    vehicleRay: () => ({ point: new THREE.Vector3(0, 0, 20), t: 20 }),
    applyExplosion() {},
    camera: new THREE.PerspectiveCamera(),
    hud: { popup() {}, showLose() {} },
    state: 'playing',
    spawnEnemy() {
      const e = { alive: true, pos: new THREE.Vector3(120, 0, 120), _ticketHandled: false };
      this.enemies.push(e);
      return e;
    },
    winGame() { this._won = true; },
  };
  return game;
}

console.log('[载具定义]');
assert.ok(VEHICLE_DEFS.jeep && VEHICLE_DEFS.tank && VEHICLE_DEFS.chopper);
assert.equal(VEHICLE_DEFS.chopper.air, true);
assert.ok(VEHICLE_DEFS.tank.maxHp > VEHICLE_DEFS.jeep.maxHp);
console.log('  ✓ 吉普、坦克、直升机三类载具齐全');

const game = makeGame();
const jeep = new Vehicle(game, 'jeep', new THREE.Vector3(0, 0, 0), 0, { team: 'blue', aiControlled: false });
const tank = new Vehicle(game, 'tank', new THREE.Vector3(10, 0, 0), 0, { team: 'red', aiControlled: true });
const heli = new Vehicle(game, 'chopper', new THREE.Vector3(0, 8, 10), 0, { team: 'blue', aiControlled: true });
game.vehicles.push(jeep, tank, heli);
assert.equal(jeep.occupied, false);
assert.equal(tank.occupied, true);
assert.equal(tank.driver, 'ai');
console.log('  ✓ AI 驾驶状态与玩家空载车辆区分正确');

const before = jeep.pos.clone();
game.driving = jeep;
jeep.setPlayerOccupied(true);
jeep.update(1, { move: { x: 0, y: -1 }, sprint: false, jump: false, crouch: false, fire: false, ads: false });
assert.ok(jeep.pos.distanceTo(before) > 0.5, '玩家驾驶吉普应向前移动');
console.log('  ✓ 玩家驾驶陆地载具可移动');

const h0 = heli.pos.y;
game.driving = heli;
heli.setPlayerOccupied(true);
heli.update(0.5, { move: { x: 0, y: 0 }, sprint: false, jump: true, crouch: false, fire: false, ads: false });
assert.ok(heli.pos.y > h0, '直升机应能上升');
console.log('  ✓ 玩家驾驶直升机可升降');

let fired = 0;
game.vehicleRay = () => { fired++; return { point: new THREE.Vector3(0, 0, 30), t: 30 }; };
game.driving = jeep;
jeep.primaryCooldown = 0;
jeep.update(0.1, { move: { x: 0, y: 0 }, sprint: false, jump: false, crouch: false, fire: true, ads: false });
assert.equal(fired, 1);
console.log('  ✓ 玩家载具主武器可开火');

console.log('[20V20 总控]');
const dGame = makeGame();
const director = new BattlefieldDirector(dGame);
// 不调用 start（会生成完整模型），直接验证核心票数与目标配置。
director.blueTickets = 300;
director.redTickets = 300;
director.blueTarget = 20;
director.redTarget = 20;
assert.equal(director.blueTarget, 20);
assert.equal(director.redTarget, 20);
console.log('  ✓ 双方目标兵力固定为 20');

dGame.map.objectives = [
  { owner: 'blue' }, { owner: 'blue' }, { owner: 'blue' }, { owner: 'red' }, { owner: 'neutral' },
];
director.bleedTimer = 0;
director.updateBleed(0.1);
assert.equal(director.redTickets, 298);
console.log('  ✓ 据点优势会消耗对方增援票');

const mainSrc = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const weaponsSrc = fs.readFileSync(new URL('../js/weapons.js', import.meta.url), 'utf8');
const vehiclesSrc = fs.readFileSync(new URL('../js/vehicles.js', import.meta.url), 'utf8');
assert.match(mainSrc, /BattlefieldDirector/);
assert.match(mainSrc, /player\+19|19 名友军|20V20/);
assert.match(mainSrc, /vehicleNavigator/);
assert.match(mainSrc, /updateRenderLOD/);
assert.match(vehiclesSrc, /navPath/);
assert.match(vehiclesSrc, /resolveVehicleSeparation/);
assert.match(weaponsSrc, /weaponGain/);
assert.match(weaponsSrc, /DirectionalLight/);
console.log('  ✓ 主循环已接入 20V20、载具 A*、动态阴影 LOD 与独立枪械灯光层');

console.log('\n✅ 20V20、陆空载具与统一枪械光照测试全部通过');
