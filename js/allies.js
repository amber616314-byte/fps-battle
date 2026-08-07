// ============================================================
// allies.js — 友军 AI：跟随玩家、自动索敌交火（大战场模式）
// 友军不会被玩家子弹命中（worldRay 只检测敌人），但会被敌人正常感知和攻击。
// ============================================================
import * as THREE from 'three';
import { camoGrey, camoForest } from './tex.js';
import { rayAABB } from './enemy.js';

export class Ally {
  constructor(game, index) {
    this.game = game;
    this.index = index;
    this.hp = 100;
    this.alive = true;
    // 出生在玩家附近
    const p = game.player.pos;
    // 黄金角螺旋阵型：19 名友军分散在基地周围，不再每 3 人重叠一次。
    const a = index * 2.3999632297 + 1.2;
    const r = 3.4 + Math.floor(index / 6) * 2.25 + (index % 3) * 0.35;
    this.pos = p.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    this.pos.y = game.map.groundHeight(this.pos.x, this.pos.z);
    this.yaw = Math.random() * Math.PI * 2;
    this.fireTimer = 0.4 + Math.random() * 0.5;
    this.target = null;
    this.targetTimer = 0;
    this.navPath = [];
    this.navIndex = 0;
    this.navTarget = null;
    this.navRepath = 0;
    this._prevPos = this.pos.clone();
    this.speed = 0;
    this._fwd = new THREE.Vector3();
    this.buildModel();
  }

  buildModel() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    // 蓝灰迷彩（与敌方区分）
    const mat = new THREE.MeshStandardMaterial({ map: this.index === 0 ? camoGrey() : camoForest(), roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.5, metalness: 0.4 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xb08d6a, roughness: 0.9 });

