# ============================================================
# verify-v8.py — 第八轮专项验证
# 1) 地面纯哑光（无 roughnessMap / envMapIntensity=0）
# 2) 枪感参数（射速 0.095 / 后坐力 0.015）
# 3) 敌我头顶标识（敌人红 / 友军蓝）
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
                if (!g || !g.weapons) return false;
                const m = g.weapons.models[0];
                return !!(m && m.userData && (m.userData.tilt || (m.children[0] && m.children[0].userData && m.children[0].userData.fromObj)));
            }''', timeout=15000)
        except Exception:
            pass

        r = await page.evaluate('''() => {
            const g = window.__game;
            const out = {};
            // 1. 地面材质
            const sand = g.tex.ph.sand;
            out.sand = {
                hasRoughnessMap: !!sand.roughnessMap,
                envI: sand.envMapIntensity,
                metalness: sand.metalness,
                roughness: sand.roughness,
                hasBump: !!sand.bumpMap,
            };
            // 2. 枪感参数
            out.weapons = {
                rifleInterval: g.weapons.slots[0].def.interval,
                rifleKick: g.weapons.slots[0].def.recoilKick,
                pistolKick: g.weapons.slots[1].def.recoilKick,
                sniperKick: g.weapons.slots[2].def.recoilKick,
            };
            // 3. 敌我标识
            g.enemies.forEach(e => e.remove());
            g.enemies = [];
            const e = g.spawnEnemy('grunt');
            const ally = g.allies[0];
            out.enemyIndicator = !!e.indicator;
            out.allyIndicator = !!(ally && ally.indicator);
            if (e.indicator) {
                const mat = e.indicator.material;
                out.enemyColor = mat.map ? 'has-map' : 'none';
                out.enemyVisible = e.indicator.visible;
            }
            e.remove();
            g.enemies = g.enemies.filter(x => x !== e);
            return out;
        }''')

        check('沙地无 roughnessMap（纯哑光）', not r['sand']['hasRoughnessMap'])
        check('沙地环境反射 = 0', r['sand']['envI'] == 0, f'(实际 {r["sand"]["envI"]})')
        check('沙地金属度 0 + 粗糙度 1', r['sand']['metalness'] == 0 and r['sand']['roughness'] == 1)
        check('沙地 bump 视差保留', r['sand']['hasBump'])
        check('步枪射速 0.095s（手感实在）', r['weapons']['rifleInterval'] == 0.095, f'(实际 {r["weapons"]["rifleInterval"]})')
        check('步枪后坐力 0.015', r['weapons']['rifleKick'] == 0.015, f'(实际 {r["weapons"]["rifleKick"]})')
        check('手枪后坐力 0.018 / 狙击 0.042', r['weapons']['pistolKick'] == 0.018 and r['weapons']['sniperKick'] == 0.042)
        check('敌人红色头顶标识存在', r['enemyIndicator'] and r['enemyVisible'])
        check('友军蓝色头顶标识存在', r['allyIndicator'])

        # 大战场草地材质
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        await page.click('#btn-quit')
        await page.wait_for_selector('#menu:not(.hidden)', timeout=8000)
        await page.click('.mode-card[data-mode="battlefield"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(800)
        r2 = await page.evaluate('''() => {
            const g = window.__game;
            // 找地面 mesh（第一个 PlaneGeometry 且位置低）
            let ground = null;
            g.scene.traverse(c => {
                if (!ground && c.isMesh && c.geometry && c.geometry.type === 'PlaneGeometry' && c.material && c.material.bumpMap) ground = c;
            });
            return ground ? { envI: ground.material.envMapIntensity, hasBump: !!ground.material.bumpMap } : null;
        }''')
        check('大战场草地纯哑光 + 视差', r2 and r2['envI'] == 0 and r2['hasBump'], f'({r2})')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
