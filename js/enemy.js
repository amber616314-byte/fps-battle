// ============================================================
// enemy.js — 敌人 AI（5 兵种）、人形模型、波次系统
// ============================================================
import * as THREE from 'three';
import { camoDesert, camoForest, camoGrey } from './tex.js';

export const ENEMY_TYPES = {
  grunt:  { hp: 60,  speed: 4.2, damage: 8,  interval: 0.17, spread: 0.022, range: 38, sense: 48, score: 100, camo: 'desert' },
  heavy:  { hp: 200, speed: 3.0, damage: 6,  interval: 0.1,  spread: 0.03,  range: 30, sense: 42, score: 250, camo: 'forest' },
  sniper: { hp: 45,  speed: 3.6, damage: 45, interval: 2.3,  spread: 0.003, range: 95, sense: 75, score: 300, camo: 'grey' },
  rusher: { hp: 32,  speed: 6.9, damage: 0,  interval: 99,   spread: 0,     range: 1.7, sense: 42, score: 150, camo: 'desert' },
  rocket: { hp: 70,  speed: 3.4, damage: 55, interval: 3.4,  spread: 0.01,  range: 60, sense: 60, score: 300, camo: 'forest' },
};

// ---------- 射线与体元求交（数学版，避免每帧 raycast 开销） ----------
export function raySphere(ro, rd, c, r) {
  const oc = new THREE.Vector3().subVectors(ro, c);
  const b = oc.dot(rd);
  const cc = oc.dot(oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  if (t < 0) return null;
  const p = new THREE.Vector3().addScaledVector(rd, t).add(ro);
  return { t, point: p, normal: p.clone().sub(c).normalize() };
}
export function rayAABB(ro, rd, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = ro.getComponent(i), d = rd.getComponent(i);
    const mn = min.getComponent(i), mx = max.getComponent(i);
    if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) return null; continue; }
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin < 0 ? tmax : tmin;
  const p = new THREE.Vector3().addScaledVector(rd, t).add(ro);
  // 法线：找最近面
  const eps = 0.01;
  let normal = new THREE.Vector3(0, 0, 0);
  let best = Infinity;
  const faces = [
    [new THREE.Vector3(-1, 0, 0), Math.abs(p.x - min.x)],
    [new THREE.Vector3(1, 0, 0), Math.abs(max.x - p.x)],
    [new THREE.Vector3(0, -1, 0), Math.abs(p.y - min.y)],
    [new THREE.Vector3(0, 1, 0), Math.abs(max.y - p.y)],
    [new THREE.Vector3(0, 0, -1), Math.abs(p.z - min.z)],
    [new THREE.Vector3(0, 0, 1), Math.abs(max.z - p.z)],
  ];
  for (const [n, d] of faces) if (d < best) { best = d; normal = n; }
  void eps;
  return { t, point: p, normal };
}

// ============================================================
// Enemy
// ============================================================
export class Enemy {
  constructor(type, pos, game) {
    this.game = game;
    this.type = type;
    this.def = ENEMY_TYPES[type];
    this.pos = pos.clone();
    this.pos.y = game.map.groundHeight(pos.x, pos.z);
    this.vel = new THREE.Vector3();
    this.hp = this.def.hp;
    this.yaw = Math.random() * Math.PI * 2;
    this.state = 'patrol';
    this.alive = true;
    this.fireTimer = 0.4 + Math.random() * 0.8;
    this.senseTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = this.pos.clone();
    this.deathT = 0;
    this.stagger = 0;
    this.flashT = 0;      // 受击闪红计时
    this._flashOn = false;
    this.flankT = 0;      // 包抄侧移计时
    this.flankDir = null;
    this.retreatT = 0;    // 受击后撤计时
    this.searchT = 0;     // 原地搜索计时
    this._prevPos = this.pos.clone();
    this.speed = 0;
    this.heardPos = null;
    this.laser = null;
    this.laserT = 0;
    this.attackPlayerYaw = 0;
    this.target = null;          // 玩家或友军
    this.targetRefresh = 0;
    this.advanceTarget = null;
    this.navPath = [];
    this.navIndex = 0;
    this.navTarget = null;
    this.navRepath = 0;
    this._wp = this.pickWaypoint();
    this._fwd = new THREE.Vector3();
    this.buildModel();
  }

