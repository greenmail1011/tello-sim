# -*- coding: utf-8 -*-
"""
Tello 飛行模擬器 —— 模擬用的 djitellopy
學生程式裡的 `from djitellopy import Tello` 會拿到這裡的 Tello。
每個指令不會真的送到無人機，而是記錄成「時間軸事件」，交給網頁播放動畫。

座標（公分）：x = 起飛時的正前方、y = 起飛時的左方、z = 高度
yaw（度）：逆時針為正（rotate_clockwise 會讓 yaw 變小）
"""
import sys
import math
import json
import types
import builtins
import logging
import difflib
import traceback
import time as _time_mod

STUDENT_FILE = "<學生程式>"
MAX_EVENTS = 3000          # 時間軸事件上限（避免停不下來的迴圈）
MAX_SIM_TIME = 900.0       # 模擬時間上限：15 分鐘
TAKEOFF_HEIGHT = 80.0      # 起飛後高度（公分）
MIN_HEIGHT = 20.0          # 飛行中最低高度
AUTO_LAND_IDLE = 15.0      # 實機 15 秒沒收到指令會自動降落
RC_STEP = 0.05             # 遙控模式積分間隔（秒）
RC_SPEED = 1.0             # rc 值 100 ≈ 100 公分/秒
RC_YAW = 1.0               # rc 值 100 ≈ 100 度/秒
ROTATE_SPEED = 90.0        # 旋轉速度（度/秒）
DEFAULT_SPEED = 50.0       # 預設飛行速度（公分/秒）
ARENA_HALF = 500.0         # 場地 10m x 10m
CEILING_WARN = 300.0
BATTERY_SECONDS_PER_PERCENT = 7.8   # 約 13 分鐘飛完一顆電池
TIME_BASE = 1767225600.0   # time.time() 的起點（2026-01-01）


class TelloException(Exception):
    """和真正的 djitellopy 一樣的例外名稱"""
    pass


class _SimStop(Exception):
    """模擬器自己的上限（程式太長、迴圈停不下來）"""
    pass


def _cur_line():
    f = sys._getframe(1)
    while f is not None:
        if f.f_code.co_filename == STUDENT_FILE:
            return f.f_lineno
        f = f.f_back
    return None


def _r(v, n=2):
    return round(float(v), n)


