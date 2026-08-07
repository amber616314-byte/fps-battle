# ============================================================
# verify-v5.py — 第五轮专项验证
# 1) 持枪倾角（rifle/pistol/sniper holder tilt）
# 2) Kenney 模型加载（卡车替换吉普、路障/残骸/油罐/烟囱/废墟楼）
# 3) 眩光标定（环境强度/曝光/竞技场阳光）
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
        await page.click('.mode-card[data-mode="arena"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        try:
            await page.wait_for_function('''() => {
                const g = window.__game;
                if (!g || !g.weapons || !g.weapons.models[0].userData) return false;
                return !!(g.weapons.models[0].userData.fromObj || (g.weapons.models[0].children[0] && g.weapons.models[0].children[0].userData && g.weapons.models[0].children[0].userData.fromObj));
            }''', timeout=15000)
        except Exception:
            pass

        r = await page.evaluate('''() => {
            const g = window.__game;
            const out = {};
            // 1. 持枪倾角：模型被 holder 包裹，holder.rotation.x 应为倾斜角
            out.tilts = [];
            for (let i = 0; i < 3; i++) {
                const m = g.weapons.models[i];
                out.tilts.push(Math.round((m.rotation.x || 0) * 100) / 100);
            }
            // 2. Kenney 模型加载
            const sm = g.tex.sceneModels || {};
            out.sm = {};
            for (const k of ['jeepModel', 'cone', 'crate', 'debris', 'tank', 'chimney', 'building', 'sandbag']) {
                out.sm[k] = !!sm[k];
            }
            // 场景中 cone 实例数（克隆品）
            let cones = 0;
            g.scene.traverse(c => {
                if (c.userData && c.userData.fromSceneModel === 'cone') cones++;
            });
            out.coneInstances = cones;
            // 3. 眩光标定
            out.exposure = Math.round(g.renderer.toneMappingExposure * 100) / 100;
            out.envIntensity = g.scene.environmentIntensity != null ? Math.round(g.scene.environmentIntensity * 100) / 100 : null;
            out.sunI = Math.round(g.sun.intensity * 100) / 100;
            return out;
        }''')

        check('步枪持枪倾角 0.55（枪身斜指屏幕中心）', abs(r['tilts'][0] - 0.55) < 0.05, f'(实际 {r["tilts"][0]})')
        check('手枪持枪倾角 0.5', abs(r['tilts'][1] - 0.5) < 0.05, f'(实际 {r["tilts"][1]})')
        check('狙击持枪倾角 0.55', abs(r['tilts'][2] - 0.55) < 0.05, f'(实际 {r["tilts"][2]})')
        check('Kenney 卡车模型已加载（替换吉普）', r['sm']['jeepModel'])
        check('Kenney 道具模型全部加载', r['sm']['cone'] and r['sm']['crate'] and r['sm']['debris'] and r['sm']['tank'] and r['sm']['chimney'] and r['sm']['building'] and r['sm']['sandbag'])
        check('竞技场路障锥实例 > 8', r['coneInstances'] > 8, f'(实际 {r["coneInstances"]})')
        check('曝光 0.95（增强光影）', r['exposure'] == 0.95, f'(实际 {r["exposure"]})')
        check('环境强度 0.85（增强光影）', r['envIntensity'] == 0.85, f'(实际 {r["envIntensity"]})')

        # 大战场：油罐/烟囱/废墟楼
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        await page.click('#btn-quit')
        await page.wait_for_selector('#menu:not(.hidden)', timeout=8000)
        await page.click('.mode-card[data-mode="battlefield"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(1000)
        r2 = await page.evaluate('''() => {
            const g = window.__game;
            let tanks = 0, chimneys = 0, buildings = 0, jeeps = 0;
            g.scene.traverse(c => {
                const u = c.userData || {};
                if (u.fromSceneModel === 'tank') tanks++;
                if (u.fromSceneModel === 'chimney') chimneys++;
                if (u.fromSceneModel === 'building') buildings++;
            });
            // 吉普视觉模型（truck 替换）：vehicles[0].model.children.length > 0 且第一个是 truck 克隆
            const v0 = g.vehicles[0];
            jeeps = v0.model.children.length;
            return { tanks, chimneys, buildings, jeeps, sunI: Math.round(g.sun.intensity * 100) / 100 };
        }''')
        check('大战场油罐 4 个', r2['tanks'] == 4, f'(实际 {r2["tanks"]})')
        check('大战场烟囱 4 个', r2['chimneys'] == 4, f'(实际 {r2["chimneys"]})')
        check('大战场废墟楼 4 个', r2['buildings'] == 4, f'(实际 {r2["buildings"]})')
        check('吉普视觉 = 卡车模型', r2['jeeps'] >= 1)
        check('大战场阳光 1.8（竞技场 1.45）', r2['sunI'] == 1.8, f'(实际 {r2["sunI"]})')

        await page.screenshot(path='tests/screenshots/verify-v5-battlefield.png')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
