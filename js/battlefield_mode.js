// ============================================================
// battlefield_mode.js — 20V20 大战场总控
// 19 名友军 + 玩家 对 20 名敌军；持续增援、阵营据点、票数与 AI 载具。
// ============================================================
import * as THREE from 'three';
import { Ally } from './allies.js';
import { Vehicle } from './vehicles.js';

const ENEMY_TYPES = ['grunt', 'grunt', 'grunt', 'heavy', 'sniper', 'rusher', 'rocket'];

export class BattlefieldDirector {
  constructor(game) {
    this.game = game;
    this.blueTickets = 300;
    this.redTickets = 300;
    this.blueTarget = 20;
    this.redTarget = 20;
    this.allySerial = 0;
    this.enemyRespawns = [];
    this.allyRespawns = [];
    this.vehicleRespawns = [];
    this.bleedTimer = 8;
    this.started = false;
  }

  start() {
    const game = this.game;
    this.started = true;
    this.blueTickets = 300;
    this.redTickets = 300;
    this.enemyRespawns = [];
    this.allyRespawns = [];
    this.vehicleRespawns = [];

    for (const o of game.map.objectives) {
      o.owner = 'neutral';
      o.captureValue = 0;
      o.captured = false;
      o._lastOwner = 'neutral';
      this.paintObjective(o);
    }

    while (game.allies.length < 19) game.allies.push(new Ally(game, this.allySerial++));
    while (game.enemies.length < 20) game.spawnEnemy(this.randomEnemyType());
    this.spawnVehicleSet();
  }

  spawnVehicleSet() {
    const g = this.game;
    for (const v of g.vehicles || []) v.remove();
    g.vehicles = [];
    const ground = (x, z) => g.map.groundHeight(x, z);
    const add = (type, team, x, z, yaw, aiControlled = true) => {
      const y = type === 'chopper' ? ground(x, z) + 5 : ground(x, z);
      const v = new Vehicle(g, type, new THREE.Vector3(x, y, z), yaw, { team, aiControlled });
      g.vehicles.push(v);
      return v;
    };

    // 蓝方基地：保留一台空载吉普供玩家立即驾驶，其余由 AI 驾驶。
    add('jeep', 'blue', -151, -151, 0.7, false);
    add('tank', 'blue', -140, -145, 0.7, true);
    add('chopper', 'blue', -166, -145, 0.7, true);
    add('jeep', 'blue', -132, -158, 0.7, true);

    // 红方基地：全部由 AI 驾驶。
    add('jeep', 'red', 154, 151, -2.35, true);
    add('tank', 'red', 141, 145, -2.35, true);
    add('chopper', 'red', 166, 143, -2.35, true);
    add('jeep', 'red', 132, 158, -2.35, true);
  }

  update(dt) {
    if (!this.started || this.game.state !== 'playing') return;
    this.updateObjectives(dt);
    this.updateRespawns(dt);
    this.updateVehicleRespawns(dt);
    this.updateBleed(dt);
    this.checkEnd();
  }

  updateObjectives(dt) {
    const game = this.game;
    for (const o of game.map.objectives) {
      let blue = 0;
      let red = 0;
      if (game.player.alive && game.player.pos.distanceTo(o.pos) < o.radius + 4) blue += game.driving ? 2 : 1;
      for (const a of game.allies) if (a.alive && a.pos.distanceTo(o.pos) < o.radius + 4) blue++;
      for (const e of game.enemies) if (e.alive && e.pos.distanceTo(o.pos) < o.radius + 4) red++;
      for (const v of game.vehicles) {
        if (!v.alive || v.pos.distanceTo(o.pos) >= o.radius + 7) continue;
        if (v.team === 'blue') blue += v.type === 'tank' ? 3 : 2;
        else red += v.type === 'tank' ? 3 : 2;
      }

      const delta = blue - red;
      if (delta !== 0) {
        const strength = Math.min(4, Math.abs(delta));
        o.captureValue = THREE.MathUtils.clamp((o.captureValue || 0) + Math.sign(delta) * dt * (12 + strength * 3), -100, 100);
      } else if (!blue && !red) {
        const target = o.owner === 'blue' ? 100 : o.owner === 'red' ? -100 : 0;
        o.captureValue += (target - o.captureValue) * Math.min(1, dt * 0.16);
      }

      let owner = 'neutral';
      if (o.captureValue >= 92) owner = 'blue';
      else if (o.captureValue <= -92) owner = 'red';
      else if (Math.abs(o.captureValue) < 12) owner = 'neutral';
      else owner = o.owner || 'neutral';

      if (owner !== o.owner) {
        o.owner = owner;
        o.captured = owner === 'blue';
        this.paintObjective(o);
        if (owner !== 'neutral') {
          game.hud.popup(`${owner === 'blue' ? '友军' : '敌军'}占领 ${o.name}`, owner === 'blue');
          game.audio.beep(owner === 'blue');
        }
      }
      o.progress = Math.abs(o.captureValue) / 100 * 3;
      if (o.ring?.material) o.ring.material.opacity = 0.45 + Math.abs(o.captureValue) / 100 * 0.35;
    }
  }