class World:
    def __init__(self):
        self.reset()

    def reset(self):
        self.events = []
        self.warnings = []
        self.warned = set()
        self.t = 0.0
        self.x = 0.0
        self.y = 0.0
        self.z = 0.0
        self.yaw = 0.0
        self.flying = False
        self.connected = False
        self.ever_flew = False
        self.speed = DEFAULT_SPEED
        self.rc = (0, 0, 0, 0)
        self.last_cmd_t = 0.0
        self.flight_time = 0.0
        self.stream = False
        self.tello_count = 0

    # ---------- 基本工具 ----------
    def pose(self):
        return [_r(self.x), _r(self.y), _r(self.z), _r(self.yaw)]

    def battery(self):
        return max(0, int(100 - self.flight_time / BATTERY_SECONDS_PER_PERCENT))

    def warn(self, key, msg, line=None):
        if key in self.warned:
            return
        self.warned.add(key)
        self.warnings.append({
            "t": _r(self.t, 3),
            "line": line if line is not None else _cur_line(),
            "msg": msg,
        })

    def _check_limits(self):
        if len(self.events) > MAX_EVENTS:
            raise _SimStop("指令太多了（超過 %d 個）！是不是寫了停不下來的迴圈？" % MAX_EVENTS)
        if self.t > MAX_SIM_TIME:
            raise _SimStop("飛行時間超過 15 分鐘了，模擬先停在這裡。是不是寫了停不下來的迴圈？")

    def _check_bounds(self):
        if abs(self.x) > ARENA_HALF or abs(self.y) > ARENA_HALF:
            self.warn("arena", "飛出 10×10 公尺的場地範圍了！實機在教室裡可能會撞牆。")
        if self.z > CEILING_WARN:
            self.warn("ceiling", "高度超過 3 公尺，一般教室的天花板差不多就這麼高，實機要小心！")
        if self.battery() < 15:
            self.warn("battery", "電量低於 15%，實機這時候應該要準備降落了。")

    def add(self, kind, dur, label, kf, motors, ease=True, extra=None, line=None):
        """kf：關鍵影格 [[相對時間, x, y, z, yaw], ...]"""
        ev = {
            "kind": kind,
            "t0": _r(self.t, 3),
            "dur": _r(dur, 3),
            "line": line if line is not None else _cur_line(),
            "label": label,
            "kf": kf,
            "motors": motors,
            "ease": ease,
        }
        if extra:
            ev.update(extra)
        self.events.append(ev)
        self.t += dur
        if motors:
            self.flight_time += dur
        self._check_limits()
        return ev

    def linear(self, kind, dur, label, nx, ny, nz, nyaw, motors=True, ease=True, extra=None):
        start = self.pose()
        self.x, self.y, self.z, self.yaw = nx, ny, nz, nyaw
        end = self.pose()
        ev = self.add(kind, dur, label, [[0.0] + start, [_r(dur, 3)] + end], motors, ease, extra)
        self._check_bounds()
        return ev

    def info(self, label, line=None):
        return self.add("info", 0.0, label, [[0.0] + self.pose()], self.flying, False, line=line)

    def command_done(self):
        self.last_cmd_t = self.t

    # ---------- 時間流逝（sleep、rc 指令都會用到） ----------
    def advance(self, secs, line=None):
        secs = float(secs)
        if secs <= 0:
            return
        if line is None:
            line = _cur_line()
        while secs > 1e-9:
            if self.flying and any(self.rc):
                self._rc_fly(secs, line)
                secs = 0
            elif self.flying:
                idle = self.t - self.last_cmd_t
                left = AUTO_LAND_IDLE - idle
                if secs < left - 1e-9:
                    self._hold("hover", secs, line)
                    secs = 0
                else:
                    if left > 0:
                        self._hold("hover", left, line)
                        secs -= left
                    self.warn("autoland",
                              "Tello 已經 15 秒沒有收到任何指令，自動降落了！"
                              "（實機也會這樣。等待太久的話，可以分段 sleep 並在中間送指令）",
                              line)
                    self.linear("autoland", max(1.5, self.z / 30.0),
                                "15 秒沒收到指令 → 自動降落",
                                self.x, self.y, 0.0, self.yaw, motors=True)
                    self.flying = False
                    self.rc = (0, 0, 0, 0)
            else:
                self._hold("wait", secs, line)
                secs = 0

    def _merge_target(self, kind, line):
        if not self.events:
            return None
        ev = self.events[-1]
        if ev["kind"] == kind and ev.get("rc") == list(self.rc) and abs(ev["t0"] + ev["dur"] - self.t) < 1e-6:
            return ev
        return None

    def _hold(self, kind, secs, line):
        ev = self._merge_target(kind, line)
        if ev is not None:
            ev["dur"] = _r(ev["dur"] + secs, 3)
            ev["kf"][-1][0] = ev["dur"]
            self.t += secs
            if kind == "hover":
                self.flight_time += secs
            ev["label"] = self._hold_label(kind, ev["dur"])
            self._check_limits()
            return
        p = self.pose()
        self.add(kind, secs, self._hold_label(kind, secs),
                 [[0.0] + p, [_r(secs, 3)] + p],
                 motors=(kind == "hover"), ease=False,
                 extra={"rc": list(self.rc)}, line=line)

    @staticmethod
    def _hold_label(kind, secs):
        if kind == "hover":
            return "在空中停留 %.1f 秒" % secs
        return "等待 %.1f 秒" % secs

    def _rc_label(self, secs):
        lr, fb, ud, yw = self.rc
        return "遙控飛行 %.1f 秒（左右 %d、前後 %d、上下 %d、旋轉 %d）" % (secs, lr, fb, ud, yw)

    def _rc_fly(self, secs, line):
        lr, fb, ud, yw = self.rc
        ev = self._merge_target("rc", line)
        if ev is None:
            ev = self.add("rc", 0.0, "", [[0.0] + self.pose()], True, False,
                          extra={"rc": list(self.rc)}, line=line)
        steps = max(1, int(math.ceil(secs / RC_STEP - 1e-9)))
        dt = secs / steps
        for _ in range(steps):
            a = math.radians(self.yaw)
            vx = fb * RC_SPEED * math.cos(a) + lr * RC_SPEED * math.sin(a)
            vy = fb * RC_SPEED * math.sin(a) - lr * RC_SPEED * math.cos(a)
            self.x += vx * dt
            self.y += vy * dt
            self.z += ud * RC_SPEED * dt
            self.yaw -= yw * RC_YAW * dt
            if self.z < MIN_HEIGHT:
                self.z = MIN_HEIGHT
                self.warn("rc_floor", "遙控往下飛太低了，Tello 停在離地 20 公分的地方。")
            ev["dur"] = _r(ev["dur"] + dt, 3)
            ev["kf"].append([ev["dur"]] + self.pose())
        # 太多關鍵影格時抽稀（保留頭尾）
        if len(ev["kf"]) > 2000:
            kf = ev["kf"]
            ev["kf"] = kf[:1] + kf[1:-1:2] + kf[-1:]
        ev["label"] = self._rc_label(ev["dur"])
        self.t += secs
        self.flight_time += secs
        self.last_cmd_t = self.t
        self._check_bounds()
        self._check_limits()


WORLD = World()


# ---------- 參數檢查 ----------
def _num(v, name):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise TelloException("%s 必須是數字，但你給的是 %r" % (name, v))
    return v


def _int_arg(v, name, lo, hi, unit=""):
    _num(v, name)
    if isinstance(v, float):
        if v.is_integer():
            raise TelloException("%s要是整數，請寫 %d 而不是 %s（也可以用 int() 轉成整數）"
                                 % (name, int(v), v))
        raise TelloException("%s要是整數，你給的是 %s，可以用 round() 或 int() 轉成整數" % (name, v))
    if not (lo <= v <= hi):
        raise TelloException("%s要在 %d～%d%s之間，你給的是 %d%s" % (name, lo, hi, unit, v, unit))
    return v


_DIR_NAMES = {
    "forward": "往前", "back": "往後", "left": "往左",
    "right": "往右", "up": "往上", "down": "往下",
}
_FLIP_NAMES = {"l": "往左翻滾", "r": "往右翻滾", "f": "往前翻滾", "b": "往後翻滾"}