  pickWaypoint() {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 10;
    const p = new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r);
    const m = this.game.map.bounds;
    p.x = Math.max(m[0] + 1, Math.min(m[1] - 1, p.x));
    p.z = Math.max(m[2] + 1, Math.min(m[3] - 1, p.z));
    return p;
  }

  buildModel() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const camo = this.def.camo === 'desert' ? camoDesert() : this.def.camo === 'forest' ? camoForest() : camoGrey();
    const mat = new THREE.MeshStandardMaterial({ map: camo, roughness: 0.85, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7, metalness: 0.3 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a231d, roughness: 0.9, metalness: 0.05 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: this.type === 'heavy' ? 0x3a4a2c : 0x2c3138, roughness: 0.5, metalness: 0.4 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xb08d6a, roughness: 0.9 });
    this.matList = [mat, dark, leather, helmetMat, skinMat];

    // 腿（含靴子 + 护膝）
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.15), mat);
    this.legL.position.set(-0.11, -0.55, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.15), mat);
    this.legR.position.set(0.11, -0.55, 0);
    for (const leg of [this.legL, this.legR]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.19), leather);
      boot.position.set(0, -0.29, 0.015);
      leg.add(boot);
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.13), dark);
      knee.position.set(0, -0.02, 0.03);
      leg.add(knee);
    }
    // 躯干
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.28), mat);
    torso.position.y = 0.65;
    // 胸挂弹袋（腰带 + 胸前袋）
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 0.3), leather);
    belt.position.y = 0.42;
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06), dark);
    pouch.position.set(-0.1, 0.62, 0.155);
    const pouch2 = pouch.clone(); pouch2.position.x = 0.02;
    const pouch3 = pouch.clone(); pouch3.position.x = 0.14;
    // 护肩（轻型）
    const padL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.24), dark);
    padL.position.set(-0.26, 0.9, 0);
    const padR = padL.clone(); padR.position.x = 0.26;
    // 重甲兵：加厚胸甲 + 面罩 + 加宽肩垫
    if (this.type === 'heavy') {
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.36), helmetMat);
      chest.position.y = 0.72;
      torso.add(chest);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.02), helmetMat);
      face.position.set(0, 1.22, 0.125);
      this.body.add(face);
      const pad2 = padL.clone(); pad2.scale.set(1.35, 1.2, 1); pad2.position.x = 0;
      torso.add(pad2);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.3), dark);
      skirt.position.y = 0.28;
      torso.add(skirt);
    }
    // 头
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skinMat);
    this.head.position.y = 1.2;
    this.head.userData.head = true;
    // 头盔
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.126, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
    helmet.position.y = 1.21;
    this.head.add(helmet);
    // 帽子（狙击手兜帽）
    if (this.type === 'sniper') {
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.12, 10), helmetMat);
      hat.position.y = 1.28;
      this.head.add(hat);
      // 吉利服披风
      const cape = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 8, 1, true), mat);
      cape.position.set(0, 0.98, -0.12);
      cape.rotation.x = Math.PI;
      cape.scale.set(1, 1.4, 0.9);
      this.body.add(cape);
    }
    // 自爆兵涂装：红色背心 + 炸弹背包 + 警告灯
    if (this.type === 'rusher') {
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.32), new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.8 }));
      vest.position.y = 0.69;
      this.body.add(vest);
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.2), dark);
      pack.position.set(0, 0.7, -0.24);
      this.body.add(pack);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 }));
      lamp.position.set(0, 0.78, -0.35);
      this.body.add(lamp);
    }
    // 火箭兵：火箭筒 + 弹药背包
    if (this.type === 'rocket') {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.8, 10), dark);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0.3, 0.74, -0.3);
      this.body.add(tube);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), helmetMat);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0.3, 0.74, -0.68);
      this.body.add(muzzle);
    }
    // 手臂（带手套）
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), mat);
    this.armL.position.set(-0.3, 0.68, 0);
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), mat);
    this.armR.position.set(0.3, 0.68, 0);
    for (const arm of [this.armL, this.armR]) {
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.07, 0.085), dark);
      glove.position.y = -0.19;
      arm.add(glove);
    }
    // 枪（枪口朝 +Z，配合 lookAt 指向目标；按兵种区分造型）
    const gunLen = this.type === 'sniper' ? 0.75 : this.type === 'heavy' ? 0.6 : this.type === 'rocket' ? 0.3 : 0.5;
    this.gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, gunLen), dark);
    this.gunMesh.position.set(0.26, 0.74, gunLen / 2 - 0.05);
    if (this.type === 'heavy') {
      // 机枪枪管加粗 + 弹链
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, gunLen, 8), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0.26, 0.74, gunLen / 2 - 0.05);
      this.gunMesh.add(barrel);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), dark);
      mag.position.set(0.26, 0.62, -0.15);
      this.body.add(mag);
    }
    if (this.type === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0.26, 0.82, 0.1);
      this.body.add(scope);
    }
    this.armR.rotation.x = -Math.PI / 2.3;
    this.body.add(this.armL, this.armR, torso, this.legL, this.legR, this.head, this.gunMesh, belt, pouch, pouch2, pouch3, padL, padR);
    // 身体包围盒（射击判定）
    this.bodyBox = { min: new THREE.Vector3(-0.26, -0.85, -0.18), max: new THREE.Vector3(0.26, 1.02, 0.18) };
    // 整体放大 8%，大战场视野中更醒目
    this.scale = (this.type === 'heavy' ? 1.15 : this.type === 'sniper' ? 1.0 : 0.98) * 1.08;
    this.root.scale.setScalar(this.scale);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    // 头顶红色标识（敌我分辨）
    this.makeIndicator('#ff5a4a');
    this.game.scene.add(this.root);
  }

  // 头顶阵营标识（菱形，穿透显示，随距离缩放）
  makeIndicator(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
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
  }

  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // 射线检测（命中头/身体）
  raycast(ro, rd) {
    if (!this.alive) return null;
    // 头部
    const hp = new THREE.Vector3().copy(this.pos);
    hp.y += 1.24 * this.scale;
    const hs = raySphere(ro, rd, hp, 0.165 * this.scale);
    if (hs && hs.t < 400) return { ...hs, head: true };
    // 身体 AABB
    const min = new THREE.Vector3().copy(this.pos).addScaledVector(new THREE.Vector3(-0.34, -0.82, -0.28), this.scale);
    const max = new THREE.Vector3().copy(this.pos).addScaledVector(new THREE.Vector3(0.34, 1.08, 0.28), this.scale);
    const ba = rayAABB(ro, rd, min, max);
    if (ba && ba.t < 400) return { ...ba, head: false };
    return null;
  }

  takeDamage(dmg, dir, headshot, shooterPos) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.stagger = 0.25;
    this.flashT = 0.12;
    this.game.fx.addBlood(this.pos.clone().add(new THREE.Vector3(0, headshot ? 1.2 : 1.0, 0)), dir.clone().normalize().negate());
    // 受击后撤（近距交火时被打会退后，避免站桩）
    const activeTarget = this.target && this.target.alive ? this.target : this.game.player;
    if (this.state === 'attack' && activeTarget.pos.distanceTo(this.pos) < 14) {
      this.retreatT = Math.max(this.retreatT, 0.8);
    }
    // 根据受击位置锁定最近的玩家方单位，避免友军开枪后敌人仍只盯玩家。
    if (shooterPos) {
      const candidates = [this.game.player, ...(this.game.allies || []), ...(this.game.vehicles || []).filter(v => v.team === 'blue')].filter(t => t && t.alive);
      candidates.sort((a, b) => a.pos.distanceTo(shooterPos) - b.pos.distanceTo(shooterPos));
      this.target = candidates[0] || this.game.player;
      this.lastSeen = shooterPos.clone();
      this.heardPos = shooterPos.clone();
      this.state = 'chase';
      this.navRepath = 0;
    }
    // 被击中呼救：35m 内同伴进入追击（协同作战）
    if (this.alive) {
      for (const e of this.game.enemies) {
        if (e === this || !e.alive || e.state === 'attack') continue;
        if (e.pos.distanceTo(this.pos) < 35) {
          e.state = 'chase';
          e.heardPos = (shooterPos || this.pos).clone();
        }
      }
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.deathT = 0;
    if (this.indicator) this.indicator.visible = false; // 死亡隐藏标识
    this.fallDir = Math.random() > 0.5 ? 1 : -1; // 死亡倒向固定（避免动画抖动）
    this.game.audio.explosion(null, 0.15, 0.5); // 闷响
    // 自爆兵殉爆
    if (this.type === 'rusher') {
      const d = this.game.player.pos.distanceTo(this.pos);
      if (d < 2.8) {
        this.game.fx.addExplosion(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.1);
        this.game.audio.explosion(this.pos, 1);
        this.game.player.takeDamage(70 * Math.max(0.3, 1 - d / 3), this.pos);
      }
    }
  }

  update(dt) {
    if (!this.alive) return;
    const game = this.game;
    const player = game.player;
    this.fireTimer -= dt;
    this.senseTimer -= dt;
    this.targetRefresh -= dt;
    this.stagger = Math.max(0, this.stagger - dt);
    this.laserT -= dt;
    if (this.laser) this.laser.visible = this.laserT > 0;

    // 受击闪红（材质 emissive）
    this.flashT = Math.max(0, this.flashT - dt);
    const flashing = this.flashT > 0;
    if (flashing !== this._flashOn) {
      this._flashOn = flashing;
      this.body.traverse(ch => {
        if (ch.isMesh && ch.material) {
          ch.material.emissive.setHex(flashing ? 0x991111 : 0x000000);
          ch.material.emissiveIntensity = flashing ? 1 : 0;
        }
      });
    }

    // 上一帧实际速度：同时驱动动画和射击精度。
    this.speed = this.pos.distanceTo(this._prevPos) / Math.max(dt, 1e-4);
    this._prevPos.copy(this.pos);

    if (this.indicator && this.indicator.visible) {
      const d = Math.max(3, this.pos.distanceTo(player.pos));
      const scale = Math.min(1.6, Math.max(0.5, d * 0.055)) * (1 + Math.sin(game.time * 4.5) * 0.06);
      this.indicator.scale.setScalar(scale);
    }

    // 周期性选择玩家或最近可见友军，避免每帧做全部 LOS 检测。
    if (this.targetRefresh <= 0) {
      this.targetRefresh = 0.16 + Math.random() * 0.08;
      const sensed = this.selectCombatTarget();
      if (sensed) {
        this.target = sensed;
        this.lastSeen = sensed.pos.clone();
        const td = this.pos.distanceTo(sensed.pos);
        this.state = td < this.def.range && this.hasLOS(sensed) ? 'attack' : 'chase';
      } else if (this.target && (!this.target.alive || this.pos.distanceTo(this.target.pos) > this.def.sense * 2.2)) {
        this.target = null;
        if (this.lastSeen) { this.heardPos = this.lastSeen.clone(); this.state = 'search'; }
      }
    }

    // 枪声调查以枪声位置计算距离，而不是错误地使用到玩家的距离。
    if (!this.target && game.heardShot && this.pos.distanceTo(game.heardShot.pos) < game.heardShot.range) {
      this.heardPos = game.heardShot.pos.clone();
      this.state = 'search';
    }

    let bombPriority = false;
    if (game.bomb && !game.bomb.defused && !game.bomb.exploded) {
      const bd = this.pos.distanceTo(game.bomb.pos);
      if (bd < 18 && (!this.target || bd < 6)) {
        bombPriority = true;
        this.moveTo(game.bomb.pos, this.def.speed * 0.95, dt);
        if (bd < 1.7) {
          // 同一时间只允许一名敌人拆包，避免多人靠近时拆包进度按人数倍增。
          if (!game.bomb.defuser || !game.bomb.defuser.alive || game.bomb.defuser === this) {
            game.bomb.defuser = this;
            game.bomb.defuseT += dt;
            const tY = Math.atan2(-(game.bomb.pos.x - this.pos.x), -(game.bomb.pos.z - this.pos.z));
            this.yaw = this.angleLerp(this.yaw, tY, dt * 8);
            if (game.bomb.defuseT >= 5) game.bomb.defused = true;
          }
        } else if (game.bomb.defuser === this) {
          game.bomb.defuser = null;
          game.bomb.defuseT = Math.max(0, game.bomb.defuseT - dt * 1.5);
        }
      }
    }

    if (!bombPriority) {
      const target = this.target && this.target.alive ? this.target : null;
      if (target) {
        const toTarget = new THREE.Vector3().subVectors(target.pos, this.pos);
        toTarget.y = 0;
        const dist = toTarget.length();
        const los = this.hasLOS(target);

        if (this.state === 'attack' && (!los || dist > this.def.range * 1.45)) {
          this.lastSeen = target.pos.clone();
          this.state = 'chase';
        }
        if (this.state !== 'attack' && los && dist < this.def.range) this.state = 'attack';

        if (this.state === 'chase') {
          this.moveTo(target.pos, this.def.speed, dt);
        } else if (this.state === 'attack') {
          const targetYaw = Math.atan2(-toTarget.x, -toTarget.z);
          this.yaw = this.angleLerp(this.yaw, targetYaw, dt * 8);
          if (this.retreatT > 0) {
            this.retreatT -= dt;
            const dir = this.coverDir(toTarget);
            this.moveTo(this.pos.clone().addScaledVector(dir, 6), this.def.speed * 1.2, dt, false);
          } else if (this.type === 'sniper' && dist < 25) {
            this.moveTo(this.pos.clone().addScaledVector(toTarget.clone().normalize().negate(), 12), this.def.speed, dt, false);
          } else if (this.type === 'rusher') {
            this.moveTo(target.pos, this.def.speed * 1.3, dt);
            if (dist < this.def.range + 0.3) this.explode(target);
          } else {
            if (dist < 8) this.moveTo(this.pos.clone().addScaledVector(toTarget.clone().normalize().negate(), 7), this.def.speed * 0.65, dt, false);
            this.flankT -= dt;
            if (this.flankT <= 0 && dist > 12) {
              this.flankT = 1.8 + Math.random() * 2.2;
              const side = Math.random() > 0.5 ? 1 : -1;
              this.flankDir = new THREE.Vector3(-toTarget.z, 0, toTarget.x).normalize().multiplyScalar(side);
            }
            if (this.flankDir && this.flankT > 0.5) {
              this.moveTo(this.pos.clone().addScaledVector(this.flankDir, 5), this.def.speed * 0.72, dt, false);
            } else this.flankDir = null;
          }
          if (this.alive) this.tryFire(target, dist);
        }
      } else if (this.state === 'search' && this.heardPos) {
        if (this.pos.distanceTo(this.heardPos) < 2.2) {
          this.searchT += dt;
          this.yaw += dt * 1.6;
          if (this.searchT > 2.2) {
            this.heardPos = null;
            this.searchT = 0;
            this.state = 'advance';
          }
        } else this.moveTo(this.heardPos, this.def.speed * 0.82, dt);
      } else {
        // 没发现目标时主动推进到最近未占领据点，而不是在地图边缘原地巡逻。
        const active = game.map.objectives.filter(o => game.mode === 'battlefield' ? o.owner !== 'red' : !o.captured);
        const objective = active.length
          ? active.reduce((a, b) => this.pos.distanceTo(a.pos) < this.pos.distanceTo(b.pos) ? a : b)
          : null;
        const goal = objective ? objective.pos : player.pos;
        this.advanceTarget = goal.clone();
        this.state = 'advance';
        if (this.pos.distanceTo(goal) > 5) this.moveTo(goal, this.def.speed * 0.88, dt);
        else {
          if (!this._wp || this._wp.distanceTo(goal) > 12 || this.pos.distanceTo(this._wp) < 1.2) {
            const a = Math.random() * Math.PI * 2;
            this._wp = goal.clone().add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4));
          }
          this.moveTo(this._wp, this.def.speed * 0.42, dt);
        }
      }
    }

    // 卡住后强制丢弃旧路径并重新规划。
    this.stuckTimer += dt;
    if (this.stuckTimer > 0.85) {
      if (this.pos.distanceTo(this.lastPos) < 0.22) {
        this.navPath = [];
        this.navIndex = 0;
        this.navRepath = 0;
        this.yaw += (Math.random() - 0.5) * 2.4;
      }
      this.lastPos.copy(this.pos);
      this.stuckTimer = 0;
    }

    // 敌人互相分离，避免全部叠在同一个刷新点。
    for (const e of game.enemies) {
      if (e === this || !e.alive) continue;
      const d = this.pos.distanceTo(e.pos);
      if (d < 0.78 && d > 0.01) {
        this.pos.add(new THREE.Vector3().subVectors(this.pos, e.pos).normalize().multiplyScalar((0.78 - d) * 0.45));
      }
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const moving = this.speed > 0.18;
    const walkAmp = moving ? (this.state === 'attack' ? 0.3 : 0.62) : 0.03;
    const t = this.walkT || 0;
    this.legL.rotation.x = Math.sin(t * 9) * walkAmp;
    this.legR.rotation.x = -Math.sin(t * 9) * walkAmp;
    this.armL.rotation.x = Math.sin(t * 9 + 1) * walkAmp * 0.55;
    this.walkT = t + dt * (moving ? Math.max(2.5, this.speed) : 0.4) * 1.8;
    this.gunMesh.position.set(0.26, 0.14, -0.08);
    this.gunMesh.lookAt(this.pos.clone().add(new THREE.Vector3(-Math.sin(this.yaw) * 5, 0.1, -Math.cos(this.yaw) * 5)));

    this.pos.y = game.map.groundHeight(this.pos.x, this.pos.z);
  }

  selectCombatTarget() {
    const candidates = [this.game.player, ...(this.game.allies || []), ...(this.game.vehicles || []).filter(v => v.team === 'blue')].filter(t => t && t.alive);
    let best = null;
    let bestScore = Infinity;
    for (const target of candidates) {
      const d = this.pos.distanceTo(target.pos);
      if (d > this.def.sense) continue;
      if (!this.hasLOS(target)) continue;
      // 略微偏向更近且正在交火的目标，不再把所有火力永久集中给玩家。
      const threat = target === this.game.player ? 2 : 0;
      const score = d + threat + Math.random() * 2;
      if (score < bestScore) { bestScore = score; best = target; }
    }
    return best;
  }

  moveTo(target, speed, dt, useNavigation = true) {
    let waypoint = target;
    const nav = this.game.navigator;
    const targetDist = this.pos.distanceTo(target);
    this.navRepath -= dt;

    if (useNavigation && nav && targetDist > nav.cellSize * 1.2) {
      const direct = nav.lineClear(this.pos, target);
      const targetMoved = !this.navTarget || this.navTarget.distanceTo(target) > nav.cellSize * 1.25;
      if (direct) {
        this.navPath = [];
        this.navIndex = 0;
        waypoint = target;
      } else {
        if (targetMoved || this.navRepath <= 0 || !this.navPath.length) {
          this.navPath = nav.findPath(this.pos, target);
          this.navIndex = this.navPath.length > 1 ? 1 : 0;
          this.navTarget = target.clone();
          this.navRepath = 0.65 + Math.random() * 0.45;
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
    const wall = this._probeWall(dir);
    if (wall) {
      const slide = dir.clone().addScaledVector(wall.normal, -dir.dot(wall.normal));
      if (slide.lengthSq() > 0.02) dir.copy(slide.normalize());
      else {
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.random() > 0.5 ? 1 : -1);
        dir.copy(side);
      }
    }
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    this.yaw = this.angleLerp(this.yaw, targetYaw, dt * 9);
    this.moveCollide(dir.multiplyScalar(speed * dt));
  }

  // 受击撤退方向：优先退向最近的矮掩体（沙袋/箱子），否则直接远离玩家
  coverDir(toPlayer) {
    const away = toPlayer.clone().normalize().negate();
    let best = null, bestD = Infinity;
    for (const b of this.game.map.colliders) {
      if (b.h > 1.7) continue; // 只找矮掩体
      const d = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
      if (d < bestD && d > 2) { bestD = d; best = b; }
    }
    if (best) {
      const toCover = new THREE.Vector3(best.x - this.pos.x, 0, best.z - this.pos.z).normalize();
      if (toCover.dot(away) > 0.2) return toCover; // 掩体在撤退方向附近才采用
    }
    return away;
  }

  // 探测移动方向前方 1.15m 内是否有碰撞体（返回含法线的命中）
  _probeWall(dir) {
    const map = this.game.map;
    const from = this.pos.clone();
    from.y += 0.8;
    const dist = 1.15;
    for (const b of map.colliders) {
      const t = rayAABB(from, dir,
        new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
        new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2));
      if (t && t.t < dist && t.t > 0.05) return t;
    }
    return null;
  }

  moveCollide(delta) {
    const map = this.game.map;
    const halfW = 0.32, height = 1.6;
    this.pos.x += delta.x;
    for (const b of map.colliders) {
      if (this._overlap(b, halfW, height)) {
        this.pos.x = delta.x > 0 ? b.x - b.w / 2 - halfW : b.x + b.w / 2 + halfW;
      }
    }
    this.pos.z += delta.z;
    for (const b of map.colliders) {
      if (this._overlap(b, halfW, height)) {
        this.pos.z = delta.z > 0 ? b.z - b.d / 2 - halfW : b.z + b.d / 2 + halfW;
      }
    }
    const g = map.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < g) this.pos.y = g;
    const lim = map.bounds;
    this.pos.x = Math.max(lim[0] + 0.3, Math.min(lim[1] - 0.3, this.pos.x));
    this.pos.z = Math.max(lim[2] + 0.3, Math.min(lim[3] - 0.3, this.pos.z));
  }

  _overlap(b, halfW, height) {
    const cx = this.pos.x, cy = this.pos.y + height / 2, cz = this.pos.z;
    return Math.abs(cx - b.x) < b.w / 2 + halfW &&
      Math.abs(cz - b.z) < b.d / 2 + halfW &&
      Math.abs(cy - b.y) < b.h / 2 + height / 2;
  }

  angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }

  hasLOS(target) {
    // 从头部到目标头部，检查地图碰撞体遮挡
    const from = this.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    const to = target.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    const dir = to.sub(from);
    const len = dir.length();
    if (len < 0.01) return true;
    dir.divideScalar(len);
    for (const b of this.game.map.colliders) {
      const t = rayAABB(from, dir, new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2));
      if (t && t.t < len - 0.35) return false;
    }
    return true;
  }

  tryFire(target, dist) {
    const def = this.def;
    if (this.fireTimer > 0 || !target || !target.alive) return;
    if (this.type === 'rocket') {
      this.fireTimer = def.interval;
      this.game.fireRocket(this, target);
      this.game.audio.shotMG(this.pos, 0.8);
      return;
    }
    this.fireTimer = def.interval * (0.85 + Math.random() * 0.3);
    const moving = this.speed > 1.2;
    const sp = def.spread * (1 + Math.max(0, dist - 20) * 0.012) *
      (this.type === 'heavy' ? 1.4 : 1) * (moving ? (this.type === 'sniper' ? 3.2 : 1.7) : 1);
    const origin = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
    const aimHeight = target.isVehicle ? 1.0 : target === this.game.player ? 1.05 : 0.95;
    const dir = target.pos.clone().add(new THREE.Vector3(0, aimHeight, 0)).sub(origin).normalize();
    dir.x += (Math.random() - 0.5) * 2 * sp;
    dir.y += (Math.random() - 0.5) * 2 * sp;
    dir.z += (Math.random() - 0.5) * 2 * sp;
    dir.normalize();

    let vehHit = null, vehT = Infinity;
    if (target.isVehicle) {
      const hit = target.raycast(origin, dir);
      if (hit) { vehHit = target; vehT = hit.t; }
    } else if (target === this.game.player && this.game.driving) {
      const hit = this.game.driving.raycast(origin, dir);
      if (hit) { vehHit = this.game.driving; vehT = hit.t; }
    }

    const min = new THREE.Vector3(target.pos.x - 0.4, target.pos.y, target.pos.z - 0.4);
    const max = new THREE.Vector3(target.pos.x + 0.4, target.pos.y + 1.75, target.pos.z + 0.4);
    const targetHit = vehHit ? null : rayAABB(origin, dir, min, max);
    const mapLimit = vehHit ? vehT : (targetHit ? targetHit.t : 90);
    const mapHit = this.game.rayMap(origin, dir, mapLimit);
    const hit = targetHit && (!mapHit || targetHit.t < mapHit.t) ? targetHit : null;

    this.game.fx.addMuzzle(origin.clone().add(dir.clone().multiplyScalar(0.5)), this.type === 'heavy' ? 0.4 : 0.3);
    if (this.type === 'sniper') {
      this.laserT = 0.9;
      if (!this.laser) {
        const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.7 }));
        this.game.scene.add(this.laser);
      }
      const pts = this.laser.geometry.attributes.position;
      pts.setXYZ(0, origin.x, origin.y, origin.z);
      const end = origin.clone().add(dir.clone().multiplyScalar(60));
      pts.setXYZ(1, end.x, end.y, end.z);
      pts.needsUpdate = true;
    }
    if (this.type === 'sniper') this.game.audio.shotSniper(this.pos, 0.9);
    else this.game.audio.shotMG(this.pos, this.type === 'heavy' ? 0.9 : 0.7);

    if (vehHit && (!mapHit || vehT <= mapHit.t + 0.05)) {
      vehHit.takeDamage(def.damage * (this.type === 'heavy' ? 0.7 : 0.5), origin);
      this.game.fx.addImpact(origin.clone().addScaledVector(dir, vehT), new THREE.Vector3(0, 1, 0), 'bullet');
    } else if (hit) {
      const dmgMul = Math.max(0.55, 1 - dist / 90);
      target.takeDamage(def.damage * dmgMul, this.pos);
      this.game.fx.addImpact(hit.point, hit.normal, 'bullet');
    } else if (mapHit) {
      this.game.fx.addImpact(mapHit.point, mapHit.normal, 'bullet');
    }
  }

  explode() {
    this.game.fx.addExplosion(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 1.2);
    this.game.audio.explosion(this.pos, 1.1);
    for (const target of [this.game.player, ...(this.game.allies || []), ...(this.game.vehicles || []).filter(v => v.team === 'blue')]) {
      if (!target || !target.alive) continue;
      const d = target.pos.distanceTo(this.pos);
      if (d < 5) target.takeDamage(85 * Math.max(0.25, 1 - d / 5), this.pos);
    }
    this.hp = 0;
    this.die();
  }

  // 死亡动画更新（由 game 调用）
  updateDead(dt) {
    this.deathT += dt;
    if (this.deathT < 0.45) {
      this.body.rotation.x = Math.min(1, this.deathT / 0.45) * this.fallDir * 1.45;
      this.root.position.y = this.pos.y + 0.02;
      this.root.rotation.z = this.body.rotation.x * 0.4;
    } else if (this.deathT < 0.8) {
      const k = (this.deathT - 0.45) / 0.35;
      this.root.scale.setScalar(this.scale * (1 - k * 0.7));
    } else if (this.deathT < 1.4) {
      const k = (this.deathT - 0.8) / 0.6;
      this.root.scale.setScalar(this.scale * (0.3 - k * 0.3));
    }
    return this.deathT > 1.45;
  }

  remove() {
    this.game.scene.remove(this.root);
    if (this.laser) this.game.scene.remove(this.laser);
  }
}

