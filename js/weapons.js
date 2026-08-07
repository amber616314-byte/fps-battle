// ============================================================
// weapons.js — 武器定义、程序建模、射击/换弹/开镜/后坐力系统
// ============================================================
import * as THREE from 'three';
import { OBJLoader } from '../vendor/jsm/loaders/OBJLoader.js';


// 第一人称模型标定。尺寸按真实武器相对长度校准：M4≈0.84m、USP≈0.20m、AWP≈1.10m。
// arena = CS 风格腰射；battlefield = 战地风格机械瞄具/开镜。
const VIEWMODEL_PROFILES = {
  rifle: {
    hip: new THREE.Vector3(0.245, -0.235, -0.52),
    ads: new THREE.Vector3(0.0, -0.102, -0.47),
    muzzle: new THREE.Vector3(0.245, -0.012, -0.94),
    shell: new THREE.Vector3(0.34, 0.015, -0.58),
    hipTilt: 0.18, adsTilt: 0.018, hipRoll: -0.015,
  },
  pistol: {
    hip: new THREE.Vector3(0.205, -0.205, -0.38),
    ads: new THREE.Vector3(0.0, -0.095, -0.34),
    muzzle: new THREE.Vector3(0.205, -0.09, -0.57),
    shell: new THREE.Vector3(0.25, -0.055, -0.38),
    hipTilt: 0.12, adsTilt: 0.012, hipRoll: -0.012,
  },
  sniper: {
    hip: new THREE.Vector3(0.275, -0.255, -0.57),
    ads: new THREE.Vector3(0.0, -0.105, -0.42),
    muzzle: new THREE.Vector3(0.275, -0.015, -1.05),
    shell: new THREE.Vector3(0.35, 0.015, -0.64),
    hipTilt: 0.15, adsTilt: 0.0, hipRoll: -0.012,
  },
  grenade: {
    hip: new THREE.Vector3(0.29, -0.28, -0.44),
    ads: new THREE.Vector3(0.12, -0.2, -0.42),
    muzzle: new THREE.Vector3(0.22, -0.08, -0.52),
    shell: new THREE.Vector3(0.3, -0.05, -0.4),
    hipTilt: 0.1, adsTilt: 0.05, hipRoll: 0,
  },
};

function tuneMaterial(mat, role = 'body') {
  if (!mat || (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial)) return mat;
  // 第一人称枪械以哑光烤漆/聚合物为主，避免固定 HDR 造成“镜面发亮”。
  const cfg = {
    body:   { metalness: 0.24, roughness: 0.56, env: 0.48 },
    metal:  { metalness: 0.52, roughness: 0.46, env: 0.62 },
    barrel: { metalness: 0.62, roughness: 0.42, env: 0.68 },
    polymer:{ metalness: 0.04, roughness: 0.72, env: 0.34 },
    glass:  { metalness: 0.0,  roughness: 0.14, env: 0.82 },
  }[role] || { metalness: 0.24, roughness: 0.56, env: 0.48 };
  mat.metalness = cfg.metalness;
  mat.roughness = cfg.roughness;
  mat.envMapIntensity = cfg.env;
  mat.userData.baseEnvMapIntensity = cfg.env;
  mat.userData.baseColor = mat.color ? mat.color.clone() : null;
  mat.needsUpdate = true;
  return mat;
}

// ---------- 下载的枪械模型（OpenGameArt FPS Pack, CC0） ----------
// envMapIntensity：武器与场景 HDR 环境光影挂钩（金属质感随环境变化）
const GUN_MATS = {
  barrels: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x25292d }), 'barrel'),
  metal: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x303439 }), 'metal'),
  black: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x181b1e }), 'polymer'),
  darkwood: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x3d2e1c }), 'body'),
  lightwood: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x5a4026 }), 'body'),
  bulletyellow: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0xc9a13a }), 'metal'),
  bulletorange: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0xb8862f }), 'metal'),
  scope: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x111315 }), 'metal'),
  default: tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x24272b }), 'body'),
};

