// ============================================================
// hud.js — HUD 界面：状态显示、小地图、击杀提示、菜单交互
// ============================================================

export class HUD {
  constructor() {
    this.el = id => document.getElementById(id);
    this.menu = this.el('menu');
    this.hud = this.el('hud');
    this.loading = this.el('loading');
    this.crosshair = this.el('crosshair');
    this.hpBar = this.el('hp-bar');
    this.hpNum = this.el('hp-num');
    this.ammoMag = this.el('ammo-mag');
    this.ammoReserve = this.el('ammo-reserve');
    this.weaponName = this.el('weapon-name');
    this.waveInfo = this.el('wave-info');
    this.objective = this.el('objective');
    this.enemyCount = this.el('enemy-count');
    this.killCount = this.el('kill-count');
    this.hsCount = this.el('hs-count');
    this.killfeed = this.el('killfeed');
    this.centerMsgEl = this.el('center-msg');
    this.lowhp = this.el('lowhp-vignette');
    this.dmgInd = this.el('dmg-indicator');
    this.minimap = this.el('minimap');
    this.minimapCtx = this.minimap.getContext('2d');
    this.interactHint = this.el('interact-hint');
    this.popups = this.el('popups');
    this.scopeOverlay = this.el('scope-overlay');
    this.pause = this.el('pause');
    this.death = this.el('death');
    this.win = this.el('win');
    this.lose = this.el('lose');
    this.btnStart = this.el('btn-start');
    this.loadingFill = this.el('loading-fill');
    this.loadingText = this.el('loading-text');
    this.deathStats = this.el('death-stats');
    this.winStats = this.el('win-stats');
    this.loseStats = this.el('lose-stats');
    this.sensSlider = this.el('sens-slider');
    this.hitmarkEl = this.el('hitmarker');
    this._hitmarkT = 0;

    this.selectedMode = null;
    this.miniTimer = 0;
    this.msgTimer = 0;
    this.onStart = null;
    this.onRestart = null;
    this.onQuit = null;
    this.onRespawn = null;
    this.onContinue = null;

    // 菜单卡片
    document.querySelectorAll('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedMode = card.dataset.mode;
        this.btnStart.disabled = false;
        this.btnStart.textContent = this.selectedMode === 'arena' ? '进入爆破行动' : '进入钢铁前线';
      });
    });
    this.btnStart.addEventListener('click', () => this.onStart && this.onStart(this.selectedMode));

    // 战斗配置（敌我人数）
    this.options = { enemyScale: 1, allyCount: 3 };
    const bindCfg = (btnId, key, valAttr) => {
      document.querySelectorAll(`#${btnId} .cfg-btn`).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`#${btnId} .cfg-btn`).forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.options[key] = parseFloat(btn.dataset[valAttr]);
        });
      });
    };
    bindCfg('enemy-scale-btns', 'enemyScale', 'scale');
    bindCfg('ally-count-btns', 'allyCount', 'n');

    // 暂停
    this.el('btn-resume').addEventListener('click', () => this.onResume && this.onResume());
    this.el('btn-restart').addEventListener('click', () => this.onRestart && this.onRestart());
    this.el('btn-quit').addEventListener('click', () => this.onQuit && this.onQuit());
    // 结算
    this.el('btn-respawn').addEventListener('click', () => this.onRespawn && this.onRespawn());
    this.el('btn-win-continue').addEventListener('click', () => this.onContinue && this.onContinue());
    this.el('btn-win-menu').addEventListener('click', () => this.onQuit && this.onQuit());
    this.el('btn-lose-retry').addEventListener('click', () => this.onRestart && this.onRestart());
    this.el('btn-lose-menu').addEventListener('click', () => this.onQuit && this.onQuit());
  }

  setLoading(p, text) {
    this.loadingFill.style.width = (p * 100) + '%';
    this.loadingText.textContent = text || `正在载入战场资源 ${Math.round(p * 100)}%…`;
  }

  showMenu() {
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.death.classList.add('hidden');
    this.win.classList.add('hidden');
    this.lose.classList.add('hidden');
  }
  hideMenu() { this.menu.classList.add('hidden'); this.hud.classList.remove('hidden'); }

  // 主 HUD 刷新（每帧）
  update(dt, game) {
    const p = game.player;
    const w = game.weapons;
    // 生命
    const hpPct = Math.max(0, p.hp) / p.maxHp * 100;
    this.hpBar.style.width = hpPct + '%';
    this.hpBar.classList.toggle('low', hpPct < 35);
    this.hpNum.textContent = Math.max(0, Math.ceil(p.hp));
    // 弹药 / 载具状态
    if (game.driving) {
      const v = game.driving;
      this.ammoMag.textContent = Math.ceil(v.hp);
      this.ammoReserve.textContent = `/ ${v.maxHp} 耐久`;
      const weapon = v.type === 'tank' ? '主炮 / 并列机枪' : v.type === 'chopper' ? '机炮 / 火箭' : '车载机枪';
      this.weaponName.textContent = `${v.def.name} · ${weapon}`;
      this.ammoMag.classList.toggle('low-ammo', v.hp < v.maxHp * 0.3);
    } else if (w.isGrenadeSlot) {
      this.ammoMag.textContent = '×' + w.grenades;
      this.ammoReserve.textContent = '';
      this.weaponName.textContent = '碎片手雷';
    } else {
      this.ammoMag.textContent = w.mag;
      this.ammoReserve.textContent = '/ ' + w.reserve;
      this.ammoMag.classList.toggle('low-ammo', w.mag <= w.def.magSize * 0.25);
      this.weaponName.textContent = w.def.name + (w.reloading ? '（换弹中）' : '');
    }
    // 准星扩散
    const spread = game.driving ? 0.004 : (w.def ? w.computeSpread(p) : 0.01);
    const px = Math.min(26, 5 + spread * 900);
    this.crosshair.style.setProperty('--spread', px + 'px');
    // 波次 / 20V20 票数 / 目标
    const wm = game.waves;
    const objs = game.map.objectives;
    if (game.mode === 'battlefield' && game.battlefieldDirector) {
      const d = game.battlefieldDirector;
      this.waveInfo.innerHTML = `<span class="team-blue">蓝 ${d.blueTickets}</span>　20V20　<span class="team-red">红 ${d.redTickets}</span>`;
      const blueOwned = objs.filter(o => o.owner === 'blue').length;
      const redOwned = objs.filter(o => o.owner === 'red').length;
      this.objective.textContent = `据点控制：蓝 ${blueOwned} · 中立 ${objs.length - blueOwned - redOwned} · 红 ${redOwned}`;
      this.objective.classList.toggle('done', blueOwned === objs.length);
      const blueAlive = (p.alive ? 1 : 0) + game.allies.filter(a => a.alive).length;
      const redAlive = game.enemies.filter(e => e.alive).length;
      const blueVehicles = game.vehicles.filter(v => v.alive && v.team === 'blue').length;
      const redVehicles = game.vehicles.filter(v => v.alive && v.team === 'red').length;
      this.enemyCount.textContent = `兵力 蓝 ${blueAlive} : ${redAlive} 红　载具 ${blueVehicles} : ${redVehicles}`;
      this.el('bomb-info').classList.add('hidden');
    } else {
      const round = game.bombRound;
      const alive = game.enemies.filter(e => e.alive).length;
      this.waveInfo.textContent = game.bomb ? '爆破行动 · C4 已放置' : `爆破行动 · ${Math.ceil(round?.timeLeft ?? 150)}s`;
      if (game.bomb && !game.bomb.defused && !game.bomb.exploded) {
        this.el('bomb-info').classList.remove('hidden');
        const defuse = game.bomb.defuseT > 0 ? ` · 拆包 ${Math.round(game.bomb.defuseT / 5 * 100)}%` : '';
        this.el('bomb-info').textContent = `💣 ${Math.ceil(game.bomb.timer)}s 后引爆${defuse}`;
        this.objective.textContent = '目标：守住炸弹直到引爆';
      } else {
        this.el('bomb-info').classList.add('hidden');
        this.objective.textContent = game.planting ? '目标：正在放置炸弹' : '目标：A/B 点下包，或歼灭全部守军';
      }
      this.objective.classList.toggle('done', alive === 0 || !!game.bomb?.exploded);
      this.enemyCount.textContent = `守军存活 ${alive}`;
    }
    this.killCount.textContent = game.kills;
    this.hsCount.textContent = game.headshots;
    // 低血量红晕
    this.lowhp.classList.toggle('hidden', hpPct >= 30);
    // 交互提示
    const hint = game.interactHint;
    if (hint) {
      this.interactHint.classList.remove('hidden');
      this.interactHint.textContent = hint;
    } else this.interactHint.classList.add('hidden');
    // 中央消息计时
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.centerMsgEl.classList.add('hidden');
    }
    // 小地图
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) { this.miniTimer = 0.1; this.drawMinimap(game); }
    // 瞄准表现：狙击枪显示镜罩；大战场步枪/手枪机械瞄具时隐藏屏幕准星。
    const scoped = !game.driving && w.current !== 3 && w.def && w.adsAmount > 0.7 && w.def.type === 'sniper';
    const ironSight = !game.driving && game.mode === 'battlefield' && w.current !== 3 && w.def && w.def.type !== 'sniper' && w.adsAmount > 0.55;
    this.scopeOverlay.classList.toggle('hidden', !scoped);
    this.crosshair.classList.toggle('ads-hidden', scoped || ironSight);
    // 命中标记计时
    if (this._hitmarkT > 0) {
      this._hitmarkT -= dt;
      if (this._hitmarkT <= 0) this.hitmarkEl.classList.remove('show', 'hs');
    }
  }

  // 命中标记（准星中心 X）
  hitmark(headshot = false) {
    this._hitmarkT = 0.14;
    this.hitmarkEl.classList.add('show');
    this.hitmarkEl.classList.toggle('hs', headshot);
  }

  centerMsg(title, sub = '', dur = 2.6) {
    this.centerMsgEl.innerHTML = `<div class="cm-big">${title}</div>${sub ? `<div class="cm-sub">${sub}</div>` : ''}`;
    this.centerMsgEl.classList.remove('hidden', 'pop');
    void this.centerMsgEl.offsetWidth;
    this.centerMsgEl.classList.add('pop');
    this.msgTimer = dur;
  }

  killFeed(text, headshot) {
    const item = document.createElement('div');
    item.className = 'kill-item';
    item.innerHTML = text + (headshot ? ' <span class="hs">爆头!</span>' : '');
    this.killfeed.appendChild(item);
    while (this.killfeed.children.length > 5) this.killfeed.removeChild(this.killfeed.firstChild);
    setTimeout(() => { item.classList.add('fade'); setTimeout(() => item.remove(), 650); }, 2400);
  }

  popup(text, hs = false) {
    const el = document.createElement('div');
    el.className = 'popup' + (hs ? ' hs' : '');
    el.textContent = text;
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  showDamageDir(angle) {
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    const x = 50 + Math.sin(angle) * 30;
    const y = 50 + Math.cos(angle) * 30;
    arc.style.left = x + '%';
    arc.style.top = y + '%';
    arc.style.transform = `translate(-50%,-50%) rotate(${angle * 180 / Math.PI + 90}deg)`;
    this.dmgInd.appendChild(arc);
    setTimeout(() => arc.remove(), 750);
  }

  // ---------- 小地图 ----------
  drawMinimap(game) {
    const ctx = this.minimapCtx;
    const size = this.minimap.width;
    const m = game.map;
    const b = m.bounds;
    const mw = b[1] - b[0], mh = b[3] - b[2];
    const s = Math.min((size - 16) / mw, (size - 16) / mh);
    const ox = (size - mw * s) / 2, oy = (size - mh * s) / 2;
    const px = x => ox + (x - b[0]) * s;
    const py = z => oy + (z - b[2]) * s;

    ctx.clearRect(0, 0, size, size);
    // 背景
    ctx.fillStyle = 'rgba(8,12,16,0.82)';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#18232e';
    ctx.fillRect(ox, oy, mw * s, mh * s);
    ctx.strokeStyle = '#2a3542';
    ctx.strokeRect(ox, oy, mw * s, mh * s);
    // 建筑（碰撞体）
    ctx.fillStyle = '#3a4a58';
    for (const c of m.colliders) {
      if (c.h < 1.6) continue;
      const w = c.w * s, d = c.d * s;
      if (w < 2 || d < 2) continue;
      ctx.fillRect(px(c.x) - w / 2, py(c.z) - d / 2, w, d);
    }
    // 目标点
    for (const o of m.objectives) {
      ctx.beginPath();
      ctx.arc(px(o.pos.x), py(o.pos.z), 7, 0, 6.28);
      ctx.fillStyle = o.owner === 'blue' ? '#4aa8ff' : o.owner === 'red' ? '#ff5a4a' : (o.captured ? '#5fe08a' : '#ffb050');
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.stroke();
      ctx.fillStyle = '#0c1117';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.name[0], px(o.pos.x), py(o.pos.z) + 3);
    }
    // 补给点
    ctx.fillStyle = '#5fe08a';
    for (const sp of m.supplyPoints) {
      ctx.fillRect(px(sp.pos.x) - 2.5, py(sp.pos.z) - 2.5, 5, 5);
    }
    // 敌人（近处）
    const maxShow = game.mode === 'battlefield' ? 130 : 90;
    ctx.fillStyle = '#e04a4a';
    for (const e of game.enemies) {
      if (!e.alive) continue;
      if (e.pos.distanceTo(game.player.pos) > maxShow) continue;
      ctx.beginPath();
      ctx.arc(px(e.pos.x), py(e.pos.z), 3.2, 0, 6.28);
      ctx.fill();
    }
    // 友军
    ctx.fillStyle = '#4aa8ff';
    for (const a of game.allies || []) {
      if (!a.alive) continue;
      ctx.beginPath(); ctx.arc(px(a.pos.x), py(a.pos.z), 2.4, 0, 6.28); ctx.fill();
    }
    // 载具（方块=陆地，三角=空中）
    for (const v of game.vehicles || []) {
      if (!v.alive) continue;
      ctx.fillStyle = v.team === 'blue' ? '#68b9ff' : '#ff715f';
      if (v.type === 'chopper') {
        ctx.beginPath();
        ctx.moveTo(px(v.pos.x), py(v.pos.z) - 5);
        ctx.lineTo(px(v.pos.x) + 4, py(v.pos.z) + 4);
        ctx.lineTo(px(v.pos.x) - 4, py(v.pos.z) + 4);
        ctx.closePath(); ctx.fill();
      } else ctx.fillRect(px(v.pos.x) - 3.5, py(v.pos.z) - 3.5, 7, 7);
    }
    // 玩家
    const ppos = game.player.pos;
    ctx.save();
    ctx.translate(px(ppos.x), py(ppos.z));
    ctx.rotate(game.player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  showDeath(stats) { this.death.classList.remove('hidden'); this.deathStats.innerHTML = stats; }
  hideDeath() { this.death.classList.add('hidden'); }
  showWin(stats) { this.win.classList.remove('hidden'); this.winStats.innerHTML = stats; }
  hideWin() { this.win.classList.add('hidden'); }
  showLose(stats) { this.lose.classList.remove('hidden'); this.loseStats.innerHTML = stats; }
  hideLose() { this.lose.classList.add('hidden'); }
  showPause() { this.pause.classList.remove('hidden'); }
  hidePause() { this.pause.classList.add('hidden'); }
}
