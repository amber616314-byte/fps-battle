# ============================================================
# verify-v4.py — 第四轮专项验证
# 1) 战斗配置 UI：敌人规模/友军人数生效
# 2) 载具第三人称视角（相机在车尾后方）
# 3) 沙袋模型替换（sceneModels.sandbag 生效，地图无沙袋盒）
# 4) 敌人呼救（被击中 35m 内同伴进入 chase）
# 5) 开镜遮罩改为透光渐变
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

        # 1. 配置 UI：选「大规模 + 5 友军」
        await page.click('#enemy-scale-btns .cfg-btn[data-scale="1.6"]')
        await page.click('#ally-count-btns .cfg-btn[data-n="5"]')
        cfg = await page.evaluate('''() => {
            const g = window.__game;
            return { es: g.hud.options.enemyScale, ac: g.hud.options.allyCount };
        }''')
        check('敌人规模选择生效（大规模 1.6）', cfg['es'] == 1.6, f'(实际 {cfg["es"]})')
        check('友军人数选择生效（5 人）', cfg['ac'] == 5, f'(实际 {cfg["ac"]})')

        # 进入大战场（带配置）
        await page.click('.mode-card[data-mode="battlefield"]')
        await page.click('#btn-start')
        await page.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        await page.wait_for_timeout(1200)

        r = await page.evaluate('''() => {
            const g = window.__game;
            const out = {};
            // 配置生效检查
            out.maxEnemies = g.maxEnemies;
            out.allyCount = g.allies.length;
            out.enemyScale = g.options.enemyScale;
            // 沙袋模型检查
            let sandbagModels = 0;
            g.scene.traverse(c => {
                if (c.userData && c.userData.isSandbagModel) sandbagModels++;
            });
            out.sandbagModels = sandbagModels;
            // 第三人称驾驶：先上车（相机在主循环中更新）
            const v = g.vehicles[0];
            g.player.pos.set(v.pos.x + 1, v.pos.y, v.pos.z + 1);
            g.interact();
            out.driving = !!g.driving;
            return out;
        }''')
        check('E 键上车成功', r['driving'])

        # 等主循环更新第三人称相机 + 敌人呼救测试
        await page.wait_for_timeout(800)
        r2 = await page.evaluate('''async () => {
            const g = window.__game;
            const THREE = await import('./vendor/three.module.js');
            const out = {};
            // 手动驱动第三人称相机（headless 下 rAF 被节流，主循环不更新）
            for (let i = 0; i < 30; i++) g.updateDrivingCamera(1 / 30);
            const cam = g.camera.position.clone();
            const car = g.driving.pos.clone();
            out.camDist = Math.round(cam.distanceTo(car) * 10) / 10;
            out.camRelY = Math.round((cam.y - car.y) * 10) / 10;
            g.leaveVehicle();
            // 敌人呼救：两个敌人，一个被打，检查另一个进入 chase
            const e1 = g.spawnEnemy('grunt');
            const e2 = g.spawnEnemy('grunt');
            e1.pos.set(0, 0, 0);
            e2.pos.set(3, 0, 0);
            e1.state = 'patrol';
            e2.state = 'patrol';
            e1.takeDamage(10, new THREE.Vector3(1, 0, 0), false, new THREE.Vector3(10, 0, 10));
            out.e2StateAfter = e2.state;
            e1.remove();
            e2.remove();
            g.enemies = g.enemies.filter(x => x !== e1 && x !== e2);
            return out;
        }''')
        check('载具第三人称相机（车后 6-12m、相对高 2.5-5m）', r2['camDist'] >= 6 and r2['camDist'] <= 12 and r2['camRelY'] >= 2.5 and r2['camRelY'] <= 5, f'(距离 {r2["camDist"]}m 相对高 {r2["camRelY"]}m)')

        check('敌人规模 1.6 生效（maxEnemies 15→24）', r['maxEnemies'] >= 24, f'(实际 {r["maxEnemies"]})')
        check('友军 5 人生效', r['allyCount'] == 5, f'(实际 {r["allyCount"]})')
        check('沙袋模型已替换进场景（>30 个）', r['sandbagModels'] > 30, f'(实际 {r["sandbagModels"]})')
        check('敌人呼救：35m 内同伴进入 chase', r2['e2StateAfter'] == 'chase', f'(实际 {r2["e2StateAfter"]})')

        # 开镜遮罩样式（在游戏内检查）
        scope_ok = await page.evaluate('''() => getComputedStyle(document.getElementById('scope-overlay')).backgroundImage.includes('radial')''')
        check('开镜遮罩为径向透光渐变', scope_ok)

        await page.screenshot(path='tests/screenshots/verify-v4-battlefield.png')

        real_errors = [e for e in errors if 'favicon' not in e and '404' not in e]
        check('无控制台错误', len(real_errors) == 0, f'(实际 {len(real_errors)} 条)')
        for e in real_errors[:6]:
            print('   ', e)

        await browser.close()
        print('\n' + ('🎉 全部通过' if not FAILS else f'❌ 失败 {len(FAILS)} 项: {", ".join(FAILS)}'))

asyncio.run(main())