// 异步加载枪械模型（下载的 OBJ/转换模型；失败返回 null 由程序化模型兜底）
export async function loadGunModels() {
  const loader = new OBJLoader();
  const load = async (url, opts = {}) => {
    const { scale = 0.1, rotY = 0 } = opts;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const obj = loader.parse(await r.text());
      // 清理 FBX 转换残留的 NaN 顶点（单点缺失，肉眼不可见）
      obj.traverse(ch => {
        if (!ch.isMesh) return;
        const b = ch.geometry.attributes.position;
        let cleaned = false;
        for (let i = 0; i < b.count; i++) {
          if (Number.isNaN(b.getX(i)) || Number.isNaN(b.getY(i)) || Number.isNaN(b.getZ(i))) {
            b.setXYZ(i, 0, 0, 0);
            cleaned = true;
          }
        }
        if (cleaned) b.needsUpdate = true;
      });
      obj.scale.setScalar(scale);
      obj.rotation.y = rotY;
      // 材质映射（先于 holder 包裹，否则被跳过）
      obj.traverse(ch => {
        if (ch.isMesh) {
          const key = (ch.material && ch.material.name || '').toLowerCase().replace(/\s/g, '');
          ch.material = (GUN_MATS[key] || GUN_MATS.default).clone();
          ch.material.userData = { ...(GUN_MATS[key] || GUN_MATS.default).userData };
          ch.castShadow = false;
          ch.receiveShadow = true;
          ch.material.userData.baseEnvMapIntensity = ch.material.envMapIntensity ?? 0.75;
        }
      });
      // 持枪倾角：绕 X 轴倾斜，枪身斜指屏幕中心（真实 FPS 持枪姿态）
      if (opts.tilt !== 0) {
        const holder = new THREE.Group();
        holder.add(obj);
        holder.rotation.x = opts.tilt || 0;
        holder.userData.fromObj = true;
        holder.userData.isHolder = true;
        holder.userData.tilt = opts.tilt || 0; // 供武器动画叠加
        holder.userData.silenced = obj.userData.silenced;
        return holder;
      }
      obj.userData.fromObj = true;
      return obj;
    } catch {
      return null;
    }
  };

  // ---- 步枪：下载 M4A1（转换链修复后几何完全干净）+ 纯色材质 + 持枪倾角 ----
  const rifle = await load('assets/models/m4a1.obj', { scale: 0.97, tilt: 0.18 });
  if (rifle) {
    rifle.traverse(ch => {
      if (!ch.isMesh) return;
      const name = (ch.name || '').toLowerCase();
      if (name.includes('barrel') || name.includes('charging') || name.includes('trigger') ||
        name.includes('switch') || name.includes('firemode') || name.includes('sight')) {
        ch.material = tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x4a5056 }), name.includes('barrel') ? 'barrel' : 'metal');
      } else if (name.includes('magazine') || name.includes('ejector') || name.includes('stock')) {
        ch.material = tuneMaterial(new THREE.MeshStandardMaterial({ color: 0x34383d }), 'polymer');
      } else {
        // Base 主体：哑光深灰 + 程序枪身纹理
        ch.material = tuneMaterial(new THREE.MeshStandardMaterial({ map: texGunBody(), color: 0xb4bac0 }), 'body');
      }
      ch.castShadow = false;
      ch.receiveShadow = true;
      ch.material.userData.baseEnvMapIntensity = ch.material.envMapIntensity ?? 0.65;
    });
    rifle.userData.silenced = false; // 标准枪口（无消音器）
  }

  const pistol = await load('assets/models/fpspack/FPS Pack/OBJ/Pistol.obj', { rotY: Math.PI / 2, scale: 0.0205, tilt: 0.12 });
  const sniper = await load('assets/models/fpspack/FPS Pack/OBJ/SniperRifle.obj', { scale: 0.112, tilt: 0.15 });
  return { rifle, pistol, sniper };
}

export const WEAPON_DEFS = {
  rifle: {
    name: '突击步枪 M4A1', type: 'rifle', damage: 34, hsMult: 3.1,
    magSize: 30, reserve: 120, reloadTime: 2.1, interval: 0.095, auto: true,
    spread: 0.006, spreadMove: 0.011, spreadCrouch: 0.0035, spreadAds: 0.0022,
    recoilKick: 0.0085, recoilSpread: 0.00145, adsFov: 58, adsSpeed: 12, sound: 'rifle',
    tracer: true, model: 'rifle', color: 0x22262b,
  },
  pistol: {
    name: '战术手枪 USP', type: 'pistol', damage: 48, hsMult: 2.45,
    magSize: 12, reserve: 48, reloadTime: 1.6, interval: 0.21, auto: false,
    spread: 0.0038, spreadMove: 0.0075, spreadCrouch: 0.0024, spreadAds: 0.0015,
    recoilKick: 0.0105, recoilSpread: 0.0009, adsFov: 62, adsSpeed: 13, sound: 'pistol',
    tracer: false, model: 'pistol', color: 0x2a2d31,
  },
  sniper: {
    name: '狙击步枪 AWP', type: 'sniper', damage: 220, hsMult: 1.35,
    magSize: 5, reserve: 15, reloadTime: 3.4, interval: 1.35, auto: false,
    spread: 0.00055, spreadMove: 0.022, spreadCrouch: 0.00035, spreadAds: 0.00008,
    recoilKick: 0.026, recoilSpread: 0.0, adsFov: 22, adsSpeed: 10.5, sound: 'sniper',
    tracer: true, model: 'sniper', color: 0x23262a,
  },
};

// ---------- 模型零件工具 ----------
function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

// 枪身哑光黑纹理（细颗粒 + 划痕 + 磨损，程序化生成）
function texGunBody() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#26292d';
  ctx.fillRect(0, 0, 256, 256);
  // 细颗粒
  for (let k = 0; k < 6000; k++) {
    const x = (k * 37) % 256, y = (k * 173) % 256;
    const v = ((k * 7919) % 100) / 100;
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.02 + v * 0.03})` : `rgba(0,0,0,${0.03 + v * 0.04})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  // 划痕
  for (let k = 0; k < 9; k++) {
    const y = 20 + ((k * 61) % 216);
    ctx.strokeStyle = `rgba(150,155,160,${0.08 + ((k * 7) % 5) * 0.03})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y + ((k * 13) % 9) - 4);
    ctx.stroke();
  }
  // 磨损斑点
  for (let k = 0; k < 16; k++) {
    const x = (k * 97) % 256, y = (k * 43) % 256;
    ctx.fillStyle = `rgba(120,124,130,${0.05 + ((k * 11) % 5) * 0.025})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + (k % 4) * 2.5, 1.5 + (k % 3), ((k * 31) % 360) * Math.PI / 180, 0, 6.28);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 1.5);
  return t;
}

