# -*- coding: utf-8 -*-
"""
Tello 飛行模擬器 —— 教室用的小型網頁伺服器（含比賽模式）
在老師電腦執行後，同一個路由器底下的學生用瀏覽器打開畫面上顯示的網址即可。
不需要網路，也不需要安裝任何套件（只要有 Python 3）。

  學生畫面：  http://<老師IP>:8000/
  老師控制台：http://<老師IP>:8000/teacher.html   （需要 PIN 碼）
  大螢幕投影：http://<老師IP>:8000/index.html?screen=1
"""
import http.server
import json
import os
import random
import socket
import sys
import threading
import time
import uuid
import webbrowser

PORTS = list(range(8000, 8011))
HERE = os.path.dirname(os.path.abspath(__file__))
ARENA_FILE = os.path.join(HERE, "arena.json")
PIN = os.environ.get("TELLO_PIN") or str(random.randint(1000, 9999))
COLORS = ["#ff5d5d", "#3fa9f5", "#3dbb5a", "#ffbf1f", "#a66cff", "#ff6fa1", "#ff8a1f",
          "#14b8a6", "#8b5cf6", "#ef4444", "#0ea5e9", "#84cc16", "#f59e0b", "#ec4899", "#6366f1"]
MAX_FLIGHTS = 150
MAX_BODY = 2_000_000

LOCK = threading.Lock()


