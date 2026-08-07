# ============================================================
# verify-v9.py — 第九轮专项验证
# 1) 载具：耐久/被敌人打爆/撞击伤害/贴地
# 2) AI 占点：友军自动占点、敌人驻守
# 3) 大战场：地形起伏增强、帐篷/电线杆/战壕木板
# 4) 武器环境反射（envMapIntensity）
# ============================================================
import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from playwright.async_api import async_playwright

BASE = 'http://localhost:8080/'
FAILS = []

def check(name, cond, detail=''):
    mark = '✅' if cond else '❌'
    print(f'{mark} {name} {detail}')
    if not cond:
        FAILS.append(name)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox']
        )
        page = await browser.new_page(viewport={'width': 1280, 'height': 720})
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))

        await page.goto(BASE, wait_until='domcontentloaded', timeout=30000)
        await page.wait_for_selector('#menu:not(.hidden)', timeout=45000)
        await page.click('.mode-card[data-mode="battlefield"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(1200)

        r = await page.evaluate('''() => {
            const g = window.__game;
            const out = {};
            // 1. 载具耐久
            const v = g.vehicles[0];
            out.maxHp = v.maxHp;
            out.hp = v.hp;
            // 贴地：模拟驾驶几帧后检查与地面差
            v.pos.set(20, 0, 20);
            for (let i = 0; i < 20; i++) v.update(1 / 30, { move: {x:0,y:0}, sprint: false, jump: false, crouch: false });
            out.groundGap = Math.abs(v.pos.y - g.map.groundHeight(20, 20));
            // 打爆：直接扣到 0
            const before = g.vehicles.length;
            v.hp = 1;
            v.takeDamage(50, v.pos);
            out.vehiclesAfter = g.vehicles.length;
            out.removed = g.vehicles.length === before - 1;
            // 2. 撞击伤害：车高速撞敌人
            g.enemies.forEach(e => e.remove());
            g.enemies = [];
            const e = g.spawnEnemy('grunt');
            e.pos.set(22.5, 0, 20);
            const v2 = g.vehicles[0];
            v2.pos.set(20, 0, 20);
            v2.vel.set(15, 0, 0);
            for (let i = 0; i < 40; i++) v2.update(1 / 30, { move: {x:0,y:0}, sprint: false, jump: false, crouch: false });
            out.enemyHp = e.hp;
            out.enemyHurt = e.hp < 60;
            e.remove();
            g.enemies = g.enemies.filter(x => x !== e);
            // 3. 武器环境反射
            out.gunEnv = g.weapons.models[0].traverse ? 1 : 0;
            let gunEnvI = 0;
            g.weapons.models[1].traverse(c => { if (c.isMesh && !gunEnvI) gunEnvI = c.material.envMapIntensity || 0; });
            out.gunEnvI = gunEnvI;
            out.envIntensity = g.scene.environmentIntensity;
            return out;
        }''')

        check('载具耐久存在（吉普 350）', r['maxHp'] == 350, f'(实际 {r["maxHp"]})')
        check('吉普贴地（地面差 < 0.6m）', r['groundGap'] < 0.6, f'(实际 {r["groundGap"]}m)')
        check('载具被打爆后移除', r['removed'], f'(剩余 {r["vehiclesAfter"]} 辆)')
        check('高速撞击伤害敌人', r['enemyHurt'], f'(敌人 hp {r["enemyHp"]}/60)')
        check('武器材质环境反射挂钩（envI>0）', r['gunEnvI'] > 0.5, f'(实际 {r["gunEnvI"]})')
        check('场景环境强度 0.85', r['envIntensity'] == 0.85, f'(实际 {r["envIntensity"]})')

        # 友军占点测试（同步 evaluate）
        r2 = await page.evaluate('''() => {
            const g = window.__game;
            const out = {};
            // 清空敌人，找一个未占领目标点
            g.enemies.forEach(e => e.remove());
            g.enemies = [];
            const o = g.map.objectives.find(x => !x.captured);
            if (!o) { out.noObjective = true; return out; }
            // 友军放到目标点站圈 6 秒（模拟）
            const a = g.allies[0];
            if (!a) { out.noAlly = true; return out; }
            a.pos.set(o.pos.x, o.pos.y, o.pos.z);
            a.capT = 5.5; // 接近完成
            for (let i = 0; i < 20; i++) a.update(1/30);
            out.capturedByAlly = !!g.map.objectives.find(x => x === o && x.captured);
            return out;
        }''')
        check('友军站圈自动占领目标点', r2.get('capturedByAlly') == True, f'({r2})')

        # 大战场细节
        r3 = await page.evaluate('''() => {
            const g = window.__game;
            // 帐篷：找 ConeGeometry 且位置低
            let tents = 0, poles = 0;
            g.scene.traverse(c => {
                if (c.isMesh && c.geometry && c.geometry.type === 'ConeGeometry' && c.position.y < 3) tents++;
                if (c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry' && c.geometry.parameters && c.geometry.parameters.radiusTop === 0.06) poles++;
            });
            return { tents, poles };
        }''')
        check('帐篷存在（>2）', r3['tents'] >= 3, f'(实际 {r3["tents"]})')
        check('电线杆存在（>5）', r3['poles'] >= 6, f'(实际 {r3["poles"]})')

        # 地形起伏：地面高度范围
        r4 = await page.evaluate('''() => {
            const g = window.__game;
            let min = 1e9, max = -1e9;
            // 确定性网格采样（覆盖峰谷）
            for (let ix = 0; ix <= 40; ix++) {
                for (let iz = 0; iz <= 40; iz++) {
                    const x = -190 + ix * (380 / 40), z = -190 + iz * (380 / 40);
                    const h = g.map.groundHeight(x, z);
                    if (h < min) min = h;
                    if (h > max) max = h;
                }
            }
            return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, range: Math.round((max - min) * 10) / 10 };
        }''')
        check('地形高低差增强（>15m）', r4['range'] > 15, f'(实际范围 {r4["min"]}..{r4["max"]}m, 差 {r4["range"]}m)')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
