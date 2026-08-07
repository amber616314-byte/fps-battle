// ============================================================
// main.js — 游戏入口：渲染、主循环、射线物理、状态机
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { HDRLoader } from '../vendor/jsm/loaders/HDRLoader.js';
import * as TEX from './tex.js';
import { audio } from './audio.js';
import { FX } from './fx.js';
import { WeaponSystem, loadGunModels } from './weapons.js';
import { OBJLoader } from '../vendor/jsm/loaders/OBJLoader.js';
import { Player } from './player.js';
import { Enemy, WaveManager, rayAABB, raySphere } from './enemy.js';
import { HUD } from './hud.js';
import { buildArenaMap } from './maps/arena.js';
import { buildBattlefieldMap } from './maps/battlefield.js';
import { Ally } from './allies.js';
import { Vehicle } from './vehicles.js';
import { BattlefieldDirector } from './battlefield_mode.js';
import { GridNavigator } from './navigation.js';

// ============================================================
// 资源加载
// ============================================================
const TEXTURE_URLS = {
  brick: 'assets/textures/brick_diffuse.jpg',
  brickBump: 'assets/textures/brick_bump.jpg',
  brickRough: 'assets/textures/brick_roughness.jpg',
  grass: 'assets/textures/terrain_grasslight-big.jpg',
  decal: 'assets/textures/decal_decal-diffuse.png',
  hdr: 'assets/textures/equirectangular_spruit_sunrise_1k.hdr',
  // Poly Haven PBR（CC0）：混凝土 / 集装箱金属 / 木板 / 沙滩
  phConcreteDiff: 'assets/textures/ph/brushed_concrete_03_diff.jpg',
  phConcreteRough: 'assets/textures/ph/brushed_concrete_03_rough.jpg',
  phConcreteNorm: 'assets/textures/ph/brushed_concrete_03_nor_gl.jpg',
  phMetalDiff: 'assets/textures/ph/container_side_diff.jpg',
  phMetalRough: 'assets/textures/ph/container_side_rough.jpg',
  phMetalNorm: 'assets/textures/ph/container_side_nor_gl.jpg',
  phWoodDiff: 'assets/textures/ph/brown_planks_03_diff.jpg',
  phWoodRough: 'assets/textures/ph/brown_planks_03_rough.jpg',
  phWoodNorm: 'assets/textures/ph/brown_planks_03_nor_gl.jpg',
  phSandDiff: 'assets/textures/ph/coast_sand_02_diff.jpg',
  phSandRough: 'assets/textures/ph/coast_sand_02_rough.jpg',
  phSandNorm: 'assets/textures/ph/coast_sand_02_nor_gl.jpg',
};