  paintObjective(o) {
    const color = o.owner === 'blue' ? 0x4aa8ff : o.owner === 'red' ? 0xff5a4a : 0xffb050;
    o.ring?.material?.color?.setHex(color);
    if (o.beacon?.material?.color) o.beacon.material.color.setHex(color);
    if (o.flag?.material && this.game.tex) {
      if (o.owner === 'blue') o.flag.material.map = this.game.tex.flagBlue;
      else if (o.owner === 'red') o.flag.material.map = this.game.tex.flagRed;
      o.flag.material.needsUpdate = true;
    }
  }

  updateRespawns(dt) {
    const game = this.game;
    for (const e of game.enemies) {
      if (e._ticketHandled) continue;
      if (!e.alive) {
        e._ticketHandled = true;
        this.redTickets = Math.max(0, this.redTickets - 1);
        this.enemyRespawns.push(5 + Math.random() * 3);
      }
    }
    for (const a of game.allies) {
      if (a._ticketHandled) continue;
      if (!a.alive) {
        a._ticketHandled = true;
        this.blueTickets = Math.max(0, this.blueTickets - 1);
        this.allyRespawns.push(5 + Math.random() * 3);
      }
    }

    for (let i = this.enemyRespawns.length - 1; i >= 0; i--) {
      this.enemyRespawns[i] -= dt;
      if (this.enemyRespawns[i] <= 0 && this.redTickets > 0 && game.enemies.filter(e => e.alive).length < this.redTarget) {
        game.spawnEnemy(this.randomEnemyType());
        this.enemyRespawns.splice(i, 1);
      }
    }
    for (let i = this.allyRespawns.length - 1; i >= 0; i--) {
      this.allyRespawns[i] -= dt;
      if (this.allyRespawns[i] <= 0 && this.blueTickets > 0 && game.allies.filter(a => a.alive).length < 19) {
        game.allies.push(new Ally(game, this.allySerial++));
        this.allyRespawns.splice(i, 1);
      }
    }

    // 若因清理时序导致队伍数低于目标，也补充排队，确保战场持续接近 20V20。
    const liveEnemies = game.enemies.filter(e => e.alive).length;
    const liveAllies = game.allies.filter(a => a.alive).length;
    while (liveEnemies + this.enemyRespawns.length < this.redTarget && this.redTickets > 0) this.enemyRespawns.push(4 + Math.random() * 3);
    while (liveAllies + this.allyRespawns.length < 19 && this.blueTickets > 0) this.allyRespawns.push(4 + Math.random() * 3);
  }

  updateVehicleRespawns(dt) {
    const game = this.game;
    for (const v of game.vehicles) {
      if (v.alive || v._respawnQueued) continue;
      v._respawnQueued = true;
      this.vehicleRespawns.push({ type: v.type, team: v.team, t: v.type === 'chopper' ? 38 : v.type === 'tank' ? 32 : 22 });
    }
    for (let i = this.vehicleRespawns.length - 1; i >= 0; i--) {
      const r = this.vehicleRespawns[i];
      r.t -= dt;
      if (r.t > 0) continue;
      const blue = r.team === 'blue';
      const base = blue ? new THREE.Vector3(-150, 0, -150) : new THREE.Vector3(150, 0, 150);
      const offset = r.type === 'chopper' ? new THREE.Vector3(blue ? -14 : 14, 0, blue ? 6 : -6)
        : r.type === 'tank' ? new THREE.Vector3(blue ? 8 : -8, 0, blue ? 5 : -5)
        : new THREE.Vector3(blue ? 15 : -15, 0, blue ? -6 : 6);
      const p = base.add(offset);
      p.y = game.map.groundHeight(p.x, p.z) + (r.type === 'chopper' ? 5 : 0);
      const v = new Vehicle(game, r.type, p, blue ? 0.7 : -2.35, { team: r.team, aiControlled: true });
      game.vehicles.push(v);
      this.vehicleRespawns.splice(i, 1);
    }
  }

  updateBleed(dt) {
    this.bleedTimer -= dt;
    if (this.bleedTimer > 0) return;
    this.bleedTimer = 8;
    const blueOwned = this.game.map.objectives.filter(o => o.owner === 'blue').length;
    const redOwned = this.game.map.objectives.filter(o => o.owner === 'red').length;
    if (blueOwned > redOwned) this.redTickets = Math.max(0, this.redTickets - (blueOwned - redOwned));
    if (redOwned > blueOwned) this.blueTickets = Math.max(0, this.blueTickets - (redOwned - blueOwned));
  }

  checkEnd() {
    if (this.redTickets <= 0) this.game.winGame();
    else if (this.blueTickets <= 0) {
      this.game.state = 'lose';
      document.exitPointerLock?.();
      this.game.audio.stopMusic();
      this.game.hud.showLose(`友军增援耗尽。最终票数 ${this.blueTickets} : ${this.redTickets}`);
    }
  }

  randomEnemyType() {
    return ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
  }
}
