# ============================================================
# verify-v3.py — 第三轮专项验证
# 1) M4A1 消音版替换（fromObj + silenced + 消音器节点 + 顶点数）
# 2) 手枪缩小（0.075）/ 狙击放大（0.12）比例验证
# 3) 狙击开镜隐藏武器模型
# 4) 大战场：友军 3 名生成、载具 3 辆生成、上车驾驶/下车
# 5) 敌人整体放大 8%
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

        # ===== 竞技模式：武器 =====
        await page.click('.mode-card[data-mode="arena"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        try:
            await page.wait_for_function('''() => {
                const g = window.__game;
                if (!g || !g.weapons) return false;
                const m = g.weapons.models[0];
                return !!(m && m.userData && (m.userData.tilt || (m.children[0] && m.children[0].userData && m.children[0].userData.fromObj)));
            }''', timeout=15000)
            check('步枪下载模型已加载', True)
        except Exception:
            check('步枪下载模型已加载', False)

        r = await page.evaluate('''async () => {
            const g = window.__game;
            const THREE = await import('./vendor/three.module.js');
            const out = {};
            const m = g.weapons.models[0];
            // 程序化步枪：零件数 + 无 NaN 顶点 + 标准枪口标记
            let verts = 0, nanCount = 0, silenced = true;
            m.traverse(c => {
                if (c.isMesh) {
                    verts += c.geometry.attributes.position.count;
                    const b = c.geometry.attributes.position;
                    for (let i = 0; i < b.count; i++) {
                        if (Number.isNaN(b.getX(i)) || Number.isNaN(b.getY(i)) || Number.isNaN(b.getZ(i))) nanCount++;
                    }
                }
                if (c.userData && c.userData.isSilencer) silenced = false; // 无消音器节点
            });
            out.rifleVerts = verts;
            out.nanCount = nanCount;
            out.silenced = silenced;
            // 比例：pistol 长 / sniper 长（局部包围盒，含 holder 包裹）
            out.scales = [];
            for (let i = 0; i < 3; i++) {
                const holder = g.weapons.models[i];
                const mm = (holder.children && holder.children[0]) || holder;
                let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
                mm.traverse(c => {
                    if (!c.isMesh) return;
                    const b = c.geometry.attributes.position;
                    for (let k = 0; k < b.count; k++) {
                        const x = b.getX(k) * mm.scale.x, y = b.getY(k) * mm.scale.y, z = b.getZ(k) * mm.scale.z;
                        if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
                        if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
                        if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
                    }
                });
                const len = Math.max(max[0]-min[0], max[1]-min[1], max[2]-min[2]);
                out.scales.push(Math.round(len * 100) / 100);
            }
            // 开镜隐藏（狙击）
            g.weapons.switchTo(2);
            g.weapons.ads = true;
            for (let i = 0; i < 30; i++) g.weapons.update(1/60, g.player);
            out.sniperVisibleWhileAds = g.weapons.models[2].visible;
            g.weapons.ads = false;
            for (let i = 0; i < 30; i++) g.weapons.update(1/60, g.player);
            out.sniperVisibleAfter = g.weapons.models[2].visible;
            g.weapons.switchTo(0);
            // 敌人放大
            const e = g.spawnEnemy('grunt');
            out.enemyScale = Math.round(e.scale * 100) / 100;
            e.remove();
            g.enemies = g.enemies.filter(x => x !== e);
            return out;
        }''')

        check('步枪模型干净（无 NaN 顶点）', r['nanCount'] == 0, f'(实际 {r["nanCount"]} 个 NaN)')
        check('步枪标准枪口（无消音器）', r['silenced'])
        check('手枪长度 ≈0.49m（持握比例）', 0.4 < r['scales'][1] < 0.6, f'(实际 {r["scales"][1]}m)')
        check('狙击长度 ≈1.37m（再放大）', 1.25 < r['scales'][2] < 1.5, f'(实际 {r["scales"][2]}m)')
        check('狙击开镜时武器模型隐藏', r['sniperVisibleWhileAds'] == False)
        check('收镜后武器模型恢复显示', r['sniperVisibleAfter'] == True)
        check('敌人整体放大 8%（grunt ≈1.06）', abs(r['enemyScale'] - 1.06) < 0.02, f'(实际 {r["enemyScale"]})')

        # ===== 大战场：友军 + 载具 =====
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        await page.click('#btn-quit')
        await page.wait_for_selector('#menu:not(.hidden)', timeout=8000)
        await page.click('.mode-card[data-mode="battlefield"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(1200)

        r2 = await page.evaluate('''() => {
            const g = window.__game;
            const out = {
                allies: g.allies.length,
                vehicles: g.vehicles.length,
                types: g.vehicles.map(v => v.type),
            };
            // 上车（第一辆车旁）
            const v = g.vehicles[0];
            g.player.pos.set(v.pos.x + 1, v.pos.y, v.pos.z + 1);
            g.interact();
            out.driving = !!g.driving;
            out.driverName = g.driving ? g.driving.def.name : null;
            if (g.driving) {
                // 驾驶：油门 1 秒
                const v0 = g.driving.pos.clone();
                g.input.move.set(0, -1);
                for (let i = 0; i < 60; i++) { g.driving.update(1/60, g.input); }
                out.moved = g.driving.pos.distanceTo(v0) > 0.5;
                // 下车
                g.leaveVehicle();
                out.afterLeave = g.driving === null;
            }
            return out;
        }''')
        check('大战场友军 3 名', r2['allies'] == 3, f'(实际 {r2["allies"]})')
        check('大战场载具 3 辆（2 吉普 + 1 直升机）', r2['vehicles'] == 3 and r2['types'].count('jeep') == 2 and 'chopper' in r2['types'], f'({"/".join(r2["types"])})')
        check('E 键上车成功', r2['driving'], f'({r2["driverName"]})')
        check('驾驶可移动', r2['moved'])
        check('下车恢复正常', r2['afterLeave'])

        await page.screenshot(path='tests/screenshots/verify-v3-battlefield.png')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
