// ============================================================
// maps/arena.js — 竞技地图「沙漠街区」（dust2 风格）
// 对称攻防：中路长通道 + A 大道 + B 隧道，A/B 双目标点
// ============================================================
import * as THREE from 'three';

export function buildArenaMap(scene, tex) {
  const map = {
    name: '沙漠街区',
    bounds: [-48, 48, -36, 36],
    colliders: [],
    enemySpawns: [],
    playerSpawn: new THREE.Vector3(-12, 0, 31),
    playerSpawnYaw: 0,
    objectives: [],
    supplyPoints: [],
    groundHeight: () => 0,
  };

  // PBR 材质容错（tex.ph 由 main.js 注入，测试/降级环境可能缺失）
  const ph = tex.ph || {};
  const phMat = (name, fallback) => (ph[name] && ph[name].map ? ph[name] : fallback);

  const materials = {
    brick: new THREE.MeshStandardMaterial({ map: tex.brick, bumpMap: tex.brickBump, roughnessMap: tex.brickRough, roughness: 0.92, bumpScale: 0.5 }),
    concrete: phMat('concrete', new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9 })),
    sand: phMat('sand', new THREE.MeshStandardMaterial({ map: tex.sand, roughness: 0.95, color: 0xa89b82, envMapIntensity: 0.5 })),
    metal: phMat('metal', new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.55, metalness: 0.55 })),
    wood: phMat('wood', new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.8 })),
    sandbag: new THREE.MeshStandardMaterial({ map: tex.tarp, color: 0xb0a078, roughness: 1 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x33373c, metalness: 0.7, roughness: 0.5 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x3d4a35, metalness: 0.5, roughness: 0.6 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.85 }),
    flagRed: new THREE.MeshStandardMaterial({ map: tex.flagRed, side: THREE.DoubleSide, roughness: 0.8 }),
    flagBlue: new THREE.MeshStandardMaterial({ map: tex.flagBlue, side: THREE.DoubleSide, roughness: 0.8 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fb8c8, metalness: 0.1, roughness: 0.15, transparent: true, opacity: 0.55 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xf5e6c0, emissive: 0xffd98a, emissiveIntensity: 1.4 }),
    faded: new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.95 }),
  };

  // ---------- 辅助 ----------
  function addBox(x, y, z, w, h, d, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (collide) map.colliders.push({ x, y, z, w, h, d });
    return m;
  }
  function addCyl(x, y, z, r, h, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    map.colliders.push({ x, y, z, w: r * 2, h, d: r * 2 });
    return m;
  }
  // 墙体。gap=[a1,a2] 为沿墙轴的门洞区间（门宽 a2-a1）
  function addWall(x1, z1, x2, z2, h, mat, opts = {}) {
    const { collide = true, thick = 0.5, gap = null } = opts;
    const segs = [];
    if (x1 === x2) {
      // 沿 z 的墙
      if (gap) {
        const [a1, a2] = gap;
        if (a1 - z1 > 0.1) segs.push([x1, z1, x1, a1]);
        if (z2 - a2 > 0.1) segs.push([x1, a2, x1, z2]);
      } else segs.push([x1, z1, x1, z2]);
    } else {
      // 沿 x 的墙
      if (gap) {
        const [a1, a2] = gap;
        if (a1 - x1 > 0.1) segs.push([x1, z1, a1, z1]);
        if (x2 - a2 > 0.1) segs.push([a2, z1, x2, z1]);
      } else segs.push([x1, z1, x2, z1]);
    }
    for (const [ax, az, bx, bz] of segs) {
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const w = Math.abs(bx - ax) + thick, d = Math.abs(bz - az) + thick;
      addBox(cx, h / 2, cz, w, h, d, mat, collide);
    }
  }
  // 箱子堆（instanced，节省 draw call）
  function addCrates(points, size = 1.15) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), materials.crate, points.length);
    const m4 = new THREE.Matrix4();
    points.forEach((p, i) => {
      // 先旋转再写入位移；makeRotationY 会重置矩阵中的平移分量。
      m4.makeRotationY(p[3] || 0);
      m4.setPosition(p[0], p[1] + size / 2, p[2]);
      inst.setMatrixAt(i, m4);
      map.colliders.push({ x: p[0], y: p[1] + size / 2, z: p[2], w: size, h: size, d: size });
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  }
  function addObjective(name, x, z, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.08, z);
    scene.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.2, 8), materials.darkMetal);
    pole.position.set(x, 2.6, z);
    pole.castShadow = true;
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), color === 0x50d0ff ? materials.flagBlue : materials.flagRed);
    flag.position.set(x + 0.78, 4.9, z);
    flag.castShadow = true;
    scene.add(flag);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
    );
    beacon.position.set(x, 4.2, z);
    scene.add(beacon);
    map.objectives.push({ name, pos: new THREE.Vector3(x, 0, z), radius: 3.0, captured: false, ring, flag, beacon });
  }

  // 沙袋墙（优先用下载的沙袋模型，回退程序化）
  function addSandbagWall(x1, z1, x2, z2, h = 1.2) {
    const sm = tex.sceneModels && tex.sceneModels.sandbag;
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    const steps = Math.max(1, Math.round(len / 1.15));
    const dx = (x2 - x1) / steps, dz = (z2 - z1) / steps;
    const ang = Math.atan2(dx, dz);
    for (let i = 0; i < steps; i++) {
      const px = x1 + dx * (i + 0.5), pz = z1 + dz * (i + 0.5);
      if (sm) {
        const m = sm.clone();
        m.position.set(px, 0.05, pz);
        m.rotation.y = ang;
        scene.add(m);
      } else {
        addBox(px, h / 2, pz, 1.5, h, 0.8, materials.sandbag, false, ang);
      }
      map.colliders.push({ x: px, y: h / 2, z: pz, w: 1.7, h, d: 1.0 });
    }
  }

  // ---------- 地面 ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), materials.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  materials.sand.map.repeat.set(12, 9);

  // ---------- 外墙（南北留中门） ----------
  const WALL_H = 5;
  addWall(-48, -36, -48, 36, WALL_H, materials.brick, { thick: 0.6 });
  addWall(48, -36, 48, 36, WALL_H, materials.brick, { thick: 0.6 });
  addWall(-48, -36, 48, -36, WALL_H, materials.brick, { thick: 0.6, gap: [-4, 4] });
  addWall(-48, 36, 48, 36, WALL_H, materials.brick, { thick: 0.6, gap: [-4, 4] });

  // ---------- 中路（x∈[-4,4] 畅通） ----------
  // 中路两侧建筑（掩体 + 阻断横穿）
  addBox(-10, 2, 0, 8, 4, 10, materials.concrete);
  addBox(10, 2, 0, 8, 4, 10, materials.concrete);
  // 中路箱子（对狙位）
  addCrates([[0, 0, -13, 0], [-3.2, 0, -17, 0.5], [3.4, 0, -19, 0.9], [0, 0, -24, 0]]);
  addCrates([[0, 0, 13, 0], [3, 0, 17, 0.4], [-3.4, 0, 19, 0.8]]);
  // 中路两端沙袋墙（可跳跃越过）
  addSandbagWall(-4, -30.5, 4, -30.5, 1.2);
  addSandbagWall(-4, 30.5, 4, 30.5, 1.2);

  // ---------- A 大道（x∈[-36,-30] 南北通道） ----------
  addWall(-36, -36, -36, 12, 4, materials.brick, { thick: 0.5, gap: [-24, -20] }); // 西墙，中段开门通 A 点区
  // 西建筑（A 大道与中路之间，实心）
  addBox(-23, 2, -2, 10, 4, 12, materials.concrete);
  // 小巷用箱子堵住
  addCrates([[-29, 0, -2, 0], [-29.3, 0, 0.5, 0.9]]);

  // ---------- A 点区（x∈[-48,-36], z∈[-30,-14] 开阔地） ----------
  // 高台（1.5m，带台阶）
  addBox(-38, 0.75, -24, 6, 1.5, 6, materials.concrete);
  addBox(-38, 0.375, -27.6, 6, 0.75, 1.3, materials.concrete);
  // 掩体箱子
  addCrates([[-34, 0, -16, 0], [-44, 0, -18, 0.4], [-42, 0, -26, 0.9], [-34, 0, -28, 0.2], [-44.5, 0, -24, 0.6]]);
  // A 点北侧沙袋
  addSandbagWall(-44, -30, -36, -30, 1.2);

  // ---------- B 通道（x∈[30,36]） ----------
  addWall(38, -36, 38, 12, 4, materials.brick, { thick: 0.5 }); // 东墙
  addBox(23, 2, -2, 10, 4, 12, materials.concrete);            // 东建筑（B 通道与中路之间）
  addCrates([[29, 0, -2, 0], [29.3, 0, 0.5, 0.9]]);             // 小巷封堵

  // ---------- B 房（x 24..40, z -26..-14，南门） ----------
  addWall(24, -14, 40, -14, 3.5, materials.brick, { thick: 0.5, gap: [30, 34] });
  addWall(24, -26, 40, -26, 3.5, materials.brick, { thick: 0.5 });
  addWall(24, -26, 24, -14, 3.5, materials.brick, { thick: 0.5 });
  addWall(40, -26, 40, -14, 3.5, materials.brick, { thick: 0.5 });
  addCrates([[28.5, 0, -21, 0.2], [33, 0, -23, 0.7], [36, 0, -18.5, 0.1], [30, 0, -16.5, 0.5]]);
  // 房内沙袋
  addSandbagWall(28.5, -15.2, 35.5, -15.2, 1.2);

  // ---------- 出生点遮挡 ----------
  addSandbagWall(-22, 27, -2, 27, 2.4);
  addSandbagWall(2, 27, 22, 27, 2.4);
  addBox(-8, 1.2, 25, 4, 2.4, 4, materials.concrete);
  addBox(8, 1.2, 25, 4, 2.4, 4, materials.concrete);
  addSandbagWall(-22, -27, -2, -27, 2.4);
  addSandbagWall(2, -27, 22, -27, 2.4);
  addBox(-8, 1.2, -25, 4, 2.4, 4, materials.concrete);
  addBox(8, 1.2, -25, 4, 2.4, 4, materials.concrete);

  // ---------- 装饰 ----------
  const barrelPos = [[-40, -33], [40, -33], [-44, 30], [44, 30], [-14, -20], [14, 22], [14, -24], [-14, 24], [-6, 8], [6, -8], [-20, 15], [20, 15]];
  for (const [bx, bz] of barrelPos) addCyl(bx, 0.5, bz, 0.32, 1.0, materials.barrel);
  // 金属板掩体（中路南端两侧）
  addBox(-16, 1.1, 12, 0.15, 2.2, 3.2, materials.metal);
  addBox(16, 1.1, 12, 0.15, 2.2, 3.2, materials.metal);
  addBox(-16, 1.1, 20, 0.15, 2.2, 2, materials.metal);
  addBox(16, 1.1, 20, 0.15, 2.2, 2, materials.metal);

  // ---------- 车辆（废弃吉普） ----------
  function addJeep(x, z, yaw, color) {
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.35 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 4.2), bodyMat);
    chassis.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 1.9), bodyMat);
    cabin.position.set(0, 1.05, -0.1);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.5, 1.8), materials.glass);
    glass.position.set(0, 1.08, -0.1);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.4), bodyMat);
    hood.position.set(0, 0.82, 1.3);
    const rollbar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 1.9), materials.darkMetal);
    rollbar.position.set(0, 1.3, 0.7);
    car.add(chassis, cabin, glass, hood, rollbar);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-1.05, 1.35], [1.05, 1.35], [-1.05, -1.35], [1.05, -1.35]]) {
      const w = new THREE.Mesh(wheelGeo, materials.tire);
      w.position.set(wx, 0.34, wz);
      car.add(w);
    }
    car.position.set(x, 0, z);
    car.rotation.y = yaw;
    car.traverse(m => { m.castShadow = true; m.receiveShadow = true; });
    scene.add(car);
    map.colliders.push({ x, y: 0.6, z, w: 2.3, h: 1.2, d: 4.6 });
    return car;
  }
  addJeep(-44, 8, 1.2, 0x5a6b3c);
  addJeep(44, -4, -0.7, 0x6b5a3c);
  addJeep(-18, -33, 0.4, 0x4c5a6b);

  // ---------- 路灯 ----------
  function addLamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.4, 8), materials.darkMetal);
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), materials.darkMetal);
    arm.position.set(x, 5.35, z);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), materials.lamp);
    lamp.position.set(x, 5.15, z + 0.75);
    scene.add(pole, arm, lamp);
    map.colliders.push({ x, y: 2.7, z, w: 0.3, h: 5.4, d: 0.3 });
  }
  addLamp(-26, 6);
  addLamp(26, 6);
  addLamp(-26, -6);
  addLamp(26, -6);

  // ---------- 广告牌 ----------
  function addBillboard(x, z, yaw) {
    const bg = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.12), materials.faded);
    bg.position.set(0, 1.2, 0);
    const legs = [
      new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), materials.darkMetal),
      new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), materials.darkMetal),
    ];
    legs[0].position.set(-1.9, 1.2, 0);
    legs[1].position.set(1.9, 1.2, 0);
    const board = new THREE.Group();
    board.add(bg, ...legs);
    board.position.set(x, 0, z);
    board.rotation.y = yaw;
    board.traverse(m => { m.castShadow = true; });
    scene.add(board);
    map.colliders.push({ x, y: 1.2, z, w: 4.6, h: 2.5, d: 0.5 });
    return board;
  }
  addBillboard(-33, 14, Math.PI / 2);
  addBillboard(33, -14, -Math.PI / 2);

  // ---------- 轮胎堆 ----------
  function addTires(x, z, n = 2) {
    const tireGeo = new THREE.TorusGeometry(0.42, 0.14, 8, 16);
    for (let i = 0; i < n; i++) {
      const t = new THREE.Mesh(tireGeo, materials.tire);
      t.position.set(x, 0.14 + i * 0.28, z);
      t.rotation.y = Math.random() * 3;
      t.castShadow = true;
      scene.add(t);
    }
    map.colliders.push({ x, y: 0.28 * n / 2, z, w: 1.0, h: 0.28 * n, d: 1.0 });
  }
  addTires(-27, 22, 3);
  addTires(27, -22, 2);
  addTires(-27, -22, 2);

  // ---------- 外墙铁丝网 ----------
  function addFenceLine(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.ceil(len / 2.2);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), materials.darkMetal);
      post.position.set(x, 1.1, z);
      post.castShadow = true;
      scene.add(post);
    }
    // 两根横杆
    for (const h of [0.6, 1.4]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), materials.darkMetal);
      bar.rotation.set(Math.PI / 2, Math.atan2(x2 - x1, z2 - z1), 0);
      bar.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
      scene.add(bar);
    }
    map.colliders.push({ x: (x1 + x2) / 2, y: 1.1, z: (z1 + z2) / 2, w: Math.abs(x2 - x1) + 0.3, h: 2.2, d: Math.abs(z2 - z1) + 0.3 });
  }
  addFenceLine(-47, -14, -47, 14);
  addFenceLine(47, -14, 47, 14);

  // ---------- Kenney 道具（路障锥/车残骸/货箱，CC0） ----------
  const sm = tex.sceneModels || {};
  function placeModel(modelKey, x, z, rotY = 0, scale = 1) {
    const m = sm[modelKey];
    if (!m) return;
    const inst = m.clone();
    inst.position.set(x, 0.03, z);
    inst.rotation.y = rotY;
    inst.scale.multiplyScalar(scale);
    scene.add(inst);
  }
  // 路障锥：道路与掩体旁
  const conePos = [[-4, 6], [4, -6], [-4, -14], [4, 14], [-30, 4], [30, -4], [-12, 20], [12, -20], [-28, -12], [28, 12], [0, 26], [0, -26]];
  for (const [cx, cz] of conePos) placeModel('cone', cx, cz, Math.random() * 3);
  // 车残骸（轮胎/车门等散件）：战场角落
  const debrisPos = [[-44, 26, 0.8], [44, -26, 1.2], [-45, -8, 2], [45, 8, 0.4], [-30, 30, 1.6], [30, -30, 0.6]];
  for (const [dx, dz, s] of debrisPos) placeModel('debris', dx, dz, Math.random() * 3, s);
  // 货箱：A/B 点附近
  const cratePos = [[-46, -20, 0.5], [46, -16, 1.1], [-40, 20, 0.8], [40, -22, 1.4]];
  for (const [cx2, cz2, s2] of cratePos) placeModel('crate', cx2, cz2, Math.random() * 3, s2);

  // ---------- 目标点 ----------
  addObjective('A 点', -38, -22, 0x50d0ff);
  addObjective('B 点', 32, -20, 0xffb050);

  // ---------- 出生/刷怪 ----------
  map.playerSpawn = new THREE.Vector3(-12, 0, 31);
  map.playerSpawnYaw = 0;
  map.enemySpawns = [
    new THREE.Vector3(-6, 0, -28), new THREE.Vector3(6, 0, -28), new THREE.Vector3(0, 0, -30),
    new THREE.Vector3(-14, 0, -26), new THREE.Vector3(14, 0, -26),
    new THREE.Vector3(-40, 0, -28), new THREE.Vector3(40, 0, -28),
    new THREE.Vector3(-24, 0, 24), new THREE.Vector3(24, 0, 24),
  ];
  // 弹药补给点
  const supply = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), materials.crate);
  supply.position.set(-12, 0.45, 27.5);
  supply.castShadow = true;
  scene.add(supply);
  map.supplyPoints = [{ pos: new THREE.Vector3(-12, 0, 27.5), mesh: supply }];

  // 远景（沙漠远山）
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x9c7a52, roughness: 1, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 165;
    const m = new THREE.Mesh(new THREE.ConeGeometry(28 + (i % 3) * 14, 18 + (i % 4) * 14, 6), mountainMat);
    m.position.set(Math.cos(a) * r, 7, Math.sin(a) * r);
    m.rotation.y = Math.random() * 6;
    scene.add(m);
  }

  return map;
}

