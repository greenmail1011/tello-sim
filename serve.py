# -*- coding: utf-8 -*-
"""
Tello 飛行模擬器 —— 教室用的小型網頁伺服器
在老師電腦執行後，同一個路由器底下的學生用瀏覽器打開畫面上顯示的網址即可。
不需要網路，也不需要安裝任何套件（只要有 Python 3）。
"""
import http.server
import os
import socket
import sys
import webbrowser

PORTS = list(range(8000, 8011))
HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".py": "text/plain; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json",
        ".zip": "application/zip",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        if self.path.startswith("/lib/"):
            self.send_header("Cache-Control", "public, max-age=604800")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 不要洗版


def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return [ip for ip in ips if not ip.startswith("127.")] or ["127.0.0.1"]


def main():
    server = None
    for port in PORTS:
        try:
            server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        print("找不到可以用的連接埠（8000～8010 都被占用了）")
        input("按 Enter 關閉…")
        sys.exit(1)
    port = server.server_address[1]
    print("=" * 56)
    print("  Tello 飛行模擬器已啟動！")
    print("-" * 56)
    print("  老師這台電腦：  http://localhost:%d" % port)
    for ip in lan_ips():
        print("  學生請輸入：    http://%s:%d" % (ip, port))
    print("-" * 56)
    print("  這個視窗要一直開著，關掉模擬器就停止了。")
    print("  （Windows 若跳出防火牆詢問，請按「允許存取」）")
    print("=" * 56)
    try:
        webbrowser.open("http://localhost:%d" % port)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n模擬器已停止。")


if __name__ == "__main__":
    main()
