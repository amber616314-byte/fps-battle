// ============================================================
// vehicles.js — 阵营载具系统
// 载具：战术吉普 / 主战坦克 / 武装直升机
// 支持玩家驾驶、AI 驾驶、陆空移动、武器、耐久、重生与阵营识别。
// ============================================================
import * as THREE from 'three';
import { rayAABB } from './enemy.js';

export const VEHICLE_DEFS = {
  jeep: {
    name: '战术吉普', maxSpeed: 22, reverseSpeed: 10, accel: 7.5, brake: 4.2,
    turnRate: 2.0, eyeH: 1.65, air: false, radius: 1.55, maxHp: 460,
    primary: 'mg', primaryInterval: 0.095, primaryDamage: 15, range: 175,
  },
  tank: {
    name: '主战坦克', maxSpeed: 12.5, reverseSpeed: 6.5, accel: 4.3, brake: 3.0,
    turnRate: 1.15, eyeH: 2.15, air: false, radius: 2.25, maxHp: 1100,
    primary: 'cannon', primaryInterval: 3.2, primaryDamage: 210, range: 260,
    secondary: 'mg', secondaryInterval: 0.105, secondaryDamage: 11,
  },
  chopper: {
    name: '武装直升机', maxSpeed: 34, reverseSpeed: 15, accel: 4.8, brake: 1.8,
    turnRate: 1.55, eyeH: 2.4, air: true, climb: 9, radius: 2.4, maxHp: 720,
    primary: 'mg', primaryInterval: 0.075, primaryDamage: 13, range: 240,
    secondary: 'rocket', secondaryInterval: 2.4, secondaryDamage: 145,
  },
};

const TEAM_COLORS = {
  blue: { body: 0x3f6077, accent: 0x4aa8ff, dark: 0x17222b },
  red: { body: 0x75433c, accent: 0xff5a4a, dark: 0x2b1917 },
};

function makeMat(color, metalness = 0.35, roughness = 0.62) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 0.55 });
}

export class Vehicle {
  constructor(game, type, pos, yaw = 0, opts = {}) {
    this.game = game;
    this.type = type;
    this.def = VEHICLE_DEFS[type] || VEHICLE_DEFS.jeep;
    this.team = opts.team === 'red' ? 'red' : 'blue';
    this.aiControlled = !!opts.aiControlled;
    this.spawnPos = pos.clone();
    this.spawnYaw = yaw;
    this.pos = pos.clone();
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.vel = new THREE.Vector3();
    this.occupied = this.aiControlled;
    this.driver = this.aiControlled ? 'ai' : null;
    this.isVehicle = true;
    this.alive = true;
    this.maxHp = this.def.maxHp;
    this.hp = this.maxHp;
    this.primaryCooldown = Math.random() * 0.4;
    this.secondaryCooldown = Math.random() * 0.8;
    this.aiThink = Math.random() * 0.3;
    this.aiTarget = null;
    this.aiGoal = null;
    this.aiStuck = 0;
    this.navPath = [];
    this.navIndex = 0;
    this.navTimer = Math.random() * 0.8;
    this.navGoal = null;
    this.lastPos = this.pos.clone();
    this.rotorSpin = 0;
    this.turretYaw = yaw;
    this.gunPitch = 0;
    this._destroyedT = 0;
    this.buildModel();
  }

  get displayName() { return `${this.team === 'blue' ? '友军' : '敌军'}${this.def.name}`; }

