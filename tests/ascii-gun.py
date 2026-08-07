import asyncio, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
        pg = await b.new_page(viewport={'width':1280,'height':720})
        await pg.goto('http://localhost:8080/', wait_until='domcontentloaded', timeout=30000)
        await pg.wait_for_selector('#menu:not(.hidden)', timeout=45000)
        await pg.click('.mode-card[data-mode="arena"]')
        await pg.click('#btn-start')
        await pg.wait_for_selector('#hud:not(.hidden)', timeout=15000)
        # 等模型热替换
        try:
            await pg.wait_for_function('''() => { const g = window.__game; return g && g.weapons && g.weapons.models[0].userData && g.weapons.models[0].userData.fromObj; }''', timeout=15000)
        except Exception:
            pass
        # 模型在 hip 姿态（不开镜）
        for idx, name in [(0, 'rifle'), (1, 'pistol'), (2, 'sniper')]:
            art = await pg.evaluate('''async ([idx]) => {
                const THREE = await import('./vendor/three.module.js');
                const g = window.__game;
                g.weapons.showSlot(idx);
                // headless 下主循环节流，手动驱动武器动画到 hip 姿态
                g.weapons.update(1 / 60, g.player);
                g.camera.updateMatrixWorld(true);
                g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
                const model = g.weapons.models[idx];
                model.updateMatrixWorld(true);
                const W = 78, H = 30;
                const grid = [];
                for (let y = 0; y < H; y++) grid.push(new Array(W).fill(' '));
                // 计数用密度图（更清晰）
                model.traverse(c => {
                    if (!c.isMesh) return;
                    const b = c.geometry.attributes.position;
                    const m = c.matrixWorld;
                    for (let i = 0; i < b.count; i++) {
                        // 局部 -> 世界 -> 相机空间 -> NDC
                        const v = new THREE.Vector3(b.getX(i), b.getY(i), b.getZ(i)).applyMatrix4(m);
                        const cv = v.clone().applyMatrix4(g.camera.matrixWorldInverse);
                        if (cv.z > -0.05 || cv.z < -200) continue; // 深度过滤（相机前方）
                        // 手写透视投影（绕过 projectionMatrix 状态问题）
                        const f = 1 / Math.tan(g.camera.fov * Math.PI / 360);
                        const ndcX = (f / g.camera.aspect) * cv.x / -cv.z;
                        const ndcY = f * cv.y / -cv.z;
                        if (Math.abs(ndcX) > 3 || Math.abs(ndcY) > 3) continue;
                        const x = Math.round((ndcX * 0.5 + 0.5) * (W - 1));
                        const y = Math.round((-ndcY * 0.5 + 0.5) * (H - 1));
                        if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = '#';
                    }
                });
                return grid.map(r => r.join('')).join('\\n');
            }''', [idx])
            print(f'===== {name} (hip 姿态，屏幕轮廓) =====')
            print(art)
            print()
        await b.close()

asyncio.run(main())