// 精细 M4A1 模型（枪口朝 -Z，原点在机匣中部）
function buildRifleModel() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ map: texGunBody(), color: 0xb8bcc2, metalness: 0.6, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d20, metalness: 0.72, roughness: 0.35 });
  const guard = new THREE.MeshStandardMaterial({ color: 0x394046, metalness: 0.5, roughness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.85, metalness: 0.1 });

  // 枪管 + 导气管 + 消焰器
  const barrelGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.38, 12);
  barrelGeo.rotateX(Math.PI / 2);
  g.add(part(barrelGeo, dark, 0, 0.028, -0.5));
  const gasGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.16, 8);
  gasGeo.rotateX(Math.PI / 2);
  g.add(part(gasGeo, dark, 0, 0.062, -0.42));
  g.add(part(new THREE.CylinderGeometry(0.017, 0.017, 0.055, 12).rotateX(Math.PI / 2), dark, 0, 0.028, -0.72));
  // 准星座
  g.add(part(new THREE.BoxGeometry(0.012, 0.026, 0.02), dark, 0, 0.055, -0.55));
  g.add(part(new THREE.BoxGeometry(0.005, 0.02, 0.005), dark, 0, 0.078, -0.55));

  // 护木（带散热槽）
  g.add(part(new THREE.BoxGeometry(0.045, 0.052, 0.26), guard, 0, 0.028, -0.35));
  for (let i = 0; i < 4; i++) {
    g.add(part(new THREE.BoxGeometry(0.006, 0.03, 0.05), dark, 0, 0.026, -0.24 - i * 0.06));
  }
  // 战术前握把
  g.add(part(new THREE.BoxGeometry(0.02, 0.055, 0.02), grip, 0, -0.015, -0.44, 0.35));

  // 机匣
  g.add(part(new THREE.BoxGeometry(0.05, 0.052, 0.24), body, 0, 0.058, -0.1));
  g.add(part(new THREE.BoxGeometry(0.044, 0.036, 0.2), dark, 0, 0.02, -0.06));
  // 抛壳口
  g.add(part(new THREE.BoxGeometry(0.014, 0.024, 0.075), dark, 0.031, 0.052, -0.14));
  // 充电手柄
  g.add(part(new THREE.BoxGeometry(0.012, 0.016, 0.07), dark, 0.033, 0.076, 0.02));

  // 弹匣（弧形倾斜）
  const magGeo = new THREE.BoxGeometry(0.024, 0.1, 0.048);
  g.add(part(magGeo, dark, 0, -0.052, 0, 0.45));
  g.add(part(new THREE.BoxGeometry(0.027, 0.024, 0.055), dark, 0, -0.09, 0.012, 0.45));

  // 握把 + 扳机护圈 + 扳机
  g.add(part(new THREE.BoxGeometry(0.028, 0.085, 0.04), grip, 0, -0.068, 0.1, 0.55));
  g.add(part(new THREE.BoxGeometry(0.012, 0.02, 0.05), dark, 0, -0.036, 0.055, 0.5));
  g.add(part(new THREE.BoxGeometry(0.006, 0.016, 0.008), dark, 0, -0.022, 0.045));

  // 枪托（伸缩两段 + 缓冲管）
  const bufGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.1, 10);
  bufGeo.rotateX(Math.PI / 2);
  g.add(part(bufGeo, dark, 0, 0.042, 0.09));
  g.add(part(new THREE.BoxGeometry(0.046, 0.052, 0.1), body, 0, 0.032, 0.14));
  g.add(part(new THREE.BoxGeometry(0.038, 0.042, 0.1), dark, 0, 0.024, 0.24));
  g.add(part(new THREE.BoxGeometry(0.04, 0.05, 0.015), grip, 0, 0.022, 0.295));

  // 顶部导轨 + 红点镜
  g.add(part(new THREE.BoxGeometry(0.01, 0.008, 0.18), dark, 0, 0.088, -0.12));
  g.add(part(new THREE.CylinderGeometry(0.014, 0.014, 0.045, 12).rotateX(Math.PI / 2), dark, 0, 0.095, -0.06));
  g.add(part(new THREE.CylinderGeometry(0.010, 0.010, 0.005, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.8 }), 0, 0.095, -0.083));
  return g;
}