  buildModel() {
    const c = TEAM_COLORS[this.team];
    const g = new THREE.Group();
    g.userData.vehicle = this;
    const bodyMat = makeMat(c.body, 0.42, 0.58);
    const dark = makeMat(c.dark, 0.58, 0.48);
    const tire = makeMat(0x151719, 0.05, 0.95);
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x8db6cc, metalness: 0.05, roughness: 0.2,
      transparent: true, opacity: 0.48, transmission: 0.05, envMapIntensity: 0.8,
    });

    if (this.type === 'jeep') {
      const source = this.game.tex?.sceneModels?.jeepModel;
      if (source) {
        const model = source.clone();
        model.scale.setScalar(1.28);
        model.rotation.y = Math.PI;
        model.traverse(ch => {
          if (!ch.isMesh) return;
          ch.castShadow = true;
          ch.receiveShadow = true;
          ch.material = bodyMat.clone();
        });
        g.add(model);
      } else {
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.55, 4.35), bodyMat);
        chassis.position.y = 0.62;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 1.95), bodyMat);
        cabin.position.set(0, 1.18, -0.15);
        const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.52, 0.08), glass);
        windshield.position.set(0, 1.32, 0.8);
        windshield.rotation.x = -0.18;
        g.add(chassis, cabin, windshield);
      }
      const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 16);
      wheelGeo.rotateZ(Math.PI / 2);
      this.wheels = [];
      for (const [wx, wz] of [[-1.16, 1.45], [1.16, 1.45], [-1.16, -1.45], [1.16, -1.45]]) {
        const w = new THREE.Mesh(wheelGeo, tire);
        w.position.set(wx, 0.42, wz);
        this.wheels.push(w);
        g.add(w);
      }
      this.turret = new THREE.Group();
      this.turret.position.set(0, 1.65, -0.25);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.18, 14), dark);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.25), dark);
      gun.position.z = 0.62;
      this.turret.add(ring, gun);
      g.add(this.turret);
      this.muzzleLocal = new THREE.Vector3(0, 1.65, 1.25);
    } else if (this.type === 'tank') {
      const lower = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.72, 5.35), bodyMat);
      lower.position.y = 0.74;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.72, 3.35), bodyMat);
      upper.position.set(0, 1.3, -0.25);
      const trackGeo = new THREE.BoxGeometry(0.58, 0.72, 5.5);
      const leftTrack = new THREE.Mesh(trackGeo, dark);
      const rightTrack = new THREE.Mesh(trackGeo, dark);
      leftTrack.position.set(-1.68, 0.62, 0);
      rightTrack.position.set(1.68, 0.62, 0);
      g.add(lower, upper, leftTrack, rightTrack);

      this.turret = new THREE.Group();
      this.turret.position.set(0, 1.75, -0.28);
      const turretBody = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.38, 0.62, 10), bodyMat);
      const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.48), dark);
      mantlet.position.set(0, 0.02, 1.15);
      this.barrelPivot = new THREE.Group();
      this.barrelPivot.position.set(0, 0.04, 1.16);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.7, 12), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 1.8;
      const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12), dark);
      muzzleBrake.rotation.x = Math.PI / 2;
      muzzleBrake.position.z = 3.55;
      this.barrelPivot.add(barrel, muzzleBrake);
      this.turret.add(turretBody, mantlet, this.barrelPivot);
      g.add(this.turret);
      this.muzzleLocal = new THREE.Vector3(0, 1.79, 4.15);
    } else {
      const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 2.6, 6, 12), bodyMat);
      fuselage.rotation.x = Math.PI / 2;
      fuselage.position.y = 1.0;
      const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10), glass);
      cockpit.scale.set(1, 0.75, 1.25);
      cockpit.position.set(0, 1.12, 1.55);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 4.0), bodyMat);
      tail.position.set(0, 1.08, -2.45);
      tail.rotation.x = -0.1;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.12), dark);
      fin.position.set(0, 1.75, -4.25);
      this.rotor = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.055, 7.4), dark);
      this.rotor.position.set(0, 2.15, 0);
      this.rotor2 = this.rotor.clone();
      this.rotor2.rotation.y = Math.PI / 2;
      this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.1), dark);
      this.tailRotor.position.set(0.2, 1.72, -4.32);
      const skidGeo = new THREE.CylinderGeometry(0.055, 0.055, 3.2, 8);
      skidGeo.rotateX(Math.PI / 2);
      for (const x of [-0.78, 0.78]) {
        const skid = new THREE.Mesh(skidGeo, dark);
        skid.position.set(x, 0.18, 0.25);
        g.add(skid);
      }
      this.turret = new THREE.Group();
      this.turret.position.set(0, 0.72, 1.75);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.25), dark);
      gun.position.z = 0.62;
      this.turret.add(gun);
      g.add(fuselage, cockpit, tail, fin, this.rotor, this.rotor2, this.tailRotor, this.turret);
      this.muzzleLocal = new THREE.Vector3(0, 0.72, 2.95);
    }

    const markerCanvas = document.createElement('canvas');
    markerCanvas.width = markerCanvas.height = 48;
    const ctx = markerCanvas.getContext('2d');
    ctx.fillStyle = `#${c.accent.toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.moveTo(24, 2); ctx.lineTo(46, 24); ctx.lineTo(24, 46); ctx.lineTo(2, 24); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
    const markerTex = new THREE.CanvasTexture(markerCanvas);
    markerTex.colorSpace = THREE.SRGBColorSpace;
    this.indicator = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthTest: false, depthWrite: false }));
    this.indicator.position.set(0, this.type === 'chopper' ? 4.0 : 3.25, 0);
    this.indicator.scale.setScalar(0.9);
    g.add(this.indicator);

    g.traverse(ch => {
      if (!ch.isMesh) return;
      ch.castShadow = true;
      ch.receiveShadow = true;
    });
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    this.model = g;
    this.game.scene.add(g);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  muzzleWorld() {
    this.model.updateMatrixWorld(true);
    if (this.barrelPivot) return this.barrelPivot.localToWorld(new THREE.Vector3(0, 0, 3.85));
    if (this.turret) return this.turret.localToWorld(new THREE.Vector3(0, 0, this.type === 'chopper' ? 1.28 : 1.3));
    const p = this.muzzleLocal.clone();
    return this.model.localToWorld(p);
  }

  raycast(origin, dir) {
    if (!this.alive) return null;
    const r = this.def.radius;
    const h = this.type === 'chopper' ? 2.1 : this.type === 'tank' ? 2.4 : 1.8;
    const min = new THREE.Vector3(this.pos.x - r, this.pos.y - 0.25, this.pos.z - r * 1.35);
    const max = new THREE.Vector3(this.pos.x + r, this.pos.y + h, this.pos.z + r * 1.35);
    return rayAABB(origin, dir, min, max);
  }

  takeDamage(dmg, fromPos = null) {
    if (!this.alive) return;
    this.hp -= dmg;
    const hit = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.8 + Math.random(), (Math.random() - 0.5) * 1.4));
    this.game.fx.addImpact(hit, new THREE.Vector3(0, 1, 0), 'bullet');
    this.game.audio.hitSurface('metal', hit);
    if (this.hp <= 0) this.explode(fromPos);
  }

  explode() {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    const p = this.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.game.fx.addExplosion(p, this.type === 'tank' ? 2.8 : 2.2);
    this.game.audio.explosion(p, this.type === 'tank' ? 2.0 : 1.6);
    this.game.applyExplosion?.(p, this.type === 'tank' ? 13 : 10, this.type === 'tank' ? 150 : 100, this.team);
    if (this.game.driving === this) {
      this.game.player.takeDamage(110, p);
      this.game.leaveVehicle();
    }
    this.occupied = false;
    this.driver = null;
    this._destroyedT = 0;
    this.model.traverse(ch => {
      if (ch.isMesh && ch.material?.color) ch.material.color.multiplyScalar(0.24);
    });
    if (this.indicator) this.indicator.visible = false;
  }

  update(dt, input = null) {
    if (!this.alive) {
      this._destroyedT += dt;
      this.model.rotation.z += (0.22 - this.model.rotation.z) * Math.min(1, dt * 1.8);
      return;
    }
    this.primaryCooldown = Math.max(0, this.primaryCooldown - dt);
    this.secondaryCooldown = Math.max(0, this.secondaryCooldown - dt);

    const playerDriving = this.game.driving === this;
    if (playerDriving) this.updatePlayer(dt, input || { move: { x: 0, y: 0 } });
    else if (this.aiControlled) this.updateAI(dt);
    else this.applyIdle(dt);

    if (this.rotor) {
      this.rotorSpin += dt * (this.alive ? 23 : 3);
      this.rotor.rotation.y = this.rotorSpin;
      this.rotor2.rotation.y = this.rotorSpin + Math.PI / 2;
      this.tailRotor.rotation.z += dt * 31;
    }
    this.syncModel();
  }

  updatePlayer(dt, input) {
    if (this.def.air) this.driveAir(dt, input.move.x, -input.move.y, input.jump ? 1 : input.crouch ? -1 : 0, true);
    else this.driveGround(dt, input.move.x, -input.move.y, !!input.sprint);

    const cameraDir = new THREE.Vector3();
    this.game.camera.getWorldDirection(cameraDir);
    this.aimTurret(cameraDir, dt);
    if (this.barrelPivot) this.barrelPivot.rotation.x = THREE.MathUtils.clamp(Math.asin(cameraDir.y), -0.18, 0.28);

    if (input.fire) this.tryFire(false, null, true);
    if (input.ads) this.tryFire(true, null, true);
  }

  updateAI(dt) {
    this.aiThink -= dt;
    if (this.aiThink <= 0) {
      this.aiThink = 0.28 + Math.random() * 0.22;
      this.aiTarget = this.chooseTarget();
      this.aiGoal = this.chooseGoal();
    }

    const target = this.aiTarget && this.aiTarget.alive ? this.aiTarget : null;
    const goal = target ? target.pos : this.aiGoal;
    if (!goal) return this.applyIdle(dt);

    // 吉普/坦克沿大半径 A* 路径推进；直升机不受地面导航限制。
    let steerGoal = goal;
    if (!this.def.air && this.game.vehicleNavigator) {
      this.navTimer -= dt;
      const goalChanged = !this.navGoal || this.navGoal.distanceTo(goal) > 12;
      if (this.navTimer <= 0 || goalChanged || !this.navPath.length) {
        this.navTimer = 1.15 + Math.random() * 0.55;
        this.navGoal = goal.clone();
        this.navPath = this.game.vehicleNavigator.findPath(this.pos, goal, 5000);
        this.navIndex = this.navPath.length > 1 ? 1 : 0;
      }
      while (this.navIndex < this.navPath.length - 1 && this.pos.distanceTo(this.navPath[this.navIndex]) < 5.5) this.navIndex++;
      if (this.navPath[this.navIndex]) steerGoal = this.navPath[this.navIndex];
    }

    const to = steerGoal.clone().sub(this.pos);
    const horizontal = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    const desiredYaw = Math.atan2(-to.x, -to.z);
    let yawDiff = desiredYaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const steer = THREE.MathUtils.clamp(-yawDiff * 1.25, -1, 1);

    if (this.def.air) {
      const desiredAlt = this.game.map.groundHeight(this.pos.x, this.pos.z) + (target ? 18 : 22);
      const climb = THREE.MathUtils.clamp((desiredAlt - this.pos.y) * 0.18, -1, 1);
      const throttle = horizontal > 16 ? 0.9 : horizontal < 8 ? -0.15 : 0.25;
      this.driveAir(dt, steer, throttle, climb, false);
    } else {
      const throttle = horizontal > (this.type === 'tank' ? 18 : 12) ? 0.92 : horizontal < 6 ? -0.2 : 0.25;
      this.driveGround(dt, steer, throttle, false);
    }

    if (target) {
      const targetPoint = target.pos.clone().add(new THREE.Vector3(0, target.isVehicle ? 1.0 : 1.1, 0));
      const origin = this.muzzleWorld();
      const dir = targetPoint.sub(origin);
      const dist = dir.length();
      if (dist > 0.01) {
        dir.normalize();
        this.aimTurret(dir, dt);
        if (this.hasLOS(target, dist)) {
          if (this.type === 'tank') {
            if (dist < 230) this.tryFire(false, target, false);
            if (dist < 110) this.tryFire(true, target, false);
          } else if (this.type === 'chopper') {
            if (dist < 215) this.tryFire(false, target, false);
            if (target.isVehicle && dist < 190) this.tryFire(true, target, false);
          } else if (dist < 150) this.tryFire(false, target, false);
        }
      }
    }

    this.aiStuck += dt;
    if (this.aiStuck > 1.3) {
      const moved = this.pos.distanceTo(this.lastPos);
      if (moved < 0.8 && !this.def.air) {
        this.yaw += (Math.random() > 0.5 ? 1 : -1) * 1.3;
        this.vel.multiplyScalar(-0.35);
      }
      this.lastPos.copy(this.pos);
      this.aiStuck = 0;
    }
  }

  chooseTarget() {
    const candidates = [];
    if (this.team === 'blue') {
      for (const e of this.game.enemies || []) if (e.alive) candidates.push(e);
      for (const v of this.game.vehicles || []) if (v !== this && v.alive && v.team === 'red') candidates.push(v);
    } else {
      if (this.game.player?.alive) candidates.push(this.game.player);
      for (const a of this.game.allies || []) if (a.alive) candidates.push(a);
      for (const v of this.game.vehicles || []) if (v !== this && v.alive && v.team === 'blue') candidates.push(v);
    }
    let best = null;
    let bestScore = Infinity;
    for (const target of candidates) {
      const d = this.pos.distanceTo(target.pos);
      const max = this.def.air ? 250 : this.type === 'tank' ? 235 : 165;
      if (d > max) continue;
      const vehicleBonus = target.isVehicle ? -18 : 0;
      const score = d + vehicleBonus + Math.random() * 10;
      if (score < bestScore) { bestScore = score; best = target; }
    }
    return best;
  }

  chooseGoal() {
    const objectives = this.game.map?.objectives || [];
    const valid = objectives.filter(o => (o.owner || (o.captured ? 'blue' : 'neutral')) !== this.team);
    if (valid.length) {
      return valid.reduce((a, b) => this.pos.distanceTo(a.pos) < this.pos.distanceTo(b.pos) ? a : b).pos.clone();
    }
    const base = this.team === 'blue' ? this.game.map.enemySpawns?.[0] : this.game.map.playerSpawn;
    return base ? base.clone() : null;
  }

  hasLOS(target, dist = null) {
    const origin = this.muzzleWorld();
    const point = target.pos.clone().add(new THREE.Vector3(0, target.isVehicle ? 1.0 : 1.0, 0));
    const dir = point.sub(origin);
    const len = dist || dir.length();
    if (len < 0.01) return true;
    dir.normalize();
    const hit = this.game.rayMap(origin, dir, len);
    return !hit || hit.t >= len - 1.0;
  }

  aimTurret(worldDir, dt) {
    const desired = Math.atan2(-worldDir.x, -worldDir.z);
    let d = desired - this.turretYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.turretYaw += d * Math.min(1, dt * (this.type === 'tank' ? 2.0 : 4.5));
    if (this.turret) this.turret.rotation.y = this.turretYaw - this.yaw;
  }

  tryFire(secondary = false, explicitTarget = null, playerControlled = false) {
    if (!this.alive) return false;
    const weapon = secondary ? this.def.secondary : this.def.primary;
    if (!weapon) return false;
    const cooldownKey = secondary ? 'secondaryCooldown' : 'primaryCooldown';
    if (this[cooldownKey] > 0) return false;
    const interval = secondary ? this.def.secondaryInterval : this.def.primaryInterval;
    this[cooldownKey] = interval;

    const origin = this.muzzleWorld();
    const dir = new THREE.Vector3();
    if (playerControlled) this.game.camera.getWorldDirection(dir);
    else if (explicitTarget) dir.copy(explicitTarget.pos).add(new THREE.Vector3(0, explicitTarget.isVehicle ? 0.8 : 1.0, 0)).sub(origin).normalize();
    else this.forward(dir);

    if (!playerControlled) {
      const spread = weapon === 'cannon' || weapon === 'rocket' ? 0.006 : 0.018;
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }

    if (weapon === 'mg') {
      const damage = secondary ? this.def.secondaryDamage : this.def.primaryDamage;
      const range = this.def.range || 180;
      this.game.fx.addMuzzle(origin, 0.38);
      this.game.audio.shotMG(origin, 0.75);
      const hit = this.game.vehicleRay?.(this, origin, dir, range, damage);
      const end = hit?.point || origin.clone().addScaledVector(dir, range);
      this.game.fx.addTracer(origin, end, this.team === 'blue' ? 0x78c6ff : 0xff7a55);
      return true;
    }

    const range = this.def.range || 260;
    const trace = this.game.vehicleRay?.(this, origin, dir, range, 0);
    const targetPoint = trace?.point?.clone?.() || (explicitTarget
      ? explicitTarget.pos.clone().add(new THREE.Vector3(0, explicitTarget.isVehicle ? 0.7 : 0.9, 0))
      : origin.clone().addScaledVector(dir, range));
    this.game.fx.addMuzzle(origin, weapon === 'cannon' ? 0.9 : 0.6);
    this.game.audio.explosion(origin, weapon === 'cannon' ? 0.65 : 0.4);
    this.game.fx.addTracer(origin, targetPoint, weapon === 'cannon' ? 0xffd27c : 0xff8a4c);
    this.game.fx.addExplosion(targetPoint, weapon === 'cannon' ? 1.9 : 1.45);
    const radius = weapon === 'cannon' ? 10.5 : 7.5;
    const damage = secondary ? this.def.secondaryDamage : this.def.primaryDamage;
    this.game.applyExplosion?.(targetPoint, radius, damage, this.team);
    return true;
  }

  driveGround(dt, steer, throttle, boost = false) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const turnScale = Math.min(1, 0.3 + speed / Math.max(1, this.def.maxSpeed));
    this.yaw += -steer * this.def.turnRate * turnScale * dt;
    const dir = this.forward();
    const max = throttle >= 0 ? this.def.maxSpeed : this.def.reverseSpeed;
    const target = dir.multiplyScalar(throttle * max * (boost && this.type === 'jeep' ? 1.15 : 1));
    const response = this.def.accel * dt;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, response);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, response);
    if (Math.abs(throttle) < 0.04) {
      this.vel.x *= Math.max(0, 1 - this.def.brake * dt);
      this.vel.z *= Math.max(0, 1 - this.def.brake * dt);
    }
    const prev = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    const ground = this.game.map.groundHeight(this.pos.x, this.pos.z);
    this.pos.y += (ground + (this.type === 'tank' ? 0.15 : 0.34) - this.pos.y) * Math.min(1, dt * 10);
    if (this.collidesMap()) {
      this.pos.copy(prev);
      this.vel.multiplyScalar(-0.25);
    }
    this.resolveVehicleSeparation(false);
    for (const w of this.wheels || []) w.rotation.x += speed * dt * 2.2;
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 4);
    this.roll += (-steer * Math.min(0.08, speed * 0.004) - this.roll) * Math.min(1, dt * 5);
    this.damageInfantryByCollision();
    this.clampBounds();
  }

  driveAir(dt, steer, throttle, climb, playerControlled) {
    this.yaw += -steer * this.def.turnRate * dt;
    const forward = this.forward();
    const target = forward.multiplyScalar(throttle * this.def.maxSpeed);
    const response = this.def.accel * dt;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, response);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, response);
    this.vel.y += (climb * this.def.climb - this.vel.y) * Math.min(1, dt * 2.8);
    this.pos.addScaledVector(this.vel, dt);
    const ground = this.game.map.groundHeight(this.pos.x, this.pos.z);
    const minAlt = ground + 2.2;
    if (this.pos.y < minAlt) { this.pos.y = minAlt; this.vel.y = Math.max(0, this.vel.y); }
    if (this.pos.y > ground + 85) { this.pos.y = ground + 85; this.vel.y = Math.min(0, this.vel.y); }
    this.pitch += ((throttle * 0.14) - this.pitch) * Math.min(1, dt * 3.5);
    this.roll += ((-steer * 0.18) - this.roll) * Math.min(1, dt * 4);
    if (!playerControlled && this.collidesMap(1.0)) {
      this.pos.y += 2;
      this.vel.multiplyScalar(0.6);
    }
    this.resolveVehicleSeparation(true);
    this.clampBounds();
  }

  resolveVehicleSeparation(airborne = false) {
    for (const other of this.game.vehicles || []) {
      if (!other?.alive || other === this) continue;
      const dy = Math.abs(other.pos.y - this.pos.y);
      if (airborne && dy > 4.5) continue;
      if (!airborne && other.def.air && dy > 2.5) continue;
      const dx = this.pos.x - other.pos.x;
      const dz = this.pos.z - other.pos.z;
      const minD = (this.def.radius + other.def.radius) * (airborne ? 0.85 : 0.92);
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) * 0.52;
      this.pos.x += dx / d * push;
      this.pos.z += dz / d * push;
      this.vel.multiplyScalar(0.78);
    }
  }

  collidesMap(extra = 0) {
    const r = this.def.radius + extra;
    for (const b of this.game.map.colliders) {
      if (Math.abs(this.pos.x - b.x) < b.w / 2 + r &&
          Math.abs(this.pos.z - b.z) < b.d / 2 + r &&
          this.pos.y + 1.2 > b.y - b.h / 2 && this.pos.y < b.y + b.h / 2 + 0.8) return true;
    }
    return false;
  }

  damageInfantryByCollision() {
    const speed = this.vel.length();
    if (speed < 4.5) return;
    const infantry = this.team === 'blue'
      ? (this.game.enemies || [])
      : [this.game.player, ...(this.game.allies || [])];
    for (const unit of infantry) {
      if (!unit?.alive || unit === this.driver) continue;
      if (unit.pos.distanceTo(this.pos) < this.def.radius + 0.8) {
        const dir = this.vel.clone().normalize();
        if (unit === this.game.player) unit.takeDamage(speed * 7.5, this.pos);
        else unit.takeDamage(speed * 8.5, dir, false, this.pos);
        unit.pos?.addScaledVector?.(dir, 0.8);
        this.vel.multiplyScalar(0.82);
      }
    }
  }

  applyIdle(dt) {
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
  }

  clampBounds() {
    const b = this.game.map.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, b[0] + 3, b[1] - 3);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, b[2] + 3, b[3] - 3);
  }

  syncModel() {
    this.model.position.copy(this.pos);
    this.model.rotation.set(this.pitch, this.yaw, this.roll);
    if (this.indicator && this.game.player) {
      const d = this.pos.distanceTo(this.game.player.pos);
      this.indicator.scale.setScalar(THREE.MathUtils.clamp(d * 0.035, 0.8, 2.2));
    }
  }

  setPlayerOccupied(active) {
    this.occupied = active;
    this.driver = active ? this.game.player : null;
    if (active) this.aiControlled = false;
  }

  remove() {
    this.game.scene.remove(this.model);
  }
}