    // 腿 + 靴子
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.15), mat);
    this.legL.position.set(-0.11, -0.55, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.15), mat);
    this.legR.position.set(0.11, -0.55, 0);
    // 躯干 + 胸挂
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.28), mat);
    torso.position.y = 0.65;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 0.3), dark);
    belt.position.y = 0.42;
    // 头 + 头盔
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skinMat);
    head.position.y = 1.2;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.126, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
    helmet.position.y = 1.21;
    head.add(helmet);
    // 手臂 + 枪
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), mat);
    this.armL.position.set(-0.3, 0.68, 0);
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), mat);
    this.armR.position.set(0.3, 0.68, 0);
    this.gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.55), dark);
    this.gunMesh.position.set(0.26, 0.74, 0.22);
    this.armR.rotation.x = -Math.PI / 2.3;
    this.body.add(this.armL, this.armR, torso, this.legL, this.legR, head, this.gunMesh, belt);
    this.root.scale.setScalar(1.06);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    // 头顶蓝色标识（敌我分辨）
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4aa8ff';
    ctx.beginPath();
    ctx.moveTo(16, 2); ctx.lineTo(30, 16); ctx.lineTo(16, 30); ctx.lineTo(2, 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.indicator = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    this.indicator.position.set(0, 2.35, 0);
    this.indicator.scale.setScalar(0.6);
    this.root.add(this.indicator);
    this.game.scene.add(this.root);
  }

  // 找到最近的可见敌人（优先与同伴共享目标，集中火力）
  findTarget() {
    const game = this.game;
    // 先跟随同伴的目标
    for (const a of game.allies) {
      if (a === this || !a.target || !a.target.alive) continue;
      if (this.pos.distanceTo(a.target.pos) < 70 && this.hasLOS(a.target)) {
        return a.target;
      }
    }
    let best = null, bestScore = Infinity;
    const candidates = [
      ...game.enemies.filter(e => e.alive),
      ...(game.vehicles || []).filter(v => v.alive && v.team === 'red'),
    ];
    for (const target of candidates) {
      const d = target.pos.distanceTo(this.pos);
      if (d > (target.isVehicle ? 95 : 70)) continue;
      const score = d + (target.isVehicle ? -8 : 0);
      if (score < bestScore && this.hasLOS(target, d)) { bestScore = score; best = target; }
    }
    return best;
  }

  hasLOS(enemy, dist) {
    const from = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const dir = enemy.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(from);
    const len = dir.length();
    if (len < 0.01) return true;
    dir.divideScalar(len);
    for (const b of this.game.map.colliders) {
      const t = rayAABB(from, dir,
        new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
        new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2));
      if (t && t.t < len - 0.3) return false;
    }
    return true;
  }

  // A* 路径 + 局部碰撞移动
  moveTo(target, speed, dt, useNavigation = true) {
    const nav = this.game.navigator;
    let waypoint = target;
    this.navRepath -= dt;
    if (useNavigation && nav && this.pos.distanceTo(target) > nav.cellSize * 1.2) {
      const direct = nav.lineClear(this.pos, target);
      const changed = !this.navTarget || this.navTarget.distanceTo(target) > nav.cellSize * 1.2;
      if (direct) {
        this.navPath = [];
        this.navIndex = 0;
      } else {
        if (changed || this.navRepath <= 0 || !this.navPath.length) {
          this.navPath = nav.findPath(this.pos, target);
          this.navIndex = this.navPath.length > 1 ? 1 : 0;
          this.navTarget = target.clone();
          this.navRepath = 0.7 + Math.random() * 0.4;
        }
        while (this.navIndex < this.navPath.length - 1 && this.pos.distanceTo(this.navPath[this.navIndex]) < nav.cellSize * 0.55) {
          this.navIndex++;
        }
        if (this.navPath[this.navIndex]) waypoint = this.navPath[this.navIndex];
      }
    }

    const dir = new THREE.Vector3().subVectors(waypoint, this.pos);
    dir.y = 0;
    if (dir.lengthSq() < 0.04) return;
    dir.normalize();
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    let turn = targetYaw - this.yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.yaw += turn * Math.min(1, dt * 8);

    const delta = dir.multiplyScalar(speed * dt);
    const halfW = 0.32;
    this.pos.x += delta.x;
    for (const b of this.game.map.colliders) {
      if (Math.abs(this.pos.x - b.x) < b.w / 2 + halfW && Math.abs(this.pos.z - b.z) < b.d / 2 + halfW && Math.abs(this.pos.y + 0.8 - b.y) < b.h / 2 + 0.8) {
        this.pos.x = delta.x > 0 ? b.x - b.w / 2 - halfW : b.x + b.w / 2 + halfW;
      }
    }
    this.pos.z += delta.z;
    for (const b of this.game.map.colliders) {
      if (Math.abs(this.pos.x - b.x) < b.w / 2 + halfW && Math.abs(this.pos.z - b.z) < b.d / 2 + halfW && Math.abs(this.pos.y + 0.8 - b.y) < b.h / 2 + 0.8) {
        this.pos.z = delta.z > 0 ? b.z - b.d / 2 - halfW : b.z + b.d / 2 + halfW;
      }
    }
    const bounds = this.game.map.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, bounds[0] + halfW, bounds[1] - halfW);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, bounds[2] + halfW, bounds[3] - halfW);
    this.pos.y = this.game.map.groundHeight(this.pos.x, this.pos.z);
  }

  update(dt) {
    if (!this.alive) { this.updateDead(dt); return; }
    const game = this.game;
    const player = game.player;
    this.fireTimer -= dt;
    this.targetTimer -= dt;
    this.speed = this.pos.distanceTo(this._prevPos) / Math.max(dt, 1e-4);
    this._prevPos.copy(this.pos);

    // 定时重新索敌，目标失去视线后不再隔墙站桩射击。
    if (this.targetTimer <= 0 || !this.target || !this.target.alive) {
      this.targetTimer = 0.22 + Math.random() * 0.12;
      this.target = this.findTarget();
    } else if (this.pos.distanceTo(this.target.pos) > 80 || !this.hasLOS(this.target)) {
      this.target = null;
      this.targetTimer = 0;
    }

    if (this.target) {
      const dist = this.pos.distanceTo(this.target.pos);
      const to = new THREE.Vector3().subVectors(this.target.pos, this.pos);
      to.y = 0;
      const targetYaw = Math.atan2(-to.x, -to.z);
      let turn = targetYaw - this.yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      this.yaw += turn * Math.min(1, dt * 8);
      if (dist < 10) this.moveTo(this.pos.clone().addScaledVector(to.clone().normalize().negate(), 6), 3.5, dt, false);
      else if (dist > 22) this.moveTo(this.target.pos, 4.6, dt);
      if (dist < 60 && this.fireTimer <= 0 && this.hasLOS(this.target)) {
        this.fireTimer = 0.55 + Math.random() * 0.35;
        this.tryFire();
      }
    } else {
      // 按队员编号分配不同目标，避免全队永远挤在数组中的第一个据点。
      const active = game.map.objectives.filter(o => !o.captured);
      if (active.length) {
        const ordered = [...active].sort((a, b) => this.pos.distanceTo(a.pos) - this.pos.distanceTo(b.pos));
        const next = ordered[this.index % ordered.length];
        const dist = this.pos.distanceTo(next.pos);
        if (dist > 2.2) {
          this.moveTo(next.pos, 4.6, dt);
          this.capT = 0;
        } else {
          this.capT = (this.capT || 0) + dt;
          if (this.capT > 5 && game.mode !== 'battlefield') {
            next.captured = true;
            next.ring.material.color.set(0x5fe08a);
            if (game.hud) game.hud.popup('友军占领了 ' + next.name + '！', true);
            this.capT = 0;
          }
        }
      } else {
        const desired = player.pos.clone();
        desired.x += Math.cos(this.index * 2.1) * 5;
        desired.z += Math.sin(this.index * 2.1) * 5;
        if (this.pos.distanceTo(desired) > 1.2) this.moveTo(desired, 4.8, dt);
      }
    }

    for (const ally of game.allies) {
      if (ally === this || !ally.alive) continue;
      const d = this.pos.distanceTo(ally.pos);
      if (d < 1.6 && d > 0.01) {
        this.pos.add(new THREE.Vector3().subVectors(this.pos, ally.pos).normalize().multiplyScalar((1.6 - d) * 0.45));
      }
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    if (this.indicator) {
      const d = Math.max(3, this.pos.distanceTo(player.pos));
      const scale = Math.min(1.6, Math.max(0.5, d * 0.055)) * (1 + Math.sin(game.time * 4.5 + this.index) * 0.06);
      this.indicator.scale.setScalar(scale);
    }
    const moving = this.speed > 0.18;
    this.walkT = (this.walkT || 0) + dt * (moving ? Math.max(3, this.speed) * 1.8 : 0.4);
    const amp = moving ? 0.52 : 0.04;
    this.legL.rotation.x = Math.sin(this.walkT) * amp;
    this.legR.rotation.x = -Math.sin(this.walkT) * amp;
    this.gunMesh.lookAt(this.pos.clone().add(new THREE.Vector3(-Math.sin(this.yaw) * 5, 0.1, -Math.cos(this.yaw) * 5)));
  }

  tryFire() {
    const game = this.game;
    const origin = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
    const dir = new THREE.Vector3().subVectors(this.target.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), origin).normalize();
    // 散布
    dir.x += (Math.random() - 0.5) * 0.02;
    dir.y += (Math.random() - 0.5) * 0.02;
    dir.z += (Math.random() - 0.5) * 0.02;
    dir.normalize();
    // 枪口火光 + 音效
    game.fx.addMuzzle(origin.clone().add(dir.clone().multiplyScalar(0.6)), 0.26);
    game.audio.shotRifle(this.pos, 0.5);
    if (this.target?.isVehicle) {
      const vh = this.target.raycast(origin, dir);
      const mapHit = game.rayMap(origin, dir, vh ? vh.t : 100);
      if (vh && (!mapHit || vh.t < mapHit.t)) {
        this.target.takeDamage(7.5, this.pos);
        game.fx.addImpact(vh.point, vh.normal || new THREE.Vector3(0, 1, 0), 'bullet');
        game.fx.addTracer(origin, vh.point, 0x78c6ff);
      } else if (mapHit) game.fx.addImpact(mapHit.point, mapHit.normal, 'bullet');
      return;
    }
    // 射线命中最近的敌人
    let best = null, bestT = Infinity;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const h = e.raycast(origin, dir);
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, enemy: e }; }
    }
    const mapHit = game.rayMap(origin, dir, bestT);
    if (mapHit && mapHit.t < bestT) best = null;
    if (best) {
      game.fx.addImpact(best.point, best.normal, best.head ? 'blood' : 'bullet');
      const dmg = best.head ? 22 : 12;
      best.enemy.takeDamage(dmg, dir.clone(), best.head, this.pos);
      if (best.enemy.hp <= 0) {
        game.kills++;
        if (best.head) { game.headshots++; game.hud.popup('友军爆头！', true); }
        game.hud.killFeed('<b>友军</b> 击杀敌人', best.head);
        game.audio.hitmarker(best.head);
        game.onEnemyKilled(best.enemy);
      }
    } else if (mapHit) {
      game.fx.addImpact(mapHit.point, mapHit.normal, 'bullet');
    }
  }

  takeDamage(dmg, fromPos) {
    if (!this.alive) return;
    this.hp -= dmg;
    if (this.hp <= 0) this.die(fromPos);
  }

  die(fromPos) {
    if (!this.alive) return;
    this.alive = false;
    this.deathT = 0;
    this.target = null;
    if (this.indicator) this.indicator.visible = false;
    this.fallDir = fromPos && fromPos.x < this.pos.x ? -1 : 1;
  }

  updateDead(dt) {
    this.deathT = (this.deathT || 0) + dt;
    this.root.rotation.z += (this.fallDir * 1.45 - this.root.rotation.z) * Math.min(1, dt * 6);
    if (this.deathT > 1.4) {
      this.root.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (this.root.scale.x < 0.05) {
        this.remove();
        this.removed = true;
      }
    }
  }

  remove() {
    this.game.scene.remove(this.root);
  }
}