// 精细 USP 手枪
function buildPistolModel() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ map: texGunBody(), color: 0xb8bcc2, metalness: 0.6, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e21, metalness: 0.72, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.85, metalness: 0.1 });

  // 套筒（含防滑纹）
  g.add(part(new THREE.BoxGeometry(0.03, 0.036, 0.17), body, 0, 0.036, -0.05));
  for (let i = 0; i < 3; i++) {
    g.add(part(new THREE.BoxGeometry(0.03, 0.004, 0.004), dark, 0, 0.05, 0.045 + i * 0.013));
  }
  // 枪管伸出
  g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 10).rotateX(Math.PI / 2), dark, 0, 0.034, -0.17));
  // 准星 + 照门
  g.add(part(new THREE.BoxGeometry(0.005, 0.012, 0.005), dark, 0, 0.062, -0.13));
  g.add(part(new THREE.BoxGeometry(0.014, 0.008, 0.006), dark, 0, 0.058, 0.035));
  // 套筒前部
  g.add(part(new THREE.BoxGeometry(0.026, 0.03, 0.04), body, 0, 0.036, -0.14));
  // 击锤
  g.add(part(new THREE.BoxGeometry(0.006, 0.016, 0.01), dark, 0, 0.045, 0.045, 0.5));

  // 握把（倾斜 + 防滑纹）
  g.add(part(new THREE.BoxGeometry(0.027, 0.08, 0.052), grip, 0, -0.055, 0.042, 0.35));
  for (let i = 0; i < 4; i++) {
    g.add(part(new THREE.BoxGeometry(0.023, 0.004, 0.006), dark, 0, -0.03 - i * 0.017, 0.052, 0.35));
  }
  // 扳机护圈 + 扳机
  const trigGeo = new THREE.TorusGeometry(0.016, 0.004, 8, 14, Math.PI);
  trigGeo.rotateX(Math.PI / 2);
  g.add(part(trigGeo, dark, 0, -0.024, 0.0));
  g.add(part(new THREE.BoxGeometry(0.005, 0.014, 0.007), dark, 0, -0.018, 0.01, 0.3));
  // 弹匣底
  g.add(part(new THREE.BoxGeometry(0.024, 0.02, 0.045), dark, 0, -0.088, 0.055, 0.35));
  return g;
}

// 精细 AWP 狙击枪
function buildSniperModel() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ map: texGunBody(), color: 0xb8bcc2, metalness: 0.6, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171a1d, metalness: 0.75, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.85, metalness: 0.1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3622, roughness: 0.65, metalness: 0.05 });

  // 长枪管 + 枪口重器
  const barrelGeo = new THREE.CylinderGeometry(0.013, 0.015, 0.62, 14);
  barrelGeo.rotateX(Math.PI / 2);
  g.add(part(barrelGeo, dark, 0, 0.022, -0.58));
  g.add(part(new THREE.CylinderGeometry(0.019, 0.019, 0.07, 14).rotateX(Math.PI / 2), dark, 0, 0.022, -0.78));
  // 导气箍
  g.add(part(new THREE.CylinderGeometry(0.017, 0.017, 0.03, 12).rotateX(Math.PI / 2), dark, 0, 0.022, -0.36));

  // 机匣
  g.add(part(new THREE.BoxGeometry(0.054, 0.072, 0.32), body, 0, 0.042, -0.18));
  g.add(part(new THREE.BoxGeometry(0.048, 0.04, 0.22), dark, 0, 0.008, -0.14));
  // 抛壳口
  g.add(part(new THREE.BoxGeometry(0.016, 0.026, 0.09), dark, 0.035, 0.058, -0.2));

  // 瞄准镜（镜筒 + 目镜 + 物镜 + 遮光罩）
  g.add(part(new THREE.CylinderGeometry(0.019, 0.019, 0.3, 14).rotateX(Math.PI / 2), dark, 0, 0.108, -0.32));
  g.add(part(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 14).rotateX(Math.PI / 2), dark, 0, 0.108, -0.16));
  g.add(part(new THREE.CylinderGeometry(0.021, 0.024, 0.05, 14).rotateX(Math.PI / 2), dark, 0, 0.108, -0.48));
  g.add(part(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 14).rotateX(Math.PI / 2), dark, 0, 0.108, -0.52));
  g.add(part(new THREE.CylinderGeometry(0.013, 0.019, 0.035, 14).rotateX(Math.PI / 2), dark, 0, 0.108, -0.14));
  // 镜座
  g.add(part(new THREE.BoxGeometry(0.02, 0.02, 0.05), dark, 0, 0.078, -0.3));

  // 弹匣（长）
  g.add(part(new THREE.BoxGeometry(0.03, 0.1, 0.05), dark, 0, -0.055, -0.12, 0.28));
  g.add(part(new THREE.BoxGeometry(0.032, 0.024, 0.055), dark, 0, -0.098, -0.09, 0.28));

  // 握把 + 扳机
  g.add(part(new THREE.BoxGeometry(0.03, 0.08, 0.045), grip, 0, -0.07, 0.02, 0.55));
  g.add(part(new THREE.BoxGeometry(0.012, 0.02, 0.05), dark, 0, -0.036, -0.02, 0.5));

  // 枪托（木质 + 托腮板 + 托底板）
  g.add(part(new THREE.BoxGeometry(0.046, 0.06, 0.22), wood, 0, 0.028, 0.22));
  g.add(part(new THREE.BoxGeometry(0.042, 0.03, 0.16), dark, 0, 0.075, 0.2));
  g.add(part(new THREE.BoxGeometry(0.044, 0.07, 0.02), grip, 0, 0.03, 0.335));

  // 两脚架（收拢状态斜向前）
  g.add(part(new THREE.CylinderGeometry(0.005, 0.005, 0.09, 8).rotateX(2.4), dark, 0.012, -0.02, -0.42));
  g.add(part(new THREE.CylinderGeometry(0.005, 0.005, 0.09, 8).rotateX(2.4), dark, -0.012, -0.02, -0.42));
  return g;
}