class Tello:
    """模擬版 djitellopy.Tello（指令名稱、參數範圍都和實機一樣）"""

    LOGGER = logging.getLogger("djitellopy")
    TELLO_IP = "192.168.10.1"
    RETRY_COUNT = 3
    RESPONSE_TIMEOUT = 7
    TIME_BTW_COMMANDS = 0.1
    TIME_BTW_RC_CONTROL_COMMANDS = 0.001
    CONTROL_UDP_PORT = 8889
    STATE_UDP_PORT = 8890
    VS_UDP_PORT = 11111

    def __init__(self, host=TELLO_IP, retry_count=RETRY_COUNT, vs_udp=VS_UDP_PORT, *args, **kwargs):
        object.__setattr__(self, "_w", WORLD)
        WORLD.tello_count += 1
        if WORLD.tello_count > 1:
            WORLD.warn("multi", "建立了不只一個 Tello()，模擬器裡它們都是同一台無人機。")
        self.address = (host, Tello.CONTROL_UDP_PORT)
        self.retry_count = retry_count
        self.vs_udp_port = vs_udp

    # 找不到的指令 → 中文提示 + 猜你想打的
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        cands = difflib.get_close_matches(name, _public_names(), n=3, cutoff=0.55)
        msg = "Tello 沒有「%s」這個指令。" % name
        if cands:
            msg += " 你是不是要用：" + "、".join(c + "()" for c in cands) + "？"
        raise AttributeError(msg)

    # ---------- 狀態屬性 ----------
    @property
    def is_flying(self):
        return self._w.flying

    @property
    def stream_on(self):
        return self._w.stream

    # ---------- 內部檢查 ----------
    def _need_conn(self):
        if not self._w.connected:
            raise TelloException("還沒連線！下指令之前要先呼叫 tello.connect()")

    def _need_fly(self, what):
        self._need_conn()
        if not self._w.flying:
            raise TelloException("無人機沒有在飛，不能%s。請先呼叫 tello.takeoff()" % what)

    # ---------- 連線 ----------
    def connect(self, wait_for_state=True):
        w = self._w
        if w.connected:
            return
        w.connected = True
        w.linear("connect", 0.5, "連線到 Tello（進入 SDK 模式）", w.x, w.y, w.z, w.yaw, motors=False)
        w.command_done()

    def end(self):
        if self._w.flying:
            self.land()
        self._w.info("結束連線 end()")

    def send_keepalive(self):
        self._need_conn()
        self._w.command_done()

    # ---------- 起飛降落 ----------
    def takeoff(self):
        w = self._w
        self._need_conn()
        if w.flying:
            w.warn("takeoff_twice", "已經在飛了，又呼叫了一次 takeoff()，這次被忽略。")
            return
        w.flying = True
        w.ever_flew = True
        w.linear("takeoff", 3.5, "起飛（升到約 80 公分）", w.x, w.y, TAKEOFF_HEIGHT, w.yaw)
        w.command_done()

    def land(self):
        w = self._w
        self._need_fly("降落")
        w.linear("land", max(2.0, w.z / 40.0), "降落", w.x, w.y, 0.0, w.yaw)
        w.flying = False
        w.rc = (0, 0, 0, 0)
        w.command_done()

    def emergency(self):
        w = self._w
        self._need_conn()
        if w.flying:
            w.warn("emergency", "emergency() 會讓馬達立刻停止，無人機會直接掉下來！只有危險時才用。")
            fall = max(0.3, math.sqrt(2 * max(w.z, 1) / 980.0))
            w.linear("fall", fall, "緊急停止！馬達關閉、掉落", w.x, w.y, 0.0, w.yaw, motors=False, ease=False)
            w.flying = False
            w.rc = (0, 0, 0, 0)
        else:
            w.info("緊急停止（無人機本來就在地上）")
        w.command_done()

    # ---------- 移動 ----------
    def move(self, direction, x):
        w = self._w
        if direction not in _DIR_NAMES:
            raise TelloException("move() 的方向要是 forward / back / left / right / up / down 其中一個，你給的是 %r" % (direction,))
        _int_arg(x, "距離", 20, 500, " 公分")
        self._need_fly("移動")
        a = math.radians(w.yaw)
        nx, ny, nz = w.x, w.y, w.z
        if direction == "forward":
            nx += x * math.cos(a); ny += x * math.sin(a)
        elif direction == "back":
            nx -= x * math.cos(a); ny -= x * math.sin(a)
        elif direction == "left":
            nx -= x * math.sin(a); ny += x * math.cos(a)
        elif direction == "right":
            nx += x * math.sin(a); ny -= x * math.cos(a)
        elif direction == "up":
            nz += x
        elif direction == "down":
            nz -= x
            if nz < MIN_HEIGHT:
                can = int(w.z - MIN_HEIGHT)
                if can < 20:
                    raise TelloException("現在高度只有 %d 公分，不能再往下飛了，會撞到地面！" % round(w.z))
                raise TelloException("往下飛 %d 公分會撞到地面！現在高度 %d 公分，最多只能往下 %d 公分"
                                     % (x, round(w.z), can))
        w.linear("move", x / w.speed + 0.4, "%s飛 %d 公分" % (_DIR_NAMES[direction], x), nx, ny, nz, w.yaw)
        w.command_done()

    def move_forward(self, x): self.move("forward", x)
    def move_back(self, x): self.move("back", x)
    def move_left(self, x): self.move("left", x)
    def move_right(self, x): self.move("right", x)
    def move_up(self, x): self.move("up", x)
    def move_down(self, x): self.move("down", x)

    # ---------- 旋轉 ----------
    def rotate_clockwise(self, x):
        w = self._w
        _int_arg(x, "角度", 1, 360, " 度")
        self._need_fly("旋轉")
        w.linear("rotate", x / ROTATE_SPEED + 0.3, "順時針轉 %d 度" % x, w.x, w.y, w.z, w.yaw - x)
        w.command_done()

    def rotate_counter_clockwise(self, x):
        w = self._w
        _int_arg(x, "角度", 1, 360, " 度")
        self._need_fly("旋轉")
        w.linear("rotate", x / ROTATE_SPEED + 0.3, "逆時針轉 %d 度" % x, w.x, w.y, w.z, w.yaw + x)
        w.command_done()

    # ---------- 翻滾 ----------
    def flip(self, direction):
        w = self._w
        if direction not in _FLIP_NAMES:
            raise TelloException("flip() 的方向要是 'l'、'r'、'f'、'b' 其中一個，你給的是 %r" % (direction,))
        self._need_fly("翻滾")
        if w.battery() < 50:
            raise TelloException("電量低於 50%%（現在 %d%%），Tello 不能翻滾" % w.battery())
        if w.z < 50:
            w.warn("flip_low", "離地不到 50 公分就翻滾，實機很容易擦到地面，建議先 move_up()。")
        w.linear("flip", 1.4, _FLIP_NAMES[direction], w.x, w.y, w.z, w.yaw, ease=False,
                 extra={"flip": direction})
        w.command_done()

    def flip_left(self): self.flip("l")
    def flip_right(self): self.flip("r")
    def flip_forward(self): self.flip("f")
    def flip_back(self): self.flip("b")

    # ---------- 速度 ----------
    def set_speed(self, x):
        _int_arg(x, "速度", 10, 100, " 公分/秒")
        self._need_conn()
        self._w.speed = float(x)
        self._w.info("速度設定為 %d 公分/秒" % x)
        self._w.command_done()

    # ---------- go / curve ----------
    def _body_to_world(self, bx, by):
        a = math.radians(self._w.yaw)
        return (bx * math.cos(a) - by * math.sin(a), bx * math.sin(a) + by * math.cos(a))

    def go_xyz_speed(self, x, y, z, speed):
        w = self._w
        _int_arg(x, "x", -500, 500, " 公分")
        _int_arg(y, "y", -500, 500, " 公分")
        _int_arg(z, "z", -500, 500, " 公分")
        _int_arg(speed, "速度", 10, 100, " 公分/秒")
        if abs(x) <= 20 and abs(y) <= 20 and abs(z) <= 20:
            raise TelloException("go_xyz_speed 的 x、y、z 不能同時都在 -20～20 之間（距離太短，Tello 不會飛）")
        self._need_fly("移動")
        dx, dy = self._body_to_world(x, y)
        nz = w.z + z
        if nz < MIN_HEIGHT:
            raise TelloException("這樣飛會撞到地面！現在高度 %d 公分，z 最多只能是 %d"
                                 % (round(w.z), -int(w.z - MIN_HEIGHT)))
        dist = math.sqrt(x * x + y * y + z * z)
        w.linear("move", dist / speed + 0.4,
                 "直線飛行：前 %d、左 %d、上 %d 公分（速度 %d）" % (x, y, z, speed),
                 w.x + dx, w.y + dy, nz, w.yaw)
        w.command_done()

    def curve_xyz_speed(self, x1, y1, z1, x2, y2, z2, speed):
        w = self._w
        for v, n in ((x1, "x1"), (y1, "y1"), (z1, "z1"), (x2, "x2"), (y2, "y2"), (z2, "z2")):
            _int_arg(v, n, -500, 500, " 公分")
        _int_arg(speed, "速度", 10, 60, " 公分/秒")
        self._need_fly("飛曲線")
        A = (0.0, 0.0, 0.0)
        B = (float(x1), float(y1), float(z1))
        C = (float(x2), float(y2), float(z2))

        def sub(p, q): return (p[0] - q[0], p[1] - q[1], p[2] - q[2])
        def add(p, q): return (p[0] + q[0], p[1] + q[1], p[2] + q[2])
        def mul(p, k): return (p[0] * k, p[1] * k, p[2] * k)
        def dot(p, q): return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
        def cross(p, q): return (p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0])

        ab, ac = sub(B, A), sub(C, A)
        n = cross(ab, ac)
        nn = dot(n, n)
        if nn < 1e-6 * max(1.0, dot(ab, ab) * dot(ac, ac)):
            raise TelloException("曲線的三個點（起點、第一點、第二點）在同一條直線上，畫不出圓弧。請換一個第一點。")
        center = add(A, mul(add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab))), 1.0 / (2 * nn)))
        r = math.sqrt(dot(sub(A, center), sub(A, center)))
        if r < 50 or r > 1000:
            raise TelloException("曲線的半徑要在 0.5～10 公尺之間，這組點算出來的半徑是 %.2f 公尺，請調整兩個點的位置"
                                 % (r / 100.0))
        u = mul(sub(A, center), 1.0 / r)
        nl = math.sqrt(nn)
        nh = mul(n, 1.0 / nl)
        v = cross(nh, u)

        def ang(p):
            d = sub(p, center)
            t = math.atan2(dot(d, v), dot(d, u))
            return t if t >= 0 else t + 2 * math.pi

        end_ang = ang(C)
        length = r * end_ang
        dur = length / speed + 0.4
        steps = max(8, min(200, int(end_ang / math.radians(4))))
        sx, sy, sz = w.x, w.y, w.z
        kf = []
        for i in range(steps + 1):
            th = end_ang * i / steps
            p = add(center, add(mul(u, r * math.cos(th)), mul(v, r * math.sin(th))))
            dx, dy = self._body_to_world(p[0], p[1])
            pz = sz + p[2]
            if pz < MIN_HEIGHT - 1e-6:
                raise TelloException("這條曲線中途會低於地面！請把點的 z 調高，或先 move_up()")
            kf.append([_r(dur * i / steps, 3), _r(sx + dx), _r(sy + dy), _r(pz), _r(w.yaw)])
        w.x, w.y, w.z = kf[-1][1], kf[-1][2], kf[-1][3]
        w.add("curve", dur,
              "曲線飛行：經過 (%d, %d, %d) 到 (%d, %d, %d)" % (x1, y1, z1, x2, y2, z2),
              kf, True, False)
        w._check_bounds()
        w.command_done()

    # ---------- 遙控模式 ----------
    def send_rc_control(self, left_right_velocity, forward_backward_velocity, up_down_velocity, yaw_velocity):
        w = self._w
        vals = []
        for v, n in ((left_right_velocity, "左右速度"), (forward_backward_velocity, "前後速度"),
                     (up_down_velocity, "上下速度"), (yaw_velocity, "旋轉速度")):
            _num(v, n)
            vals.append(int(max(-100, min(100, v))))
        self._need_conn()
        if not w.flying:
            if any(vals):
                w.warn("rc_ground", "還沒起飛就送 send_rc_control()，無人機在地上不會動。")
            return
        new = tuple(vals)
        if new != w.rc:
            w.rc = new
            w.info("遙控速度設為：左右 %d、前後 %d、上下 %d、旋轉 %d" % new)
        w.command_done()
        if any(new):
            w.advance(0.02)  # 送一次指令大約 0.02 秒（讓 while 迴圈裡的 rc 也會前進）

    # ---------- 讀取感測器 ----------
    def get_battery(self): return self._w.battery()
    def query_battery(self): self._need_conn(); return self._w.battery()
    def get_height(self): return int(round(self._w.z))
    def query_height(self): self._need_conn(); return int(round(self._w.z))
    def get_distance_tof(self): return int(round(self._w.z)) + (10 if self._w.flying else 0)
    def query_distance_tof(self): self._need_conn(); return float(self.get_distance_tof())
    def get_flight_time(self): return int(self._w.flight_time)
    def query_flight_time(self): self._need_conn(); return int(self._w.flight_time)
    def get_temperature(self): return 60.0 + min(25.0, self._w.flight_time / 20.0)
    def get_lowest_temperature(self): return int(self.get_temperature()) - 1
    def get_highest_temperature(self): return int(self.get_temperature()) + 1
    def query_temperature(self): return int(self.get_temperature())

    def get_yaw(self):
        y = (-self._w.yaw + 180.0) % 360.0 - 180.0
        return int(round(y))

    def get_pitch(self): return 0
    def get_roll(self): return 0
    def get_speed_x(self): return 0
    def get_speed_y(self): return 0
    def get_speed_z(self): return 0
    def query_speed(self): return self._w.speed
    def get_acceleration_x(self): return 0.0
    def get_acceleration_y(self): return 0.0
    def get_acceleration_z(self): return -1000.0
    def get_barometer(self): return round(100.0 + self._w.z / 100.0, 2)
    def query_barometer(self): return self.get_barometer()
    def query_attitude(self): return {"pitch": 0, "roll": 0, "yaw": self.get_yaw()}
    def query_sdk_version(self): return "30"
    def query_serial_number(self): return "SIMULATOR-0001"
    def query_wifi_signal_noise_ratio(self): return "90"

    def get_current_state(self):
        return {
            "mid": -1, "x": 0, "y": 0, "z": 0, "pitch": 0, "roll": 0, "yaw": self.get_yaw(),
            "vgx": 0, "vgy": 0, "vgz": 0, "templ": self.get_lowest_temperature(),
            "temph": self.get_highest_temperature(), "tof": self.get_distance_tof(),
            "h": self.get_height(), "bat": self.get_battery(), "baro": self.get_barometer(),
            "time": self.get_flight_time(), "agx": 0.0, "agy": 0.0, "agz": -1000.0,
        }

    def get_state_field(self, key):
        st = self.get_current_state()
        if key not in st:
            raise TelloException("狀態欄位裡沒有 %r，可以用的有：%s" % (key, ", ".join(st)))
        return st[key]

    # ---------- 挑戰卡（mission pad） ----------
    def enable_mission_pads(self):
        self._need_conn()
        self._w.warn("pads", "模擬器的場地上沒有挑戰卡（mission pad），get_mission_pad_id() 會一直是 -1。")
        self._w.info("開啟挑戰卡偵測（模擬器沒有挑戰卡）")

    def disable_mission_pads(self): self._need_conn()
    def set_mission_pad_detection_direction(self, x): self._need_conn()
    def get_mission_pad_id(self): return -1
    def get_mission_pad_distance_x(self): return 0
    def get_mission_pad_distance_y(self): return 0
    def get_mission_pad_distance_z(self): return 0

    def _no_pads(self, *a, **k):
        raise TelloException("模擬器的場地上沒有挑戰卡，不能使用跟挑戰卡（mid）有關的飛行指令")

    go_xyz_speed_mid = _no_pads
    curve_xyz_speed_mid = _no_pads
    go_xyz_speed_yaw_mid = _no_pads

    # ---------- 鏡頭 ----------
    def streamon(self):
        self._need_conn()
        self._w.stream = True
        self._w.warn("stream", "模擬器沒有鏡頭畫面，streamon() 不會有影像（要用實機才行）。")
        self._w.info("開啟影像串流（模擬器沒有鏡頭畫面）")

    def streamoff(self):
        self._need_conn()
        self._w.stream = False

    def get_frame_read(self, *a, **k):
        raise TelloException("模擬器不支援鏡頭影像（get_frame_read），拍照、影像辨識要用實機才能做")

    def get_video_capture(self, *a, **k):
        raise TelloException("模擬器不支援鏡頭影像（get_video_capture），要用實機才能做")

    def get_udp_video_address(self): return "udp://0.0.0.0:11111"
    def set_video_resolution(self, *a): pass
    def set_video_fps(self, *a): pass
    def set_video_bitrate(self, *a): pass
    def set_video_direction(self, *a): pass

    # ---------- 其他 ----------
    def set_wifi_credentials(self, *a):
        self._w.warn("wifi", "模擬器不會修改 Wi-Fi 設定。")

    def connect_to_wifi(self, *a):
        self._w.warn("wifi", "模擬器不會修改 Wi-Fi 設定。")

    def set_network_ports(self, *a): pass

    def reboot(self):
        raise TelloException("模擬器不支援 reboot()")

    def turn_motor_on(self):
        self._need_conn()
        self._w.info("馬達怠速轉動（不會起飛）")

    def turn_motor_off(self):
        self._need_conn()

    def send_expansion_command(self, *a):
        self._need_conn()
        self._w.info("擴充指令（模擬器略過）")

    # ---------- 直接送 SDK 指令字串 ----------
    def send_control_command(self, command, timeout=7):
        return self._sdk(command)

    def send_command_with_return(self, command, timeout=7):
        r = self._sdk(command)
        return "ok" if r is True else str(r)

    def send_command_without_return(self, command):
        self._sdk(command)

    def send_read_command(self, command):
        r = self._sdk(command)
        return str(r)

    def _sdk(self, command):
        if not isinstance(command, str):
            raise TelloException("SDK 指令要是文字，例如 'forward 50'")
        parts = command.strip().split()
        if not parts:
            raise TelloException("送出的 SDK 指令是空的")
        cmd, args = parts[0].lower(), parts[1:]

        def ints():
            try:
                return [int(a) for a in args]
            except ValueError:
                raise TelloException("SDK 指令 %r 的數字格式不對（要是整數）" % command)

        if cmd == "command":
            self.connect(); return True
        if cmd in ("takeoff", "land", "emergency", "streamon", "streamoff"):
            getattr(self, cmd)(); return True
        if cmd in _DIR_NAMES:
            a = ints()
            if len(a) != 1: raise TelloException("%s 後面要接 1 個數字，例如 '%s 50'" % (cmd, cmd))
            self.move(cmd, a[0]); return True
        if cmd == "cw":
            self.rotate_clockwise(*ints()); return True
        if cmd == "ccw":
            self.rotate_counter_clockwise(*ints()); return True
        if cmd == "flip":
            if len(args) != 1: raise TelloException("flip 後面要接 l / r / f / b")
            self.flip(args[0]); return True
        if cmd == "speed":
            if not args: return self._w.speed
            self.set_speed(*ints()); return True
        if cmd == "go":
            a = ints()
            if len(a) != 4: raise TelloException("go 指令要 4 個數字：go x y z speed")
            self.go_xyz_speed(*a); return True
        if cmd == "curve":
            a = ints()
            if len(a) != 7: raise TelloException("curve 指令要 7 個數字：curve x1 y1 z1 x2 y2 z2 speed")
            self.curve_xyz_speed(*a); return True
        if cmd == "rc":
            a = ints()
            if len(a) != 4: raise TelloException("rc 指令要 4 個數字：rc a b c d")
            self.send_rc_control(*a); return True
        q = {"battery?": self.get_battery, "height?": self.get_height, "time?": self.get_flight_time,
             "speed?": lambda: self._w.speed, "temp?": self.get_temperature,
             "tof?": self.get_distance_tof, "baro?": self.get_barometer,
             "attitude?": self.query_attitude, "sdk?": self.query_sdk_version,
             "sn?": self.query_serial_number, "wifi?": self.query_wifi_signal_noise_ratio}
        if cmd in q:
            return q[cmd]()
        raise TelloException("模擬器看不懂這個 SDK 指令：%r" % command)


