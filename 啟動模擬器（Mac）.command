#!/bin/bash
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 serve.py
else
  echo "找不到 Python 3，請先安裝：https://www.python.org/downloads/"
  read -p "按 Enter 關閉…"
fi