// 手雷（增强细节）
function buildGrenadeModel() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x46543c, metalness: 0.25, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.9, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e2a24, metalness: 0.6, roughness: 0.7 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 12), bodyMat);
  s.scale.set(1, 1.18, 1);
  g.add(s);
  // 防滑环带
  g.add(part(new THREE.CylinderGeometry(0.0365, 0.0365, 0.012, 14).rotateX(Math.PI / 2), dark, 0, 0.02, 0));
  g.add(part(new THREE.CylinderGeometry(0.0365, 0.0365, 0.012, 14).rotateX(Math.PI / 2), dark, 0, -0.02, 0));
  // 保险柄 + 保险夹
  g.add(part(new THREE.BoxGeometry(0.02, 0.008, 0.028), metal, 0, 0.05, 0));
  g.add(part(new THREE.BoxGeometry(0.012, 0.02, 0.012), dark, 0, 0.048, -0.012));
  // 拉环
  const ringGeo = new THREE.TorusGeometry(0.02, 0.004, 8, 14);
  ringGeo.rotateX(Math.PI / 2);
  g.add(part(ringGeo, metal, 0, 0.062, -0.005));
  return g;
}

export function buildWeaponModel(type) {
  if (type === 'rifle') return buildRifleModel();
  if (type === 'pistol') return buildPistolModel();
  if (type === 'sniper') return buildSniperModel();
  return buildGrenadeModel();
}

// ============================================================
// WeaponSystem — 持有槽位、处理射击与动画
// ============================================================
export class WeaponSystem {
  constructor(camera, scene, audio, fx, gunModels = null) {
    this.camera = camera;
    this.scene = scene;
    this.audio = audio;
    this.fx = fx;
    this.slots = [
      { def: WEAPON_DEFS.rifle, mag: 30, reserve: 120 },
      { def: WEAPON_DEFS.pistol, mag: 12, reserve: 48 },
      { def: WEAPON_DEFS.sniper, mag: 5, reserve: 15 },
      { def: null, grenades: 2 }, // 手雷槽
    ];
    this.current = 0;
    this.lastSlot = 0;
    this.mag = 30; this.reserve = 120;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.spreadCur = 0;
    this.fireAnim = 0;
    this.switchAnim = 0;
    this.recoilStack = 0; // 连射后坐力累积（越打越飘）
    this.kickPitch = 0;   // 武器模型瞬态上抬
    this.inspectT = 0;    // 检视动画计时
    this.inspectDur = 1.5;
    this.inspectDir = 1;
    this.kickRoll = 0;      // 开枪瞬间枪口横向微晃
    this.ads = false;
    this.adsAmount = 0;
    this.bobTime = 0;
    this.swayX = 0; this.swayY = 0;
    this.gameplayMode = 'arena';
    this._adsRequested = false;
    this.triggerHeld = false;

    // 模型：优先使用下载的枪械建模，失败回退程序化
    this.models = [
      (gunModels && gunModels.rifle) || buildWeaponModel('rifle'),
      (gunModels && gunModels.pistol) || buildWeaponModel('pistol'),
      (gunModels && gunModels.sniper) || buildWeaponModel('sniper'),
      buildGrenadeModel(),
    ];
    this.environmentFactor = 1;
    this._prepareModels(this.models);
    this.modelHolder = new THREE.Group();
    this.modelHolder.add(...this.models);
    camera.add(this.modelHolder);
    scene.add(camera);

    // 第一人称枪械使用独立灯光层。旧版近距离点光源会让较长的 M4 枪口和枪托
    // 亮度差异过大，看起来像不在同一环境；方向光对三把枪提供一致、无距离衰减的受光。
    this.viewmodelLayer = 1;
    this.camera.layers.enable(this.viewmodelLayer);
    this.viewKey = new THREE.DirectionalLight(0xffdfbd, 0.0);
    this.viewFill = new THREE.DirectionalLight(0xa9caff, 0.0);
    this.viewRim = new THREE.DirectionalLight(0xffffff, 0.0);
    this.viewKey.position.set(-1.2, 1.0, 0.55);
    this.viewFill.position.set(1.1, 0.25, 0.15);
    this.viewRim.position.set(0.45, 0.9, -2.2);
    this.viewKeyTarget = new THREE.Object3D();
    this.viewFillTarget = new THREE.Object3D();
    this.viewRimTarget = new THREE.Object3D();
    this.viewKeyTarget.position.set(0, -0.12, -0.8);
    this.viewFillTarget.position.set(0, -0.16, -0.75);
    this.viewRimTarget.position.set(0, -0.04, -0.62);
    this.viewKey.target = this.viewKeyTarget;
    this.viewFill.target = this.viewFillTarget;
    this.viewRim.target = this.viewRimTarget;
    for (const light of [this.viewKey, this.viewFill, this.viewRim]) {
      light.layers.set(this.viewmodelLayer);
      light.castShadow = false;
    }
    this.modelHolder.add(
      this.viewKey, this.viewFill, this.viewRim,
      this.viewKeyTarget, this.viewFillTarget, this.viewRimTarget,
    );
    this.showSlot(0);
  }

  setGameplayMode(mode) {
    this.gameplayMode = mode === 'battlefield' ? 'battlefield' : 'arena';
    if (!this.canADS()) this.setADS(false);
  }

  canADS(def = this.def) {
    if (!def || this.current === 3) return false;
    if (def.type === 'sniper') return true;
    return this.gameplayMode === 'battlefield';
  }