def _public_names():
    return [n for n in dir(Tello) if not n.startswith("_")]


class TelloSwarm:
    def __init__(self, *a, **k):
        raise TelloException("模擬器一次只能模擬一台 Tello，不支援 TelloSwarm（多機編隊）")

    @classmethod
    def fromIps(cls, *a, **k):
        cls()

    @classmethod
    def fromFile(cls, *a, **k):
        cls()


# ---------- 安裝假的 djitellopy 模組 ----------
def _install_modules():
    pkg = types.ModuleType("djitellopy")
    pkg.__path__ = []
    pkg.Tello = Tello
    pkg.TelloException = TelloException
    pkg.TelloSwarm = TelloSwarm
    mod = types.ModuleType("djitellopy.tello")
    mod.Tello = Tello
    mod.TelloException = TelloException
    swarm = types.ModuleType("djitellopy.swarm")
    swarm.TelloSwarm = TelloSwarm
    pkg.tello = mod
    pkg.swarm = swarm
    sys.modules["djitellopy"] = pkg
    sys.modules["djitellopy.tello"] = mod
    sys.modules["djitellopy.swarm"] = swarm


_install_modules()


# ---------- 時間、print、input 的替身 ----------
def _sim_sleep(secs):
    if isinstance(secs, bool) or not isinstance(secs, (int, float)):
        raise TypeError("time.sleep() 裡面要放數字（秒數），你給的是 %r" % (secs,))
    if secs < 0:
        raise ValueError("time.sleep() 的秒數不能是負的")
    WORLD.advance(secs)


