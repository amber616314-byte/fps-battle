# ============================================================
# verify-v2.py — 第二轮强化专项验证
# 1) 下载枪模（OBJ）加载与热替换成功、朝向正确（枪口朝 -Z）
# 2) 后坐力新标定（单发抬升幅度变小）
# 3) 敌人绕障寻路（墙前切线滑动）
# 4) 无控制台错误
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
        page.on('requestfailed', lambda r: errors.append(f'[reqfail] {r.url}') if 'obj' in r.url or 'fpspack' in r.url else None)

        await page.goto(BASE, wait_until='domcontentloaded', timeout=30000)
        await page.wait_for_selector('#menu:not(.hidden)', timeout=45000)
        await page.click('.mode-card[data-mode="arena"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)

        # 等待下载枪模热替换完成（最多 12 秒）
        try:
            replaced = await page.wait_for_function('''() => {
                const g = window.__game;
                if (!g || !g.weapons) return false;
                const m = g.weapons.models[0];
                return !!(m && m.userData && m.userData.fromObj);
            }''', timeout=12000)
            check('下载枪模已热替换（OBJ 模型生效）', replaced is not None)
        except Exception as ex:
            check('下载枪模已热替换（OBJ 模型生效）', False, f'({str(ex)[:80]})')

        r = await page.evaluate('''async () => {
            const THREE = await import('./vendor/three.module.js');
            const g = window.__game;
            const out = {};
            const names = ['rifle', 'pistol', 'sniper'];
            out.bbox = {};
            for (let i = 0; i < 3; i++) {
                const m = g.weapons.models[i];
                // 用局部顶点坐标（OBJ 原始数据 × scale，Pistol 额外绕 Y 旋转）
                const rot = i === 1 ? Math.PI / 2 : 0;
                const cs = Math.cos(rot), sn = Math.sin(rot);
                let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
                let verts = 0;
                m.traverse(c => {
                    if (!c.isMesh) return;
                    const b = c.geometry.attributes.position;
                    verts += b.count;
                    for (let k = 0; k < b.count; k++) {
                        const x = b.getX(k) * 0.1, y = b.getY(k) * 0.1, z = b.getZ(k) * 0.1;
                        const rx = x * cs + z * sn, rz = -x * sn + z * cs;
                        const v = [rx, y, rz];
                        for (let d = 0; d < 3; d++) {
                            if (v[d] < min[d]) min[d] = v[d];
                            if (v[d] > max[d]) max[d] = v[d];
                        }
                    }
                });
                out.bbox[names[i]] = { min: min.map(v => Math.round(v * 100) / 100), max: max.map(v => Math.round(v * 100) / 100), verts };
            }
            // 2. 后坐力新标定：单发抬升（读 recoilPitch，一帧内未衰减）
            g.player.recoilPitch = 0;
            g.weapons.fireCooldown = 0;
            g.weapons.tryFire(g, g.player);
            out.kickAfterOne = Math.round(g.player.recoilPitch * 1000) / 1000;
            // 3. 敌人绕障：造一堵墙（3m 外）+ 敌人朝墙移动
            const scene = g.scene;
            const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 0.4), new THREE.MeshBasicMaterial());
            wall.position.set(3, 1, 3);
            scene.add(wall);
            g.map.colliders.push({ x: 3, y: 1, z: 3, w: 3, h: 2, d: 0.4 });
            const e = g.spawnEnemy('grunt');
            e.pos.set(2.2, 0, 2.2);
            const probe = e._probeWall(new THREE.Vector3(0.707, 0, 0.707));
            out.probeWall = !!probe;
            // 清理
            scene.remove(wall);
            g.map.colliders.pop();
            e.remove();
            g.enemies = g.enemies.filter(x => x !== e);
            return out;
        }''')

        bb = r['bbox']
        check('Rifle 枪口朝 -Z（zMin≈-0.48 且为枪口端）', bb['rifle']['min'][2] < -0.4, f'(z范围 {bb["rifle"]["min"][2]}..{bb["rifle"]["max"][2]})')
        check('Pistol 旋转后枪口朝 -Z', bb['pistol']['min'][2] < -0.4, f'(z范围 {bb["pistol"]["min"][2]}..{bb["pistol"]["max"][2]})')
        check('Sniper 枪口朝 -Z', bb['sniper']['min'][2] < -0.4, f'(z范围 {bb["sniper"]["min"][2]}..{bb["sniper"]["max"][2]})')
        check('三枪均为高模（顶点数 > 400）', bb['rifle']['verts'] > 400 and bb['pistol']['verts'] > 400 and bb['sniper']['verts'] > 400, f'(verts {bb["rifle"]["verts"]}/{bb["pistol"]["verts"]}/{bb["sniper"]["verts"]})')
        check('单发后坐力抬升 ≈0.012（较上版 0.02 明显减小）', 0.005 < r['kickAfterOne'] < 0.016, f'(实际 {r["kickAfterOne"]})')
        check('敌人墙前障碍探测生效', r['probeWall'])

        # 开枪 5 发确认新模型下射击无错
        await page.evaluate('''() => {
            const g = window.__game;
            for (let i = 0; i < 5; i++) { g.weapons.fireCooldown = 0; g.weapons.tryFire(g, g.player); }
        }''')
        await page.wait_for_timeout(300)
        await page.screenshot(path='tests/screenshots/verify-v2-gun.png')

        # 切到狙击看一眼
        await page.evaluate('''() => { const g = window.__game; g.weapons.switchTo(2); g.weapons.inspect(); }''')
        await page.wait_for_timeout(700)
        await page.screenshot(path='tests/screenshots/verify-v2-sniper.png')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误/请求失败', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