  setADS(active) {
    this._adsRequested = !!active;
    this.ads = !!active && this.canADS();
  }

  toggleADS() {
    if (!this.canADS()) return;
    this.setADS(!this._adsRequested);
  }

  getADSAmount() {
    return this.canADS() ? this.adsAmount : 0;
  }

  getTargetFov(baseFov) {
    if (!this.canADS() || !this.def) return baseFov;
    return THREE.MathUtils.lerp(baseFov, this.def.adsFov || baseFov, this.adsAmount);
  }

  // 热替换为下载的枪械模型（加载完成后调用）
  setModels(gunModels) {
    if (!gunModels) return;
    const next = [
      gunModels.rifle || this.models[0],
      gunModels.pistol || this.models[1],
      gunModels.sniper || this.models[2],
      this.models[3], // 手雷保留程序化
    ];
    for (const m of this.models) {
      this.modelHolder.remove(m);
      if (next.includes(m)) continue; // 保留的回退模型不销毁
      m.traverse?.(c => { c.geometry?.dispose?.(); if (c.material) c.material.dispose?.(); });
    }
    this.models = next;
    this._prepareModels(this.models);
    this.modelHolder.add(...this.models);
    this.showSlot(this.current);
    this.setEnvironmentFactor(this.environmentFactor);
  }

