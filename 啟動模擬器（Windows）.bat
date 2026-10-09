@echo off
chcp 65001 >nul
title Tello 飛行模擬器
cd /d "%~dp0"
python --version >nul 2>&1
if %errorlevel%==0 (
    python serve.py
    goto end
)
py -3 --version >nul 2>&1
if %errorlevel%==0 (
    py -3 serve.py
    goto end
)
echo.
echo 找不到 Python！
echo 請先到 https://www.python.org/downloads/ 下載安裝 Python 3，
echo 安裝時記得勾選「Add python.exe to PATH」，然後再雙擊這個檔案一次。
echo.
:end
pause