def _sim_time():
    return TIME_BASE + WORLD.t


def _sim_monotonic():
    return 1000.0 + WORLD.t


class _PrintCatcher:
    def __init__(self):
        self.buf = ""
        self.line = None

    def write(self, s):
        if not s:
            return 0
        if self.line is None:
            self.line = _cur_line()
        self.buf += s
        while "\n" in self.buf:
            text, self.buf = self.buf.split("\n", 1)
            self._emit(text)
        return len(s)

    def _emit(self, text):
        WORLD.add("print", 0.0, text, [[0.0] + WORLD.pose()], WORLD.flying, False, line=self.line)
        self.line = None

    def flush(self):
        pass

    def finish(self):
        if self.buf:
            self._emit(self.buf)
            self.buf = ""


def _no_input(prompt=""):
    raise RuntimeError("模擬器不能用 input() 讓人輸入，請直接把數字寫在程式裡（例如 distance = 50）")


# ---------- 錯誤訊息翻譯 ----------
_FULLWIDTH = "，（）：；＝「」『』。＋－＊／＜＞　“”‘’"

_MODULE_HINTS = {
    "cv2": "cv2（OpenCV 影像處理）在模擬器裡不能用，因為模擬器沒有鏡頭畫面。",
    "keyboard": "keyboard（鍵盤控制）在模擬器裡不能用，請改成用程式寫好每一步。",
    "pynput": "pynput（鍵盤控制）在模擬器裡不能用，請改成用程式寫好每一步。",
    "pygame": "pygame 在模擬器裡不能用，請改成用程式寫好每一步。",
    "tello": "沒有 tello 這個套件，應該是 from djitellopy import Tello",
    "djitellopy2": "套件名稱是 djitellopy，請寫 from djitellopy import Tello",
    "socket": None,
}

