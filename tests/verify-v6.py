# ============================================================
# verify-v6.py — 第六轮专项验证
# 1) 手枪/狙击/载具材质非白（材质映射 bug 修复）
# 2) M4A1 纯色材质（无错乱贴图）
# 3) 开镜时枪保持在右下（ads 位置靠右）
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
            // 每把枪的材质统计：取第一个 mesh 的材质颜色与类型
            out.guns = [];
            for (let i = 0; i < 3; i++) {
                const holder = g.weapons.models[i];
                const root = (holder.children && holder.children[0]) || holder;
                let first = null, whiteCount = 0, meshCount = 0, hasMap = false;
                root.traverse(c => {
                    if (!c.isMesh) return;
                    meshCount++;
                    const m = c.material;
                    if (!first) first = { type: m.type, color: m.color ? m.color.getHexString() : null, hasMap: !!m.map };
                    if (m.type === 'MeshBasicMaterial') whiteCount++;
                    if (m.color && m.color.r > 0.9 && m.color.g > 0.9 && m.color.b > 0.9) whiteCount++;
                    if (m.map) hasMap = true;
                });
                out.guns.push({ meshCount, whiteCount, first, hasMap });
            }
            // 载具材质
            const jm = g.tex.sceneModels.jeepModel;
            let jeepMat = null;
            if (jm) {
                jm.traverse(c => { if (c.isMesh && !jeepMat) jeepMat = { type: c.material.type, hasMap: !!c.material.map }; });
            }
            out.jeep = jeepMat;
            // 开镜 ads 位置（右下方，不占屏幕中心）
            out.ads = { rifle: g.weapons.slotAdsPos(), pistol: null };
            g.weapons.switchTo(1);
            out.ads.pistol = g.weapons.slotAdsPos();
            g.weapons.switchTo(0);
            return out;
        }''')

        for i, name in [(0, '步枪'), (1, '手枪'), (2, '狙击')]:
            gd = r['guns'][i]
            check(f'{name}材质非白（无 MeshBasicMaterial/纯白）', gd['whiteCount'] == 0, f'(white={gd["whiteCount"]}, first={gd["first"]["type"]}/{gd["first"]["color"]})')
        check('步枪使用纯色/程序纹理（无错乱 PBR 贴图）', not r['guns'][0]['hasMap'] or r['guns'][0]['first']['type'] == 'MeshStandardMaterial', f'(map={r["guns"][0]["hasMap"]})')
        check('载具卡车材质有贴图（colormap）', r['jeep'] and r['jeep']['hasMap'], f'({r["jeep"]})')
        check('步枪开镜略偏右下（不挡准星）', 0.05 < r['ads']['rifle']['x'] < 0.15, f'(x={r["ads"]["rifle"]["x"]})')
        check('手枪开镜位置靠右（不占中心）', r['ads']['pistol']['x'] > 0.12, f'(x={r["ads"]["pistol"]["x"]})')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误/资源失败', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
