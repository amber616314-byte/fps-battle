# ============================================================
# e2e-test.py — 真实浏览器端到端验证（Playwright + Chromium）
# 打开游戏 → 等待加载 → 捕获错误 → 截图 → 进入游戏测试
# ============================================================
import asyncio
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from playwright.async_api import async_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:8080/')
RESULTS = []

def log(msg):
    print(msg, flush=True)
    RESULTS.append(msg)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
            headless=True,
            args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox']
        )
        page = await browser.new_page(viewport={'width': 1280, 'height': 720})

        console_errors = []
        page.on('console', lambda m: console_errors.append(f'[console.{m.type}] {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: console_errors.append(f'[pageerror] {e}'))
        page.on('requestfailed', lambda r: console_errors.append(f'[requestfailed] {r.url} -> {r.failure}'))

        try:
            await page.goto(BASE, wait_until='domcontentloaded', timeout=30000)
            log('页面已加载，等待游戏初始化…')

            # 等待游戏菜单出现（加载完成的标志）
            try:
                await page.wait_for_selector('#menu:not(.hidden)', timeout=40000)
                log('✅ 加载完成，游戏菜单已显示')
            except Exception:
                err_text = ''
                try:
                    if await page.is_visible('#loading-error'):
                        err_text = await page.text_content('#loading-error')
                except Exception:
                    pass
                log(f'❌ 加载卡住！错误提示: {err_text or "(无错误提示)"}')
                await page.screenshot(path='tests/screenshots/e2e-stuck.png')
                log('已保存 e2e-stuck.png')
                log('控制台错误:')
                for e in console_errors:
                    log('  ' + e)
                await browser.close()
                return

            await page.screenshot(path='tests/screenshots/e2e-menu.png')
            log('已保存菜单截图 e2e-menu.png')

            # 点击竞技模式卡片
            await page.click('.mode-card[data-mode="arena"]')
            log('已选择「竞技风暴」')
            await page.screenshot(path='tests/screenshots/e2e-selected.png')

            # 点击开始按钮
            await page.click('#btn-start')
            log('已点击开始，等待进入游戏…')

            # 进入游戏后 HUD 应显示
            try:
                await page.wait_for_selector('#hud:not(.hidden)', timeout=20000)
                log('✅ 游戏已启动，HUD 显示')
            except asyncio.TimeoutError:
                log('❌ 游戏未启动（HUD 未显示）')
                await page.screenshot(path='tests/screenshots/e2e-ingame-fail.png')

            # 等几帧渲染
            await asyncio.sleep(3)
            await page.screenshot(path='tests/screenshots/e2e-ingame.png')
            log('已保存游戏内截图 e2e-ingame.png')

            # 模拟按键：切枪、开火
            await page.keyboard.press('Digit2')
            await page.keyboard.press('Digit3')
            await page.keyboard.press('Digit1')
            await page.keyboard.down('KeyW')
            await asyncio.sleep(1)
            await page.keyboard.up('KeyW')
            await page.mouse.down(button='left')
            await asyncio.sleep(0.3)
            await page.mouse.up(button='left')
            log('已模拟移动与开火')

            await asyncio.sleep(1)
            await page.screenshot(path='tests/screenshots/e2e-action.png')
            log('已保存操作后截图 e2e-action.png')

            # 打印控制台错误（如果有）
            real_errors = [e for e in console_errors if 'favicon' not in e and '404' not in e]
            if real_errors:
                log('控制台错误:')
                for e in real_errors:
                    log('  ' + e)
            else:
                log('✅ 无控制台错误')

        except Exception as ex:
            log(f'❌ 测试异常: {ex}')
            try:
                await page.screenshot(path='tests/screenshots/e2e-error.png')
            except Exception:
                pass
        finally:
            await browser.close()

    ok = all('❌' not in r for r in RESULTS) and any('✅ 加载完成' in r for r in RESULTS)
    log('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)

asyncio.run(main())