_ERR_NAMES = {
    "NameError": "名稱錯誤",
    "TypeError": "型別錯誤",
    "ValueError": "數值錯誤",
    "AttributeError": "找不到指令",
    "ZeroDivisionError": "除以零",
    "IndexError": "索引超出範圍",
    "KeyError": "找不到這個鍵",
    "ModuleNotFoundError": "找不到套件",
    "ImportError": "匯入錯誤",
    "RuntimeError": "執行錯誤",
    "RecursionError": "遞迴太深",
    "TelloException": "Tello 回報錯誤",
}


def _student_line_from_tb(tb):
    line = None
    for fs in traceback.extract_tb(tb):
        if fs.filename == STUDENT_FILE:
            line = fs.lineno
    return line


def _explain(e, code_lines):
    name = type(e).__name__
    msg = str(e)
    title = _ERR_NAMES.get(name, name)
    hint = ""
    line = _student_line_from_tb(e.__traceback__)

    if isinstance(e, TelloException):
        hint = ""
    elif isinstance(e, ModuleNotFoundError):
        mod = (e.name or "").split(".")[0]
        if mod in _MODULE_HINTS and _MODULE_HINTS[mod]:
            msg = _MODULE_HINTS[mod]
        else:
            msg = "模擬器裡沒有「%s」這個套件。" % mod
        hint = "模擬器只認得 djitellopy、time、math、random 這些常用套件。"
    elif isinstance(e, NameError):
        nm = getattr(e, "name", None)
        if nm is None:
            import re
            m = re.search(r"name '([^']+)'", msg)
            nm = m.group(1) if m else "?"
        msg = "「%s」還沒有定義。" % nm
        if nm == "Tello":
            hint = "是不是忘了在最上面寫 from djitellopy import Tello ？"
        elif nm in ("tello", "drone", "me"):
            hint = "是不是忘了先建立無人機：%s = Tello() ？或是名字前後大小寫不一樣？" % nm
        elif nm in ("time", "sleep"):
            hint = "是不是忘了在最上面寫 import time ？"
        elif nm in ("math", "random"):
            hint = "是不是忘了在最上面寫 import %s ？" % nm
        else:
            hint = "可能是打錯字、大小寫不一樣，或是還沒給它值就先用了。"
    elif isinstance(e, AttributeError):
        import re
        m = re.match(r"'(\w+)' object has no attribute '(\w+)'", msg)
        if m:
            msg = "「%s」沒有「%s」這個功能。" % (m.group(1), m.group(2))
    elif isinstance(e, TypeError):
        import re
        m = re.search(r"(\w+)\(\) missing (\d+) required positional argument", msg)
        if m:
            msg = "%s() 少了參數（括號裡要放數字）。原始訊息：%s" % (m.group(1), msg)
        m2 = re.search(r"(\w+)\(\) takes (\d+) positional arguments? but (\d+) (?:were|was) given", msg)
        if m2:
            msg = "%s() 括號裡的參數數量不對。原始訊息：%s" % (m2.group(1), msg)
    elif isinstance(e, ZeroDivisionError):
        msg = "不能除以 0。"
    elif isinstance(e, RecursionError):
        msg = "函式一直呼叫自己停不下來（遞迴太深）。"

    return {"type": name, "title": title, "msg": msg, "hint": hint, "line": line}


