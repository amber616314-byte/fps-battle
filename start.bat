@echo off
chcp 65001 >nul
cd /d %~dp0
title 钢铁前线 - 游戏服务器
echo ==============================================
echo   钢铁前线 STEEL FRONTLINE 正在启动...
echo ==============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 未检测到 Node.js！
  echo   请先安装 Node.js: https://nodejs.org  (安装后重新双击本文件)
  echo.
  pause
  exit /b 1
)
start /b node server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:8080
echo   游戏已在浏览器中打开: http://localhost:8080
echo   若浏览器未自动打开，请手动访问上面的地址
echo   关闭此窗口即可停止游戏服务器
echo.
pause
