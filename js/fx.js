// ============================================================
// fx.js — 粒子与贴花特效系统（全部池化，控制 draw call）
// ============================================================
import * as THREE from 'three';
import { texBloodDecal, texScorchDecal } from './tex.js';

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,200,90,0.95)');
  g.addColorStop(0.6, 'rgba(255,120,30,0.5)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // 星芒
  ctx.strokeStyle = 'rgba(255,230,160,0.9)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.translate(32, 32); ctx.rotate((i * 45) * Math.PI / 180);
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, 40); ctx.stroke();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(200,200,200,0.85)');
  g.addColorStop(0.6, 'rgba(150,150,150,0.4)');
  g.addColorStop(1, 'rgba(120,120,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.shells = [];
    this.sprites = [];   // {sprite, life, maxLife, vel, gravity, grow}
    this.tracers = [];   // {line, life}
    this.decals = [];    // {mesh, life}
    this.lights = [];    // 临时点光（兼容字段）
    // 共享点光：常驻场景（intensity 0），开枪/爆炸时更新位置与强度。
    // 场景点光数量恒定 → MeshStandardMaterial 只需编译一次光照变体，避免每枪重新编译卡顿
    this.muzzleLight = new THREE.PointLight(0xffa040, 0, 9, 1.8);
    this.explosionLight = new THREE.PointLight(0xff9030, 0, 60, 1.6);
    this.scene.add(this.muzzleLight, this.explosionLight);
    this.flashTex = makeFlashTexture();
    this.smokeTex = makeSmokeTexture();
    this.bloodTex = texBloodDecal();
    this.scorchTex = texScorchDecal();
    this.decalTex = null; // 由 main 注入（下载的子弹贴花纹理）

    this.decalPool = [];
    this.poolIdx = 0;
    this._initDecalPool();
  }

  _initDecalPool() {
    // 贴花池（地图切换后重建）
    for (let i = 0; i < 70; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.11, 10), mat);
      m.visible = false;
      this.scene.add(m);
      this.decalPool.push({ mesh: m, life: 0, maxLife: 0 });
    }
    this.poolIdx = 0;
  }

  setDecalTexture(t) { this.decalTex = t; }

  // ---------- 预热：提前创建所有动态特效材质，触发 GPU shader 编译，避免第一枪卡顿 ----------
  // 用法：warmup() → renderer.compile(scene, camera) → warmupCleanup()
  warmup() {
    const p = new THREE.Vector3(0, 1.5, -2);
    this.addMuzzle(p);
    this.addTracer(p, new THREE.Vector3(0, 1.5, -6));
    this.addShell(p, new THREE.Vector3(0.5, 1, 0));
    this.addImpact(p, new THREE.Vector3(0, 1, 0), 'bullet');
    this.addBlood(p, new THREE.Vector3(0, 1, 0));
    this.addExplosion(p);
    this.addDust(p);
    this.addSmoke(p);
    this.addExplosion(p);
    this.addDust(p);
    this.addSmoke(p);
  }
  warmupCleanup() {
    this.update(0.05);
    this.clear();
  }

  update(dt) {
    this.time += dt;
    // 弹壳
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      if (s.life <= 0) { this.scene.remove(s.mesh); s.mesh.geometry.dispose?.(); s.mesh.material.dispose?.(); this.shells.splice(i, 1); continue; }
      s.vel.y -= 16 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.01 && s.vel.y < 0) { s.vel.y *= -0.35; s.vel.x *= 0.5; s.vel.z *= 0.5; s.pos.y = 0.01; s.bounced = (s.bounced || 0) + 1; if (s.bounced > 2) s.life = Math.min(s.life, 0.1); }
      s.mesh.position.copy(s.pos);
      s.mesh.rotation.x += s.rot.x * dt; s.mesh.rotation.y += s.rot.y * dt; s.mesh.rotation.z += s.rot.z * dt;
    }
    // 精灵粒子
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const p = this.sprites[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose?.();
        if (p.disposeGeo) p.sprite.geometry.dispose?.();
        this.sprites.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.maxLife;
      if (p.vel) { p.pos.addScaledVector(p.vel, dt); if (p.gravity) p.vel.y -= p.gravity * dt; }
      p.sprite.position.copy(p.pos);
      const sc = p.scale * (p.grow ? 1 + k * p.grow : 1 - k * 0.7);
      p.sprite.scale.setScalar(Math.max(sc, 0.01));
      p.sprite.material.opacity = p.alpha * (1 - k);
      if (p.rise) p.sprite.position.y += p.rise * dt;
    }
    // 曳光
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose?.();
        t.line.material.dispose?.();
        this.tracers.splice(i, 1);
        continue;
      }
      t.line.material.opacity = t.life / t.maxLife;
    }
    // 贴花
    for (const d of this.decalPool) {
      if (d.life > 0) {
        d.life -= dt;
        if (d.life <= 0) d.mesh.visible = false;
      }
    }
    // 临时点光
    // 临时点光（兼容）：共享光强度衰减（场景不再新增/移除光源，避免 shader 变体重编译）
    this.muzzleLight.intensity *= Math.max(0, 1 - dt * 22);
    this.explosionLight.intensity *= Math.max(0, 1 - dt * 8);
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      if (l.life <= 0) { this.scene.remove(l.light); this.lights.splice(i, 1); continue; }
      l.light.intensity = l.maxI * (l.life / l.maxLife);
    }
  }

  // ---------- 弹壳（高温铜色 + 双轴旋转） ----------
  addShell(pos, dir) {
    const geo = new THREE.BoxGeometry(0.009, 0.02, 0.009);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4ab3f, emissive: 0x3a2600, emissiveIntensity: 0.4, metalness: 0.85, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.shells.push({
      mesh, pos: pos.clone(), life: 0.8 + Math.random() * 0.5,
      vel: dir.clone().multiplyScalar(2.2 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.8 + Math.random(), (Math.random() - 0.5) * 1.5)),
      rot: new THREE.Vector3(Math.random() * 26, Math.random() * 26, Math.random() * 26),
    });
  }

  // ---------- 枪口火光 ----------
  addMuzzle(pos, scale = 0.35) {
    const mat = new THREE.SpriteMaterial({
      map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1,
    });
    const s = new THREE.Sprite(mat);
    s.frustumCulled = false; // 关闭视锥剔除：确保始终被渲染（预热/实际开火都触发编译）
    s.position.copy(pos);
    s.scale.setScalar(scale);
    this.scene.add(s);
    this.sprites.push({ sprite: s, pos: pos.clone(), life: 0.045, maxLife: 0.045, scale, alpha: 1, grow: 0 });
    // 动态点光（共享常驻光：只更新位置与强度，不新增光源）
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 10;
  }

  // ---------- 曳光弹（主亮线 + 前端亮点，速度感更强） ----------
  addTracer(from, to, color = 0xffd27a) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.1, maxLife: 0.1 });
    // 前端亮点（快速飞向弹着点）
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flashTex, color: 0xffe9b0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    head.frustumCulled = false; // 关闭视锥剔除
    head.position.copy(from);
    head.scale.setScalar(0.055);
    this.scene.add(head);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    this.sprites.push({
      sprite: head, pos: from.clone(), life: 0.075, maxLife: 0.075, scale: 0.055, alpha: 1, grow: 0,
      vel: dir.clone().multiplyScalar(len / 0.075),
    });
  }

  // ---------- 命中贴花 + 碎屑 ----------
  addImpact(pos, normal, type = 'bullet') {
    const d = this.decalPool[this.poolIdx];
    this.poolIdx = (this.poolIdx + 1) % this.decalPool.length;
    let tex, scale;
    if (type === 'bullet') { tex = this.decalTex; scale = 0.09 + Math.random() * 0.05; }
    else if (type === 'blood') { tex = this.bloodTex; scale = 0.16 + Math.random() * 0.12; }
    else { tex = this.scorchTex; scale = 0.5 + Math.random() * 0.4; }
    d.mesh.material.map = tex;
    d.mesh.position.copy(pos).addScaledVector(normal, 0.02);
    d.mesh.lookAt(pos.clone().add(normal));
    d.mesh.scale.setScalar(scale);
    d.mesh.visible = true;
    d.life = type === 'scorch' ? 9999 : 25;
    d.maxLife = d.life;
    // 碎屑 + 火花
    if (type === 'bullet') {
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          color: 0x9a8f7a, transparent: true, opacity: 0.8, depthWrite: false,
        }));
        sp.position.copy(pos);
        sp.scale.setScalar(0.012 + Math.random() * 0.02);
        this.scene.add(sp);
        this.sprites.push({
          sprite: sp, pos: pos.clone(), life: 0.25 + Math.random() * 0.2, maxLife: 0.4, scale: 0.02,
          vel: normal.clone().multiplyScalar(1.2).add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2)),
          gravity: 9, alpha: 0.8,
        });
      }
      // 橙色火花（金属弹着）
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.flashTex, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
        }));
        sp.position.copy(pos);
        sp.scale.setScalar(0.03 + Math.random() * 0.03);
        this.scene.add(sp);
        const dir = normal.clone().multiplyScalar(2.5).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3));
        this.sprites.push({
          sprite: sp, pos: pos.clone(), life: 0.12 + Math.random() * 0.1, maxLife: 0.22, scale: 0.04,
          vel: dir, gravity: 5, alpha: 1, grow: -0.4,
        });
      }
    }
  }

  // ---------- 血雾 ----------
  addBlood(pos, dir) {
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({ color: 0x7a0d0d, transparent: true, opacity: 0.9, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      sp.position.copy(pos);
      sp.scale.setScalar(0.05 + Math.random() * 0.08);
      this.scene.add(sp);
      const v = dir.clone().multiplyScalar(2.5 + Math.random() * 3)
        .add(new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3));
      this.sprites.push({ sprite: sp, pos: pos.clone(), life: 0.4 + Math.random() * 0.35, maxLife: 0.7, scale: 0.06, vel: v, gravity: 7, alpha: 0.9 });
    }
  }

  // ---------- 爆炸 ----------
  addExplosion(pos, size = 1) {
    // 火球
    const mat = new THREE.SpriteMaterial({
      map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size * 1.2);
    this.scene.add(s);
    this.sprites.push({ sprite: s, pos: pos.clone(), life: 0.35, maxLife: 0.35, scale: size * 1.2, alpha: 1, grow: 1.6 });

    // 烟雾
    for (let i = 0; i < 6; i++) {
      const sm = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex, transparent: true, opacity: 0.55, depthWrite: false, color: 0x555555,
      }));
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * size, 0.3, (Math.random() - 0.5) * size));
      sm.position.copy(p);
      sm.scale.setScalar(size * 0.8);
      this.scene.add(sm);
      this.sprites.push({
        sprite: sm, pos: p, life: 1.4 + Math.random() * 0.8, maxLife: 2.2, scale: size * 0.8,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.2 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2),
        gravity: -1.2, alpha: 0.5, grow: 2.2, rise: 0.6,
      });
    }

    // 冲击波环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.4, size * 0.45, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    this.scene.add(ring);
    this.sprites.push({ sprite: ring, pos: pos.clone(), life: 0.32, maxLife: 0.32, scale: size * 4.5, alpha: 0.9, disposeGeo: true });

    // 点光（共享常驻光）
    this.explosionLight.position.copy(pos);
    this.explosionLight.intensity = 70;
    this.explosionLight.distance = 40 * size + 15;

    // 地面焦痕
    const groundY = this.groundHeight ? this.groundHeight(pos.x, pos.z) : 0;
    this.addImpact(new THREE.Vector3(pos.x, groundY + 0.03, pos.z), new THREE.Vector3(0, 1, 0), 'scorch');
  }

  // ---------- 尘土足迹（奔跑） ----------
  addDust(pos) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.smokeTex, transparent: true, opacity: 0.25, depthWrite: false, color: 0x9a8d74,
    }));
    sp.position.copy(pos);
    sp.scale.setScalar(0.25);
    this.scene.add(sp);
    this.sprites.push({ sprite: sp, pos: pos.clone(), life: 0.5, maxLife: 0.5, scale: 0.25, alpha: 0.25, grow: 1.4 });
  }

  // ---------- 拖尾烟雾（火箭） ----------
  addSmoke(pos, size = 0.3, color = 0x888888) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.smokeTex, transparent: true, opacity: 0.4, depthWrite: false, color,
    }));
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    this.scene.add(sp);
    this.sprites.push({ sprite: sp, pos: pos.clone(), life: 0.7, maxLife: 0.7, scale: size, alpha: 0.4, grow: 1.8, vel: new THREE.Vector3(0, 0.4, 0) });
  }

  clear() {
    for (const s of this.shells) { this.scene.remove(s.mesh); s.mesh.geometry.dispose?.(); s.mesh.material.dispose?.(); }
    for (const s of this.sprites) { this.scene.remove(s.sprite); s.sprite.material.dispose?.(); if (s.disposeGeo) s.sprite.geometry.dispose?.(); }
    for (const t of this.tracers) { this.scene.remove(t.line); t.line.geometry.dispose?.(); t.line.material.dispose?.(); }
    for (const l of this.lights) this.scene.remove(l.light);
    this.shells = []; this.sprites = []; this.tracers = []; this.lights = [];
    // 共享光重置（常驻场景不移除）
    this.muzzleLight.intensity = 0;
    this.explosionLight.intensity = 0;
    // 贴花池被地图清理移除，这里重建
    for (const d of this.decalPool) { this.scene.remove(d.mesh); d.mesh.geometry.dispose?.(); d.mesh.material.dispose?.(); }
    this.decalPool = [];
    this._initDecalPool();
  }
}