def _load_arena():
    try:
        with open(ARENA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


STATE = {
    "arena": _load_arena(),
    "arenaVersion": 1,
    "contest": {"status": "idle", "mode": "first", "round": 1, "startedAt": None, "endedAt": None, "duration": 0},
    "teams": {},        # id -> {id, name, color, joinedAt, lastSeen, best: {...}, tries}
    "flights": [],      # [{seq, teamId, name, color, at, path, success, flightTime, lines, crashT}]
    "seq": 0,
}


def _now():
    return time.time()


def _check_timer():
    c = STATE["contest"]
    if c["status"] == "running" and c["duration"] and _now() - c["startedAt"] >= c["duration"]:
        c["status"] = "ended"
        c["endedAt"] = c["startedAt"] + c["duration"]


def _leaderboard():
    c = STATE["contest"]
    rows = []
    for t in STATE["teams"].values():
        b = t.get("best") or {}
        rows.append({
            "id": t["id"], "name": t["name"], "color": t["color"], "tries": t.get("tries", 0),
            "done": bool(b), "firstAt": b.get("firstAt"), "bestTime": b.get("bestTime"),
            "bestLines": b.get("bestLines"), "bestLinesTime": b.get("bestLinesTime"),
            "online": _now() - t.get("lastSeen", 0) < 15,
        })
    mode = c["mode"]
    INF = float("inf")

    def key(r):
        if not r["done"]:
            return (1, INF, INF, r["name"])
        if mode == "time":
            return (0, r["bestTime"], r["firstAt"] or INF, r["name"])
        if mode == "lines":
            return (0, r["bestLines"], r["bestLinesTime"] or INF, r["name"])
        return (0, r["firstAt"], 0, r["name"])

    rows.sort(key=key)
    rank = 0
    for r in rows:
        if r["done"]:
            rank += 1
            r["rank"] = rank
        else:
            r["rank"] = None
    return rows


def _public_state(since, team_id=None):
    _check_timer()
    c = STATE["contest"]
    flights = [f for f in STATE["flights"] if f["seq"] > since] if since >= 0 else []
    if team_id and team_id in STATE["teams"]:
        STATE["teams"][team_id]["lastSeen"] = _now()
    return {
        "now": _now(),
        "arena": STATE["arena"],
        "arenaVersion": STATE["arenaVersion"],
        "contest": c,
        "leaderboard": _leaderboard(),
        "flights": flights,
        "seq": STATE["seq"],
    }


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
        pass

    # ---------- API ----------
    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        if self.path.startswith("/api/state"):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            since = int((q.get("since") or ["-1"])[0])
            team = (q.get("team") or [None])[0]
            with LOCK:
                return self._json(_public_state(since, team))
        if self.path.startswith("/api/ping"):
            return self._json({"ok": True})
        return super().do_GET()

    def do_POST(self):
        body = self._body()
        with LOCK:
            if self.path == "/api/join":
                return self._json(self._join(body))
            if self.path == "/api/flight":
                return self._json(self._flight(body))
            if self.path == "/api/teacher":
                if str(body.get("pin", "")) != PIN:
                    return self._json({"ok": False, "error": "PIN 碼不對"}, 403)
                return self._json(self._teacher(body))
        self._json({"ok": False, "error": "not found"}, 404)

    def _join(self, b):
        name = str(b.get("name", "")).strip()[:16]
        if not name:
            return {"ok": False, "error": "請輸入隊名"}
        tid = str(b.get("teamId") or "")
        teams = STATE["teams"]
        if tid in teams:
            teams[tid]["name"] = name
            teams[tid]["lastSeen"] = _now()
            return {"ok": True, "team": teams[tid]}
        for t in teams.values():
            if t["name"] == name:
                t["lastSeen"] = _now()
                return {"ok": True, "team": t}
        tid = uuid.uuid4().hex[:10]
        color = COLORS[len(teams) % len(COLORS)]
        teams[tid] = {"id": tid, "name": name, "color": color, "joinedAt": _now(), "lastSeen": _now(), "best": None, "tries": 0}
        return {"ok": True, "team": teams[tid]}

    def _flight(self, b):
        tid = str(b.get("teamId") or "")
        t = STATE["teams"].get(tid)
        if not t:
            return {"ok": False, "error": "請先加入隊伍"}
        _check_timer()
        c = STATE["contest"]
        path = b.get("path") or []
        if not isinstance(path, list):
            path = []
        path = path[:12000]
        success = bool(b.get("success"))
        ft = float(b.get("flightTime") or 0)
        lines = int(b.get("lines") or 0)
        av = int(b.get("arenaVersion") or 0)
        t["lastSeen"] = _now()
        ranked = c["status"] == "running" and av == STATE["arenaVersion"]
        if ranked:
            t["tries"] = t.get("tries", 0) + 1
            if success:
                best = t.get("best") or {}
                if best.get("firstAt") is None:
                    best["firstAt"] = round(_now() - c["startedAt"], 1)
                if best.get("bestTime") is None or ft < best["bestTime"]:
                    best["bestTime"] = round(ft, 1)
                if best.get("bestLines") is None or lines < best["bestLines"] or (lines == best["bestLines"] and ft < (best.get("bestLinesTime") or 1e9)):
                    best["bestLines"] = lines
                    best["bestLinesTime"] = round(ft, 1)
                t["best"] = best
        STATE["seq"] += 1
        STATE["flights"].append({
            "seq": STATE["seq"], "teamId": tid, "name": t["name"], "color": t["color"], "at": _now(),
            "path": path, "success": success, "flightTime": round(ft, 1), "lines": lines,
            "crashT": b.get("crashT"), "ranked": ranked,
        })
        if len(STATE["flights"]) > MAX_FLIGHTS:
            STATE["flights"] = STATE["flights"][-MAX_FLIGHTS:]
        return {"ok": True, "ranked": ranked}

    def _teacher(self, b):
        a = b.get("action")
        c = STATE["contest"]
        if a == "check":
            return {"ok": True}
        if a == "arena":
            STATE["arena"] = b.get("arena")
            STATE["arenaVersion"] += 1
            try:
                with open(ARENA_FILE, "w", encoding="utf-8") as f:
                    json.dump(STATE["arena"], f, ensure_ascii=False, indent=1)
            except Exception:
                pass
            return {"ok": True, "arenaVersion": STATE["arenaVersion"]}
        if a == "start":
            for t in STATE["teams"].values():
                t["best"] = None
                t["tries"] = 0
            c.update(status="running", startedAt=_now(), endedAt=None,
                     mode=b.get("mode") if b.get("mode") in ("first", "time", "lines") else c["mode"],
                     duration=max(0, int(b.get("duration") or 0)))
            if b.get("newRound"):
                c["round"] += 1
            return {"ok": True}
        if a == "mode":
            if b.get("mode") in ("first", "time", "lines"):
                c["mode"] = b["mode"]
            return {"ok": True}
        if a == "stop":
            if c["status"] == "running":
                c["status"] = "ended"
                c["endedAt"] = _now()
            return {"ok": True}
        if a == "reset":
            for t in STATE["teams"].values():
                t["best"] = None
                t["tries"] = 0
            c.update(status="idle", startedAt=None, endedAt=None)
            STATE["flights"] = []
            return {"ok": True}
        if a == "kick":
            STATE["teams"].pop(str(b.get("teamId")), None)
            return {"ok": True}
        if a == "clearTeams":
            STATE["teams"] = {}
            STATE["flights"] = []
            return {"ok": True}
        return {"ok": False, "error": "unknown action"}


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
    ip = lan_ips()[0]
    print("=" * 60)
    print("  Tello 飛行模擬器已啟動！")
    print("-" * 60)
    print("  學生請輸入：    http://%s:%d" % (ip, port))
    for other in lan_ips()[1:]:
        print("           或：    http://%s:%d" % (other, port))
    print("  老師控制台：    http://localhost:%d/teacher.html" % port)
    print("  大螢幕投影：    http://localhost:%d/index.html?screen=1" % port)
    print("-" * 60)
    print("  比賽模式 PIN 碼：  %s    （老師控制台要輸入）" % PIN)
    print("-" * 60)
    print("  這個視窗要一直開著，關掉模擬器就停止了。")
    print("  （Windows 若跳出防火牆詢問，請按「允許存取」）")
    print("=" * 60)
    try:
        webbrowser.open("http://localhost:%d/teacher.html" % port)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n模擬器已停止。")


if __name__ == "__main__":
    main()