  _prepareModels(models) {
    const names = ['rifle', 'pistol', 'sniper', 'grenade'];
    models.forEach((model, index) => {
      model.userData.weaponType = names[index] || 'rifle';
      const gain = index === 0 ? 1.34 : index === 1 ? 1.02 : index === 2 ? 1.0 : 0.9;
      model.traverse?.(ch => {
        if (!ch.isMesh || !ch.material) return;
        ch.castShadow = false;
        ch.receiveShadow = false;
        ch.layers.set(this.viewmodelLayer ?? 1);
        const materials = Array.isArray(ch.material) ? ch.material : [ch.material];
        for (const mat of materials) {
          if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) continue;
          mat.metalness = Math.min(mat.metalness ?? 0, 0.68);
          mat.roughness = Math.max(mat.roughness ?? 0.55, mat.emissiveIntensity > 0 ? 0.28 : 0.38);
          if (mat.userData.baseEnvMapIntensity == null) {
            const fallback = mat.metalness > 0.4 ? 0.58 : 0.42;
            mat.userData.baseEnvMapIntensity = Math.min(Number.isFinite(mat.envMapIntensity) ? mat.envMapIntensity : fallback, 0.82);
          }
          mat.userData.baseColor = mat.userData.baseColor || mat.color?.clone?.() || new THREE.Color(0x777777);
          mat.userData.weaponGain = gain;
          if (mat.emissive) mat.userData.baseEmissive = mat.emissive.clone();
          mat.needsUpdate = true;
        }
      });
    });
  }

  setEnvironmentFactor(factor, directFactor = factor, ambientFactor = factor) {
    this.environmentFactor = THREE.MathUtils.clamp(factor, 0.12, 1.0);
    const direct = THREE.MathUtils.clamp(directFactor, 0, 1);
    const ambient = THREE.MathUtils.clamp(ambientFactor, 0.08, 1);
    for (const model of this.models) {
      model.traverse?.(ch => {
        if (!ch.isMesh || !ch.material) return;
        const materials = Array.isArray(ch.material) ? ch.material : [ch.material];
        for (const mat of materials) {
          if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) continue;
          const base = mat.userData.baseEnvMapIntensity ?? 0.48;
          const gain = mat.userData.weaponGain ?? 1;
          // 三把枪共享同一套环境采样；M4 仅做模型贴图曝光补偿，不再使用另一套反射逻辑。
          mat.envMapIntensity = Math.min(1.15, base * (0.42 + this.environmentFactor * 0.88) * Math.min(1.18, gain));
          if (mat.color && mat.userData.baseColor) {
            const exposure = (0.78 + ambient * 0.34 + direct * 0.10) * gain;
            mat.color.copy(mat.userData.baseColor).multiplyScalar(exposure);
          }
          if (mat.emissive && mat.userData.baseColor) {
            // 极弱的相机曝光补偿只抬起黑位，强度仍由环境遮挡控制。
            mat.emissive.copy(mat.userData.baseColor).multiplyScalar(0.012 + ambient * 0.018);
            mat.emissiveIntensity = 0.35;
          }
        }
      });
    }
    // 独立方向补光不受枪械长度和相机内位置影响；三把枪会在同一环境中同步变化。
    if (this.viewKey) this.viewKey.intensity = 0.36 + direct * 1.18;
    if (this.viewFill) this.viewFill.intensity = 0.22 + ambient * 0.62;
    if (this.viewRim) this.viewRim.intensity = 0.10 + direct * 0.24 + ambient * 0.20;
  }

  get isGrenadeSlot() { return this.current === 3; }
  get grenades() { return this.slots[3].grenades; }
  set grenades(v) { this.slots[3].grenades = v; }

  showSlot(i) {
    this.models.forEach((m, idx) => (m.visible = idx === i));
    this.current = i;
    if (i === 3) { this.def = null; this.mag = 0; this.reserve = 0; }
    else {
      this.def = this.slots[i].def;
      this.mag = this.slots[i].mag;
      this.reserve = this.slots[i].reserve;
    }
    this.switchAnim = 1;
    this.setADS(false);
  }

  switchTo(i) {
    if (i === this.current) return;
    if (i < 0 || i >= this.slots.length) return;
    this.lastSlot = this.current;
    this.slots[this.current] = { def: this.def, mag: this.mag, reserve: this.reserve, grenades: this.slots[this.current].grenades ?? this.grenades };
    if (this.current === 3) this.slots[3].grenades = this.grenades;
    this.showSlot(i);
  }

  // Q 键：快速切回上一把武器（CS 风格）
  quickSwitch() {
    const target = this.lastSlot !== this.current ? this.lastSlot : (this.current === 0 ? 1 : 0);
    this.switchTo(target);
  }

  // V 键：检视武器（垂下 → 旋转一周 → 回正）
  inspect() {
    if (this.inspectT > 0 || this.reloading) return;
    this.inspectT = this.inspectDur;
    this.inspectDir = Math.random() > 0.5 ? 1 : -1;
  }

  startReload() {
    if (this.reloading || !this.def) return;
    if (this.mag >= this.def.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = this.def.reloadTime;
    this.audio.reload();
  }

  update(dt, player) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.spreadCur = Math.max(0, this.spreadCur - 7.5 * dt); // 准星扩散快速回正，避免射击后长时间飘散
    this.fireAnim = Math.max(0, this.fireAnim - dt / 0.16);
    this.switchAnim = Math.max(0, this.switchAnim - dt / 0.28);
    // 连射后坐力累积衰减（停止射击约 1.2 秒归零）
    this.recoilStack = Math.max(0, this.recoilStack - dt * 5.0);
    this.kickPitch += (0 - this.kickPitch) * Math.min(1, dt * 14);

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const def = this.def;
        const need = def.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take; this.reserve -= take;
        this.slots[this.current] = { def, mag: this.mag, reserve: this.reserve, grenades: this.grenades };
        this.reloading = false;
      }
    }

    // 冲刺和换弹会压下武器；松开冲刺后，战场模式按住右键会自动重新举枪。
    this.ads = this._adsRequested && this.canADS() && !player.sprinting && !this.reloading;
    // 开镜状态平滑
    const adsTarget = this.ads ? 1 : 0;
    const adsSpeed = this.def?.adsSpeed || 10;
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(1, dt * adsSpeed);

    // 走路摆动
    const speed = Math.hypot(player.vel.x, player.vel.z);
    if (speed > 0.4 && player.onGround) this.bobTime += dt * (player.sprinting ? 11 : 7);
    const bobAmp = Math.min(speed / 7, 1) * (this.adsAmount > 0.5 ? 0.075 : 1) * (player.crouching ? 0.4 : 1);
    const bobX = Math.sin(this.bobTime) * 0.012 * bobAmp;
    const bobY = Math.cos(this.bobTime * 2) * 0.008 * bobAmp;

    // 视角摆动（鼠标惯性）
    const swayScale = this.adsAmount > 0.5 ? 0.00008 : 0.00022;
    const lookDX = player.viewDX || 0, lookDY = player.viewDY || 0;
    this.swayX += (-lookDX * swayScale - this.swayX) * Math.min(1, dt * 15);
    this.swayY += (-lookDY * swayScale - this.swayY) * Math.min(1, dt * 15);

    // 位置混合
    const model = this.models[this.current];
    const hip = this.slotHipPos();
    const ads = this.slotAdsPos();
    let tx = hip.x + (ads.x - hip.x) * this.adsAmount;
    let ty = hip.y + (ads.y - hip.y) * this.adsAmount;
    let tz = hip.z + (ads.z - hip.z) * this.adsAmount;
    // 后坐/开火动画（枪口上抬 + 后座）
    const kick = this.fireAnim > 0 && this.def ? this.fireAnim * (this.def.type === 'sniper' ? 0.32 : 0.24) : 0;
    tx += this.swayX; ty += this.swayY;
    tz += kick * 0.2; ty -= kick * 0.07;
    ty += this.kickPitch * 0.0022; // 连射累积：枪口持续上抬
    // 切换动画
    if (this.switchAnim > 0) ty -= this.switchAnim * 0.22;
    // 开枪瞬间枪口横向微晃（随 fireAnim 衰减）
    tx += this.kickRoll * this.fireAnim;
    // 换弹动画 + 持枪倾角（开镜时完全收平，枪保持在右下不挡视野）
    const profile = this.currentProfile();
    const baseTilt = THREE.MathUtils.lerp(profile.hipTilt, profile.adsTilt, this.adsAmount);
    if (this.reloading) { ty -= 0.18; model.rotation.x = 0.9; }
    else model.rotation.x = kick * 0.82 + baseTilt;
    model.rotation.z = THREE.MathUtils.lerp(profile.hipRoll, 0, this.adsAmount) + this.kickRoll * this.fireAnim * 0.35;
    model.position.set(tx + bobX, ty + bobY, tz);
    // 狙击开镜：隐藏武器模型，只显示瞄准镜遮罩（避免遮挡/重叠）
    const scoped = this.def && this.def.type === 'sniper' && this.adsAmount > 0.55;
    model.visible = !scoped;
    // 检视动画（V 键）：垂下 → 旋转一周 → 回正
    if (this.inspectT > 0) {
      this.inspectT -= dt;
      const t = 1 - Math.max(0, this.inspectT) / this.inspectDur;
      const drop = t < 0.14 ? t / 0.14 : t > 0.86 ? (1 - t) / 0.14 : 1;
      model.rotation.x = model.rotation.x * (1 - drop) + 1.15 * drop;
      const spin = t < 0.14 ? 0 : Math.min(1, (t - 0.14) / 0.72);
      model.rotation.y = this.swayX * 2 + spin * Math.PI * 2 * this.inspectDir;
      model.position.y = ty + bobY - drop * 0.06;
    } else {
      model.rotation.y = this.swayX * 2;
    }
  }

  currentProfile() {
    if (this.current === 3) return VIEWMODEL_PROFILES.grenade;
    return VIEWMODEL_PROFILES[this.def?.type] || VIEWMODEL_PROFILES.rifle;
  }
  slotHipPos() { return this.currentProfile().hip.clone(); }
  slotAdsPos() { return this.currentProfile().ads.clone(); }

  // 枪口世界位置，跟随当前武器校准数据。
  muzzleWorld() {
    const v = this.currentProfile().muzzle.clone();
    this.camera.localToWorld(v);
    return v;
  }

  shellEjectWorld() {
    const v = this.currentProfile().shell.clone();
    this.camera.localToWorld(v);
    return v;
  }

  computeSpread(player) {
    const def = this.def;
    let s = def.spread;
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const battlefield = this.gameplayMode === 'battlefield';
    if (!player.onGround) s += battlefield ? 0.020 : 0.024;
    else if (speed > 0.5) s += def.spreadMove * (player.sprinting ? 1.55 : (battlefield ? 0.9 : 1.0));
    if (player.crouching) s *= battlefield ? 0.58 : 0.48;
    if (this.canADS() && this.adsAmount > 0.5) {
      s = def.spreadAds * (speed > 0.5 ? (battlefield ? 1.25 : 1.6) : 1);
    }
    // CS 模式狙击枪不开镜时大幅不准；战场腰射同样不应像准星射线枪。
    if (def.type === 'sniper' && this.adsAmount < 0.5) s = Math.max(s, battlefield ? 0.018 : 0.030);
    return s + this.spreadCur;
  }

  // 尝试开火；返回是否开枪。game 负责射线判定
  tryFire(game, player) {
    if (this.current === 3) return false; // 手雷用 G
    if (this.reloading) return false;
    if (this.fireCooldown > 0) return false;
    const def = this.def;
    if (this.mag <= 0) { this.startReload(); return false; }
    this.fireCooldown = def.interval;
    this.mag--;
    this.slots[this.current] = { def, mag: this.mag, reserve: this.reserve, grenades: this.grenades };

    // 散布方向：先按准星方向计算，再加入非常轻微的目标容错。
    const spread = this.computeSpread(player);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    const aimOrigin = this.camera.position.clone();
    if (game.assistAimDirection) dir.copy(game.assistAimDirection(aimOrigin, dir, def, player));

    // 命中判定始终使用屏幕准星射线。旧版从偏右下的真实枪口再打一遍射线，
    // 在门框、掩体边缘和贴身交战时会把正确命中误判成撞墙。
    const result = game.worldRay(aimOrigin, dir, def, true);
    const muzzle = this.muzzleWorld();

    // 后坐力：降低累积倍率，单发清晰、连射可控，不再出现镜头被持续积分抬飞。
    const stackKick = 1 + this.recoilStack * 0.16;
    const adsRecoil = this.adsAmount > 0.5 ? (this.gameplayMode === 'battlefield' ? 0.58 : 0.72) : 1;
    const kick = def.recoilKick * adsRecoil * stackKick;
    const yawKick = (Math.random() - 0.5) * kick * 0.28 + (Math.random() - 0.5) * 0.0015 * this.recoilStack;
    player.addRecoil(kick, yawKick);
    this.kickPitch = kick * 4.2;
    this.recoilStack = Math.min(5, this.recoilStack + 0.75);
    this.spreadCur = Math.min(0.018, this.spreadCur + def.recoilSpread * stackKick);
    this.fireAnim = 1;
    // 开枪瞬间枪口随机微晃（真实感）
    this.kickRoll = (Math.random() - 0.5) * 0.016;

    // 音效/特效
    if (def.sound === 'rifle') this.audio.shotRifle();
    else if (def.sound === 'pistol') this.audio.shotPistol();
    else this.audio.shotSniper();
    this.fx.addMuzzle(muzzle, def.type === 'sniper' ? 0.55 : 0.32);
    if (def.tracer && result) this.fx.addTracer(muzzle, result.point);
    // 弹壳
    const shellDir = new THREE.Vector3();
    this.camera.getWorldDirection(shellDir);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.fx.addShell(this.shellEjectWorld(), shellDir.clone().multiplyScalar(-0.3).add(right.clone().multiplyScalar(1)));

    if (this.mag === 0) this.startReload();
    return true;
  }

  tryThrowGrenade(game, player) {
    if (this.grenades <= 0) return false;
    if (this.fireCooldown > 0) return false;
    this.fireCooldown = 0.6;
    this.grenades--;
    this.audio.grenadePin();
    setTimeout(() => this.audio.throwGrenade(), 250);
    game.throwGrenade(player, this);
    return true;
  }
}