def _explain_syntax(e, code_lines):
    line = e.lineno
    text = ""
    if line and 1 <= line <= len(code_lines):
        text = code_lines[line - 1]
    hint = ""
    bad = [c for c in text if c in _FULLWIDTH]
    if bad:
        hint = "這一行有全形符號「%s」，Python 只看得懂半形的符號（例如 , ( ) : =），請切換成英文輸入法重打。" % "".join(sorted(set(bad)))
    elif isinstance(e, IndentationError):
        hint = "縮排（每行前面的空白）不對齊。for、if、def 下面的程式要一起往右縮 4 格。"
    elif text.rstrip().startswith(("for ", "if ", "while ", "def ", "else", "elif ")) and not text.rstrip().endswith(":"):
        hint = "for / if / while / def / else 這一行的最後面要加冒號「:」。"
    elif text.count("(") != text.count(")"):
        hint = "這一行的括號 ( ) 數量對不起來，檢查看看有沒有少打。"
    elif text.count('"') % 2 == 1 or text.count("'") % 2 == 1:
        hint = "這一行的引號沒有成對，文字前後都要有引號。"
    else:
        hint = "仔細看看這一行（或上一行）有沒有打錯字、少了符號。"
    title = "縮排錯誤" if isinstance(e, IndentationError) else "語法錯誤"
    return {"type": type(e).__name__, "title": title, "msg": "Python 看不懂這一行：%s" % (e.msg or ""),
            "hint": hint, "line": line}