// 场景装饰模型（下载的 OBJ：沙袋/卡车/道具，失败返回空对象不影响游戏）
async function loadSceneModels() {
  const loader = new OBJLoader();
  const texLoader = new THREE.TextureLoader();
  const out = {};
  const load = async (rel, opts = {}) => {
    const { scale = 1, rotY = 0, color = null, tex = null, mark = null, key = null } = opts;
    try {
      const r = await fetch(rel);
      if (!r.ok) return null;
      const obj = loader.parse(await r.text());
      obj.scale.setScalar(scale);
      obj.rotation.y = rotY;
      if (mark) obj.userData[mark] = true;
      if (key) obj.userData.fromSceneModel = key;
      obj.traverse(ch => {
        if (ch.isMesh) {
          ch.material = new THREE.MeshStandardMaterial({ color: color || 0x8a8d90, roughness: 0.8, metalness: 0.25 });
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      if (tex) {
        texLoader.load(tex, t => {
          t.colorSpace = THREE.SRGBColorSpace;
          obj.traverse(ch => { if (ch.isMesh) { ch.material.map = t; ch.material.needsUpdate = true; } });
        }, undefined, () => {});
      }
      return obj;
    } catch { return null; }
  };
  const kc = 'assets/models/kenney_car/Models/OBJ format/';
  const ki = 'assets/models/kenney_city/Models/OBJ format/';
  out.sandbag = await load('assets/models/sandbags/sandbag_model.obj', { scale: 0.28, color: 0xa89a70, tex: 'assets/models/sandbags/sandbag_diffuse.png', mark: 'isSandbagModel' });
  out.jeepModel = await load(kc + 'truck.obj', { rotY: Math.PI, tex: kc + 'Textures/colormap.png', key: 'jeepModel' });
  out.cone = await load(kc + 'cone.obj', { color: 0xe07030, key: 'cone' });
  out.crate = await load(kc + 'box.obj', { color: 0x8a6a3c, key: 'crate' });
  out.debris = await load(kc + 'debris-tire.obj', { color: 0x2a2d30, key: 'debris' });
  out.chimney = await load(ki + 'chimney-medium.obj', { color: 0x8a4a3a, key: 'chimney' });
  out.tank = await load(ki + 'detail-tank.obj', { tex: ki + 'Textures/colormap.png', key: 'tank' });
  out.building = await load(ki + 'building-a.obj', { tex: ki + 'Textures/colormap.png', key: 'building' });
  return out;
}

async function loadAssets(hud, renderer) {
  const loader = new THREE.TextureLoader();
  const rgb = new HDRLoader();
  const out = {};
  let done = 0;
  const total = Object.keys(TEXTURE_URLS).length;
  const tick = (name, t) => { out[name] = t; done++; hud.setLoading(done / total, `正在载入战场资源 ${name}…`); };
  // 15 秒超时兜底，避免单个资源卡死加载画面
  const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  // 纹理（hdr 由 RGBELoader 单独加载，TextureLoader 无法解析）
  const urls = Object.entries(TEXTURE_URLS).filter(([name]) => name !== 'hdr');
  const results = await Promise.all(urls.map(([name, url]) =>
    withTimeout(loader.loadAsync(url)).then(t => ({ name, t })).catch(() => ({ name, t: null }))
  ));
  for (const { name, t } of results) {
    if (t) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(16, renderer?.capabilities?.getMaxAnisotropy?.() || 8);
      if (name === 'brick' || name === 'brickBump' || name === 'brickRough') t.wrapS = t.wrapT = THREE.RepeatWrapping;
      tick(name, t);
    } else tick(name, null);
  }
  // HDR 环境
  try {
    const hdr = await withTimeout(rgb.loadAsync(TEXTURE_URLS.hdr));
    if (hdr) tick('hdr', hdr); else tick('hdr', null);
  } catch { tick('hdr', null); }
  void total;
  return out;
}

// ============================================================
// 主游戏类
// ============================================================
class Game {
  constructor() {
    this.state = 'loading';
    this.mode = 'arena';
    this.kills = 0;
    this.headshots = 0;
    this.lives = 3;
    this.time = 0;
    this.enemies = [];
    this.projectiles = [];
    this.ammoPacks = [];
    this.heardShot = null;
    this.interactHint = null;
    this.deaths = 0;
    this.bomb = null;      // 爆破：{ obj, mesh, pos, timer, defuseT }
    this.planting = null;  // 下包进度：{ obj, t }
    this.bombRound = null; // 真正的单回合爆破任务，不使用波次系统

    // 渲染器
    const container = document.getElementById('game-container');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.045, 1200);
    this.scene.add(this.camera);

    // 光照
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x9a7f5a, 0.34);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b0, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 后期
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.045, 0.42, 1.02);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.hud = new HUD();
    this.hud.onStart = m => this.startGame(m);
    this.hud.onResume = () => this.resume();
    this.hud.onRestart = () => this.restart();
    this.hud.onQuit = () => this.quitToMenu();
    this.hud.onRespawn = () => this.respawnPlayer();
    this.hud.onContinue = () => this.continueEndless();

    this.audio = audio; // 供 player/enemy 等通过 this.game.audio 访问

    // 输入
    this.input = {
      move: new THREE.Vector2(),
      jump: false, sprint: false, crouch: false,
      fire: false, ads: false,
    };
    this.keys = new Set();
    this.bindEvents();
  }

  // ---------- 事件 ----------
  bindEvents() {
    addEventListener('keydown', e => {
      if (this.state === 'menu' || this.state === 'paused') return;
      const k = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyC', 'KeyR', 'KeyG', 'KeyE', 'KeyQ', 'KeyV', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyM'].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === 'KeyR' && this.state === 'playing') this.weapons.startReload();
      if (k === 'KeyG' && this.state === 'playing') this.weapons.tryThrowGrenade(this, this.player);
      if (k === 'KeyE' && this.state === 'playing') this.interact();
      if (k === 'KeyQ' && this.state === 'playing') this.weapons.quickSwitch();
      if (k === 'KeyV' && this.state === 'playing') this.weapons.inspect();
      if (k === 'KeyM') document.getElementById('minimap-wrap').classList.toggle('hidden');
      if (k === 'Digit1') this.weapons.switchTo(0);
      if (k === 'Digit2') this.weapons.switchTo(1);
      if (k === 'Digit3') this.weapons.switchTo(2);
      if (k === 'Digit4') this.weapons.switchTo(3);
      if (k === 'Escape' && this.state === 'playing') this.pause();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    // 滚轮切换武器（CS 风格）
    addEventListener('wheel', e => {
      if (this.state !== 'playing' || !document.pointerLockElement) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const n = this.weapons.slots.length;
      this.weapons.switchTo((this.weapons.current + dir + n) % n);
    }, { passive: false });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement && this.state === 'playing') {
        this.player.mouseDX += e.movementX;
        this.player.mouseDY += e.movementY;
      }
    });
    addEventListener('mousedown', e => {
      if (this.state !== 'playing' || !document.pointerLockElement) return;
      if (e.button === 0) this.input.fire = true;
      if (e.button === 2) {
        this.input.ads = true;
        // 驾驶时右键属于载具副武器，不再误触步兵武器开镜状态。
        if (this.driving) return;
        if (this.mode === 'arena') {
          // CS 风格：仅狙击枪右键切换镜头；步枪/手枪无开镜功能。
          if (this.weapons.def?.type === 'sniper') this.weapons.toggleADS();
        } else {
          // 战场风格：右键按住机械瞄具/瞄准镜。
          this.weapons.setADS(true);
        }
      }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.input.fire = false;
      if (e.button === 2) {
        this.input.ads = false;
        if (!this.driving && this.mode === 'battlefield') this.weapons.setADS(false);
      }
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing') this.pause();
    });
    this.hud.sensSlider.addEventListener('input', () => {
      this.player.sens = parseFloat(this.hud.sensSlider.value);
    });
  }

  // ---------- 地图构建 ----------
  async init() {
    try {
      await this._initInternal();
    } catch (err) {
      // 初始化失败：把具体错误显示到加载画面，便于诊断
      console.error('游戏初始化失败:', err);
      const el = document.getElementById('loading-error');
      if (el) {
        el.classList.remove('hidden');
        el.textContent = '初始化失败: ' + (err && err.message ? err.message : String(err)) + '（请确认浏览器支持 WebGL 并开启硬件加速）';
      }
    }
  }

  async _initInternal() {
    this.hud.setLoading(0, '正在初始化渲染引擎…');
    const tex = await loadAssets(this.hud, this.renderer);
    // 程序纹理
    tex.sand = TEX.texSand(10);
    tex.concrete = TEX.texConcrete(3);
    tex.metal = TEX.texMetal(2.5);
    tex.wood = TEX.texWood(1.5);
    tex.tarp = TEX.texTarp(2);
    tex.dirt = TEX.texDirt(6);
    tex.flagRed = TEX.texFlag([190, 45, 40]);
    tex.flagBlue = TEX.texFlag([50, 140, 220]);

    // Poly Haven PBR 材质（重复包裹 + 法线/粗糙度贴图；color 用于压暗过亮贴图；bump 用于视差感）
    const mkPBR = (diff, rough, norm, repX = 1, repY = 1, color = null, bumpTex = null) => {
      const d = tex[diff], r = tex[rough], n = tex[norm];
      const mat = new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.5, metalness: 0 });
      if (color) mat.color.setHex(color);
      if (d) { d.wrapS = d.wrapT = THREE.RepeatWrapping; d.repeat.set(repX, repY); mat.map = d; }
      if (r) { r.wrapS = r.wrapT = THREE.RepeatWrapping; r.repeat.set(repX, repY); mat.roughnessMap = r; }
      if (n) { n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(repX, repY); mat.normalMap = n; }
      if (bumpTex) { mat.bumpMap = bumpTex; mat.bumpScale = 0.022; }
      return mat;
    };
    tex.ph = {
      concrete: mkPBR('phConcreteDiff', 'phConcreteRough', 'phConcreteNorm', 2, 2, 0xbfc4c8),
      metal: mkPBR('phMetalDiff', 'phMetalRough', 'phMetalNorm', 1, 1, 0xc2c6ca),
      wood: mkPBR('phWoodDiff', 'phWoodRough', 'phWoodNorm', 1, 1, 0xbfb29a),
      // 地面：纯哑光（不用 roughnessMap——其亮区会拉低粗糙度产生镜面反光），bump 视差凹凸
      sand: mkPBR('phSandDiff', null, null, 12, 9, 0x94886e, TEX.texBump(12, 9, 77)),
    };
    // 地面材质彻底去镜面感
    tex.ph.sand.roughness = 1;
    tex.ph.sand.envMapIntensity = 0;
    tex.ph.sand.metalness = 0;
    // 下载的场景装饰模型（沙袋等）
    tex.sceneModels = await loadSceneModels();
    this.tex = tex;

    // 环境
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    if (tex.hdr) {
      const rt = this.pmrem.fromEquirectangular(tex.hdr);
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.44; // 保留环境反射，但避免阴影区武器仍像自发光
    } else {
      const sky = TEX.texSky();
      const rt = this.pmrem.fromEquirectangular(sky);
      this.scene.environment = rt.texture;
      this.scene.background = sky;
    }

    this.fx = new FX(this.scene);
    this.fx.groundHeight = (x, z) => this.map ? this.map.groundHeight(x, z) : 0;
    if (tex.decal) this.fx.setDecalTexture(tex.decal);

    // 预构建竞技图做菜单背景
    this.buildMap('arena');
    this.state = 'menu';
    this.hud.setLoading(1, '就绪');
    setTimeout(() => document.getElementById('loading').classList.add('hidden'), 200);
    this.hud.showMenu();
    this.loop();
  }

  buildMap(mode) {
    this.mode = mode;
    // 清理旧场景（保留 camera/灯光）
    const keep = new Set([this.camera, this.hemi, this.sun, this.sun.target]);
    for (const obj of [...this.scene.children]) {
      if (!keep.has(obj)) {
        this.scene.remove(obj);
        obj.traverse?.(ch => { ch.geometry?.dispose?.(); if (ch.material) { Array.isArray(ch.material) ? ch.material.forEach(m => m.dispose?.()) : ch.material.dispose?.(); } });
      }
    }
    if (this.fx) this.fx.clear();
    if (this.enemies) this.enemies.forEach(e => e.remove());
    if (this.allies) this.allies.forEach(a => a.remove());
    this.enemies = [];
    this.projectiles = [];
    this.ammoPacks = [];
    this.allies = [];
    // 爆破清理
    if (this.bomb) { this.scene.remove(this.bomb.mesh); this.bomb = null; }
    this.planting = null;
    this.bombRound = null;

    // 地图
    this.map = mode === 'battlefield'
      ? buildBattlefieldMap(this.scene, this.tex)
      : buildArenaMap(this.scene, this.tex);
    // 地图碰撞体生成完毕后构建共享导航网格。
    this.navigator = new GridNavigator(this.map, mode === 'battlefield' ? 4 : 2.4, 0.45);
    // 地面载具使用独立的大半径导航网格，避免坦克/吉普沿步兵窄路卡入建筑。
    this.vehicleNavigator = mode === 'battlefield' ? new GridNavigator(this.map, 6, 2.55) : null;
    audio.setSurface(mode === 'battlefield' ? 'grass' : 'concrete');

    // 天空与雾
    if (this.scene.environment) {
      // HDR 环境保留
    }
    this.scene.background = TEX.texSky();
    if (mode === 'battlefield') {
      this.scene.fog = new THREE.FogExp2(0xa8ab9a, 0.0026);
    } else {
      this.scene.fog = new THREE.Fog(0xd9c8a8, 70, 170);
    }

    // 太阳方向
    const sunDir = mode === 'battlefield'
      ? new THREE.Vector3(0.5, 0.75, 0.25)
      : new THREE.Vector3(-0.45, 0.8, 0.3);
    this.sun.position.copy(this.player ? this.player.pos : this.map.playerSpawn).add(sunDir.multiplyScalar(120));
    this.sun.target.position.copy(this.player ? this.player.pos : this.map.playerSpawn);
    this.sun.target.updateMatrixWorld();

    // 玩家/武器
    if (!this.player) {
      this.player = new Player(this);
      this.weapons = new WeaponSystem(this.camera, this.scene, audio, this.fx);
      // 异步加载下载的枪械建模（CC0），完成后热替换程序化模型
      loadGunModels().then(m => this.weapons.setModels(m)).catch(() => {});
    }
    this.weapons.setGameplayMode(mode);
    this.player.respawn(this.map.playerSpawn, this.map.playerSpawnYaw);
    this.player.sens = parseFloat(this.hud.sensSlider.value);

    // 旧 WaveManager 仅为兼容测试/旧存档保留；爆破模式不再启动或更新波次。
    if (!this.waves) this.waves = new WaveManager(this);
    this.waves.totalWaves = 0;
    this.waves.state = 'idle';
    this.waves.completed = false;
    const es = (this.options && this.options.enemyScale) || 1;
    this.maxEnemies = mode === 'battlefield' ? 20 : Math.max(8, Math.round(10 * es));

    // 竞技场沿用可配置友军；大战场由 BattlefieldDirector 固定组织为玩家+19 友军。
    const allyCount = mode === 'battlefield' ? 0 : ((this.options && this.options.allyCount) || 0);
    if (this.player) {
      for (let i = 0; i < allyCount; i++) this.allies.push(new Ally(this, i));
    }

    // 载具由大战场总控统一生成与重生，避免旧版静态载具和 AI 载具重复。
    if (this.vehicles) this.vehicles.forEach(v => v.remove());
    this.vehicles = [];
    this.driving = null;
    this.battlefieldDirector = mode === 'battlefield' ? new BattlefieldDirector(this) : null;

    this.fx.groundHeight = (x, z) => this.map.groundHeight(x, z);
  }

  // ---------- 状态控制 ----------
  startGame(mode) {
    audio.init();
    audio.resume();
    audio.startMusic();
    // 读取战斗配置（敌我人数）
    this.options = { ...this.hud.options };
    this._preheated = false; // 枪口火光渲染路径预热（主循环首帧执行）
    this.buildMap(mode);
    this.time = 0;
    this.kills = 0;
    this.headshots = 0;
    this.lives = this.mode === 'battlefield' ? 999 : 1;
    this.deaths = 0;
    this._matchStarted = false;
    this.hud.hideMenu();
    this.hud.hideDeath(); this.hud.hideWin(); this.hud.hideLose(); this.hud.hidePause();
    this.state = 'playing';
    // 预热：同步段直接渲染 muzzle（与实测有效配方一致），编译全部特效 program
    this.fx.warmup();
    this.camera.updateMatrixWorld(true);
    this.renderer.compile(this.scene, this.camera);
    // 临时敌人模型：编译其材质 program（敌人首次渲染的卡顿根因）
    const tempEnemy = new Enemy('grunt', this.map.playerSpawn.clone(), this);
    tempEnemy.pos.copy(this.map.playerSpawn);
    tempEnemy.root.position.copy(tempEnemy.pos);
    // 多帧渲染：每帧带显式 muzzle（相机正前方）+ 敌人模型，确保首次渲染全部被编译
    for (let i = 0; i < 3; i++) {
      const mp = this.camera.position.clone().add(new THREE.Vector3(0, 0, -2.5));
      this.fx.addMuzzle(mp);
      this.fx.update(0.05);
      this.composer.render();
    }
    tempEnemy.remove();
    // 临时友军模型：编译其材质 program（友军首次渲染的卡顿）
    const tempAlly = new Ally(this, 0);
    tempAlly.pos.copy(this.map.playerSpawn);
    tempAlly.root.position.copy(tempAlly.pos);
    this.composer.render();
    tempAlly.remove();
    this.fx.warmupCleanup();
    // 探针：同一同步段内再次渲染 muzzle，验证 program 是否已编译（保留供诊断）
    {
      const mp2 = this.camera.position.clone().add(new THREE.Vector3(0, 0, -2.5));
      this.fx.addMuzzle(mp2);
      this.composer.render();
      this.fx.update(0.1);
    }
    this.fx.warmupCleanup();
    this.fx.muzzleLight.intensity = 0;
    this.hud.centerMsg(this.mode === 'battlefield' ? '钢铁前线 · 20V20' : '爆破行动 · 沙漠街区', this.mode === 'battlefield' ? '陆空协同 · 争夺五个据点 · 消耗敌军增援票' : '前往 A/B 点下包并守到引爆，或歼灭全部守军', 3.8);
    this.renderer.domElement.requestPointerLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.exitPointerLock?.();
    this.hud.showPause();
    audio.stopMusic();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.hidePause();
    this.renderer.domElement.requestPointerLock();
    audio.startMusic();
  }
  restart() {
    this.hud.hidePause(); this.hud.hideDeath(); this.hud.hideLose(); this.hud.hideWin();
    this.buildMap(this.mode);
    this.time = 0;
    this.kills = 0; this.headshots = 0; this.lives = this.mode === 'battlefield' ? 999 : 1; this.deaths = 0;
    if (this.mode === 'battlefield') this.battlefieldDirector.start();
    else this.startBombMission();
    this._matchStarted = true;
    this.state = 'playing';
    this.renderer.domElement.requestPointerLock();
  }
  quitToMenu() {
    this.state = 'menu';
    document.exitPointerLock?.();
    audio.stopMusic();
    this.hud.showMenu();
    // 回到菜单视角
    this.player.respawn(this.map.playerSpawn, this.map.playerSpawnYaw);
    this.enemies.forEach(e => e.remove());
    this.enemies = [];
    this.projectiles = [];
  }
  respawnPlayer() {
    this.hud.hideDeath();
    if (this.driving) this.leaveVehicle();
    this.player.respawn(this.map.playerSpawn, this.map.playerSpawnYaw);
    this.state = 'playing';
    this.renderer.domElement.requestPointerLock();
    audio.startMusic();
  }
  continueEndless() {
    // 爆破模式没有无尽波次；继续按钮等同于重新执行一局完整爆破任务。
    if (this.mode === 'arena') {
      this.restart();
      return;
    }
    this.restart();
  }

  // ---------- 游戏事件 ----------
  startBombMission() {
    const scale = (this.options && this.options.enemyScale) || 1;
    const total = Math.max(8, Math.round(10 * scale));
    const roster = [];
    for (let i = 0; i < total; i++) {
      if (i === total - 1 && total >= 9) roster.push('sniper');
      else if (i >= Math.ceil(total * 0.72)) roster.push('heavy');
      else roster.push('grunt');
    }
    // 打乱固定守军编成，但整局只生成一次，死亡后不补波。
    for (let i = roster.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roster[i], roster[j]] = [roster[j], roster[i]];
    }
    this.bombRound = { state: 'active', timeLeft: 150, initialEnemies: total, result: null };
    for (const type of roster) this.spawnEnemy(type);
  }

  updateBombMission(dt) {
    const round = this.bombRound;
    if (!round || round.state !== 'active' || this.state !== 'playing') return;
    const alive = this.enemies.filter(e => e.alive).length;
    if (alive === 0 && !this.bomb) {
      round.state = 'won';
      round.result = 'elimination';
      this.winGame();
      return;
    }
    // C4 放置后由炸弹自身倒计时接管；未下包时执行回合时间限制。
    if (!this.bomb && !this.planting) {
      round.timeLeft = Math.max(0, round.timeLeft - dt);
      if (round.timeLeft <= 0) {
        round.state = 'lost';
        round.result = 'timeout';
        this.loseGame('行动时间耗尽，炸弹未能引爆。');
      }
    }
  }

  loseGame(reason = '任务失败。') {
    if (this.state === 'lose') return;
    this.state = 'lose';
    document.exitPointerLock?.();
    audio.stopMusic();
    this.hud.showLose(`${reason}<br>用时 <b>${Math.round(this.time)}</b> 秒 · 击杀 <b>${this.kills}</b> · 爆头 <b>${this.headshots}</b>`);
  }

  playerDied() {
    this.deaths++;
    // 载具内阵亡时先释放驾驶权，避免重生后摄像机和输入仍绑定在残骸上。
    if (this.driving) this.leaveVehicle();
    this.state = 'dead';
    document.exitPointerLock?.();
    audio.stopMusic();
    if (this.mode === 'battlefield') {
      if (this.battlefieldDirector) this.battlefieldDirector.blueTickets = Math.max(0, this.battlefieldDirector.blueTickets - 1);
      const blue = this.battlefieldDirector?.blueTickets ?? 0;
      const red = this.battlefieldDirector?.redTickets ?? 0;
      this.hud.showDeath(`你已阵亡，等待重新部署。<br>增援票 <b>${blue}</b> : <b>${red}</b> · 击杀 <b>${this.kills}</b>`);
      return;
    }
    this.lives = 0;
    if (this.bombRound) {
      this.bombRound.state = 'lost';
      this.bombRound.result = 'player_down';
    }
    this.loseGame(`你已阵亡，本局爆破行动失败。`);
  }

  objectivesAllDone() {
    return this.mode === 'battlefield' ? this.map.objectives.every(o => o.owner === 'blue') : this.map.objectives.every(o => o.captured);
  }

  winGame() {
    if (this.state === 'win') return;
    this.state = 'win';
    document.exitPointerLock?.();
    audio.stopMusic();
    this.hud.showWin(this.mode === 'battlefield' ? `敌军增援耗尽，20V20 战线获胜！<br>用时 <b>${Math.round(this.time)}</b> 秒 · 击杀 <b>${this.kills}</b> · 爆头 <b>${this.headshots}</b>` : `${this.bombRound?.result === 'elimination' ? '守军已全部歼灭，爆破行动完成！' : '炸弹成功引爆，目标已摧毁！'}<br>用时 <b>${Math.round(this.time)}</b> 秒 · 击杀 <b>${this.kills}</b> · 爆头 <b>${this.headshots}</b>`);
  }

  spawnEnemy(type) {
    const spawns = this.map.enemySpawns;
    const battlefield = this.mode === 'battlefield';
    const minDist = battlefield ? 42 : 26;
    const activeObjectives = this.map.objectives.filter(o => !o.captured);
    const frontline = activeObjectives.length
      ? activeObjectives.reduce((a, b) => this.player.pos.distanceTo(a.pos) < this.player.pos.distanceTo(b.pos) ? a : b).pos
      : this.player.pos;

    // 选择“接近当前战线但不贴脸”的刷新点，并惩罚已经拥挤的出生点。
    let best = null;
    let bestScore = Infinity;
    for (const spawn of spawns) {
      const playerD = this.player.pos.distanceTo(spawn);
      if (playerD < minDist) continue;
      let crowd = 0;
      for (const enemy of this.enemies) if (enemy.alive && enemy.pos.distanceTo(spawn) < 5) crowd++;
      const frontD = spawn.distanceTo(frontline);
      const tooFar = battlefield && playerD > 300 ? (playerD - 300) * 0.7 : 0;
      const score = frontD + crowd * 70 + tooFar + Math.random() * (battlefield ? 35 : 12);
      if (score < bestScore) { bestScore = score; best = spawn; }
    }
    const source = best || spawns[Math.floor(Math.random() * spawns.length)];
    const p = source.clone();
    p.x += (Math.random() - 0.5) * 2.4;
    p.z += (Math.random() - 0.5) * 2.4;
    p.y = this.map.groundHeight(p.x, p.z);
    const e = new Enemy(type, p, this);
    e.state = 'advance';
    e.advanceTarget = frontline.clone();
    this.enemies.push(e);
    return e;
  }

  interact() {
    // 载具上下车优先
    if (this.driving) {
      this.leaveVehicle();
      return;
    }
    for (const v of this.vehicles) {
      if (!v.alive || v.team !== 'blue' || (v.occupied && v.driver !== 'ai')) continue;
      const d = this.player.pos.distanceTo(v.pos);
      if (d < 5.0) {
        this.enterVehicle(v);
        return;
      }
    }
    // 爆破：在未占领目标点下包
    if (this.mode !== 'battlefield' && !this.planting && !this.bomb) {
      for (const o of this.map.objectives) {
        if (o.captured) continue;
        if (this.player.pos.distanceTo(o.pos) < o.radius) {
          this.planting = { obj: o, t: 0 };
          audio.beep();
          return;
        }
      }
    }
    // 补给点
    for (const sp of this.map.supplyPoints) {
      if (this.player.pos.distanceTo(sp.pos) < 2.6) {
        let refilled = false;
        this.weapons.slots.forEach(s => {
          if (s.def) { s.mag = s.def.magSize; s.reserve = s.def.reserve; refilled = true; }
        });
        this.weapons.grenades = 2;
        this.weapons.showSlot(this.weapons.current); // 同步当前槽缓存
        if (refilled) {
          audio.pickup();
          this.hud.popup('弹药已补满');
        }
        return;
      }
    }
  }

  // ---------- 载具上下车 ----------
  // 驾驶视角更新（第三人称跟随，独立方法便于测试）
  updateDrivingCamera(dt) {
    const v = this.driving;
    if (!v) return;
    const p = this.player;
    this.vehicleCamYaw = (this.vehicleCamYaw ?? v.yaw) - p.mouseDX * p.sens * 0.72;
    this.vehicleCamPitch = THREE.MathUtils.clamp((this.vehicleCamPitch ?? -0.18) - p.mouseDY * p.sens * 0.55, -0.78, 0.28);
    p.mouseDX = 0; p.mouseDY = 0;

    const dist = v.def.air ? 13.5 : v.type === 'tank' ? 10.5 : 8.2;
    const height = v.def.air ? 5.2 : v.type === 'tank' ? 4.2 : 3.5;
    const cp = Math.cos(this.vehicleCamPitch);
    const offset = new THREE.Vector3(
      Math.sin(this.vehicleCamYaw) * cp * dist,
      height + Math.sin(-this.vehicleCamPitch) * dist * 0.55,
      Math.cos(this.vehicleCamYaw) * cp * dist,
    );
    const desired = v.pos.clone().add(offset);
    if (!this.camTp) this.camTp = desired.clone();
    this.camTp.lerp(desired, Math.min(1, dt * 6));
    this.camera.position.copy(this.camTp);
    const look = v.pos.clone().add(new THREE.Vector3(0, v.def.air ? 1.2 : 1.35, 0));
    this.camera.lookAt(look);
    this.weapons.modelHolder.visible = false;
    p.pos.copy(v.pos);
    p.pos.y = v.pos.y;
    p.yaw = v.yaw;
    const targetFov = this.input.sprint ? 84 : 78;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();
  }

  enterVehicle(v) {
    this.driving = v;
    v.setPlayerOccupied(true);
    this.driver = v;
    this.vehicleCamYaw = v.yaw;
    this.vehicleCamPitch = -0.18;
    this.player.vel.set(0, 0, 0);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.hud.centerMsg(v.def.name, v.type === 'chopper' ? 'WASD 飞行 · Space/C 升降 · 左键机枪 · 右键火箭 · E 下机' : v.type === 'tank' ? 'WASD 驾驶 · 左键主炮 · 右键并列机枪 · E 下车' : 'WASD 驾驶 · Shift 加速 · 左键机枪 · E 下车', 3.2);
  }

  leaveVehicle() {
    const v = this.driving;
    if (!v) return;
    // 下车位置：车侧 2.5m
    const dir = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.player.pos.copy(v.pos).addScaledVector(side, 2.5);
    this.player.pos.y = this.map.groundHeight(this.player.pos.x, this.player.pos.z);
    this.player.yaw = v.yaw;
    this.driving = null;
    v.setPlayerOccupied(false);
    this.camTp = null;
    this.vehicleCamYaw = null;
    this.vehicleCamPitch = null;
    this.camera.fov = 75;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 射线 ----------
  rayGround(origin, dir) {
    if (Math.abs(dir.y) < 1e-6) return null;
    let t = (0 - origin.y) / dir.y;
    if (t < 0) return null;
    let p = origin.clone().addScaledVector(dir, t);
    for (let i = 0; i < 3; i++) {
      const gh = this.map.groundHeight(p.x, p.z);
      const t2 = (gh - origin.y) / dir.y;
      if (Math.abs(t2 - t) < 0.02) break;
      t = t2;
      p = origin.clone().addScaledVector(dir, t);
    }
    if (t < 0) return null;
    return { t, point: p, normal: new THREE.Vector3(0, 1, 0) };
  }

  rayMap(origin, dir, maxDist = 300) {
    let best = null;
    for (const b of this.map.colliders) {
      const h = rayAABB(origin, dir,
        new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2),
        new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2));
      if (h && h.t < maxDist && (!best || h.t < best.t)) best = h;
    }
    const g = this.rayGround(origin, dir);
    if (g && g.t < maxDist && (!best || g.t < best.t)) best = g;
    return best;
  }

  // 无副作用射线：用于先从准星确定瞄准点，再从真实枪口检查遮挡。
  traceWorld(origin, dir, maxDist = 300) {
    let best = null;
    let bestT = maxDist;
    for (const e of this.enemies) {
      const h = e.raycast(origin, dir);
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, enemy: e }; }
    }
    const mh = this.rayMap(origin, dir, bestT);
    if (mh && mh.t < bestT) best = mh;
    return best || { t: maxDist, point: origin.clone().addScaledVector(dir, maxDist), normal: dir.clone().negate() };
  }

  // 轻量准星容错：只在目标非常接近准星且无遮挡时微调，不做明显吸附。
  assistAimDirection(origin, dir, def, player) {
    if (!def || player?.sprinting) return dir;
    const ads = this.weapons?.adsAmount > 0.5;
    const maxAngle = def.type === 'sniper' ? (ads ? 0.0065 : 0.0035) : (ads ? 0.0085 : 0.0125);
    let bestDir = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const target = e.pos.clone().add(new THREE.Vector3(0, def.type === 'sniper' ? 1.12 : 0.92, 0));
      const to = target.sub(origin);
      const dist = to.length();
      if (dist < 1 || dist > 220) continue;
      to.multiplyScalar(1 / dist);
      const angle = dir.angleTo(to);
      if (angle > maxAngle) continue;
      if (this.rayMap(origin, to, Math.max(0, dist - 0.45))) continue;
      const score = angle + dist * 0.000003;
      if (score < bestScore) { bestScore = score; bestDir = to.clone(); }
    }
    if (!bestDir) return dir;
    return dir.clone().lerp(bestDir, ads ? 0.48 : 0.36).normalize();
  }

  // 玩家武器射线：敌人 + 地图
  worldRay(origin, dir, def, fromPlayer) {
    let best = null;
    let bestT = Infinity;
    for (const e of this.enemies) {
      const h = e.raycast(origin, dir);
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, enemy: e }; }
    }
    for (const v of this.vehicles || []) {
      if (!v.alive || v === this.driving) continue;
      const h = v.raycast(origin, dir);
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, vehicle: v }; }
    }
    const mh = this.rayMap(origin, dir, bestT);
    if (mh && mh.t < bestT) { bestT = mh.t; best = mh; }
    if (!best) return null;
    // 命中贴花
    this.fx.addImpact(best.point, best.normal, best.head ? 'blood' : 'bullet');
    // 命中表面音效（金属/木箱/沙土）
    if (!best.enemy && !best.vehicle) {
      const r = Math.random();
      audio.hitSurface(r < 0.35 ? 'metal' : r < 0.7 ? 'wood' : 'soft', best.point);
    }
    // 伤害
    if (best.vehicle && fromPlayer) {
      const dmg = def.damage * (def.type === 'sniper' ? 0.75 : 0.42);
      best.vehicle.takeDamage(dmg, this.player.pos);
      this.hud.hitmark(false);
      audio.hitmarker(false);
      if (!best.vehicle.alive) {
        this.kills++;
        this.hud.killFeed(`<b>${def.name}</b> 摧毁 ${best.vehicle.def.name}`, false);
      }
    }
    if (best.enemy && fromPlayer) {
      const rangeScale = 1 - Math.min(0.18, bestT / 900);
      const dmg = (best.head ? def.damage * def.hsMult : def.damage) * rangeScale;
      best.enemy.takeDamage(dmg, dir.clone(), best.head, this.player.pos);
      this.hud.hitmark(best.head); // 命中标记（爆头高亮）
      if (best.enemy.hp <= 0) {
        this.kills++;
        if (best.head) { this.headshots++; this.hud.popup('爆头 +' + Math.round(dmg), true); }
        this.hud.killFeed(`<b>${def.name}</b> 击杀敌人`, best.head);
        audio.hitmarker(best.head);
        this.onEnemyKilled(best.enemy);
      } else {
        audio.hitmarker(best.head);
      }
    }
    return best;
  }

  // 载具武器射线：自动判断敌我阵营、步兵、载具和地图遮挡。
  vehicleRay(shooter, origin, dir, maxDist, damage) {
    let best = null;
    let bestT = maxDist;
    const blue = shooter.team === 'blue';
    const infantry = blue ? this.enemies : [this.player, ...this.allies];
    for (const unit of infantry) {
      if (!unit?.alive) continue;
      let h;
      if (unit.raycast) h = unit.raycast(origin, dir);
      else {
        h = rayAABB(origin, dir,
          new THREE.Vector3(unit.pos.x - 0.4, unit.pos.y, unit.pos.z - 0.4),
          new THREE.Vector3(unit.pos.x + 0.4, unit.pos.y + 1.75, unit.pos.z + 0.4));
      }
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, unit }; }
    }
    for (const v of this.vehicles || []) {
      if (!v.alive || v === shooter || v.team === shooter.team) continue;
      const h = v.raycast(origin, dir);
      if (h && h.t < bestT) { bestT = h.t; best = { ...h, vehicle: v }; }
    }
    const mapHit = this.rayMap(origin, dir, bestT);
    if (mapHit && mapHit.t < bestT) best = mapHit;
    if (!best) return { point: origin.clone().addScaledVector(dir, maxDist), t: maxDist };
    if (best.vehicle && damage > 0) best.vehicle.takeDamage(damage, origin);
    else if (best.unit && damage > 0) {
      if (best.unit === this.player) best.unit.takeDamage(damage, origin);
      else if (blue) best.unit.takeDamage(damage, dir.clone(), !!best.head, origin);
      else best.unit.takeDamage(damage, origin);
    } else this.fx.addImpact(best.point, best.normal, 'bullet');
    return best;
  }

  applyExplosion(pos, radius, damage, sourceTeam = null) {
    const hurt = (unit, amount) => {
      if (!unit?.alive) return;
      if (unit === this.player) unit.takeDamage(amount, pos);
      else if (unit.takeDamage.length >= 4) unit.takeDamage(amount, new THREE.Vector3().subVectors(unit.pos, pos), false, pos);
      else unit.takeDamage(amount, pos);
    };
    if (sourceTeam !== 'blue') {
      const pd = this.player.pos.distanceTo(pos);
      if (pd < radius) hurt(this.player, damage * Math.max(0.15, 1 - pd / radius));
      for (const a of this.allies) {
        const d = a.pos.distanceTo(pos); if (d < radius) hurt(a, damage * Math.max(0.15, 1 - d / radius));
      }
    }
    if (sourceTeam !== 'red') {
      for (const e of this.enemies) {
        const d = e.pos.distanceTo(pos); if (d < radius) hurt(e, damage * Math.max(0.15, 1 - d / radius));
      }
    }
    for (const v of this.vehicles || []) {
      if (!v.alive || v.team === sourceTeam) continue;
      const d = v.pos.distanceTo(pos);
      if (d < radius * 1.2) v.takeDamage(damage * 0.7 * Math.max(0.18, 1 - d / (radius * 1.2)), pos);
    }
  }

  onEnemyKilled(enemy) {
    // 掉落弹药包
    if (Math.random() < 0.4) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x2e8b3d, emissive: 0x1a5c28, emissiveIntensity: 0.5 })
      );
      mesh.position.copy(enemy.pos).add(new THREE.Vector3(0, 0.25, 0));
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.ammoPacks.push({ mesh, pos: mesh.position.clone(), taken: false });
    }
  }

  // 敌人子弹打玩家
  rayPlayer(origin, dir, maxDist = 100) {
    const p = this.player;
    const min = new THREE.Vector3(p.pos.x - 0.4, p.pos.y, p.pos.z - 0.4);
    const max = new THREE.Vector3(p.pos.x + 0.4, p.pos.y + 1.75, p.pos.z + 0.4);
    const h = rayAABB(origin, dir, min, max);
    if (!h || h.t > maxDist) return null;
    // 地图遮挡（命中点早于玩家才算挡）
    const mh = this.rayMap(origin, dir, h.t);
    if (mh && mh.t < h.t) return null;
    return h;
  }

  // ---------- 投掷物 ----------
  throwGrenade(player, weapons) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = player.eye.clone().add(dir.clone().multiplyScalar(0.5));
    const vel = dir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)).add(player.vel.clone().multiplyScalar(0.4));
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x46543c, metalness: 0.4, roughness: 0.7 })
    );
    this.scene.add(mesh);
    this.projectiles.push({ type: 'grenade', pos: origin, vel, mesh, fuse: 1.7, life: 20, bounces: 0 });
  }

  fireRocket(enemy, target) {
    const origin = enemy.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const dir = new THREE.Vector3().subVectors(target.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), origin).normalize();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.22, 6),
      new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.5 })
    );
    mesh.rotation.x = Math.PI / 2;
    this.scene.add(mesh);
    this.projectiles.push({ type: 'rocket', pos: origin, vel: dir.multiplyScalar(15), mesh, fuse: 6, life: 6, enemy, target });
  }

  explodeProjectile(p, size = 1.2) {
    this.fx.addExplosion(p.pos, size);
    audio.explosion(p.pos, size);
    // 玩家伤害
    const dp = this.player.pos.distanceTo(p.pos);
    if (dp < 6) {
      const dmg = (p.type === 'rocket' ? 60 : 85) * Math.max(0.2, 1 - dp / 6);
      this.player.takeDamage(dmg, p.pos);
      // 爆炸冲击：镜头震动
      this.player.addRecoil(0.018 * (1 - dp / 6), (Math.random() - 0.5) * 0.02);
    }
    // 玩家投掷物伤害敌人；敌方火箭伤害友军，避免双方只围着玩家打。
    if (!p.enemy) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = e.pos.distanceTo(p.pos);
        if (d < 6) e.takeDamage(100 * Math.max(0.2, 1 - d / 6), new THREE.Vector3().subVectors(e.pos, p.pos), false, p.pos);
      }
    } else {
      for (const a of this.allies) {
        if (!a.alive) continue;
        const d = a.pos.distanceTo(p.pos);
        if (d < 6) a.takeDamage(70 * Math.max(0.2, 1 - d / 6), p.pos);
      }
    }
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose?.();
    p.mesh.material.dispose?.();
  }

  // 炸弹引爆：清场 + 爆破占领目标点
  explodeBomb() {
    const b = this.bomb;
    if (!b || b.exploded) return;
    b.exploded = true;
    this.fx.addExplosion(b.pos, 1.7);
    audio.explosion(b.pos, 1.5);
    // 敌人 AOE
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(b.pos);
      if (d < 9) e.takeDamage(250 * Math.max(0.2, 1 - d / 9), new THREE.Vector3().subVectors(e.pos, b.pos), false, b.pos);
    }
    // 爆破占领目标点
    const o = b.obj;
    if (o && !o.captured) {
      o.captured = true;
      o.ring.material.color.set(0x5fe08a);
      o.ring.material.opacity = 0.8;
      if (o.flag) { o.flag.material.map = this.tex.flagBlue; o.flag.material.needsUpdate = true; }
      if (o.beacon) o.beacon.material.color.set(0x5fe08a);
      this.hud.popup('💥 ' + o.name + ' 爆破占领！');
    }
    this.scene.remove(b.mesh);
    b.mesh.traverse?.(c => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
    this.bomb = null;
    if (this.bombRound) { this.bombRound.state = 'won'; this.bombRound.result = 'detonated'; }
    this.winGame();
  }

  // ---------- 主循环 ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, (performance.now() - (this._last || performance.now())) / 1000);
    this._last = performance.now();

    // 首帧预热：真实开一枪完整路径 + 显式 muzzle，编译全部 program，消除玩家/敌人/队友第一枪卡顿
    if (!this._preheated && this.state === 'playing') {
      this._preheated = true;
      this.camera.updateMatrixWorld(true); // 刷新相机矩阵，确保特效位置正确可见
      const fx = this.fx;
      const w = this.weapons;
      // 显式全部特效（相机正前方，保证全部被渲染编译）
      const mp = this.camera.position.clone().add(new THREE.Vector3(0, 0, -2.5));
      const mp2 = mp.clone().add(new THREE.Vector3(0, 0, -6));
      fx.addMuzzle(mp);
      fx.addTracer(mp, mp2);
      fx.addShell(mp, new THREE.Vector3(0.3, 1, 0.2));
      fx.addImpact(new THREE.Vector3(mp2.x, 0.1, mp2.z), new THREE.Vector3(0, 1, 0), 'bullet');
      // 真实开一枪（覆盖 tracer/shell/impact/光照完整路径）
      const savedMag = w.mag;
      const savedCd = w.fireCooldown;
      const savedSlot = { ...w.slots[w.current] };
      const savedSpread = w.spreadCur;
      const savedStack = w.recoilStack;
      w.mag = Math.max(2, w.mag);
      w.fireCooldown = 0;
      w.tryFire(this, this.player);
      this.composer.render();
      w.mag = savedMag;
      w.fireCooldown = savedCd;
      w.slots[w.current] = savedSlot;
      w.spreadCur = savedSpread;
      w.recoilStack = savedStack;
      this.player.recoilPitch = 0;
      this.player.recoilYaw = 0;
      fx.update(0.3); // 推进特效生命周期（不 dispose 材质缓存）
      if (!this._matchStarted) {
        if (this.mode === 'battlefield') this.battlefieldDirector?.start();
        else this.startBombMission();
        this._matchStarted = true;
      }
    }

    // 菜单背景：相机环绕
    if (this.state === 'menu' && this.player && this.map) {
      this.time += dt;
      const r = 6;
      const a = this.time * 0.12;
      this.camera.position.set(this.map.playerSpawn.x + Math.sin(a) * r, this.map.playerSpawn.y + 1.7 + Math.sin(this.time * 0.3) * 0.4, this.map.playerSpawn.z + Math.cos(a) * r);
      this.camera.lookAt(this.map.objectives[0] ? this.map.objectives[0].pos : this.map.playerSpawn);
      this.updateSun(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.state !== 'playing' && this.state !== 'dead') {
      // 暂停/结算时静态渲染
      this.updateSun(dt);
      this.composer.render();
      return;
    }

    this.time += dt;
    const p = this.player;

    // 输入状态
    this.input.move.set(0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.input.move.y = -1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.input.move.y = 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.input.move.x = -1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.input.move.x = 1;
    this.input.jump = this.keys.has('Space');
    this.input.sprint = this.keys.has('ShiftLeft');
    if (this.keys.has('KeyC')) this.input.crouch = true;
    else this.input.crouch = false;

    if (this.state === 'playing') {
      if (this.driving) {
        // 驾驶载具：物理 + 第三人称跟随视角 + 玩家位置随车
        this.driving.update(dt, this.input);
        this.updateDrivingCamera(dt);
      } else {
        this.weapons.modelHolder.visible = true;
        p.update(dt, this.input);

        // 射击：自动武器可持续开火；手枪/狙击枪必须每次重新点击，避免按住连发失去手感。
        const canTrigger = this.input.fire && (this.weapons.def?.auto || !this.weapons.triggerHeld);
        if (canTrigger && !this.weapons.reloading) {
          if (this.weapons.tryFire(this, p)) {
            this.heardShot = { pos: p.eye.clone(), range: this.mode === 'battlefield' ? 320 : 200, time: this.time };
            if (this.weapons.def && this.weapons.def.type === 'sniper') setTimeout(() => audio.bolt(), 480);
          }
        }
        this.weapons.triggerHeld = this.input.fire;
        // 开镜 FOV（冲刺时视野略微扩展）
        const baseFov = p.sprinting && this.weapons.adsAmount < 0.15 ? 81 : 75;
        const adsTarget = this.weapons.getTargetFov(baseFov);
        if (this.weapons.current !== 3) {
          const fovSpeed = this.weapons.def?.type === 'sniper' ? 12 : 10;
          this.camera.fov += (adsTarget - this.camera.fov) * Math.min(1, dt * fovSpeed);
          this.camera.updateProjectionMatrix();
        }
      }
    }

    this.updateWeaponLighting(dt);
    this.weapons.update(dt, p);

    // 友军
    for (const a of this.allies) a.update(dt);
    this.allies = this.allies.filter(a => !a.removed);

    // 敌人
    for (const e of this.enemies) {
      if (e.alive) e.update(dt);
      else if (e.updateDead(dt)) { e.remove(); e.removed = true; }
    }
    this.enemies = this.enemies.filter(e => !e.removed);

    // 非玩家驾驶载具由 AI 或空载物理更新。
    for (const v of this.vehicles || []) if (v !== this.driving) v.update(dt, null);

    // 20V20 中按距离动态关闭远处角色/载具阴影，保留模型与战斗逻辑但显著降低 GPU 阴影开销。
    this.updateRenderLOD(dt);

    // 大战场使用 20V20 总控；爆破模式使用单回合任务状态，不再生成任何波次。
    if (this.state === 'playing') {
      if (this.mode === 'battlefield') this.battlefieldDirector?.update(dt);
      else this.updateBombMission(dt);
    }

    // 爆破点只负责下包，不再通过站圈自动占领。靠近时仅高亮提示。
    if (this.mode !== 'battlefield') for (const o of this.map.objectives) {
      if (o.captured) continue;
      const near = p.alive && p.pos.distanceTo(o.pos) < o.radius;
      o.ring.material.opacity = near ? 0.82 + Math.sin(this.time * 6) * 0.12 : 0.5;
    }

    // 交互提示
    this.interactHint = null;
    // 爆破下包提示
    if (this.mode !== 'battlefield' && !this.planting && !this.bomb) {
      for (const o of this.map.objectives) {
        if (o.captured) continue;
        if (p.pos.distanceTo(o.pos) < o.radius && p.alive) {
          this.interactHint = '按 E 下包（爆破目标点）';
          break;
        }
      }
    } else if (this.planting) {
      this.interactHint = `正在下包 ${Math.ceil(3 - this.planting.t)}…`;
    }
    // 载具提示
    if (!this.driving) {
      for (const v of this.vehicles) {
        if (v.alive && v.team === 'blue' && (!v.occupied || v.driver === 'ai') && p.pos.distanceTo(v.pos) < 5.0 && p.alive) {
          this.interactHint = v.driver === 'ai' ? `按 E 接管${v.def.name}` : `按 E 驾驶${v.def.name}`;
          break;
        }
      }
    }
    for (const sp of this.map.supplyPoints) {
      if (p.pos.distanceTo(sp.pos) < 2.6 && p.alive) {
        this.interactHint = '按 E 补充弹药';
        if (this.keys.has('KeyE')) this.interact();
      }
    }
    // 弹药包自动拾取
    for (const ap of this.ammoPacks) {
      if (ap.taken) continue;
      if (p.pos.distanceTo(ap.pos) < 1.7) {
        ap.taken = true;
        this.scene.remove(ap.mesh);
        let got = false;
        for (const s of this.weapons.slots) {
          if (s.def && s.reserve < s.def.reserve) { s.reserve += s.def.magSize; got = true; }
        }
        if (got) {
          this.weapons.showSlot(this.weapons.current); // 同步当前槽缓存
          audio.pickup();
          this.hud.popup('+30 弹药');
        }
      }
    }
    // 投掷物
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.fuse -= dt;
      pr.vel.y -= (pr.type === 'grenade' ? 14 : 5) * dt;
      const prev = pr.pos.clone();
      pr.pos.addScaledVector(pr.vel, dt);
      // 地面
      const g = this.map.groundHeight(pr.pos.x, pr.pos.z);
      if (pr.pos.y < g + 0.06) {
        if (pr.type === 'grenade' && pr.bounces < 2) {
          pr.pos.y = g + 0.06;
          pr.vel.y = Math.abs(pr.vel.y) * 0.4;
          pr.vel.x *= 0.65; pr.vel.z *= 0.65;
          pr.bounces++;
        } else { this.explodeProjectile(pr); this.projectiles.splice(i, 1); continue; }
      }
      // 碰撞体
      let hitWall = false;
      for (const b of this.map.colliders) {
        if (Math.abs(pr.pos.x - b.x) < b.w / 2 + 0.1 && Math.abs(pr.pos.z - b.z) < b.d / 2 + 0.1) {
          if (pr.pos.y > b.y - b.h / 2 && pr.pos.y < b.y + b.h / 2) { hitWall = true; break; }
        }
      }
      if (hitWall) {
        if (pr.type === 'grenade') {
          // 侧向滑走
          pr.pos.copy(prev);
          pr.vel.x *= -0.4; pr.vel.z *= -0.4;
        } else { this.explodeProjectile(pr); this.projectiles.splice(i, 1); continue; }
      }
      // 火箭近身引爆
      if (pr.type === 'rocket') {
        const target = pr.target && pr.target.alive ? pr.target : p;
        const dp = target.pos.distanceTo(pr.pos);
        if (dp < 1.0) { this.explodeProjectile(pr); this.projectiles.splice(i, 1); continue; }
        // 拖尾
        this.fx.addTracer(pr.pos.clone().addScaledVector(pr.vel.clone().normalize(), -0.3), pr.pos, 0xffa060);
        if (Math.random() < 0.3) this.fx.addSmoke(pr.pos, 0.3, 0x888888);
      }
      // 手雷插销音
      if (pr.type === 'grenade' && pr.fuse < 0.8 && !pr._pinSound) { pr._pinSound = true; audio.beep(); }
      pr.mesh.position.copy(pr.pos);
      pr.mesh.rotation.x += pr.vel.z * dt * 3;
      pr.mesh.rotation.z -= pr.vel.x * dt * 3;
      pr.life -= dt;
      if (pr.fuse <= 0) { this.explodeProjectile(pr); this.projectiles.splice(i, 1); }
    }

    // 听到的枪声过期
    if (this.heardShot && this.time - this.heardShot.time > 0.6) this.heardShot = null;

    // ---------- 爆破系统 ----------
    if (this.planting) {
      const plantObj = this.planting.obj;
      if (!p.alive || p.pos.distanceTo(plantObj.pos) > plantObj.radius + 0.45) {
        this.planting = null;
        this.hud.popup('下包已取消');
      } else {
        this.planting.t += dt;
      }
      if (this.planting && this.planting.t >= 3) {
        const o = this.planting.obj;
        this.planting = null;
        // 炸弹模型（C4 盒 + 警示灯）
        const grp = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.2),
          new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.7, metalness: 0.4 }));
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02),
          new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 }));
        lamp.position.y = 0.08;
        grp.add(box, lamp);
        grp.position.copy(o.pos).add(new THREE.Vector3(0, 0.35, 0));
        grp.rotation.y = Math.random() * 3;
        this.scene.add(grp);
        this.bomb = { obj: o, mesh: grp, lamp, pos: o.pos.clone(), timer: 45, defuseT: 0, defuser: null, defused: false, exploded: false };
        this.hud.popup('💣 炸弹已放置！45 秒后引爆');
        audio.beep(true);
      }
    }
    if (this.bomb) {
      const b = this.bomb;
      if (b.defused) {
        this.scene.remove(b.mesh);
        b.mesh.traverse?.(c => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
        this.bomb = null;
        this.hud.popup('❌ 炸弹被敌人拆除');
        audio.beep();
        if (this.bombRound) { this.bombRound.state = 'lost'; this.bombRound.result = 'defused'; }
        this.loseGame('炸弹已被守军拆除。');
      } else {
        b.timer -= dt;
        b.lamp.material.emissiveIntensity = Math.sin(this.time * 8) > 0 ? 2.5 : 0.2;
        if (b.timer <= 0) this.explodeBomb();
      }
    }

    this.fx.update(dt);
    this.updateSun(dt);
    audio.setListener(p.camera.position, p.camera.quaternion);

    this.hud.update(dt, this);
    this.composer.render();
  }

  updateRenderLOD(dt) {
    if (!this.player || !this.map) return;
    this._renderLodTimer = (this._renderLodTimer || 0) - dt;
    if (this._renderLodTimer > 0) return;
    this._renderLodTimer = this.mode === 'battlefield' ? 0.22 : 0.35;

    const focus = this.driving?.pos || this.player.pos;
    const setShadow = (root, enabled) => {
      if (!root || root.userData._lodShadow === enabled) return;
      root.userData._lodShadow = enabled;
      root.traverse?.(ch => {
        if (!ch.isMesh) return;
        // 第一人称模型由独立灯光层处理，不参与世界阴影。
        if (ch.layers?.mask === 2) return;
        ch.castShadow = enabled;
      });
    };

    for (const unit of [...(this.allies || []), ...(this.enemies || [])]) {
      if (!unit?.root) continue;
      const d = unit.pos.distanceTo(focus);
      setShadow(unit.root, d < (this.mode === 'battlefield' ? 72 : 90));
      if (unit.indicator) unit.indicator.visible = unit.alive && d < 190;
    }
    for (const v of this.vehicles || []) {
      if (!v?.model) continue;
      const d = v.pos.distanceTo(focus);
      setShadow(v.model, v.alive && d < (v.type === 'chopper' ? 145 : 105));
      if (v.indicator) v.indicator.visible = v.alive && d < 330;
    }
  }

  updateWeaponLighting(dt) {
    if (!this.weapons || !this.player || !this.map) return;
    this._weaponLightTimer = (this._weaponLightTimer || 0) - dt;
    if (this._weaponLightTimer <= 0) {
      this._weaponLightTimer = 0.08;
      const eye = this.player.eye.clone();
      const skyBlocked = !!this.rayMap(eye, new THREE.Vector3(0, 1, 0), 40);
      const sunDir = this.sun.position.clone().sub(eye).normalize();
      const sunBlocked = !!this.rayMap(eye, sunDir, 260);
      // 四个水平采样估计周围开阔程度，让枪身颜色随房间/掩体环境变化。
      let openSides = 0;
      const dirs = [
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
      ];
      for (const dir of dirs) if (!this.rayMap(eye, dir, 7)) openSides++;
      const openness = openSides / dirs.length;
      this._weaponAmbientTarget = (skyBlocked ? 0.24 : 0.62) + openness * 0.24;
      this._weaponDirectTarget = sunBlocked ? 0.10 : (this.mode === 'battlefield' ? 1.0 : 0.86);
      this._weaponLightTarget = Math.min(1, this._weaponAmbientTarget * 0.62 + this._weaponDirectTarget * 0.38);
    }
    const k = Math.min(1, dt * 7.5);
    this._weaponLight = THREE.MathUtils.lerp(this._weaponLight ?? 0.8, this._weaponLightTarget ?? 0.8, k);
    this._weaponDirect = THREE.MathUtils.lerp(this._weaponDirect ?? 0.6, this._weaponDirectTarget ?? 0.6, k);
    this._weaponAmbient = THREE.MathUtils.lerp(this._weaponAmbient ?? 0.5, this._weaponAmbientTarget ?? 0.5, k);
    this.weapons.setEnvironmentFactor(this._weaponLight, this._weaponDirect, this._weaponAmbient);
  }

  updateSun(dt) {
    const focus = this.player ? this.player.pos : (this.map ? this.map.playerSpawn : new THREE.Vector3());
    const dir = new THREE.Vector3(this.mode === 'battlefield' ? 0.5 : -0.45, 0.8, this.mode === 'battlefield' ? 0.25 : 0.3).normalize();
    // 竞技场沙地反光强，阳光略低（切图瞬切）
    this.sun.intensity = this.mode === 'battlefield' ? 2.0 : 1.55;
    this.hemi.intensity = this.mode === 'battlefield' ? 0.30 : 0.27;
    this.renderer.toneMappingExposure = this.mode === 'battlefield' ? 1.0 : 1.04;
    this.sun.position.copy(focus).addScaledVector(dir, 130);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    void dt;
  }
}

const game = new Game();
window.__game = game; // 调试/验证句柄（无副作用）
game.init();

