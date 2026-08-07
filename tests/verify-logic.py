# ============================================================
# verify-logic.py — 逻辑级验证（通过 window.__game 句柄）
# 验证：后坐力方向 / 新武器模型 / 地图装饰 / 切枪 / HUD 元素
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

        # 进入竞技模式
        await page.click('.mode-card[data-mode="arena"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(1200)

        r = await page.evaluate('''() => {
            const g = window.__game;
            const out = {};
            // 1. 武器模型零件数（新精细建模）
            const model = g.weapons.models[g.weapons.current];
            let parts = 0;
            model.traverse(() => parts++);
            out.rifleParts = parts;
            out.fromObj = !!(model.userData && model.userData.fromObj);
            // 2. 后坐力方向：正 recoil 应使 pitch 增加（向上抬枪口）
            const p0 = g.player.recoilPitch;
            g.player.pitch = 0;
            g.player.addRecoil(0.02, 0);
            g.player.update(1 / 60, { move: {x:0,y:0}, crouch: false, sprint: false, jump: false });
            out.pitchAfter = g.player.pitch.toFixed(5);
            out.pitchSign = g.player.pitch > 0;
            // 3. 连射累积
            const before = g.weapons.recoilStack;
            for (let i = 0; i < 5; i++) {
                g.weapons.fireCooldown = 0;
                g.weapons.tryFire(g, g.player);
            }
            out.stackAfter = Math.round(g.weapons.recoilStack * 10) / 10;
            out.magAfter = g.weapons.mag;
            // 4. 地图装饰
            out.colliders = g.map.colliders.length;
            // 5. 切枪记忆
            g.weapons.switchTo(2);
            g.weapons.switchTo(0);
            out.lastSlot = g.weapons.lastSlot;
            g.weapons.quickSwitch();
            out.quickCurrent = g.weapons.current;
            // 6. HUD 命中标记
            out.hitmarkExists = !!document.getElementById('hitmarker');
            return out;
        }''')

        check('步枪使用下载高模（OBJ 替换程序化）', bool(r['fromObj']), f'(rifle parts={r["rifleParts"]}, fromObj={r["fromObj"]})')
        check('后坐力使准星向上抬（pitch > 0）', r['pitchSign'], f'(pitch={r["pitchAfter"]})')
        check('连射后坐力累积生效', r['stackAfter'] > 0, f'(stack={r["stackAfter"]})')
        check('连射消耗弹药', r['magAfter'] < 30, f'(mag={r["magAfter"]})')
        check('竞技场碰撞体数量 > 60（装饰增多）', r['colliders'] > 60, f'(实际 {r["colliders"]})')
        check('Q 键快速切枪返回上一把', r['quickCurrent'] == 2, f'(current={r["quickCurrent"]}, lastSlot={r["lastSlot"]})')
        check('命中标记元素存在', r['hitmarkExists'])

        # 大战场验证
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        await page.click('#btn-quit')
        await page.wait_for_selector('#menu:not(.hidden)', timeout=8000)
        await page.click('.mode-card[data-mode="battlefield"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(1500)

        r2 = await page.evaluate('''() => {
            const g = window.__game;
            return {
                colliders: g.map.colliders.length,
                name: g.map.name,
                groundOk: typeof g.map.groundHeight === 'function',
                enemies: g.enemies.length,
            };
        }''')
        check('大战场加载正常', r2['name'] == '钢铁前线' and r2['groundOk'], f'({r2["name"]})')
        check('大战场碰撞体数量 > 200（装饰增多）', r2['colliders'] > 200, f'(实际 {r2["colliders"]})')

        await page.screenshot(path='tests/screenshots/verify-battlefield.png')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e and 'ResizeObserver' not in e]
        check('无控制台错误', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:8]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