# ---------- 程式分析（給關卡星星判定用） ----------
def _analyze(code):
    import ast
    try:
        tree = ast.parse(code)
    except Exception:
        return None
    info = {"lines": 0, "for": 0, "while": 0, "def": 0, "calls": [], "names": [], "imports": []}
    info["lines"] = len([l for l in code.split("\n") if l.strip() and not l.strip().startswith("#")])
    calls, names, imports = set(), set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.For):
            info["for"] += 1
        elif isinstance(node, ast.While):
            info["while"] += 1
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            info["def"] += 1
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                calls.add(node.func.attr)
            elif isinstance(node.func, ast.Name):
                names.add(node.func.id)
        elif isinstance(node, ast.Import):
            for n in node.names:
                imports.add(n.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module.split(".")[0])
    info["calls"] = sorted(calls)
    info["names"] = sorted(names)
    info["imports"] = sorted(imports)
    return info


# ---------- 主程式：執行學生程式 ----------
def run_student(code):
    WORLD.reset()
    code_lines = code.split("\n")
    error = None
    old = (_time_mod.sleep, _time_mod.time, _time_mod.monotonic, _time_mod.perf_counter,
           sys.stdout, sys.stderr, builtins.input)
    catcher = _PrintCatcher()
    _time_mod.sleep = _sim_sleep
    _time_mod.time = _sim_time
    _time_mod.monotonic = _sim_monotonic
    _time_mod.perf_counter = _sim_monotonic
    sys.stdout = catcher
    builtins.input = _no_input
    g = {"__name__": "__main__", "__builtins__": builtins}
    try:
        compiled = compile(code, STUDENT_FILE, "exec")
        exec(compiled, g)
    except SyntaxError as e:
        error = _explain_syntax(e, code_lines)
    except _SimStop as e:
        error = {"type": "SimStop", "title": "模擬停止", "msg": str(e), "hint": "", "line": _student_line_from_tb(e.__traceback__)}
    except RecursionError as e:
        error = _explain(e, code_lines)
    except Exception as e:
        try:
            error = _explain(e, code_lines)
        except Exception:
            error = {"type": type(e).__name__, "title": type(e).__name__, "msg": str(e), "hint": "", "line": None}
    finally:
        try:
            catcher.finish()
        except _SimStop:
            pass
        (_time_mod.sleep, _time_mod.time, _time_mod.monotonic, _time_mod.perf_counter,
         sys.stdout, sys.stderr, builtins.input) = old

    w = WORLD
    if error is None:
        if w.flying:
            w.warnings.append({"t": _r(w.t, 3), "line": None,
                               "msg": "程式結束了，但無人機還在空中！記得最後要寫 tello.land()。"
                                      "（實機會停在空中，15 秒後才自動降落）"})
        if not w.connected and not w.events:
            w.warnings.append({"t": 0, "line": None,
                               "msg": "程式裡沒有使用 Tello 的指令，無人機不會動喔。"})
    return json.dumps({
        "events": w.events,
        "warnings": w.warnings,
        "error": error,
        "total": _r(w.t, 3),
        "analysis": _analyze(code),
        "final": {"pose": w.pose(), "flying": w.flying, "battery": w.battery(),
                  "flight_time": _r(w.flight_time, 1), "ever_flew": w.ever_flew},
    }, ensure_ascii=False)
