// ============================================================
// maps/battlefield.js — 大战场「钢铁前线」
// 400×400m 起伏地形，5 个据点，战壕/坦克残骸/碉堡/观察塔
// ============================================================
import * as THREE from 'three';
import { fbm, texBump } from '../tex.js';

export function buildBattlefieldMap(scene, tex) {
  const map = {
    name: '钢铁前线',
    bounds: [-200, 200, -200, 200],
    colliders: [],
    enemySpawns: [],
    playerSpawn: null,
    playerSpawnYaw: 0.7,
    objectives: [],
    supplyPoints: [],
    groundHeight: null,
  };

  // ---------- 地形高度图（129×129） ----------
  const N = 129;
  const hm = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const nx = i / (N - 1), nz = j / (N - 1);
      let h = fbm(nx * 1.9, nz * 1.9, 201, 5) * 18 - 8;
      h += (fbm(nx * 5.2, nz * 5.2, 307, 3) - 0.5) * 5;     // 中频丘陵（高低差明显）
      h += (fbm(nx * 14, nz * 14, 503, 2) - 0.5) * 1.1;     // 高频地表细节
      // 四座高耸山峰（高低差显著）
      const peaks = [[0.18, 0.3, 12], [0.8, 0.75, 11], [0.25, 0.85, 10], [0.72, 0.25, 11]];
      for (const [px, pz, ph] of peaks) {
        const dc = Math.hypot(nx - px, nz - pz);
        h += Math.max(0, 1 - dc * 2.6) * ph;
      }
      // 中部高地隆起
      const dc = Math.hypot(nx - 0.5, nz - 0.42);
      h += Math.max(0, 1 - dc * 2.2) * 5;
      // 战壕凹陷带（南北向主战壕 + 两条支线）
      const trenchA = Math.exp(-((nx - 0.28) * (nx - 0.28)) / 0.0016);
      const trenchB = Math.exp(-((nx - 0.72) * (nx - 0.72)) / 0.0016);
      const trenchC = Math.exp(-((nz - 0.68) * (nz - 0.68)) / 0.0016);
      h -= (trenchA + trenchB) * 1.6 * (1 - Math.min(1, Math.abs(nz - 0.4) * 2.2));
      h -= trenchC * 1.2 * (1 - Math.min(1, Math.abs(nx - 0.5) * 2.5));
      // 边缘抬升
      const e = Math.min(nx, 1 - nx, nz, 1 - nz);
      const fade = Math.max(0, Math.min(1, (0.14 - e) / 0.1));
      h += fade * 7;
      hm[j * N + i] = h;
    }
  }
  function groundHeight(x, z) {
    const fx = (x + 200) / 400 * (N - 1);
    const fz = (z + 200) / 400 * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const tx = fx - i0, tz = fz - j0;
    const h00 = hm[j0 * N + i0], h10 = hm[j0 * N + i0 + 1];
    const h01 = hm[(j0 + 1) * N + i0], h11 = hm[(j0 + 1) * N + i0 + 1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }
  map.groundHeight = groundHeight;

  // ---------- 地面网格 ----------
  const groundGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  groundGeo.computeVertexNormals();
  const grassTex = tex.grass.clone();
  grassTex.repeat.set(44, 44);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
    map: grassTex, roughness: 1, color: 0x8fa084, envMapIntensity: 0,
    bumpMap: texBump(44, 44, 55), bumpScale: 0.018, // 草地视差凹凸（纯哑光）
  }));
  ground.receiveShadow = true;
  scene.add(ground);

  // 泥土道路（基地到各据点）
  const dirtTex = tex.dirt.clone();
  dirtTex.repeat.set(6, 1);
  const roadMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });
  function addRoad(x1, z1, x2, z2, w = 5) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const g = new THREE.PlaneGeometry(w, len, 1, 8);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, groundHeight(p.getX(i), p.getZ(i)) + 0.06);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, roadMat);
    m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    scene.add(m);
  }
  addRoad(-150, -150, 0, -150);
  addRoad(0, -150, 0, 30);
  addRoad(0, 30, 150, -30);
  addRoad(0, 30, -150, 60);
  addRoad(-150, -150, -150, 60);

  // ---------- 材质 ----------
  const ph = tex.ph || {};
  const phMat = (name, fallback) => (ph[name] && ph[name].map ? ph[name] : fallback);
  const M = {
    concrete: phMat('concrete', new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9 })),
    metal: phMat('metal', new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.6, metalness: 0.5 })),
    wood: phMat('wood', new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.85 })),
    sandbag: new THREE.MeshStandardMaterial({ map: tex.tarp, color: 0xa89a70, roughness: 1 }),
    tarp: new THREE.MeshStandardMaterial({ map: tex.tarp, roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7, metalness: 0.4 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.9, metalness: 0.3 }),
    burnt: new THREE.MeshStandardMaterial({ color: 0x1d1c18, roughness: 1 }),
    flagBlue: new THREE.MeshStandardMaterial({ map: tex.flagBlue, side: THREE.DoubleSide, roughness: 0.8 }),
    flagRed: new THREE.MeshStandardMaterial({ map: tex.flagRed, side: THREE.DoubleSide, roughness: 0.8 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4a5d38, roughness: 1, flatShading: true }),
  };

  // ---------- 辅助 ----------
  function addBox(x, y, z, w, h, d, mat, collide = true, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (collide) {
      // 旋转长方体转换为紧凑 AABB，避免细墙被错误扩大成巨型正方形空气墙。
      const c = Math.abs(Math.cos(ry));
      const s = Math.abs(Math.sin(ry));
      const aw = w * c + d * s;
      const ad = w * s + d * c;
      map.colliders.push({ x, y, z, w: aw * 1.02, h, d: ad * 1.02 });
    }
    return m;
  }
  function addCyl(x, y, z, r, h, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (collide) map.colliders.push({ x, y, z, w: r * 2, h, d: r * 2 });
    return m;
  }
  function addSandbagCircle(cx, cz, r, seg = 8) {
    const sm = tex.sceneModels && tex.sceneModels.sandbag;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + 0.2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const g = groundHeight(x, z);
      if (sm) {
        const m = sm.clone();
        m.position.set(x, g + 0.05, z);
        m.rotation.y = a + Math.PI / 2;
        scene.add(m);
      } else {
        addBox(x, g + 0.55, z, 1.5, 1.1, 0.8, M.sandbag, true, a);
      }
      map.colliders.push({ x, y: g + 0.55, z, w: 1.6, h: 1.1, d: 1.2 });
    }
  }
  // 旗帜据点
  function addObjective(name, x, z) {
    const g = groundHeight(x, z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.2, 36),
      new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, g + 0.1, z);
    scene.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 8), M.dark);
    pole.position.set(x, g + 3, z);
    pole.castShadow = true;
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), M.flagRed);
    flag.position.set(x + 0.95, g + 5.6, z);
    scene.add(flag);
    map.objectives.push({ name, pos: new THREE.Vector3(x, g, z), radius: 3.2, captured: false, ring, flag, beacon: null });
    // 沙袋环 + 帐篷
    addSandbagCircle(x, z, 4.6);
    for (let i = 0; i < 2; i++) {
      const a = (i * Math.PI) + 0.6;
      const tx = x + Math.cos(a) * 7, tz = z + Math.sin(a) * 7;
      const tg = groundHeight(tx, tz);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.3, 2.4, 4), M.tarp);
      tent.position.set(tx, tg + 1.2, tz);
      tent.rotation.y = a + Math.PI / 4;
      tent.castShadow = true;
      scene.add(tent);
      map.colliders.push({ x: tx, y: tg + 1.2, z: tz, w: 4.4, h: 2.4, d: 4.4 });
    }
  }

  // ---------- 坦克残骸 ----------
  function addTank(x, z, yaw, scale = 1) {
    const g = groundHeight(x, z);
    const t = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6 * scale, 0.85 * scale, 4.4 * scale), M.rust);
    body.position.y = 0.45 * scale;
    const trackL = new THREE.Mesh(new THREE.BoxGeometry(0.55 * scale, 0.6 * scale, 4.8 * scale), M.burnt);
    trackL.position.set(-1.15 * scale, 0.3 * scale, 0);
    const trackR = trackL.clone();
    trackR.position.x = 1.15 * scale;
    const turret = new THREE.Mesh(new THREE.BoxGeometry(1.6 * scale, 0.5 * scale, 2 * scale), M.rust);
    turret.position.set(0, 1.05 * scale, -0.2 * scale);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * scale, 0.11 * scale, 2.6 * scale, 10), M.dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.15 * scale, -1.6 * scale);
    t.add(body, trackL, trackR, turret, barrel);
    t.position.set(x, g + 0.05, z);
    t.rotation.y = yaw;
    t.rotation.z = 0.05;
    scene.add(t);
    map.colliders.push({ x, y: g + 0.5 * scale, z, w: 3 * scale, h: 1.3 * scale, d: 5 * scale });
    return t;
  }

  // ---------- 碉堡 ----------
  function addBunker(x, z, yaw) {
    const g = groundHeight(x, z);
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 5.4), M.concrete);
    b.position.set(x, g + 1.1, z);
    b.rotation.y = yaw;
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    // 射击口
    const slot = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.25), M.burnt);
    slot.position.set(x + Math.sin(yaw) * 2.75, g + 1.15, z + Math.cos(yaw) * 2.75);
    slot.rotation.y = yaw;
    scene.add(slot);
    map.colliders.push({ x, y: g + 1.1, z, w: 5.2, h: 2.2, d: 6.2 });
  }

  // ---------- 观察塔 ----------
  function addTower(x, z) {
    const g = groundHeight(x, z);
    const w = 2.4;
    for (const [ox, oz] of [[-w / 2, -w / 2], [w / 2, -w / 2], [-w / 2, w / 2], [w / 2, w / 2]]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6.2, 0.22), M.wood);
      col.position.set(x + ox, g + 3.1, z + oz);
      col.castShadow = true;
      scene.add(col);
      map.colliders.push({ x: x + ox, y: g + 3.1, z: z + oz, w: 0.3, h: 6.2, d: 0.3 });
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.2, w + 0.6), M.wood);
    plat.position.set(x, g + 6.1, z);
    plat.castShadow = true; plat.receiveShadow = true;
    scene.add(plat);
    for (const [ox, oz] of [[-w / 2 - 0.2, -w / 2 - 0.2], [w / 2 + 0.2, -w / 2 - 0.2], [-w / 2 - 0.2, w / 2 + 0.2], [w / 2 + 0.2, w / 2 + 0.2]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, w + 0.9), M.wood);
      rail.position.set(x + ox, g + 6.7, z + oz * 0.7);
      scene.add(rail);
    }
    map.colliders.push({ x, y: g + 6.1, z, w: w + 1.2, h: 0.4, d: w + 1.2 });
  }

  // ---------- 集装箱 ----------
  function addContainer(x, z, yaw, stacked = false) {
    const g = groundHeight(x, z);
    addBox(x, g + (stacked ? 2.6 : 1.3), z, 2.5, 2.6, 6.2, M.metal, true, yaw);
    if (stacked) addBox(x, g + 3.95, z, 2.5, 2.6, 6.2, M.rust, true, yaw);
  }

  // ---------- 树木 ----------
  function addTree(x, z) {
    const g = groundHeight(x, z);
    // 树：主干 + 斜枝 + 多球树冠（建模更精致）
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 3.2, 7), M.trunk);
    trunk.position.y = 1.6;
    tree.add(trunk);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random() * 0.8;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.09, 1.5, 5), M.trunk);
      br.position.set(Math.cos(a) * 0.75, 2.4 + Math.random() * 0.3, Math.sin(a) * 0.75);
      br.rotation.z = Math.cos(a) * 0.45;
      br.rotation.x = Math.sin(a) * 0.45;
      tree.add(br);
    }
    const crownMat = M.leaf;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.35, 7, 6), crownMat);
    crown.position.y = 3.5;
    crown.scale.set(1, 0.85, 1);
    tree.add(crown);
    const c2 = crown.clone(); c2.position.set(0.95, 2.95, 0.3); c2.scale.setScalar(0.72); tree.add(c2);
    const c3 = crown.clone(); c3.position.set(-0.72, 3.15, -0.65); c3.scale.setScalar(0.66); tree.add(c3);
    tree.position.set(x, g, z);
    tree.traverse(m => { m.castShadow = true; });
    scene.add(tree);
    map.colliders.push({ x, y: g + 1.3, z, w: 0.5, h: 3.4, d: 0.5 });
  }

  // ================= 布置据点 =================
  // 玩家基地（西南）
  addObjective('基地哨站', -150, -150);
  map.playerSpawn = new THREE.Vector3(-160, groundHeight(-160, -160), -160);
  map.playerSpawnYaw = 0.6;
  // 基地围墙
  addBox(-170, groundHeight(-170, -160) + 1.3, -160, 0.5, 2.6, 22, M.sandbag, true);
  addBox(-150, groundHeight(-150, -170) + 1.3, -170, 22, 2.6, 0.5, M.sandbag, true);
  addSandbagCircle(-150, -150, 4.6);
  addTower(-165, -145);
  addContainer(-172, -152, 0.5);
  // 补给点
  const sup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.wood);
  sup.position.set(-155, groundHeight(-155, -158) + 0.5, -158);
  sup.castShadow = true;
  scene.add(sup);
  map.supplyPoints = [{ pos: new THREE.Vector3(-155, 0, -158), mesh: sup }];

  // 北哨站
  addObjective('北哨站', 0, -150);
  addBunker(-3, -143, 1.2);
  addTank(-12, -156, 0.5, 0.9);
  addSandbagCircle(8, -158, 3.4, 6);

  // 中央高地
  addObjective('中央高地', 0, 30);
  addBunker(0, 26, 0.3);
  addTower(7, 34);
  addTank(-9, 38, 2.4, 1.05);
  addSandbagCircle(9, 24, 3.4, 6);

  // 东站
  addObjective('东站', 150, -30);
  addContainer(143, -26, 0.9);
  addContainer(147, -20, 0.9, true);
  addTank(158, -36, 0.1, 1.1);
  addBunker(155, -22, -0.7);

  // 西站
  addObjective('西站', -150, 60);
  addTank(-158, 52, 1.8, 0.95);
  addContainer(-143, 66, 0.2);
  addSandbagCircle(-156, 66, 3.4, 6);

  // ================= 战壕沙袋 & 掩体散布 =================
  const trenchSections = [
    [-60, -130, -60, -30], [60, -140, 60, -40], [-120, 10, -30, 10],
    [120, -80, 120, 20], [-40, 90, 40, 90],
  ];
  for (const [x1, z1, x2, z2] of trenchSections) {
    const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)) / 6);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const g = groundHeight(x, z);
      const sb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 0.7), M.sandbag);
      const side = i % 2 === 0 ? 1 : -1;
      sb.position.set(x + side * 1.1, g + 0.45, z);
      sb.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      sb.castShadow = true;
      scene.add(sb);
      map.colliders.push({ x: x + side * 1.1, y: g + 0.45, z, w: 1.8, h: 0.95, d: 1.1 });
    }
  }
  // 开阔地掩体
  const fieldCrates = [[-90, -60], [90, -110], [70, 80], [-70, -100], [110, 100], [-110, 30], [30, -90], [-30, 130]];
  for (const [x, z] of fieldCrates) addBox(x, groundHeight(x, z) + 0.6, z, 1.2, 1.2, 1.2, M.wood, true);
  // 油桶散落
  const barrels = [[-100, -120], [100, -60], [-40, -10], [80, 60], [-130, 90], [40, 140], [160, 10], [-60, 150]];
  for (const [x, z] of barrels) addCyl(x, groundHeight(x, z) + 0.5, z, 0.34, 1.0, M.rust);

  // ================= 战场细节装饰 =================
  // 战壕沿线沙袋与铁丝网（优先用下载的沙袋模型）
  const sm = tex.sceneModels && tex.sceneModels.sandbag;
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.8, metalness: 0.6 });
  for (const [x1, z1, x2, z2] of trenchSections) {
    const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)) / 6);
    const nx = -(z2 - z1) / Math.hypot(x2 - x1, z2 - z1), nz = (x2 - x1) / Math.hypot(x2 - x1, z2 - z1);
    const ang = Math.atan2(x2 - x1, z2 - z1);
    for (let i = 0; i <= steps; i += 2) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const g = groundHeight(x, z);
      for (const side of [-1, 1]) {
        const sx = x + nx * side * 1.9, sz = z + nz * side * 1.9;
        if (sm) {
          const m = sm.clone();
          m.position.set(sx, g + 0.05, sz);
          m.rotation.y = ang;
          scene.add(m);
        } else {
          const sb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 0.7), M.sandbag);
          sb.position.set(sx, g + 0.45, sz);
          sb.rotation.y = ang;
          sb.castShadow = true;
          scene.add(sb);
        }
        map.colliders.push({ x: sx, y: g + 0.45, z: sz, w: 1.8, h: 0.95, d: 1.1 });
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), wireMat);
        post.position.set(sx, g + 0.7, sz);
        post.castShadow = true;
        scene.add(post);
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.6, 5), wireMat);
        wire.rotation.set(Math.PI / 2, ang, 0);
        wire.position.set(sx, g + 1.05, sz);
        scene.add(wire);
      }
    }
  }
  // 弹坑（焦黑圆盘贴地）
  const craterMat = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 1 });
  const craters = [[-70, -40], [70, -80], [-30, 50], [120, 30], [-110, 110], [50, 150], [-150, 10], [170, -120]];
  for (const [x, z] of craters) {
    const g = groundHeight(x, z);
    const r = 1.8 + Math.random() * 2;
    const pit = new THREE.Mesh(new THREE.CircleGeometry(r, 14), craterMat);
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(x, g + 0.05, z);
    pit.receiveShadow = true;
    scene.add(pit);
    // 边缘碎石
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 6.28 + Math.random();
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + Math.random() * 0.15, 0), M.burnt);
      stone.position.set(x + Math.cos(a) * r * 1.2, g + 0.12, z + Math.sin(a) * r * 1.2);
      stone.castShadow = true;
      scene.add(stone);
    }
  }
  // 基地通讯塔
  (function addAntenna(x, z) {
    const g = groundHeight(x, z);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 10, 8), M.dark);
    tower.position.set(x, g + 5, z);
    tower.castShadow = true;
    scene.add(tower);
    for (const [hh, ww] of [[7, 2.4], [8.4, 1.8], [9.6, 1.2]]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.06, 0.06), M.dark);
      cross.position.set(x, g + hh, z);
      scene.add(cross);
      const cross2 = cross.clone();
      cross2.rotation.y = Math.PI / 2;
      scene.add(cross2);
    }
    map.colliders.push({ x, y: g + 5, z, w: 0.6, h: 10, d: 0.6 });
  })(-172, -168);
  // 弹药箱堆（基地 + 北哨站）
  function addAmmoCrates(x, z, n = 3) {
    const g = groundHeight(x, z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const ox = Math.cos(a) * 0.7, oz = Math.sin(a) * 0.7;
      addBox(x + ox, g + 0.35, z + oz, 0.7, 0.7, 0.7, M.wood, true, a);
    }
  }
  addAmmoCrates(-148, -162, 4);
  addAmmoCrates(6, -156, 3);
  addAmmoCrates(152, -24, 3);

  // ================= Kenney 工业道具（烟囱/油罐/废墟楼，CC0） =================
  const ksm = tex.sceneModels || {};
  function placeK(modelKey, x, z, rotY = 0, scale = 1) {
    const m = ksm[modelKey];
    if (!m) return;
    const inst = m.clone();
    const g = groundHeight(x, z);
    inst.position.set(x, g + 0.02, z);
    inst.rotation.y = rotY;
    inst.scale.multiplyScalar(scale);
    scene.add(inst);
    return inst;
  }
  // 油罐：据点旁（可作掩体）
  placeK('tank', -144, -134, 0.5, 2.2);
  placeK('tank', 148, -34, 1.2, 2.2);
  placeK('tank', -146, 56, 0.2, 2.2);
  placeK('tank', 4, 36, 0.8, 2.2);
  // 烟囱：阵地边缘
  placeK('chimney', -130, -110, 0, 1);
  placeK('chimney', 120, 80, 0, 1.2);
  placeK('chimney', -90, 130, 0, 0.9);
  placeK('chimney', 160, -100, 0, 1.1);
  // 废墟建筑：战场角落
  placeK('building', -120, 140, 0.8, 1);
  placeK('building', 130, 140, 1.6, 0.9);
  placeK('building', -170, 40, 0.3, 1.1);
  placeK('building', 170, -60, 2.2, 1);

  // ================= 坦克/树木 =================
  addTank(-100, -90, 1.1, 0.9);
  addTank(90, -30, 2.2, 1.05);
  addTank(-80, 20, 4.2, 0.95);
  addTank(110, 60, 3.3, 1.1);
  addTank(-20, 150, 0.8, 0.9);
  addTank(40, -160, 5.2, 0.95);

  // 树木（伪随机散布）
  let seed = 777;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const occupied = map.objectives.map(o => o.pos);
  let trees = 0;
  for (let i = 0; i < 260 && trees < 60; i++) {
    const x = -190 + rnd() * 380, z = -190 + rnd() * 380;
    if (occupied.some(o => o.distanceTo(new THREE.Vector3(x, 0, z)) < 26)) continue;
    if (Math.hypot(x + 160, z + 160) < 18) continue; // 基地
    addTree(x, z);
    trees++;
  }

  // ================= 自然细节：岩石 / 灌木 / 枯树 =================
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6a60, roughness: 0.95, flatShading: true });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x46563a, roughness: 1, flatShading: true });
  const deadMat = new THREE.MeshStandardMaterial({ color: 0x4a3c2a, roughness: 1 });
  let rocks = 0, bushes = 0, deads = 0;
  for (let i = 0; i < 420 && (rocks < 34 || bushes < 30 || deads < 10); i++) {
    const x = -188 + rnd() * 376, z = -188 + rnd() * 376;
    if (occupied.some(o => o.distanceTo(new THREE.Vector3(x, 0, z)) < 24)) continue;
    if (Math.hypot(x + 160, z + 160) < 16) continue;
    const g = groundHeight(x, z);
    const roll = rnd();
    if (roll < 0.42 && rocks < 34) {
      // 岩石（随机大小/朝向）
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rnd() * 1.1, 0), rockMat);
      rock.position.set(x, g + 0.15, z);
      rock.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
      rock.scale.y = 0.55 + rnd() * 0.5;
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
      rocks++;
    } else if (roll < 0.8 && bushes < 30) {
      // 灌木丛
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.5 + rnd() * 0.4, 6, 5), bushMat);
      bush.position.set(x, g + 0.3, z);
      bush.scale.y = 0.7;
      bush.castShadow = true;
      scene.add(bush);
      bushes++;
    } else if (deads < 10) {
      // 枯树（战火烧毁）
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 2.4 + rnd() * 1.4, 5), deadMat);
      trunk.position.set(x, g + 1.3, z);
      trunk.rotation.z = (rnd() - 0.5) * 0.3;
      trunk.rotation.x = (rnd() - 0.5) * 0.3;
      trunk.castShadow = true;
      scene.add(trunk);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 1.0, 4), deadMat);
      branch.position.set(x + 0.2, g + 2.4, z + 0.1);
      branch.rotation.z = 0.9;
      branch.castShadow = true;
      scene.add(branch);
      deads++;
    }
  }

  // 远景山
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x5c6a4e, roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.ConeGeometry(60 + (i % 4) * 26, 30 + (i % 3) * 22, 7), mountainMat);
    m.position.set(Math.cos(a) * 330, 8, Math.sin(a) * 330);
    m.rotation.y = rnd() * 6;
    scene.add(m);
  }

  // ================= 营地细节：帐篷 / 战壕木板 / 电线杆 =================
  // 帐篷（三角锥 + 门洞，帆布色）
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x8a8a72, roughness: 1, side: THREE.DoubleSide });
  const tentDark = new THREE.MeshStandardMaterial({ color: 0x2a2a24, roughness: 1 });
  function addTent(x, z, rotY = 0) {
    const g = groundHeight(x, z);
    const t = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.8, 3, 1, true), tentMat);
    body.position.y = 0.9;
    body.rotation.y = rotY;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), tentDark);
    pole.position.y = 0.95;
    t.add(body, pole);
    t.position.set(x, g, z);
    t.traverse(m => { m.castShadow = true; });
    scene.add(t);
    map.colliders.push({ x, y: g + 0.7, z, w: 3.0, h: 1.4, d: 2.6 });
  }
  addTent(-144, -176, 0.5);
  addTent(-134, -172, 2.1);
  addTent(146, -8, 1.3);
  addTent(-12, 40, 0.2);

  // 战壕内木板路（沿战壕中线铺设）
  const phW = (tex.ph && tex.ph.wood && tex.ph.wood.map) || null;
  const plankMat = new THREE.MeshStandardMaterial({ map: phW, color: 0x8a6a42, roughness: 0.9 });
  for (const [x1, z1, x2, z2] of trenchSections) {
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    const steps = Math.ceil(len / 3);
    const dx = (x2 - x1) / steps, dz = (z2 - z1) / steps;
    for (let i = 0; i < steps; i++) {
      const px = x1 + dx * (i + 0.5), pz = z1 + dz * (i + 0.5);
      const g = groundHeight(px, pz);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 3.1), plankMat);
      plank.position.set(px, g + 0.05, pz);
      plank.rotation.y = Math.atan2(dx, dz);
      plank.receiveShadow = true;
      scene.add(plank);
    }
  }

  // 电线杆（沿道路）
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3c2c, roughness: 0.9 });
  const wireMat2 = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7 });
  const roadPoles = [[-150, -150], [-120, -150], [-90, -150], [-60, -150], [-30, -150], [0, -150], [0, -120], [0, -90], [0, -60], [0, -30], [0, 0], [0, 30]];
  for (const [px, pz] of roadPoles) {
    const g = groundHeight(px, pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.2, 6), poleMat);
    pole.position.set(px, g + 2.6, pz);
    pole.castShadow = true;
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.07), poleMat);
    arm.position.set(px, g + 4.6, pz);
    scene.add(arm);
    map.colliders.push({ x: px, y: g + 2.6, z: pz, w: 0.3, h: 5.2, d: 0.3 });
  }
  // 电线（相邻杆之间）
  for (let i = 0; i < roadPoles.length - 1; i++) {
    const [x1, z1] = roadPoles[i], [x2, z2] = roadPoles[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const g1 = groundHeight(x1, z1), g2 = groundHeight(x2, z2);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 4), wireMat2);
    wire.rotation.set(Math.PI / 2, Math.atan2(x2 - x1, z2 - z1), 0);
    wire.position.set((x1 + x2) / 2, (g1 + g2) / 2 + 4.6, (z1 + z2) / 2);
    scene.add(wire);
  }

  // 刷怪点（边缘）
  map.enemySpawns = [
    new THREE.Vector3(-180, 0, -180), new THREE.Vector3(180, 0, -180),
    new THREE.Vector3(-180, 0, 180), new THREE.Vector3(180, 0, 180),
    new THREE.Vector3(0, 0, -192), new THREE.Vector3(0, 0, 192),
    new THREE.Vector3(-192, 0, 30), new THREE.Vector3(192, 0, -20),
    new THREE.Vector3(-160, 0, 140), new THREE.Vector3(150, 0, 120),
  ];

  return map;
}
