import assert from 'node:assert/strict';
import fs from 'node:fs';

const weapons = fs.readFileSync(new URL('../js/weapons.js', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const hud = fs.readFileSync(new URL('../js/hud.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

console.log('[战斗修复回归]');
assert.match(weapons, /damage:\s*34,\s*hsMult:\s*3\.1/);
assert.match(weapons, /damage:\s*48,\s*hsMult:\s*2\.45/);
assert.match(weapons, /damage:\s*220,\s*hsMult:\s*1\.35/);
console.log('  ✓ 三把枪威力已重新标定');

assert.match(weapons, /game\.worldRay\(aimOrigin, dir, def, true\)/);
assert.doesNotMatch(weapons, /game\.worldRay\(muzzle, shotDir, def, true\)/);
console.log('  ✓ 命中以准星射线为准，不再被右下枪口二次射线误拦截');

assert.match(player, /frameRecoilPitch/);
assert.doesNotMatch(player, /this\.pitch \+= this\.recoilPitch;/);
assert.match(player, /_moveAxis\('x'/);
console.log('  ✓ 后坐力不再逐帧重复积分，移动采用稳定分步碰撞');

assert.match(main, /startBombMission\(\)/);
assert.match(main, /updateBombMission\(dt\)/);
assert.doesNotMatch(main, /else this\.waves\.start\(8\)/);
assert.doesNotMatch(main, /else this\.waves\.update\(dt\)/);
assert.match(main, /A\/B 点下包并守到引爆/);
console.log('  ✓ 爆破模式已脱离第一波/第二波系统');

assert.match(hud, /爆破行动/);
assert.doesNotMatch(html, /8 波敌人/);
assert.match(html, /敌人不会按第一波、第二波重复刷新/);
console.log('  ✓ 菜单与 HUD 已同步为真正爆破规则');

console.log('✅ 战斗修复回归测试全部通过');