// ============================================================
// WaveManager — 波次生成
// ============================================================
export class WaveManager {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.totalWaves = 8;
    this.state = 'idle'; // idle | spawning | between
    this.queue = [];
    this.spawnTimer = 0;
    this.betweenTimer = 0;
    this.spawned = 0;
    this.completed = false;
  }

  start(totalWaves) {
    this.totalWaves = totalWaves;
    this.wave = 0;
    this.queue = [];
    this.state = 'between';
    this.betweenTimer = 2.5;
    this.completed = false;
  }

  buildWave(n) {
    const list = [];
    const battlefield = this.game.mode === 'battlefield';
    const es = (this.game.options && this.game.options.enemyScale) || 1;
    const sc = x => Math.max(1, Math.round(x * es));
    if (!battlefield) {
      list.push(...Array(sc(Math.min(4 + n * 2, 10))).fill('grunt'));
      if (n >= 3) list.push(...Array(sc(Math.min(n - 2, 5))).fill('heavy'));
      if (n >= 4) list.push(...Array(sc(Math.min(n - 3, 4))).fill('sniper'));
      if (n >= 5) list.push(...Array(sc(Math.min(n - 4, 4))).fill('rusher'));
    } else {
      const base = 6 + n * 2;
      list.push(...Array(sc(Math.min(base, 22))).fill('grunt'));
      if (n >= 2) list.push(...Array(sc(Math.min(Math.floor(n * 0.8), 7))).fill('heavy'));
      if (n >= 3) list.push(...Array(sc(Math.min(n - 2, 6))).fill('sniper'));
      if (n >= 4) list.push(...Array(sc(Math.min(n - 3, 6))).fill('rusher'));
      if (n >= 5) list.push(...Array(sc(Math.min(n - 4, 5))).fill('rocket'));
    }
    // 洗牌
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  update(dt) {
    const game = this.game;
    if (this.state === 'between') {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) {
        this.wave++;
        if (this.wave > this.totalWaves) { this.completed = true; return; }
        this.queue = this.buildWave(this.wave);
        this.spawned = 0;
        this.spawnTimer = 0;
        this.state = 'spawning';
        game.hud.centerMsg(`第 ${this.wave} 波`, this.wave === this.totalWaves ? '最后一波！敌人倾巢而出' : '敌人正在逼近…');
        game.audio.beep(true);
      }
    } else if (this.state === 'spawning') {
      if (this.queue.length > 0 && game.enemies.length < game.maxEnemies) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = 0.7;
          const type = this.queue.pop();
          game.spawnEnemy(type);
          this.spawned++;
        }
      } else if (this.queue.length === 0 && game.enemies.length === 0) {
        this.state = 'between';
        this.betweenTimer = 10;
        if (this.wave >= this.totalWaves) {
          // 全部波次完成
          if (game.objectivesAllDone()) {
            game.winGame();
          } else {
            game.hud.centerMsg('波次已清空', '继续攻占目标点');
          }
        } else {
          game.hud.centerMsg('波次完成', `${10} 秒后下一波`);
        }
      }
    }
  }
}
