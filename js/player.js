// ============================================================
// player.js — 玩家控制器：移动、碰撞、跳跃、蹲伏、受伤、相机
// ============================================================
import * as THREE from 'three';

const GRAVITY = 21;
const JUMP_V = 8.6;
const WALK_SPEED = 5.6;
const SPRINT_SPEED = 8.6;
const CROUCH_SPEED = 2.9;
const PLAYER_RADIUS = 0.36;

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.eyeH = 1.62;
    this.eyeHCur = 1.62;
    this.bobPhase = 0;
    this.landAnim = 0;
    this.alive = true;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.invuln = 0;
    this.ads = false;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.footstepTimer = 0;
    this.hurtFlash = 0;
    this.sens = 1.2;
    this.viewDX = 0;
    this.viewDY = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();

    this.camera.rotation.order = 'YXZ';
    this.camera.fov = 75;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.set(0, 0, 0);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHCur, this.pos.z); }

  addRecoil(pitch, yaw) { this.recoilPitch += pitch; this.recoilYaw += yaw; }

  // ---------- 移动 ----------
  update(dt, input) {
    if (!this.alive) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);

    // 蹲伏状态
    const wantCrouch = input.crouch;
    this.crouching = wantCrouch;
    const targetEye = this.crouching ? 1.05 : 1.62;
    this.eyeHCur += (targetEye - this.eyeHCur) * Math.min(1, dt * 12);
    this.eyeH = this.eyeHCur;

    // 冲刺
    this.sprinting = input.sprint && !this.crouching && input.move.lengthSq() > 0;

    // 朝向输入（相对相机 yaw）
    const move = input.move; // Vector2: x=左右, y=前后
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0; this._fwd.normalize();
    this._right.set(-this._fwd.z, 0, this._fwd.x);
    const wish = new THREE.Vector3()
      .addScaledVector(this._fwd, -move.y)
      .addScaledVector(this._right, move.x);
    if (wish.lengthSq() > 1) wish.normalize();

    const maxSpeed = this.crouching ? CROUCH_SPEED : (this.sprinting ? SPRINT_SPEED : WALK_SPEED);
    const accel = this.onGround ? 45 : 9;
    wish.multiplyScalar(maxSpeed);
    // 加速/摩擦
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) {
      const fric = speed > maxSpeed ? 0.5 : 8;
      this.vel.x *= Math.max(0, 1 - fric * dt);
      this.vel.z *= Math.max(0, 1 - fric * dt);
    }
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);

    // 跳跃
    if (input.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }

    // 重力
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    // 积分 + 碰撞
    const wasGround = this.onGround;
    const prevY = this.pos.y;
    this.moveCollide(this.vel.clone().multiplyScalar(dt));

    // 落地
    if (this.onGround && !wasGround) {
      const fallV = this.vel.y;
      if (fallV < -7) this.landAnim = Math.min(0.3, -fallV * 0.02);
    }
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;
    void prevY;

    // 脚步声
    const spd = this.speed;
    if (spd > 0.6 && this.onGround) {
      this.footstepTimer -= dt * (this.sprinting ? 1.6 : 1);
      if (this.footstepTimer <= 0) {
        this.footstepTimer = 0.42;
        this.game.audio.footstep(this.sprinting);
        if (this.sprinting) this.game.fx.addDust(new THREE.Vector3(this.pos.x, this.pos.y + 0.05, this.pos.z));
      }
    }

    // 后坐力只把每次射击的冲量应用一次。旧版每帧重复叠加尚未衰减的值，
    // 一发子弹会被积分成多次抬枪，因而后坐力异常夸张。
    const recoilApply = Math.min(1, dt * 30);
    const frameRecoilPitch = this.recoilPitch * recoilApply;
    const frameRecoilYaw = this.recoilYaw * recoilApply;
    this.recoilPitch -= frameRecoilPitch;
    this.recoilYaw -= frameRecoilYaw;
    this.recoilPitch *= Math.max(0, 1 - 10 * dt);
    this.recoilYaw *= Math.max(0, 1 - 12 * dt);

    // 保存本帧鼠标增量给武器模型摆动，之后再清零。
    this.viewDX = this.mouseDX;
    this.viewDY = this.mouseDY;

    // 相机朝向（鼠标）+ 单次后坐力冲量
    this.yaw -= this.mouseDX * 0.00205 * this.sens + frameRecoilYaw;
    this.pitch -= this.mouseDY * 0.00205 * this.sens;
    this.pitch += frameRecoilPitch;
    const pitchLimit = this.game.weapons && this.game.weapons.adsAmount > 0.5 && this.game.weapons.current !== 3 ? Math.PI / 2.2 : Math.PI / 2 - 0.06;
    this.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.pitch));

    // 相机摆动
    this.landAnim = Math.max(0, this.landAnim - dt);
    const bobAmp = Math.min(spd / 7, 1) * (this.crouching ? 0.3 : 1);
    const bobY = Math.sin(this.bobPhase) * 0.035 * bobAmp;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.02 * bobAmp;
    if (spd > 0.4 && this.onGround) this.bobPhase += dt * (this.sprinting ? 13 : 8.6);

    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const lp = new THREE.Vector3(this.pos.x + bobX, this.pos.y + this.eyeHCur + bobY - this.landAnim * 0.18, this.pos.z);
    this.camera.position.copy(lp);

    // 鼠标增量清零（sway 用旧值）
    this.mouseDX = 0; this.mouseDY = 0;
  }

  // 稳定轴分离碰撞：水平位移分步推进，若起点已贴近/轻微嵌入碰撞体则取消该轴，
  // 不再按移动方向把玩家强行推到碰撞盒另一侧，修复靠近箱子、沙袋时的离奇瞬移。
  moveCollide(delta) {
    const map = this.game.map;
    const halfW = PLAYER_RADIUS;
    const height = this.crouching ? 1.0 : 1.72;
    const maxHorizontalStep = 0.16;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.z)) / maxHorizontalStep));
    const sx = delta.x / steps, sz = delta.z / steps;

    for (let i = 0; i < steps; i++) {
      this._moveAxis('x', sx, halfW, height, map.colliders);
      this._moveAxis('z', sz, halfW, height, map.colliders);
    }

    // 垂直移动 + 头顶碰撞
    const oldY = this.pos.y;
    this.pos.y += delta.y;
    if (delta.y > 0) {
      for (const b of map.colliders) {
        if (!this._overlap(b, halfW, height)) continue;
        const ceiling = b.y - b.h / 2;
        if (oldY + height <= ceiling + 0.04) {
          this.pos.y = ceiling - height;
          this.vel.y = 0;
          break;
        }
      }
    }

    const ground = map.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.onGround = true;
    } else this.onGround = false;

    const lim = map.bounds;
    this.pos.x = Math.max(lim[0] + halfW, Math.min(lim[1] - halfW, this.pos.x));
    this.pos.z = Math.max(lim[2] + halfW, Math.min(lim[3] - halfW, this.pos.z));
  }

  _moveAxis(axis, amount, halfW, height, colliders) {
    if (Math.abs(amount) < 1e-8) return;
    const old = this.pos[axis];
    this.pos[axis] += amount;
    for (const b of colliders) {
      if (!this._overlap(b, halfW, height)) continue;
      const center = axis === 'x' ? b.x : b.z;
      const half = (axis === 'x' ? b.w : b.d) / 2 + halfW;
      const nearFace = center - half;
      const farFace = center + half;
      const eps = 0.025;

      if (amount > 0 && old <= nearFace + eps) this.pos[axis] = nearFace - 0.002;
      else if (amount < 0 && old >= farFace - eps) this.pos[axis] = farFace + 0.002;
      else this.pos[axis] = old; // 起点已经重叠时只撤销本次位移，绝不跨盒推送

      this.vel[axis] = 0;
      break;
    }
  }

  _overlap(b, halfW, height) {
    const cx = this.pos.x, cy = this.pos.y + height / 2, cz = this.pos.z;
    return Math.abs(cx - b.x) < b.w / 2 + halfW &&
      Math.abs(cz - b.z) < b.d / 2 + halfW &&
      Math.abs(cy - b.y) < b.h / 2 + height / 2;
  }

  // ---------- 伤害 ----------
  takeDamage(amount, fromPos) {
    if (!this.alive || this.invuln > 0) return;
    this.hp -= amount;
    this.hurtFlash = 0.6;
    this.invuln = 0.25;
    this.game.audio.hurt();
    // 受击镜头震动（随伤害增大）
    this.addRecoil(0.006 + Math.min(0.02, amount * 0.00035), (Math.random() - 0.5) * 0.02);
    // 方向指示
    if (fromPos) {
      const dir = new THREE.Vector3().subVectors(this.pos, fromPos);
      dir.y = 0;
      const angle = Math.atan2(dir.x, dir.z) - this.yaw;
      this.game.hud.showDamageDir(angle);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.game.playerDied();
  }

  respawn(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.invuln = 1.5;
    this.camera.rotation.set(0, yaw, 0);
    this.camera.position.copy(this.eye);
    this.game.weapons.slots.forEach(s => {
      if (s.def) { s.mag = s.def.magSize; s.reserve = s.def.reserve; }
    });
    if (this.game.weapons.slots[3]) this.game.weapons.slots[3].grenades = 2;
    this.game.weapons.showSlot(this.game.weapons.current);
  }
}
