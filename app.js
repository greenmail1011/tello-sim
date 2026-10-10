// Tello 飛行模擬器 —— 網頁介面、3D 場景、音效、時間軸播放
let THREE;
try {
  THREE = await import("./lib/three.module.min.js");
} catch (e) {
  THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js");
}

import { LEVELS, TIERS, CARDS } from "./levels.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("tello-sim:" + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("tello-sim:" + k, v); } catch (e) {} },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let seed = 20270101;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/* =========================================================
   範例程式
   ========================================================= */
const EXAMPLES = [
  ["起飛、轉一圈、降落", `from djitellopy import Tello

tello = Tello()
tello.connect()
print("電量：", tello.get_battery(), "%")

tello.takeoff()
tello.move_up(50)
tello.rotate_clockwise(360)
tello.land()
`],
  ["飛一個正方形", `from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 重複 4 次：往前飛 1 公尺，再左轉 90 度
for i in range(4):
    tello.move_forward(100)
    tello.rotate_counter_clockwise(90)

tello.land()
`],
  ["翻滾表演", `from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_up(60)

tello.flip_forward()
tello.flip_back()
tello.flip_left()
tello.flip_right()

tello.land()
`],
  ["飛一顆星星", `from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 每次轉 144 度，5 次就會畫出星星
for i in range(5):
    tello.move_forward(150)
    tello.rotate_clockwise(144)

tello.land()
`],
  ["曲線飛行", `from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 經過「前 100、左 100」這個點，畫半圓飛到「前 200」
tello.curve_xyz_speed(100, 100, 0, 200, 0, 0, 30)

# 直線飛回來
tello.go_xyz_speed(-200, 0, 0, 50)
tello.land()
`],
  ["遙控模式：螺旋上升", `from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()

# 一邊前進、一邊上升、一邊旋轉
tello.send_rc_control(0, 30, 15, 45)
time.sleep(8)

# 全部設成 0 = 停下來
tello.send_rc_control(0, 0, 0, 0)
print("爬到高度：", tello.get_height(), "公分")
tello.land()
`],
  ["用感測器決定高度", `from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()

# 一直往上飛，直到高度超過 150 公分
while tello.get_height() < 150:
    tello.send_rc_control(0, 0, 40, 0)
    time.sleep(0.1)

tello.send_rc_control(0, 0, 0, 0)
print("現在高度：", tello.get_height(), "公分")
tello.land()
`],
  ["錯誤示範（看看會發生什麼）", `from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 這一行有問題：Tello 每次最少要移動 20 公分
tello.move_forward(10)
tello.land()
`],
];

/* =========================================================
   關卡狀態（關卡資料在 levels.js）
   ========================================================= */
const RING_PASS = 40, RING_FRAME = 62, STAR_R = 30;
const HEADER = `from djitellopy import Tello

tello = Tello()
tello.connect()
`;
let CONTEST_LEVEL = null;
const SCREEN = new URLSearchParams(location.search).get("screen") === "1";
const levelById = (id) => (id === "contest" ? CONTEST_LEVEL : LEVELS.find((l) => l.id === id)) || LEVELS[0];
let curLevel = levelById(store.get("level", "free"));
let attempts = 0;
let cardsOn = false;
let pz = null;
function getStars(id) { try { const v = JSON.parse(store.get("stars:" + id, "[]")); return [0, 1, 2].map((i) => !!v[i]); } catch (e) { return [false, false, false]; } }
function saveStars(id, earned) {
  const old = getStars(id);
  const merged = old.map((v, i) => v || !!earned[i]);
  store.set("stars:" + id, JSON.stringify(merged));
  return merged;
}

/* =========================================================
   音效（Web Audio 即時合成，不需要音效檔）
   ========================================================= */
const Sound = (() => {
  let ctx = null, master = null, motor = null, noiseBuf = null;
  let enabled = store.get("sound", "1") === "1";
  function ensure() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    buildMotor();
    return ctx;
  }
  function buildMotor() {
    const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500; lp.Q.value = 0.8; lp.connect(out);
    const am = ctx.createGain(); am.gain.value = 0.7; am.connect(lp);
    const o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 170;
    const o2 = ctx.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 256;
    const g1 = ctx.createGain(); g1.gain.value = 0.5; o1.connect(g1).connect(am);
    const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2).connect(am);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 40;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.28; lfo.connect(lfoG).connect(am.gain);
    const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0.45; nz.connect(bp).connect(ng).connect(out);
    o1.start(); o2.start(); lfo.start(); nz.start();
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true; wn.playbackRate.value = 0.7;
    const wlp = ctx.createBiquadFilter(); wlp.type = "lowpass"; wlp.frequency.value = 450; wlp.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0; wn.connect(wlp).connect(wg).connect(master); wn.start();
    motor = { out, o1, o2, lfo, bp, wg, wlp };
  }
  function setMotor(on, spd, climb, rate) {
    if (!ctx || !motor) return;
    const t = ctx.currentTime;
    const f = (150 + Math.min(spd, 160) * 0.65 + Math.max(0, climb) * 0.9) * (1 + (rate - 1) * 0.05);
    motor.o1.frequency.setTargetAtTime(f, t, 0.08);
    motor.o2.frequency.setTargetAtTime(f * 1.505, t, 0.08);
    motor.lfo.frequency.setTargetAtTime(f / 4.3, t, 0.08);
    motor.bp.frequency.setTargetAtTime(700 + f * 2, t, 0.1);
    motor.out.gain.setTargetAtTime(on ? 0.06 : 0, t, on ? 0.15 : 0.2);
  }
  function setWind(level) {
    if (!ctx || !motor) return;
    const t = ctx.currentTime;
    motor.wg.gain.setTargetAtTime(level * 0.5, t, 0.4);
    motor.wlp.frequency.setTargetAtTime(300 + level * 900, t, 0.4);
  }
  function tone(freq, dur, type = "sine", vol = 0.2, when = 0, slideTo = null) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(dur, f0, f1, vol = 0.25, when = 0, type = "bandpass") {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  const sfx = {
    flip() { whoosh(0.7, 300, 2600, 0.35); tone(500, 0.5, "triangle", 0.06, 0.05, 1200); },
    ring() { [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.35, "triangle", 0.13, i * 0.06)); },
    crash() { whoosh(0.6, 1200, 120, 0.6, 0, "lowpass"); tone(140, 0.5, "sine", 0.4, 0, 40); tone(90, 0.35, "square", 0.08, 0.02, 45); },
    success() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, "triangle", 0.16, i * 0.11)); [523, 659, 784].forEach((f) => tone(f * 2, 0.7, "sine", 0.06, 0.48)); },
    done() { tone(784, 0.18, "triangle", 0.14, 0); tone(1046, 0.35, "triangle", 0.14, 0.12); },
    fail() { tone(392, 0.25, "triangle", 0.15, 0); tone(330, 0.25, "triangle", 0.15, 0.2); tone(262, 0.45, "triangle", 0.15, 0.4); },
    error() { tone(220, 0.16, "square", 0.07, 0); tone(185, 0.3, "square", 0.07, 0.18); },
    ding() { tone(1568, 0.25, "sine", 0.1); tone(2349, 0.2, "sine", 0.04, 0.02); },
    warn() { tone(880, 0.15, "triangle", 0.1); tone(660, 0.22, "triangle", 0.1, 0.14); },
    takeoff() { tone(220, 0.9, "sine", 0.05, 0, 440); },
    star() { tone(1318, 0.12, "square", 0.05); tone(1976, 0.3, "triangle", 0.12, 0.07); tone(2637, 0.25, "sine", 0.06, 0.14); },
    click() { tone(880, 0.06, "triangle", 0.06); },
  };
  function setEnabled(v) {
    enabled = v;
    store.set("sound", v ? "1" : "0");
    if (master) master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.05);
  }
  return { ensure, setMotor, setWind, sfx, setEnabled, get enabled() { return enabled; } };
})();
document.addEventListener("pointerdown", () => Sound.ensure(), { capture: true });
document.addEventListener("keydown", () => Sound.ensure(), { capture: true });
const SOUND_ON = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
const SOUND_OFF = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6M22 9l-6 6"/>';
function paintSound() {
  $("soundIcon").innerHTML = Sound.enabled ? SOUND_ON : SOUND_OFF;
  $("soundText").textContent = Sound.enabled ? "音效" : "靜音";
  $("soundBtn").classList.toggle("off", !Sound.enabled);
}
$("soundBtn").addEventListener("click", () => { Sound.ensure(); Sound.setEnabled(!Sound.enabled); paintSound(); });
paintSound();

/* =========================================================
   程式編輯器（textarea + 語法上色）
   ========================================================= */
const ta = $("code"), hl = $("hl"), layer = $("layer"), gutter = $("gutter"), hlLine = $("hlLine");
const KW = new Set("False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const TELLO_METHODS = new Set(("connect takeoff land emergency end move move_forward move_back move_left move_right move_up move_down " +
  "rotate_clockwise rotate_counter_clockwise flip flip_left flip_right flip_forward flip_back set_speed go_xyz_speed curve_xyz_speed " +
  "send_rc_control get_battery get_height get_yaw get_flight_time get_temperature get_distance_tof get_barometer get_pitch get_roll " +
  "streamon streamoff get_frame_read send_control_command send_command_with_return send_read_command query_battery get_current_state get_state_field").split(" "));
let lineCount = 0;

function highlight(src) {
  const re = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_À-￿][A-Za-z0-9_À-￿]*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out += `<span class="tok-com">${esc(tok)}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(tok)}</span>`;
    else if (m[3]) out += `<span class="tok-num">${esc(tok)}</span>`;
    else if (KW.has(tok)) out += `<span class="tok-kw">${tok}</span>`;
    else if (/^_{3,}$/.test(tok)) out += `<span class="tok-blank">${tok}</span>`;
    else {
      const after = src.slice(re.lastIndex).match(/^\s*\(/);
      const before = src[m.index - 1] === ".";
      if (after && before && TELLO_METHODS.has(tok)) out += `<span class="tok-tello">${esc(tok)}</span>`;
      else if (after) out += `<span class="tok-fn">${esc(tok)}</span>`;
      else out += esc(tok);
    }
    last = re.lastIndex;
    if (tok.length === 0) re.lastIndex++;
  }
  out += esc(src.slice(last));
  return out + "\n ";
}

function refreshEditor() {
  hl.innerHTML = highlight(ta.value);
  const n = ta.value.split("\n").length;
  if (n !== lineCount) {
    lineCount = n;
    let h = "";
    for (let i = 1; i <= n; i++) h += `<div data-l="${i}">${i}</div>`;
    gutter.innerHTML = h;
    markGutter();
  }
  syncScroll();
}
function syncScroll() {
  layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
}

let edLine = null, edErr = false;
function setEditorLine(line, isErr) {
  if (curLevel.mode === "parsons" && pz) {
    const i = line ? line - 1 : null;
    if (pz.hl !== i || pz.err !== !!isErr) { pz.hl = i; pz.err = !!isErr; renderParsons(); }
    return;
  }
  if (line === edLine && !!isErr === edErr) return;
  edLine = line; edErr = !!isErr;
  if (!line) { hlLine.style.display = "none"; }
  else {
    hlLine.style.display = "block";
    hlLine.style.top = (12 + (line - 1) * 24) + "px";
    hlLine.classList.toggle("err", edErr);
    const top = 12 + (line - 1) * 24, h = ta.clientHeight;
    if (top < ta.scrollTop + 8 || top + 24 > ta.scrollTop + h - 8) {
      ta.scrollTop = Math.max(0, top - h / 3);
      syncScroll();
    }
  }
  markGutter();
}
function markGutter() {
  const ins = cardsOn ? caretLine() : -1;
  for (const d of gutter.children) {
    const l = +d.dataset.l;
    d.className = (l === edLine ? (edErr ? "err" : "cur") : "") + (l === ins ? " ins" : "");
  }
}

function insertText(text) {
  ta.focus();
  let ok = false;
  try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    onCodeInput();
  }
}

function cleanCode(s) {
  let c = s.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/\t/g, "    ").replace(/[​﻿]/g, "");
  const m = c.match(/```[ \t]*(?:python3?|py)?[^\n]*\n([\s\S]*?)(?:```|$)/i);
  if (m) c = m[1];
  return c;
}

let hintTimer = null;
function hint(msg, keep) {
  $("hintLine").textContent = msg || "";
  clearTimeout(hintTimer);
  if (msg && !keep) hintTimer = setTimeout(() => ($("hintLine").textContent = ""), 6000);
}

let saveTimer = null, codeDirty = false;
function onCodeInput() {
  refreshEditor();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("code:" + curLevel.id, ta.value), 400);
  if (run && !codeDirty) {
    codeDirty = true;
    setEditorLine(null);
    hint("程式改過了，再按一次「起飛！執行程式」看看新的結果。", true);
  }
}

ta.addEventListener("input", onCodeInput);
ta.addEventListener("scroll", syncScroll);
ta.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      const s = ta.selectionStart, ls = ta.value.lastIndexOf("\n", s - 1) + 1;
      const sp = ta.value.slice(ls).match(/^ {1,4}/);
      if (sp) { ta.setRangeText("", ls, ls + sp[0].length, "end"); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - sp[0].length); onCodeInput(); }
    } else insertText("    ");
  } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    const s = ta.selectionStart, ls = ta.value.lastIndexOf("\n", s - 1) + 1;
    const line = ta.value.slice(ls, s);
    let ind = line.match(/^ */)[0];
    if (/:\s*(#.*)?$/.test(line)) ind += "    ";
    e.preventDefault();
    insertText("\n" + ind);
  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    doRun();
  }
});
ta.addEventListener("paste", (e) => {
  const txt = e.clipboardData && e.clipboardData.getData("text/plain");
  if (!txt) return;
  const c = cleanCode(txt);
  if (c !== txt.replace(/\r\n?/g, "\n")) {
    e.preventDefault();
    insertText(c);
    hint("已自動整理貼上的程式（拿掉 ``` 標記、Tab 換成空白）。");
  }
});

const exSel = $("exampleSel");
EXAMPLES.forEach(([name], i) => { const o = document.createElement("option"); o.value = i; o.textContent = name; exSel.appendChild(o); });
exSel.addEventListener("change", () => {
  if (exSel.value === "") return;
  const [name, code] = EXAMPLES[+exSel.value];
  if (ta.value.trim() && ta.value.trim() !== code.trim() && !window.confirm("要用範例取代目前的程式嗎？（目前的程式會不見）")) { exSel.value = ""; return; }
  setCode(code);
  exSel.value = "";
  hint("已載入範例「" + name + "」，按「起飛！執行程式」試試看！");
});
function setCode(code) {
  ta.value = code;
  ta.scrollTop = 0;
  onCodeInput();
  store.set("code:" + curLevel.id, code);
  smartCaret();
}
$("openBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  setCode(cleanCode(await f.text()));
  hint("已開啟「" + f.name + "」");
  e.target.value = "";
});
$("saveBtn").addEventListener("click", () => {
  const blob = new Blob([ta.value], { type: "text/x-python" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my_tello.py";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("clearBtn").addEventListener("click", () => {
  if (ta.value.trim() && !window.confirm("確定要清空程式嗎？")) return;
  setCode("");
  ta.focus();
});

/* =========================================================
   Python 執行（Web Worker）
   ========================================================= */
let worker = null, workerReady = false, runId = 0, runTimer = null;
const RUN_TIMEOUT = 6000;
const PYTHON_LOAD_TIMEOUT = 90000;
let workerLoadTimer = null, workerFetchController = null;
const RUN_LABEL = "起飛！執行程式";
function setPyStatus(kind, text) { $("pyDot").className = "dot " + kind; $("pyText").textContent = text; }
async function startWorker() {
  clearTimeout(workerLoadTimer);
  workerFetchController?.abort();
  worker?.terminate();
  worker = null;
  const controller = new AbortController();
  workerFetchController = controller;
  workerReady = false;
  $("runBtn").disabled = true;
  $("runText").textContent = "Python 準備中…";
  $("retryPython").hidden = true;
  setPyStatus("busy", "Python 載入中…");
  const fail = (message) => {
    if (workerFetchController !== controller) return;
    clearTimeout(workerLoadTimer);
    controller.abort();
    worker?.terminate();
    workerReady = false;
    $("runBtn").disabled = true;
    $("runText").textContent = "無法執行";
    $("retryPython").hidden = false;
    setPyStatus("bad", "Python 載入失敗");
    hint("Python 載入失敗：" + message, true);
  };
  workerLoadTimer = setTimeout(() => fail("載入逾時，請檢查網路或網站檔案，再按「重新載入 Python」。"), PYTHON_LOAD_TIMEOUT);
  // 先查核檔案，避免 Worker 的 404 只留下沒有 message 的 ErrorEvent。
  const workerURL = new URL("./worker.js", import.meta.url);
  let currentWorker;
  try {
    if (location.protocol === "file:") throw new Error("請使用啟動工具或老師的網址開啟，不能直接打開 HTML 檔。");
    const response = await fetch(workerURL, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`worker.js 載入失敗（HTTP ${response.status}），請確認網站已上傳這個檔案。`);
    if (controller.signal.aborted) return;
    currentWorker = new Worker(workerURL);
    worker = currentWorker;
  } catch (e) {
    if (!controller.signal.aborted) fail(e.message || "無法取得 worker.js，請檢查網路與網站檔案。");
    return;
  }
  currentWorker.onmessage = (ev) => {
    if (controller.signal.aborted || worker !== currentWorker) return;
    const m = ev.data;
    if (m.type === "ready") {
      clearTimeout(workerLoadTimer);
      workerReady = true;
      $("runBtn").disabled = false;
      $("runText").textContent = RUN_LABEL;
      setPyStatus("ok", m.where === "cdn" ? "Python 準備好了（線上版）" : "Python 準備好了");
      if ($("hintLine").textContent.startsWith("Python 載入失敗")) hint("");
    } else if (m.type === "loading") {
      setPyStatus("busy", m.message);
    } else if (m.type === "fatal") {
      fail(m.message);
    } else if (m.type === "result") {
      if (m.id !== runId) return;
      clearTimeout(runTimer);
      $("runBtn").disabled = false;
      $("runText").textContent = RUN_LABEL;
      loadRun(m.result);
    }
  };
  currentWorker.onerror = (e) => {
    if (controller.signal.aborted || worker !== currentWorker) return;
    fail(e.message || "背景程式 worker.js 無法啟動，請確認網站檔案完整，再按「重新載入 Python」。");
  };
  currentWorker.postMessage({ type: "init", baseUrl: new URL("./", import.meta.url).href });
}
$("retryPython").addEventListener("click", startWorker);

function doRun() {
  if (!workerReady) return;
  if (curLevel.tier === "contest" && NET.ok && !NET.team) { openJoin(); return; }
  Sound.ensure();
  let code;
  if (curLevel.mode === "parsons") {
    if (!pz || !pz.ans.length) { hint("先點積木，把程式排好喔！"); return; }
    code = pzCode();
  } else {
    const cleaned = cleanCode(ta.value);
    if (cleaned !== ta.value) { setCode(cleaned); hint("已自動整理程式（拿掉 ``` 標記、Tab 換成空白）。"); }
    if (!ta.value.trim()) { hint("先貼上或寫一段程式喔！"); return; }
    const bl = ta.value.split("\n").findIndex((l) => /(^|[^A-Za-z0-9_])_{3,}([^A-Za-z0-9_]|$)/.test(l));
    if (bl >= 0) { setEditorLine(bl + 1, true); hint("第 " + (bl + 1) + " 行還有空格 ___ 沒有填喔！把它換成數字或程式。", true); Sound.sfx.warn(); return; }
    code = ta.value;
  }
  attempts++;
  hideBanner();
  if (window.innerWidth <= 1000) {
    const r = document.querySelector(".view-card").getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) document.querySelector(".view-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  runId++;
  $("runBtn").disabled = true;
  $("runText").textContent = "執行中…";
  worker.postMessage({ type: "run", id: runId, code });
  const myId = runId;
  runTimer = setTimeout(() => {
    if (myId !== runId) return;
    worker.terminate();
    loadRun({
      events: [], warnings: [], total: 0, final: null,
      error: { title: "程式停不下來", msg: "程式跑了很久都沒有結束，可能有一個停不下來的迴圈。", hint: "檢查 while 迴圈：裡面要有會讓條件改變的指令（例如 Tello 的移動或 time.sleep），或是用 for 迴圈指定次數。", line: null },
    });
    startWorker();
  }, RUN_TIMEOUT);
}
$("runBtn").addEventListener("click", doRun);

/* =========================================================
   3D 場景
   ========================================================= */
const viewport = $("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
viewport.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);

function canvasTex(draw, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const FONT = getComputedStyle(document.body).fontFamily;
const S = (x, y, z) => new THREE.Vector3(x / 100, z / 100, -y / 100); // 模擬座標(公分) → 3D(公尺)
const lambert = (color, flat = false) => new THREE.MeshLambertMaterial({ color, flatShading: flat });

// 天空
scene.background = canvasTex((g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#4fb0ff"); gr.addColorStop(0.5, "#9ad6ff"); gr.addColorStop(1, "#e4f6ff");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, 8, 256);
scene.fog = new THREE.Fog(0xdcf1ff, 22, 70);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9fd18b, 1.7));
const sunLight = new THREE.DirectionalLight(0xfff6e0, 1.9);
sunLight.position.set(-5, 10, 6);
scene.add(sunLight);

// 太陽
{
  const sun = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe36b, fog: false }));
  sun.position.set(-30, 24, -42); scene.add(sun);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, transparent: true, depthWrite: false, map: canvasTex((g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(255,240,170,.9)"); gr.addColorStop(1, "rgba(255,240,170,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 128, 128) }));
  halo.scale.set(16, 16, 1); halo.position.copy(sun.position); scene.add(halo);
}

// 雲
const clouds = [];
{
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x99aabb, emissiveIntensity: 0.25 });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + rand() * 0.8, 2), mat);
      s.position.set(k * 1.1 - n * 0.55, rand() * 0.5, (rand() - 0.5) * 0.9);
      s.scale.y = 0.75;
      c.add(s);
    }
    const ang = (i / 9) * Math.PI * 2 + rand() * 0.4, r = 18 + rand() * 16;
    c.position.set(Math.cos(ang) * r, 9 + rand() * 6, Math.sin(ang) * r);
    c.scale.setScalar(1 + rand() * 0.8);
    scene.add(c);
    clouds.push(c);
  }
}

// 草地
{
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "#8ed96a"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rand() < 0.5 ? "rgba(70,170,70,.25)" : "rgba(190,240,140,.35)";
      g.beginPath(); g.arc(rand() * w, rand() * h, 3 + rand() * 9, 0, Math.PI * 2); g.fill();
    }
  }, 256, 256);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 30);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshLambertMaterial({ map: tex }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.01; scene.add(grass);
}

// 彩色拼接地墊（每塊 1 公尺）
{
  const PAL = ["#fff1c2", "#d6eeff", "#ffe0ea", "#daf5d3", "#efe4ff"];
  const tex = canvasTex((g, w, h) => {
    const u = w / 10;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      g.fillStyle = PAL[(i * 2 + j * 3) % PAL.length];
      g.fillRect(i * u, j * u, u, u);
    }
    g.strokeStyle = "rgba(60,90,120,.10)"; g.lineWidth = 2; g.setLineDash([8, 8]);
    for (let i = 0; i < 10; i++) {
      g.beginPath(); g.moveTo(i * u + u / 2, 0); g.lineTo(i * u + u / 2, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * u + u / 2); g.lineTo(w, i * u + u / 2); g.stroke();
    }
    g.setLineDash([]); g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 5;
    for (let i = 0; i <= 10; i++) {
      g.beginPath(); g.moveTo(i * u, 0); g.lineTo(i * u, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * u); g.lineTo(w, i * u); g.stroke();
    }
  }, 1024, 1024);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshLambertMaterial({ map: tex }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.002; scene.add(mat);
  const edgeMat = lambert(0x3fa9f5);
  for (const [w, d, x, z] of [[10.3, 0.15, 0, 5.07], [10.3, 0.15, 0, -5.07], [0.15, 10, 5.07, 0], [0.15, 10, -5.07, 0]]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), edgeMat);
    e.position.set(x, 0.025, z); scene.add(e);
  }
}

// 場邊彩旗
{
  const COLS = [0xff5d5d, 0xffbf1f, 0x3fa9f5, 0x4cd964, 0xff6fa1, 0xa66cff];
  const E = 5.5, H = 1.0;
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, H, 10);
  const capGeo = new THREE.SphereGeometry(0.07, 14, 10);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.1, 0, 0, 0.1, 0, 0, 0, -0.2, 0], 3));
  flagGeo.computeVertexNormals();
  const flagMats = COLS.map((c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
  const corners = [[-E, -E], [E, -E], [E, E], [-E, E]];
  let ci = 0, fi = 0;
  for (let s = 0; s < 4; s++) {
    const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
    const seg = 5;
    for (let k = 0; k < seg; k++) {
      const x0 = ax + (bx - ax) * k / seg, z0 = az + (bz - az) * k / seg;
      const x1 = ax + (bx - ax) * (k + 1) / seg, z1 = az + (bz - az) * (k + 1) / seg;
      const post = new THREE.Mesh(postGeo, lambert(0xffffff)); post.position.set(x0, H / 2, z0); scene.add(post);
      const cap = new THREE.Mesh(capGeo, lambert(COLS[ci++ % COLS.length])); cap.position.set(x0, H + 0.04, z0); scene.add(cap);
      const pts = [];
      for (let q = 0; q <= 12; q++) {
        const u = q / 12;
        pts.push(new THREE.Vector3(x0 + (x1 - x0) * u, H - 0.02 - Math.sin(u * Math.PI) * 0.15, z0 + (z1 - z0) * u));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8a97a8 })));
      const nf = 6;
      for (let q = 1; q < nf; q++) {
        const u = q / nf;
        const f = new THREE.Mesh(flagGeo, flagMats[fi++ % flagMats.length]);
        f.position.set(x0 + (x1 - x0) * u, H - 0.02 - Math.sin(u * Math.PI) * 0.15, z0 + (z1 - z0) * u);
        f.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        scene.add(f);
      }
    }
  }
}

// 樹與花
{
  const trunkMat = lambert(0xa0724a);
  const greens = [0x4cc35c, 0x37a94f, 0x6fd36a, 0x2f9d58].map((c) => lambert(c, true));
  for (let i = 0; i < 30; i++) {
    const ang = rand() * Math.PI * 2, r = 8.5 + rand() * 9;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.9, 8), trunkMat);
    trunk.position.y = 0.45; t.add(trunk);
    if (rand() < 0.45) {
      for (let k = 0; k < 2; k++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.75 - k * 0.2, 1.1, 8), greens[(i + k) % 4]);
        cone.position.y = 1.2 + k * 0.6; t.add(cone);
      }
    } else {
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + rand() * 0.25, 1), greens[(i + k) % 4]);
        b.position.set((rand() - 0.5) * 0.6, 1.3 + rand() * 0.5, (rand() - 0.5) * 0.6); t.add(b);
      }
    }
    t.position.set(x, 0, z);
    t.scale.setScalar(0.9 + rand() * 0.7);
    scene.add(t);
  }
  const petal = [0xff6fa1, 0xffd23f, 0xffffff, 0xa66cff, 0xff8a1f].map((c) => lambert(c));
  const fGeo = new THREE.SphereGeometry(0.07, 8, 6);
  for (let i = 0; i < 110; i++) {
    const ang = rand() * Math.PI * 2, r = 6.2 + rand() * 9;
    const f = new THREE.Mesh(fGeo, petal[i % petal.length]);
    f.position.set(Math.cos(ang) * r, 0.06, Math.sin(ang) * r);
    scene.add(f);
  }
}

// 地上的字
function flatLabel(text, x, z, size = 0.32, color = "#5b6e82", rot = 0) {
  const tex = canvasTex((g, w, h) => {
    g.font = "bold 92px " + FONT;
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2);
  }, 512, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = rot;
  m.position.set(x, 0.006, z);
  return m;
}
function badgeSprite(text, bg, size = 0.3) {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = bg; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
    g.lineWidth = 10; g.strokeStyle = "#fff"; g.stroke();
    g.fillStyle = "#fff"; g.font = "bold 72px " + FONT; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4);
  }, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(size, size, 1);
  return s;
}

// 起飛點 H、前方箭頭、距離
{
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "#fff9e6"; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#b94700"; g.lineWidth = 12; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "#ffac24"; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 28, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#b94700"; g.font = "bold 142px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("H", w / 2, h / 2 + 8);
  }, 256, 256);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.38, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  pad.rotation.x = -Math.PI / 2; pad.rotation.z = -Math.PI / 2; pad.position.y = 0.007; scene.add(pad);
  const sh = new THREE.Shape();
  sh.moveTo(0.4, 0.06); sh.lineTo(0.8, 0.06); sh.lineTo(0.8, 0.15); sh.lineTo(1.02, 0); sh.lineTo(0.8, -0.15); sh.lineTo(0.8, -0.06); sh.lineTo(0.4, -0.06);
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xff8a1f }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.y = 0.008; scene.add(arrow);
  scene.add(flatLabel("前方", 1.32, 0.0, 0.26, "#e46f05", -Math.PI / 2));
  // 機身會遮住正下方的 H；在旁邊保留固定的起飛點標示。
  scene.add(flatLabel("起飛 H", -0.62, 0, 0.20, "#b94700", -Math.PI / 2));
  for (let i = 1; i <= 4; i++) scene.add(flatLabel("前 " + i + " m", i, 0.5, 0.18, "#6f8297"));
  for (let i = 1; i <= 4; i++) {
    scene.add(flatLabel("左 " + i + " m", -0.6, -i, 0.18, "#6f8297"));
    scene.add(flatLabel("右 " + i + " m", -0.6, i, 0.18, "#6f8297"));
  }
}

const dotTex = canvasTex((g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, "#fff"); gr.addColorStop(0.6, "#fff"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, 64, 64);
// =========================================================
// Tello EDU 模型（依照實機比例：約 98 × 92.5 × 41 mm，畫面上放大 2.4 倍方便觀看）
// 機頭有鏡頭，旁邊是「飛行器狀態指示燈」，燈號規則和實機一樣
// =========================================================
const BODY_STYLES = {
  edu: { name: "Tello EDU", shell: 0x45494f, top: 0x34383d, battery: 0x2a2d31, guard: 0x2e3135, prop: 0x9aa3ad, logo: "#d9dde2", edu: true },
  white: { name: "Tello", shell: 0xf2f3f4, top: 0xdfe2e5, battery: 0xc9ced3, guard: 0xe9ebed, prop: 0xc4cad1, logo: "#7b8590", edu: false },
};
let bodyStyle = BODY_STYLES[store.get("body", "edu")] ? store.get("body", "edu") : "edu";
const LED_COLORS = { red: 0xff2a2a, green: 0x22ff55, yellow: 0xffc400, blue: 0x2a7bff };

function roundedRectShape(w, d, r) {
  const sh = new THREE.Shape(), x = -w / 2, y = -d / 2;
  sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r);
  sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
  return sh;
}
function slab(w, d, h, r, bevel, mat) {
  // 圓角長方體：w = 前後(x)、d = 左右(z)、h = 高(y)
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, d, r), { depth: Math.max(0.0005, h - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  return new THREE.Mesh(g, mat);
}

function makeDrone(opts = {}) {
  const st = BODY_STYLES[opts.style || bodyStyle];
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const body = new THREE.Group(); tilt.add(body);
  body.scale.setScalar(2.4);
  const M = (color, rough = 0.55, metal = 0.05) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const shell = M(st.shell, 0.5), top = M(st.top, 0.45), batt = M(st.battery, 0.6), guardM = M(st.guard, 0.5);
  const black = M(0x111214, 0.3, 0.2), motorM = M(0x24272b, 0.4, 0.4), metalM = M(0x8d949c, 0.3, 0.7);
  const add = (m, x, y, z) => { m.position.set(x, y, z); body.add(m); return m; };

  // 機身（前窄後寬的圓角殼）
  add(slab(0.054, 0.036, 0.020, 0.011, 0.004, shell), 0, 0.016, 0);
  // 上蓋
  add(slab(0.046, 0.030, 0.004, 0.009, 0.0015, top), 0.002, 0.0275, 0);
  // 電池（從後方插入，上面有止滑紋）
  add(slab(0.022, 0.028, 0.0035, 0.004, 0.001, batt), -0.016, 0.0295, 0);
  for (let k = 0; k < 4; k++) add(new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0008, 0.020), shell), -0.022 + k * 0.004, 0.0316, 0);
  // 上蓋的 TELLO 字樣
  {
    const tex = canvasTex((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = st.logo; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "bold 70px Arial, Helvetica, sans-serif"; g.fillText("TELLO", w / 2, h * 0.42);
      if (st.edu) { g.font = "bold 46px Arial, Helvetica, sans-serif"; g.fillText("EDU", w / 2, h * 0.82); }
    }, 256, 128);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.012), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    logo.rotation.x = -Math.PI / 2; logo.rotation.z = -Math.PI / 2;
    add(logo, 0.008, 0.0298, 0);
  }
  // 機頭：鏡頭（黑色圓框 + 玻璃）
  const lens = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 24), black), 0.0283, 0.017, 0.0015);
  lens.rotation.z = Math.PI / 2;
  const glass = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.0008, 24), new THREE.MeshStandardMaterial({ color: 0x1b2a44, roughness: 0.05, metalness: 0.9 })), 0.0299, 0.017, 0.0015);
  glass.rotation.z = Math.PI / 2;
  // 機頭：狀態指示燈（在鏡頭旁邊）
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const led = add(new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0028, 0.0045), ledMat), 0.0290, 0.017, -0.0085);
  const ledGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0x22ff55, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  ledGlow.scale.set(0.022, 0.022, 1);
  ledGlow.position.set(0.0305, 0.017, -0.0085);
  body.add(ledGlow);
  // 側面電源鍵
  add(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.003, 0.0012), metalM), -0.004, 0.017, 0.0185);
  // 機腹：視覺定位鏡頭
  const vps = add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.001, 16), black), 0.006, 0.0055, 0);

  // 四個馬達、螺旋槳、保護罩、腳架
  const props = [], discs = [];
  const MX = 0.0285, MZ = 0.0275, GR = 0.0205;
  const bladeMat = M(st.prop, 0.45);
  const discMat = new THREE.MeshBasicMaterial({ color: st.prop, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = sx * MX, cz = sz * MZ;
    // 機臂
    const len = Math.hypot(cx, cz) - 0.012;
    const arm = add(slab(len, 0.008, 0.006, 0.003, 0.001, shell), (cx / Math.hypot(cx, cz)) * (0.012 + len / 2), 0.012, (cz / Math.hypot(cx, cz)) * (0.012 + len / 2));
    arm.rotation.y = -Math.atan2(cz, cx);
    // 馬達座 + 馬達
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0068, 0.008, 20), shell), cx, 0.012, cz);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 20), motorM), cx, 0.019, cz);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.004, 8), metalM), cx, 0.0235, cz);
    // 保護罩（細圓環 + 支架）
    const ring = add(new THREE.Mesh(new THREE.CylinderGeometry(GR, GR, 0.0045, 40, 1, true), guardM), cx, 0.017, cz);
    ring.material.side = THREE.DoubleSide;
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(GR, 0.0009, 6, 40), guardM), cx, 0.0193, cz);
    rim.rotation.x = Math.PI / 2;
    for (let k = 0; k < 3; k++) {
      const a = Math.atan2(cz, cx) + (k - 1) * 0.9;
      const strut = add(new THREE.Mesh(new THREE.BoxGeometry(GR - 0.006, 0.0014, 0.0018), guardM), cx + Math.cos(a) * (GR / 2 + 0.003), 0.0152, cz + Math.sin(a) * (GR / 2 + 0.003));
      strut.rotation.y = -a;
    }
    // 腳架（實機的天線在腳裡）
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0018, 0.008, 10), shell), cx * 0.92, 0.004, cz * 0.92);
    // 螺旋槳（兩葉，稍微扭轉）
    const prop = new THREE.Group(); prop.position.set(cx, 0.0255, cz); body.add(prop);
    for (const side of [1, -1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.0175, 0.0007, 0.0048), bladeMat);
      blade.position.x = side * 0.0095;
      blade.rotation.x = side * 0.22;
      prop.add(blade);
    }
    prop.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0018, 12), bladeMat));
    prop.userData.dir = (sx * sz > 0) ? 1 : -1;
    props.push(prop);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.0185, 32), discMat);
    disc.rotation.x = -Math.PI / 2; disc.position.set(cx, 0.0258, cz);
    body.add(disc); discs.push(disc);
  }
  return { root, tilt, props, discs, discMat, led: { mat: ledMat, glow: ledGlow, cur: null } };
}

function setLED(d, colorName) {
  if (d.led.cur === colorName) return;
  d.led.cur = colorName;
  if (!colorName) { d.led.mat.color.set(0x151515); d.led.glow.material.opacity = 0; return; }
  const c = LED_COLORS[colorName];
  d.led.mat.color.set(c);
  d.led.glow.material.color.set(c);
  d.led.glow.material.opacity = 0.95;
}
function spinProps(d, on, dt) {
  for (const pr of d.props) if (on) pr.rotation.y += dt * 60 * pr.userData.dir;
  d.discMat.opacity = on ? 0.22 : 0;
}

// ---- 狀態指示燈規則（依照 Tello 使用手冊）----
//   開機自我檢測：紅、綠、黃交替閃爍
//   還沒連線（遙控訊號中斷）：黃燈快閃
//   已連線、視覺定位正常：綠燈每隔一段時間閃兩下
//   視覺定位無法使用（姿態模式，例如飛太高）：黃燈慢閃
//   電量低：紅燈慢閃　　電量嚴重不足：紅燈快閃
const LED_LOW = 15, LED_CRITICAL = 5, VPS_MAX = 600;
const PAGE_T0 = performance.now();
function ledPattern(state, tw) {
  if (state === "selftest") return ["red", "green", "yellow"][Math.floor(tw / 0.25) % 3];
  if (state === "nolink") return (tw % 0.25) < 0.125 ? "yellow" : null;
  if (state === "atti") return (tw % 1.0) < 0.5 ? "yellow" : null;
  if (state === "low") return (tw % 1.0) < 0.5 ? "red" : null;
  if (state === "critical") return (tw % 0.25) < 0.125 ? "red" : null;
  if (state === "ok") { const c = tw % 2.0; return c < 0.12 || (c > 0.24 && c < 0.36) ? "green" : null; }
  return null;
}
function droneLedState(p, t, battery) {
  const since = (performance.now() - PAGE_T0) / 1000;
  if (since < 3) return "selftest";
  if (!run) return "nolink";
  const conn = run.result.events.find((e) => e.kind === "connect");
  if (!conn || t < conn.t0) return "nolink";
  if (battery <= LED_CRITICAL) return "critical";
  if (battery <= LED_LOW) return "low";
  if (p.motors && p.z > VPS_MAX) return "atti";
  return "ok";
}

let drone = makeDrone();
scene.add(drone.root);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshBasicMaterial({ color: 0x23324a, transparent: true, opacity: 0.25, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.009; scene.add(shadow);

// 彩虹點點軌跡
const TRAIL_MAX = 20000;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 0.06, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.2 }));
trail.frustumCulled = false;
scene.add(trail);

// 彩帶
const confetti = [];
const confGeo = new THREE.PlaneGeometry(0.07, 0.035);
const confMats = [0xff5d5d, 0xffbf1f, 0x3fa9f5, 0x4cd964, 0xff6fa1, 0xa66cff].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
function burst(pos, n = 140, power = 1) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(confGeo, confMats[i % confMats.length]);
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2, up = 2 + Math.random() * 2.5;
    m.userData = { v: new THREE.Vector3(Math.cos(a) * (0.5 + Math.random() * 1.6) * power, up * power, Math.sin(a) * (0.5 + Math.random() * 1.6) * power), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), life: 3 + Math.random() };
    scene.add(m);
    confetti.push(m);
  }
}
function updateConfetti(dt) {
  for (let i = confetti.length - 1; i >= 0; i--) {
    const m = confetti[i], u = m.userData;
    u.v.y -= 3.2 * dt; u.v.multiplyScalar(1 - 1.2 * dt);
    m.position.addScaledVector(u.v, dt);
    m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt;
    if (m.position.y < 0.01) { m.position.y = 0.01; u.v.set(0, 0, 0); u.spin.set(0, 0, 0); }
    u.life -= dt;
    if (u.life <= 0) { scene.remove(m); confetti.splice(i, 1); }
  }
}

// 關卡物件
const missionGroup = new THREE.Group();
scene.add(missionGroup);
let ringMeshes = [], starMeshes = [];
const starGeo = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.07 : 0.17, a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  g.center();
  return g;
})();
const starMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb300, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.2 });
function buildLevelScene(L) {
  missionGroup.clear();
  ringMeshes = []; starMeshes = [];
  const sc = L.scene || {};
  if (sc.pad) {
    const pad = sc.pad;
    const isHome = Math.hypot(pad.x, pad.y) < 1;
    if (!isHome) {
      const tex = canvasTex((g, w, h) => {
        g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "#ff8a1f"; g.lineWidth = 14;
        for (const r of [0.4, 0.22]) { g.beginPath(); g.arc(w / 2, h / 2, w * r, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = "#ff5d5d"; g.beginPath(); g.arc(w / 2, h / 2, 16, 0, Math.PI * 2); g.fill();
      }, 256, 256);
      const m = new THREE.Mesh(new THREE.CircleGeometry(pad.r / 100 * 1.25, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      m.rotation.x = -Math.PI / 2; m.position.copy(S(pad.x, pad.y, 0.8)); missionGroup.add(m);
    } else {
      const ring = new THREE.Mesh(new THREE.RingGeometry(pad.r / 100 * 1.05, pad.r / 100 * 1.25, 48), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; missionGroup.add(ring);
    }
  }
  (sc.stars || []).forEach((st) => {
    const m = new THREE.Mesh(starGeo, starMat);
    m.position.copy(S(st.x, st.y, st.z));
    m.userData = { base: m.position.clone(), phase: Math.random() * 6 };
    missionGroup.add(m);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xfff2a8, transparent: true, opacity: 0.55, depthWrite: false }));
    glow.scale.set(0.55, 0.55, 1); m.add(glow);
    starMeshes.push(m);
  });
  (sc.rings || []).forEach((r, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.35, emissive: r.color, emissiveIntensity: 0.15 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 16, 64), mat);
    ring.position.copy(S(r.x, r.y, r.z));
    if (r.axis === "x") ring.rotation.y = Math.PI / 2;
    ring.userData = { base: r.color, pulse: 0 };
    missionGroup.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, (r.z - 55) / 100, 8), lambert(0xffffff));
    pole.position.copy(S(r.x, r.y, (r.z - 55) / 2));
    missionGroup.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.06, 20), lambert(r.color));
    base.position.copy(S(r.x, r.y, 3)); missionGroup.add(base);
    const lab = badgeSprite(String(i + 1), "#" + r.color.toString(16).padStart(6, "0"));
    lab.position.copy(S(r.x, r.y, r.z + 75));
    missionGroup.add(lab);
    ringMeshes.push(ring);
  });
  (sc.walls || []).forEach((wl, i) => {
    const col = new THREE.Color(wl.color || ["#7cc6ff", "#ffb46b", "#b9a3ff", "#8fe0a3", "#ff9fc2"][i % 5]);
    const box = new THREE.Mesh(new THREE.BoxGeometry(wl.w / 100, wl.h / 100, wl.d / 100), new THREE.MeshLambertMaterial({ color: col }));
    box.position.copy(S(wl.x, wl.y, wl.h / 2)); missionGroup.add(box);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0xffffff }));
    edge.position.copy(box.position); missionGroup.add(edge);
  });
  (sc.pillars || []).forEach((pl) => {
    const tex = canvasTex((g, w, h) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff5d5d";
      for (let k = -h; k < w + h; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 32, 0); g.lineTo(k + 32 - h, h); g.lineTo(k - h, h); g.fill(); }
    }, 256, 128);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 6);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(pl.r / 100, pl.r / 100, pl.h / 100, 32), new THREE.MeshLambertMaterial({ map: tex }));
    p.position.copy(S(pl.x, pl.y, pl.h / 2)); missionGroup.add(p);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), lambert(0xff6fa1));
    top.position.copy(S(pl.x, pl.y, pl.h + 20)); missionGroup.add(top);
    const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 32), lambert(0xffffff));
    swirl.position.copy(S(pl.x, pl.y, pl.h + 20)); swirl.rotation.y = Math.PI / 2; missionGroup.add(swirl);
  });
}

/* =========================================================
   相機控制（環繞／跟隨／俯視）
   ========================================================= */
let camMode = "orbit";
const orbit = { theta: 2.5, phi: 1.1, r: 3.4 };
const camTarget = new THREE.Vector3(0.6, 0.3, 0);
const camPos = new THREE.Vector3(-3, 2, 2);
let shake = 0;
function setCamMode(m) {
  camMode = m;
  for (const b of $("camBox").children) b.classList.toggle("on", b.dataset.cam === m);
}
$("camBox").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setCamMode(b.dataset.cam); });
const pointers = new Map();
let pinchDist = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  renderer.domElement.setPointerCapture(e.pointerId);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (camMode === "follow") {
      const off = camPos.clone().sub(camTarget);
      orbit.r = clamp(off.length(), 1, 30);
      orbit.theta = Math.atan2(off.z, off.x);
      orbit.phi = Math.acos(clamp(off.y / orbit.r, -1, 1));
      setCamMode("orbit");
    }
    orbit.theta += dx * 0.008;
    orbit.phi = clamp(orbit.phi - dy * 0.008, 0.12, 1.52);
  } else if (pointers.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) orbit.r = clamp(orbit.r * pinchDist / d, 1, 30);
    pinchDist = d;
    return;
  }
  p.x = e.clientX; p.y = e.clientY;
});
const endPtr = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
renderer.domElement.addEventListener("pointerup", endPtr);
renderer.domElement.addEventListener("pointercancel", endPtr);
renderer.domElement.addEventListener("wheel", (e) => { e.preventDefault(); orbit.r = clamp(orbit.r * Math.exp(e.deltaY * 0.0012), 1, 30); }, { passive: false });

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

/* =========================================================
   時間軸：從 Python 結果算出每個時間點的位置
   ========================================================= */
let run = null;
let playT = 0, playing = false, speed = +store.get("speed", "1") || 1;
const DT = 0.05;

function interpEvent(ev, t) {
  const kf = ev.kf;
  if (kf.length === 1 || ev.dur <= 0) return kf[kf.length - 1];
  const u = clamp((t - ev.t0) / ev.dur, 0, 1);
  if (kf.length === 2) {
    const e = ev.ease ? 0.5 - 0.5 * Math.cos(Math.PI * u) : u;
    const a = kf[0], b = kf[1];
    return [0, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e, a[3] + (b[3] - a[3]) * e, a[4] + (b[4] - a[4]) * e];
  }
  const tr = u * ev.dur;
  let lo = 0, hi = kf.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (kf[mid][0] <= tr) lo = mid; else hi = mid; }
  const a = kf[lo], b = kf[hi];
  const k = b[0] > a[0] ? clamp((tr - a[0]) / (b[0] - a[0]), 0, 1) : 1;
  return [0, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k];
}

function basePose(R, t) {
  const M = R.motion;
  if (!M.length || t < M[0].t0) return { x: 0, y: 0, z: 0, yaw: 0, motors: false, flip: null, fu: 0 };
  let lo = 0, hi = M.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (M[mid].t0 <= t) lo = mid; else hi = mid - 1; }
  const ev = M[lo];
  const end = ev.t0 + ev.dur;
  if (t >= end) {
    const k = ev.kf[ev.kf.length - 1];
    const isLast = lo === M.length - 1;
    const motors = isLast ? !!(R.result.final && R.result.final.flying) : ev.motors;
    return { x: k[1], y: k[2], z: k[3], yaw: k[4], motors: motors && k[3] > 0.5, flip: null, fu: 0 };
  }
  const p = interpEvent(ev, t);
  return { x: p[1], y: p[2], z: p[3], yaw: p[4], motors: ev.motors, flip: ev.flip || null, fu: (t - ev.t0) / ev.dur };
}

function poseAt(t) {
  if (!run) return { x: 0, y: 0, z: 0, yaw: 0, motors: false, flip: null, fu: 0 };
  const c = run.crash;
  if (c && t > c.t) {
    const k = clamp((t - c.t) / 0.6, 0, 1);
    return { x: c.pose.x, y: c.pose.y, z: c.pose.z * (1 - k * k), yaw: c.pose.yaw + k * 40, motors: false, flip: null, fu: 0, crashed: k };
  }
  return realism(run, t, basePose(run, t));
}

/* ---------- 真實飄動 ---------- */
const REAL_LEVELS = {
  stable: { h: 0, v: 0, tilt: 0, settle: 0, icon: "🧊", label: "穩定", tip: "穩定：完全照指令飛，沒有晃動（適合檢查路線）" },
  normal: { h: 4, v: 2.5, tilt: 1, settle: 1, icon: "🍃", label: "一般", tip: "一般：像真的 Tello 一樣，懸停時會輕微飄動" },
  windy: { h: 11, v: 4.5, tilt: 2.2, settle: 1.4, gust: true, icon: "🌬️", label: "有風", tip: "有風：陣風會把無人機吹偏，任務會變難喔！" },
};
const REAL_ORDER = ["stable", "normal", "windy"];
let realKey = REAL_LEVELS[store.get("real", "normal")] ? store.get("real", "normal") : "normal";
const nz = (t, s) => Math.sin(t * 0.83 + s) * 0.5 + Math.sin(t * 1.91 + s * 2.3) * 0.3 + Math.sin(t * 3.7 + s * 4.1) * 0.2;
function gustAt(t) { const g = Math.max(0, Math.sin(t * 0.37 + 0.5)); return g * g; }

function buildSettles(R) {
  const L = REAL_LEVELS[realKey];
  const out = [];
  if (!L.settle) return out;
  for (const e of R.motion) {
    const a = e.kf[0], b = e.kf[e.kf.length - 1];
    const tEnd = e.t0 + e.dur;
    if (e.kind === "move" || e.kind === "curve") {
      const p = e.kind === "curve" ? e.kf[Math.max(0, e.kf.length - 3)] : a;
      const dx = b[1] - p[1], dy = b[2] - p[2], dz = b[3] - p[3];
      const d = Math.hypot(dx, dy, dz) || 1;
      const dist = Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]);
      const A = (1.5 + Math.min(6, dist * 0.035)) * L.settle;
      out.push({ tEnd, ux: dx / d, uy: dy / d, uz: dz / d * 0.5, A, yawA: 0 });
    } else if (e.kind === "rotate") {
      const dyaw = b[4] - a[4];
      out.push({ tEnd, ux: 0, uy: 0, uz: 0, A: 0, yawA: Math.sign(dyaw) * Math.min(5, 1 + Math.abs(dyaw) * 0.03) * L.settle });
    }
  }
  return out;
}

function realism(R, t, p) {
  const L = REAL_LEVELS[realKey];
  if (!p.motors || p.z < 1 || !L.h) return p;
  const fade = clamp(p.z / 35, 0, 1);
  const ge = p.z < 45 ? 1.5 : 1;
  let dx = nz(t, 1.3) * L.h * ge, dy = nz(t, 7.9) * L.h * ge, dz = nz(t * 1.3, 4.2) * L.v;
  let dyaw = nz(t * 0.6, 2.2) * L.tilt * 1.2;
  if (L.gust) { const g = gustAt(t); dx += g * 9; dy -= g * 5; dyaw += g * 2; }
  const S0 = R.settles;
  if (S0 && S0.length) {
    let lo = 0, hi = S0.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (S0[mid].tEnd <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans >= 0) {
      const s = S0[ans], d = t - s.tEnd;
      if (d < 1.4) {
        const f = Math.exp(-4.2 * d) * Math.sin(9 * d);
        dx += s.ux * s.A * f; dy += s.uy * s.A * f; dz += s.uz * s.A * f; dyaw += s.yawA * f;
      }
    }
  }
  return { ...p, x: p.x + dx * fade, y: p.y + dy * fade, z: Math.max(p.z * 0.5, p.z + dz * fade), yaw: p.yaw + dyaw * fade };
}

function evaluateLevel(L, R) {
  const smp = R.samples;
  const sc = L.scene || {}, goal = L.goal || {};
  const stars = sc.stars || [], rings = sc.rings || [], pillars = sc.pillars || [];
  const out = { crash: null, marks: [], progress: new Array(smp.length), passed: 0, angle: 0, got: stars.map(() => false), starCount: 0, maxZ: 0 };
  let next = 0, total = 0, prev = null, nStar = 0;
  const circ = goal.circle != null ? pillars[goal.circle] : null;
  for (let i = 0; i < smp.length; i++) {
    const s = smp[i];
    out.maxZ = Math.max(out.maxZ, s.z);
    // 星星
    for (let k = 0; k < stars.length; k++) {
      if (!out.got[k] && Math.hypot(s.x - stars[k].x, s.y - stars[k].y, s.z - stars[k].z) < STAR_R) {
        out.got[k] = true; nStar++; out.marks.push({ t: s.t, type: "star", idx: k });
      }
    }
    // 圈
    if (i > 0) {
      const a = smp[i - 1], b = s;
      for (let r = 0; r < rings.length; r++) {
        const R0 = rings[r];
        const da = R0.axis === "x" ? a.x - R0.x : a.y - R0.y;
        const db = R0.axis === "x" ? b.x - R0.x : b.y - R0.y;
        if ((da < 0 && db >= 0) || (da > 0 && db <= 0)) {
          const k = da / (da - db);
          const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k, pz = a.z + (b.z - a.z) * k;
          const dist = R0.axis === "x" ? Math.hypot(py - R0.y, pz - R0.z) : Math.hypot(px - R0.x, pz - R0.z);
          if (dist < RING_PASS) {
            if (r === next) { out.marks.push({ t: b.t, type: "ring", idx: r }); next++; }
          } else if (dist < RING_FRAME) {
            out.crash = { t: b.t, pose: b, msg: "撞到第 " + (r + 1) + " 個圈的框了！" };
          }
        }
      }
    }
    // 牆
    for (const wl of (sc.walls || [])) {
      if (s.z > 3 && Math.abs(s.x - wl.x) < wl.w / 2 + 12 && Math.abs(s.y - wl.y) < wl.d / 2 + 12 && s.z < wl.h + 5) {
        out.crash = { t: s.t, pose: s, msg: "撞到牆了！" };
      }
    }
    // 柱子
    for (const pl of pillars) {
      if (s.z > 3 && Math.hypot(s.x - pl.x, s.y - pl.y) < pl.r + 13 && s.z < pl.h + 5) {
        out.crash = { t: s.t, pose: s, msg: "撞到柱子了！" };
      }
    }
    if (circ) {
      const ang = Math.atan2(s.y - circ.y, s.x - circ.x);
      if (prev !== null && s.z > 3) {
        let d = ang - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        total += d;
      }
      prev = ang;
    }
    out.progress[i] = { stars: nStar, rings: next, angle: Math.abs(total) * 180 / Math.PI };
    if (out.crash) break;
  }
  out.passed = next; out.starCount = nStar; out.angle = Math.abs(total) * 180 / Math.PI;
  return out;
}

function judge(L, R) {
  const res = R.result, fin = res.final, goal = L.goal, sc = L.scene || {}, m = R.mission;
  let landErr = null;
  if (fin && !fin.flying && fin.ever_flew && sc.pad) landErr = Math.hypot(fin.pose[0] - sc.pad.x, fin.pose[1] - sc.pad.y);
  const ctx = { a: res.analysis, windy: realKey === "windy", attempts, maxZ: m.maxZ, landErr, total: res.total };
  if (!goal) return { free: true, ctx };
  let fail = null;
  const nStars = (sc.stars || []).length, nRings = (sc.rings || []).length;
  if (R.crash) fail = { icon: "💥", title: "撞機了！", text: R.crash.msg + " 調整一下距離或高度再試一次。" };
  else if (res.error) fail = { icon: "🛠️", title: res.error.title || "程式出錯了", text: (res.error.line ? "第 " + res.error.line + " 行出了問題，" : "") + "看看畫面下方紅色的說明。" };
  else if (!fin.ever_flew) fail = { icon: "🤔", title: "還沒起飛喔", text: "要先 connect()、takeoff() 才能開始任務。" };
  else if (goal.stars && m.starCount < nStars) fail = { icon: "⭐", title: "還差 " + (nStars - m.starCount) + " 顆星星", text: "摘到 " + m.starCount + " / " + nStars + " 顆。看看星星的位置和高度，再調整一下。" };
  else if (goal.rings && m.passed < nRings) fail = { icon: "⭕", title: "還差 " + (nRings - m.passed) + " 個圈", text: "照順序穿過了 " + m.passed + " 個圈。看看高度和左右位置對不對？" };
  else if (goal.circle != null && m.angle < 340) fail = { icon: "🍭", title: "還沒繞完一圈", text: "目前繞了大約 " + Math.round(m.angle) + " 度，要繞滿 360 度。" };
  else if (goal.land && fin.flying) fail = { icon: "🛬", title: "還沒降落", text: "最後記得 tello.land() 才算完成。" };
  else if (goal.land && goal.land !== "any") {
    const d = Math.hypot(fin.pose[0] - goal.land.x, fin.pose[1] - goal.land.y);
    if (d > goal.land.r) fail = { icon: "😮", title: "降落位置差一點", text: "降落點離目標 " + Math.round(d) + " 公分（要在 " + goal.land.r + " 公分以內）。" };
  }
  if (!fail && L.forceWindy && realKey !== "windy") fail = { icon: "🌬️", title: "這關要在有風模式", text: "把右下角切成「🌬️ 有風」再飛一次。" };
  const done = !fail;
  const earned = [done, ...L.stars.map((st) => { try { return done && !!st.check(ctx); } catch (e) { return false; } })];
  return { done, fail, earned, ctx };
}

function verdictOf(L, R) {
  const j = R.judge;
  const res = R.result;
  if (j.free) {
    if (R.crash) return { cls: "bad", icon: "💥", sound: "fail", title: "撞機了！", text: R.crash.msg };
    if (res.error) return { cls: "bad", icon: "🛠️", sound: "error", title: res.error.title || "程式出錯了", text: (res.error.line ? "第 " + res.error.line + " 行出了問題，" : "") + "看看畫面下方紅色的說明。" };
    if (!res.events.length) return null;
    return { cls: "good", icon: "🎉", sound: "done", title: "飛行結束！", text: "總共飛了 " + res.total.toFixed(1) + " 秒，剩下電量 " + res.final.battery + "%。" + (res.warnings.length ? "有 " + res.warnings.length + " 個黃色提醒，記得看一下喔。" : "") };
  }
  if (!j.done) return { cls: "bad", icon: j.fail.icon, sound: R.crash ? "fail" : res.error ? "error" : "fail", title: j.fail.title, text: j.fail.text, retry: true };
  if (L.tier === "contest") {
    const c = NET.contest;
    const lines = res.analysis ? res.analysis.lines : "?";
    const extra = !NET.team ? "" : c && c.status === "running" ? "成績已經送出，看看排行榜！" : "（比賽還沒開始，這次是練習）";
    return { cls: "good", icon: "🏁", sound: "success", confetti: true, title: "完成任務！", text: "飛行 " + res.total.toFixed(1) + " 秒・程式 " + lines + " 行。" + extra };
  }
  return { cls: "good", icon: "🏆", sound: "success", confetti: true, title: "過關！", text: "", stars: j.earned, level: L };
}

function hsl(h, s, l) { const c = new THREE.Color(); c.setHSL(h, s, l); return c; }

function loadRun(result) {
  const motion = result.events.filter((e) => e.dur > 0);
  for (const m of confetti) scene.remove(m);
  confetti.length = 0;
  const R = { result, motion, crash: null };
  R.settles = buildSettles(R);
  run = R;
  const samples = [];
  let ft = 0;
  const total = result.total;
  for (let i = 0; ; i++) {
    const t = Math.min(i * DT, total);
    const p = realism(R, t, basePose(R, t));
    if (i > 0 && samples[samples.length - 1].motors) ft += t - samples[samples.length - 1].t;
    samples.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, motors: p.motors, ft });
    if (t >= total || samples.length >= TRAIL_MAX) break;
  }
  R.samples = samples;
  R.levelId = curLevel.id;
  R.mission = evaluateLevel(curLevel, R);
  R.crash = R.mission.crash;
  R.endT = R.crash ? R.crash.t + 0.7 : total;
  // 軌跡
  const pos = trailGeo.attributes.position.array, col = trailGeo.attributes.color.array;
  samples.forEach((s, i) => {
    const v = S(s.x, s.y, s.z);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    const c = hsl((i * 0.0035) % 1, 0.85, 0.58);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  });
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
  trailGeo.setDrawRange(0, 0);
  // 音效提示點
  const cues = [];
  for (const e of result.events) {
    if (e.kind === "flip") cues.push({ t: e.t0, type: "flip" });
    else if (e.kind === "takeoff") cues.push({ t: e.t0, type: "takeoff" });
    else if (e.kind === "print") cues.push({ t: e.t0, type: "ding" });
  }
  for (const w of result.warnings) cues.push({ t: w.t, type: "warn" });
  for (const m of R.mission.marks) cues.push({ t: m.t, type: m.type, idx: m.idx });
  if (R.crash) cues.push({ t: R.crash.t, type: "crash" });
  cues.sort((a, b) => a.t - b.t);
  R.cues = cues;
  R.cueIdx = 0;
  R.judge = judge(curLevel, R);
  R.verdict = verdictOf(curLevel, R);
  R.prints = result.events.filter((e) => e.kind === "print");
  R.steps = result.events.filter((e) => e.kind !== "print");
  codeDirty = false;
  hint("");
  buildLog(R);
  $("playBtn").disabled = $("restartBtn").disabled = $("scrub").disabled = false;
  $("scrub").max = Math.max(0.01, R.endT);
  playT = 0;
  bannerShown = false;
  capKeys = {};
  playing = R.endT > 0;
  if (!playing) finish();
  updateFrame(true);
  if (curLevel.tier === "contest") netPostFlight(R);
}

function resetCues() {
  if (!run) return;
  run.cueIdx = run.cues.findIndex((c) => c.t > playT + 1e-6);
  if (run.cueIdx < 0) run.cueIdx = run.cues.length;
}
function fireCues(t) {
  if (!run) return;
  while (run.cueIdx < run.cues.length && run.cues[run.cueIdx].t <= t + 1e-6) {
    const c = run.cues[run.cueIdx++];
    if (c.type === "ring") {
      Sound.sfx.ring();
      const ring = ringMeshes[c.idx];
      if (ring) { ring.userData.pulse = 1; burst(ring.position, 40, 0.5); }
    } else if (c.type === "star") {
      Sound.sfx.star();
      const st = starMeshes[c.idx];
      if (st) burst(st.position, 30, 0.4);
    } else if (c.type === "crash") {
      Sound.sfx.crash(); shake = 0.5;
    } else if (Sound.sfx[c.type]) Sound.sfx[c.type]();
  }
}

/* =========================================================
   飛行步驟（右側抽屜）與字幕
   ========================================================= */
let logItems = [];
function buildLog(R) {
  const log = $("log");
  log.innerHTML = "";
  logItems = [];
  const res = R.result;
  const items = [];
  res.events.forEach((e) => items.push({ t: e.t0, kind: "ev", ev: e }));
  res.warnings.forEach((w) => items.push({ t: w.t, kind: "warn", w }));
  items.forEach((it, i) => (it.i = i));
  items.sort((a, b) => a.t - b.t || (a.kind === "ev" ? 0 : 1) - (b.kind === "ev" ? 0 : 1) || a.i - b.i);
  if (R.crash) items.push({ t: R.crash.t, kind: "crash" });
  if (res.error) items.push({ t: res.total, kind: "err", e: res.error });
  if (!items.length) {
    log.innerHTML = '<div class="log-empty">程式執行完了，但 Tello 沒有收到任何指令。</div>';
    $("logSub").textContent = "沒有步驟";
    return;
  }
  for (const it of items) {
    let el = document.createElement("div");
    if (it.kind === "ev") {
      const e = it.ev;
      el.className = "row" + (e.kind === "print" ? " print" : "") + (["info", "hover", "wait", "connect"].includes(e.kind) ? " dim" : "");
      el.innerHTML = `<span class="t">${fmtTime(e.t0)}</span><span class="msg">${esc(e.label)}${e.line ? `<small>第 ${e.line} 行</small>` : ""}</span>`;
      el.addEventListener("click", () => seek(e.t0 + 0.001, true));
    } else if (it.kind === "warn") {
      el.className = "note warn";
      el.innerHTML = `<div class="h">⚠️ 提醒</div>${esc(it.w.msg)}${it.w.line ? `<div class="where">第 ${it.w.line} 行</div>` : ""}`;
    } else if (it.kind === "crash") {
      el.className = "note err";
      el.innerHTML = `<div class="h">💥 撞機了！</div>${esc(R.crash.msg)}<div class="where">發生在 ${fmtTime(R.crash.t)}</div>`;
    } else {
      const e = it.e;
      el.className = "note err";
      el.innerHTML = `<div class="h">${esc(e.title || "錯誤")}${e.line ? "（第 " + e.line + " 行）" : ""}</div>${esc(e.msg)}${e.hint ? `<div style="margin-top:4px">💡 ${esc(e.hint)}</div>` : ""}`;
      el.addEventListener("click", () => { if (e.line) setEditorLine(e.line, true); });
    }
    it.el = el;
    log.appendChild(el);
    logItems.push(it);
  }
  $("logSub").textContent = res.events.length + " 個步驟・點一下可以跳到那個時間";
  lastCur = -2;
}

let drawerOpen = false;
function setDrawer(open) {
  drawerOpen = open;
  $("drawer").classList.toggle("open", open);
  lastCur = -2;
  if (open) updateSteps(playT, true);
}
$("stepsBtn").addEventListener("click", () => setDrawer(!drawerOpen));
$("drawerClose").addEventListener("click", () => setDrawer(false));

let capKeys = {};
function setCap(id, key, html) {
  if (capKeys[id] === key) return;
  capKeys[id] = key;
  const el = $(id);
  if (key === null) { el.hidden = true; return; }
  el.innerHTML = html;
  el.hidden = false;
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
}

function lastBefore(list, t, getT) {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (getT(list[mid]) <= t + 1e-6) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

let lastCur = -2;
function updateSteps(t, force) {
  if (!run) {
    setCap("capStep", null); setCap("capSay", null); setCap("capWarn", null); setCap("capErr", null);
    return;
  }
  const res = run.result;
  const doneAll = t >= run.endT - 1e-6;
  const hold = 2.5 * Math.max(1, speed / 1.5);
  // 字幕：目前步驟
  const si = lastBefore(run.steps, t, (e) => e.t0);
  const failed = run.crash || res.error;
  if (doneAll && !failed && res.events.length) setCap("capStep", "end", "🎉 程式全部執行完畢！");
  else if (doneAll && failed) setCap("capStep", null);
  else if (si >= 0) {
    const e = run.steps[si];
    setCap("capStep", "s" + si, (e.line ? `<span class="ln">第 ${e.line} 行</span>` : "") + `<span>${esc(e.label)}</span>`);
  } else setCap("capStep", null);
  // 字幕：print 輸出
  const pi = lastBefore(run.prints, t, (e) => e.t0);
  if (pi >= 0 && t - run.prints[pi].t0 < hold && !doneAll) setCap("capSay", "p" + pi, esc(run.prints[pi].label));
  else setCap("capSay", null);
  // 字幕：提醒
  const wi = lastBefore(res.warnings, t, (w) => w.t);
  if (wi >= 0 && (t - res.warnings[wi].t < hold * 1.4 || (doneAll && !failed && res.warnings[wi].t >= res.total - 1e-6)))
    setCap("capWarn", "w" + wi, "⚠️ " + esc(res.warnings[wi].msg));
  else setCap("capWarn", null);
  // 字幕：錯誤（播放結束才出現）
  if (doneAll && run.crash) setCap("capErr", "crash", `<div class="h">💥 撞機了！</div><div>${esc(run.crash.msg)}</div>`);
  else if (doneAll && res.error) {
    const e = res.error;
    setCap("capErr", "err", `<div class="h">${esc(e.title || "錯誤")}${e.line ? "（第 " + e.line + " 行）" : ""}</div><div>${esc(e.msg)}</div>${e.hint ? `<div class="tip">💡 ${esc(e.hint)}</div>` : ""}`);
  } else setCap("capErr", null);

  // 編輯器高亮
  if (codeDirty) setEditorLine(null);
  else if (doneAll && res.error && res.error.line) setEditorLine(res.error.line, true);
  else if (doneAll) setEditorLine(null);
  else {
    const e = si >= 0 ? run.steps[si] : null;
    setEditorLine(e && e.line ? e.line : null, false);
  }

  // 抽屜清單
  if (!drawerOpen || !logItems.length) return;
  let cur = -1;
  for (let i = 0; i < logItems.length; i++) if (logItems[i].kind === "ev" && logItems[i].t <= t + 1e-6) cur = i;
  for (let i = 0; i < logItems.length; i++) {
    const it = logItems[i];
    const future = it.kind === "err" || it.kind === "crash" ? !doneAll : it.t > t + 1e-6;
    it.el.classList.toggle("future", future);
    if (it.kind === "ev") it.el.classList.toggle("now", i === cur && !doneAll);
  }
  if (cur !== lastCur || force) {
    lastCur = cur;
    const target = doneAll ? logItems[logItems.length - 1] : logItems[cur];
    if (target) {
      const log = $("log");
      const top = target.el.offsetTop;
      if (top < log.scrollTop || top > log.scrollTop + log.clientHeight - 40) log.scrollTop = top - log.clientHeight / 2;
    }
  }
}

/* =========================================================
   播放控制
   ========================================================= */
const PLAY_SVG = '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>';
const PAUSE_SVG = '<rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/>';
function seek(t, pause) {
  if (!run) return;
  playT = clamp(t, 0, run.endT);
  if (pause) playing = false;
  hideBanner();
  resetCues();
  updateFrame(true);
}
$("playBtn").addEventListener("click", () => {
  if (!run) return;
  if (playT >= run.endT - 1e-6) { playT = 0; bannerShown = false; resetCues(); }
  playing = !playing;
  hideBanner();
});
$("restartBtn").addEventListener("click", () => { if (!run) return; playT = 0; bannerShown = false; playing = true; hideBanner(); resetCues(); updateFrame(true); });
$("scrub").addEventListener("input", (e) => seek(+e.target.value, true));
for (const b of $("speedBox").children) {
  b.classList.toggle("on", +b.dataset.speed === speed);
  b.addEventListener("click", () => {
    speed = +b.dataset.speed; store.set("speed", speed);
    for (const x of $("speedBox").children) x.classList.toggle("on", x === b);
  });
}

let bannerShown = false;
function finish() {
  if (bannerShown || !run) return;
  bannerShown = true;
  const v = run.verdict;
  if (!v) return;
  $("banner").className = "overlay banner show " + v.cls;
  $("bannerIcon").textContent = v.icon || "";
  $("bannerTitle").textContent = v.title;
  $("bannerText").textContent = v.text;
  const sb = $("bannerStars"), next = $("bannerNext");
  sb.innerHTML = ""; next.hidden = true;
  if (v.stars) {
    const total = saveStars(v.level.id, v.stars);
    const crit = ["完成任務", ...v.level.stars.map((s) => s.text)];
    sb.innerHTML = `<div class="big-stars">${v.stars.map((e, i) => `<span class="${e ? "on" : ""}" style="animation-delay:${0.15 + i * 0.25}s">★</span>`).join("")}</div>` +
      `<ul class="crit">${crit.map((c, i) => `<li class="${v.stars[i] ? "ok" : total[i] ? "old" : ""}">${v.stars[i] ? "✅" : total[i] ? "☑️" : "⬜"} ${esc(c)}</li>`).join("")}</ul>` +
      (total.some((x, i) => x && !v.stars[i]) ? `<div class="crit-note">☑️ = 之前已經拿到的星星</div>` : "");
    const idx = LEVELS.indexOf(v.level);
    if (idx >= 0 && idx < LEVELS.length - 1) { next.hidden = false; next.dataset.id = LEVELS[idx + 1].id; }
    paintLevelBox();
  }
  if (v.sound && Sound.sfx[v.sound]) setTimeout(() => Sound.sfx[v.sound](), v.sound === "fail" && run.crash ? 500 : 50);
  if (v.confetti) burst(drone.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 160, 1);
}
function hideBanner() { $("banner").classList.remove("show"); }
$("bannerClose").addEventListener("click", hideBanner);

/* =========================================================
   每一格畫面
   ========================================================= */
let curBattery = 100;
function updateHUD(p, t) {
  $("hudH").textContent = Math.round(p.z) + " cm";
  let ft = 0;
  if (run && run.samples.length) {
    const i = clamp(Math.floor(Math.min(t, run.result.total) / DT), 0, run.samples.length - 1);
    ft = run.samples[i].ft;
  }
  const b = Math.max(0, Math.floor(100 - ft / 7.8));
  curBattery = b;
  $("hudB").textContent = b + "%";
  const bar = $("hudBar");
  bar.style.width = b + "%";
  bar.style.background = b > 50 ? "#3dbb5a" : b > 20 ? "#ffbf1f" : "#e5484d";
  $("hudP").textContent = "前 " + Math.round(p.x) + "・左 " + Math.round(p.y);
  const yaw = ((-p.yaw + 180) % 360 + 360) % 360 - 180;
  $("hudY").textContent = Math.round(yaw) + "°";
  $("hudT").textContent = t.toFixed(1) + " 秒";
}

function updateLevelProgress(t) {
  const L = curLevel, sc = L.scene || {}, goal = L.goal;
  const box = $("missionProgress");
  let pr = null;
  if (run && run.levelId === L.id && run.mission) {
    const i = clamp(Math.floor(Math.min(t, run.result.total) / DT), 0, run.mission.progress.length - 1);
    pr = run.mission.progress[i];
    if (!pr) pr = run.mission.progress.filter(Boolean).pop() || null;
  }
  const chips = [];
  const ns = (sc.stars || []).length, nr = (sc.rings || []).length;
  if (ns) { const v = pr ? pr.stars : 0; chips.push(`<span class="chip${v >= ns ? " done" : ""}">⭐ ${v} / ${ns}</span>`); }
  if (nr) { const v = pr ? pr.rings : 0; for (let k = 0; k < nr; k++) chips.push(`<span class="chip${k < v ? " done" : ""}">第 ${k + 1} 圈${k < v ? " ✓" : ""}</span>`); }
  if (goal && goal.circle != null) { const a = pr ? Math.round(pr.angle) : 0; chips.push(`<span class="chip${a >= 340 ? " done" : ""}">已繞 ${a}°</span>`); }
  const key = chips.join("");
  if (box.dataset.k !== key) { box.innerHTML = key; box.dataset.k = key; }
  // 3D：星星被摘走、圈變綠
  const got = run && run.levelId === L.id && run.mission ? run.mission.marks : [];
  starMeshes.forEach((m, k) => { m.visible = !got.some((g) => g.type === "star" && g.idx === k && g.t <= t + 1e-6); });
  const rv = pr ? pr.rings : 0;
  ringMeshes.forEach((m, k) => { const c = k < rv ? 0x4cd964 : m.userData.base; m.material.color.set(c); m.material.emissive.set(c); });
}

let lastUI = 0, motorSpeed = 0, motorClimb = 0;
function updateFrame(force) {
  const t = playT;
  const p = poseAt(t);
  const v = S(p.x, p.y, p.z);
  drone.root.position.copy(v);
  drone.root.rotation.y = p.yaw * Math.PI / 180;
  drone.tilt.rotation.set(0, 0, 0);
  motorSpeed = 0; motorClimb = 0;
  if (p.flip) {
    const e = p.fu < 0.5 ? 2 * p.fu * p.fu : 1 - Math.pow(-2 * p.fu + 2, 2) / 2;
    const ang = e * Math.PI * 2;
    if (p.flip === "f") drone.tilt.rotation.z = -ang;
    else if (p.flip === "b") drone.tilt.rotation.z = ang;
    else if (p.flip === "l") drone.tilt.rotation.x = -ang;
    else drone.tilt.rotation.x = ang;
    drone.root.position.y += Math.sin(p.fu * Math.PI) * 0.25;
    motorSpeed = 140;
  } else if (p.crashed) {
    drone.tilt.rotation.z = p.crashed * 1.2;
    drone.tilt.rotation.x = p.crashed * 0.6;
  } else if (run && p.motors) {
    const q = poseAt(Math.min(t + 0.12, run.endT));
    const dx = (q.x - p.x) / 0.12, dy = (q.y - p.y) / 0.12, dz = (q.z - p.z) / 0.12;
    const a = p.yaw * Math.PI / 180;
    const fwd = dx * Math.cos(a) + dy * Math.sin(a);
    const left = -dx * Math.sin(a) + dy * Math.cos(a);
    drone.tilt.rotation.z = -clamp(fwd * 0.0035, -0.3, 0.3);
    drone.tilt.rotation.x = -clamp(left * 0.0035, -0.3, 0.3);
    const dyaw = Math.abs(q.yaw - p.yaw) / 0.12;
    motorSpeed = Math.hypot(dx, dy) + Math.abs(dz) * 0.5 + dyaw * 0.4;
    motorClimb = dz;
    const L = REAL_LEVELS[realKey];
    if (L.h) {
      const tt = playing ? t : t + clock;
      drone.tilt.rotation.z += nz(tt * 2.1, 3.3) * 0.035 * L.tilt;
      drone.tilt.rotation.x += nz(tt * 2.4, 9.1) * 0.035 * L.tilt;
      if (!playing) {
        drone.root.position.x += Math.sin(clock * 1.3) * 0.006 * L.tilt;
        drone.root.position.z += Math.sin(clock * 1.7 + 1) * 0.006 * L.tilt;
        drone.root.position.y += Math.sin(clock * 2.1 + 2) * 0.005 * L.tilt;
      }
    }
  }
  drone.spin = p.motors;
  drone.motorsOn = p.motors;
  drone.lastPose = p;
  shadow.position.set(v.x, 0.009, v.z);
  const hgt = Math.max(0, v.y);
  shadow.scale.setScalar(1 + hgt * 0.25);
  shadow.material.opacity = 0.28 / (1 + hgt * 0.6);
  if (run) {
    const n = clamp(Math.floor(Math.min(t, run.result.total) / DT) + 1, 0, run.samples.length);
    trailGeo.setDrawRange(0, n);
  } else trailGeo.setDrawRange(0, 0);

  const now = performance.now();
  if (force || now - lastUI > 60) {
    lastUI = now;
    updateHUD(p, t);
    if (run) {
      $("scrub").value = t;
      $("timeLabel").textContent = fmtTime(t) + " / " + fmtTime(run.endT);
    }
    updateSteps(t, force);
    updateLevelProgress(t);
    $("playIcon").innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  }
}

let lastFrame = performance.now(), clock = 0;
function loop(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  clock += dt;
  if (run && playing) {
    playT += dt * speed;
    if (playT >= run.endT) { playT = run.endT; playing = false; fireCues(playT); updateFrame(true); finish(); }
    else fireCues(playT);
  }
  updateFrame(false);
  Sound.setMotor(!!(drone.motorsOn && playing), motorSpeed, motorClimb, speed);
  Sound.setWind(realKey === "windy" ? 0.12 + gustAt(playT + clock * (playing ? 0 : 1)) * 0.25 : 0);
  spinProps(drone, drone.spin, dt);
  {
    const p = drone.lastPose || { z: 0, motors: false };
    const b = curBattery;
    setLED(drone, ledPattern(droneLedState(p, playT, b), clock));
  }
  // 動畫小細節
  for (const c of clouds) { c.position.x += dt * 0.25; if (c.position.x > 40) c.position.x = -40; }
  for (const r of ringMeshes) {
    if (r.userData.pulse > 0) { r.userData.pulse = Math.max(0, r.userData.pulse - dt * 1.5); r.scale.setScalar(1 + Math.sin(r.userData.pulse * Math.PI) * 0.25); }
  }
  for (const st of starMeshes) {
    st.rotation.y += dt * 1.8;
    st.position.y = st.userData.base.y + Math.sin(clock * 2 + st.userData.phase) * 0.04;
  }
  updateConfetti(dt);
  updateGhosts(dt);
  // 相機
  const dp = SCREEN ? new THREE.Vector3(2, 0.4, 0) : drone.root.position;
  const k = 1 - Math.exp(-dt * 5);
  if (camMode === "orbit") {
    camTarget.lerp(new THREE.Vector3(dp.x, Math.max(0.3, dp.y), dp.z), k);
    const want = new THREE.Vector3(
      camTarget.x + orbit.r * Math.sin(orbit.phi) * Math.cos(orbit.theta),
      camTarget.y + orbit.r * Math.cos(orbit.phi),
      camTarget.z + orbit.r * Math.sin(orbit.phi) * Math.sin(orbit.theta));
    camPos.lerp(want, Math.min(1, k * 2.5));
  } else if (camMode === "follow") {
    const yaw = drone.root.rotation.y;
    camTarget.lerp(new THREE.Vector3(dp.x, dp.y + 0.1, dp.z), k);
    const want = new THREE.Vector3(dp.x - Math.cos(yaw) * 1.8, dp.y + 0.75, dp.z + Math.sin(yaw) * 1.8);
    camPos.lerp(want, k);
  } else {
    camTarget.lerp(new THREE.Vector3(dp.x, 0, dp.z), k);
    const want = new THREE.Vector3(camTarget.x, 2 + orbit.r * 1.6, camTarget.z + 0.01);
    camPos.lerp(want, k);
  }
  camera.position.copy(camPos);
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    camera.position.x += (Math.random() - 0.5) * shake * 0.15;
    camera.position.y += (Math.random() - 0.5) * shake * 0.15;
  }
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* =========================================================
   飄動程度切換
   ========================================================= */
function paintReal() {
  const L = REAL_LEVELS[realKey];
  $("realBtn").innerHTML = `<span style="font-size:16px">${L.icon}</span>${L.label}`;
  $("realBtn").title = L.tip;
}
$("realBtn").addEventListener("click", () => {
  realKey = REAL_ORDER[(REAL_ORDER.indexOf(realKey) + 1) % REAL_ORDER.length];
  store.set("real", realKey);
  paintReal();
  hint(REAL_LEVELS[realKey].tip);
  if (run) loadRun(run.result);
});
paintReal();

/* =========================================================
   關卡選擇
   ========================================================= */
const tierOf = (L) => TIERS.find((t) => t.id === L.tier);
function levelLabel(L) {
  if (L.tier === "contest") return "🏁 比賽場地";
  const t = tierOf(L);
  const same = LEVELS.filter((l) => l.tier === L.tier);
  return L.tier === "free" ? t.name : `${t.name} ${same.indexOf(L) + 1}｜${L.name}`;
}
function paintLevelBox() {
  const L = curLevel;
  $("levelName").textContent = levelLabel(L);
  $("missionDesc").innerHTML = L.desc;
  const sl = $("starList");
  if (!L.goal) { sl.innerHTML = ""; return; }
  const got = getStars(L.id);
  const crit = ["完成任務", ...L.stars.map((s) => s.text)];
  sl.innerHTML = crit.map((c, i) => `<li class="${got[i] ? "ok" : ""}"><span>${got[i] ? "★" : "☆"}</span>${esc(c)}</li>`).join("");
}
function clearRun() {
  run = null; playing = false; playT = 0; bannerShown = false; capKeys = {};
  trailGeo.setDrawRange(0, 0);
  $("playBtn").disabled = $("restartBtn").disabled = $("scrub").disabled = true;
  $("timeLabel").textContent = "0:00.0 / 0:00.0";
  $("log").innerHTML = '<div class="log-empty">還沒有執行程式。</div>';
  logItems = [];
  hideBanner();
  setEditorLine(null);
}
function setLevel(id, opts = {}) {
  const L = levelById(id);
  if (curLevel.tier === "contest" && L.tier !== "contest") clearGhosts();
  curLevel = L;
  store.set("level", L.id);
  attempts = 0;
  clearRun();
  buildLevelScene(L);
  paintLevelBox();
  if (L.forceWindy && realKey !== "windy") { realKey = "windy"; store.set("real", realKey); paintReal(); }
  // 程式或拼圖
  const pz = L.mode === "parsons";
  document.querySelector(".editor-card").classList.toggle("pz-mode", pz);
  if (pz) buildParsons(L, opts.reset);
  else {
    const saved = opts.reset ? null : store.get("code:" + L.id, null);
    ta.value = saved !== null ? saved : (L.starter || HEADER);
    ta.scrollTop = 0;
    refreshEditor();
    smartCaret();
    setCards(store.get("cards:" + L.id, L.cards ? "1" : "0") === "1");
  }
  codeDirty = false;
  if (typeof paintContest === "function" && NET) paintContest();
  if (L.tier === "contest" && NET.ok && !NET.team && !SCREEN) setTimeout(openJoin, 300);
  hint(pz ? "把積木排好之後，按「起飛！執行程式」。" : (L.goal && /___/.test(ta.value) ? "把程式裡的 ___ 換成正確的內容，再按「起飛！執行程式」。" : ""));
  updateFrame(true);
}
let missionOpen = store.get("missionOpen", "1") === "1";
function applyMissionOpen() {
  $("missionBody").style.display = missionOpen ? "" : "none";
  $("missionToggle").textContent = missionOpen ? "收起" : "展開";
}
$("missionToggle").addEventListener("click", () => { missionOpen = !missionOpen; store.set("missionOpen", missionOpen ? "1" : "0"); applyMissionOpen(); });

// 關卡地圖
function openLevelMap() {
  const box = $("levelGrid");
  let html = "", sum = 0, max = 0;
  if (NET.ok) {
    const c = NET.contest || {};
    const st = !CONTEST_LEVEL ? "老師還沒有設定場地" : { idle: "等待老師開始", running: "比賽進行中！", ended: "比賽已結束（可以練習）" }[c.status] || "";
    html += `<div class="tier"><div class="tier-h"><b>🏁 比賽</b><span>和其他組一起比賽</span></div><div class="tiles">` +
      `<button class="tile contest${curLevel.id === "contest" ? " cur" : ""}" data-id="contest" ${CONTEST_LEVEL ? "" : "disabled"}><span class="n">🏁</span><span class="nm">比賽場地</span><span class="st" style="color:var(--ink-2);letter-spacing:0;font-size:12px">${st}</span></button></div></div>`;
  }
  for (const t of TIERS) {
    const ls = LEVELS.filter((l) => l.tier === t.id);
    html += `<div class="tier"><div class="tier-h"><b>${t.name}</b><span>${t.who}</span></div><div class="tiles">`;
    ls.forEach((L, i) => {
      const g = getStars(L.id);
      if (L.goal) { sum += g.filter(Boolean).length; max += 3; }
      html += `<button class="tile${L === curLevel ? " cur" : ""}" data-id="${L.id}"><span class="n">${L.tier === "free" ? "🎈" : i + 1}</span><span class="nm">${esc(L.name)}</span>` +
        (L.goal ? `<span class="st">${g.map((x) => (x ? "★" : "☆")).join("")}</span>` : `<span class="st">&nbsp;</span>`) + `</button>`;
    });
    html += `</div></div>`;
  }
  box.innerHTML = html;
  $("levelTotal").textContent = `已經收集 ${sum} / ${max} 顆星星`;
  $("levelDlg").showModal();
}
$("levelBtn").addEventListener("click", openLevelMap);
$("levelName").addEventListener("click", openLevelMap);
$("levelGrid").addEventListener("click", (e) => {
  const b = e.target.closest(".tile");
  if (!b) return;
  $("levelDlg").close();
  setLevel(b.dataset.id);
});
$("levelClose").addEventListener("click", () => $("levelDlg").close());
$("levelReset").addEventListener("click", () => {
  if (!window.confirm("確定要清除這台裝置上所有關卡的星星和程式嗎？")) return;
  for (const L of LEVELS) { store.set("stars:" + L.id, "[]"); try { localStorage.removeItem("tello-sim:code:" + L.id); localStorage.removeItem("tello-sim:pz:" + L.id); } catch (e) {} }
  $("levelDlg").close();
  setLevel(curLevel.id, { reset: true });
});
$("resetLevelBtn").addEventListener("click", () => {
  if (!window.confirm("要把這一關的程式恢復成一開始的樣子嗎？")) return;
  setLevel(curLevel.id, { reset: true });
});
$("bannerNext").addEventListener("click", () => setLevel($("bannerNext").dataset.id));

/* =========================================================
   指令卡
   ========================================================= */
const cardVals = {};
function updateCardsScrollTip() {
  const grid = $("cardGrid");
  $("cardsScrollTip").hidden = grid.scrollHeight <= grid.clientHeight + 2;
}
new ResizeObserver(updateCardsScrollTip).observe($("cardGrid"));
function setCards(on) {
  cardsOn = on;
  $("cards").hidden = !on;
  $("cardsBtn").classList.toggle("on", on);
  store.set("cards:" + curLevel.id, on ? "1" : "0");
  markGutter();
}
$("cardsBtn").addEventListener("click", () => setCards(!cardsOn));
function buildCards() {
  const box = $("cardGrid");
  box.innerHTML = "";
  for (const c of CARDS) {
    if (c.v !== undefined) cardVals[c.key] = c.v;
    if (c.dir) cardVals[c.key] = 0;
    const el = document.createElement("div");
    el.className = "ccard";
    el.style.setProperty("--c", c.color);
    let inner = `<button class="cmain" data-k="${c.key}"><span class="ci">${c.icon}</span><span class="cl">${c.label}</span></button>`;
    if (c.v !== undefined) inner += `<div class="cstep"><button data-k="${c.key}" data-d="-1">−</button><span id="cv-${c.key}">${c.v}${c.unit ? `<small>${c.unit}</small>` : ""}</span><button data-k="${c.key}" data-d="1">＋</button></div>`;
    if (c.dir) inner += `<div class="cstep"><button class="cdir" data-k="${c.key}" data-dir="1"><span id="cv-${c.key}">${c.dir[0][0]}</span> ⇄</button></div>`;
    el.innerHTML = inner;
    box.appendChild(el);
  }
}
function cardValText(c) {
  if (c.dir) return c.dir[cardVals[c.key]][0];
  return cardVals[c.key] + (c.unit ? `<small>${c.unit}</small>` : "");
}
$("cardGrid").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const c = CARDS.find((x) => x.key === b.dataset.k);
  if (!c) return;
  if (b.dataset.d) {
    cardVals[c.key] = clamp(cardVals[c.key] + (+b.dataset.d) * c.step, c.min, c.max);
    $("cv-" + c.key).innerHTML = cardValText(c);
    return;
  }
  if (b.dataset.dir) {
    cardVals[c.key] = (cardVals[c.key] + 1) % c.dir.length;
    $("cv-" + c.key).innerHTML = cardValText(c);
    return;
  }
  Sound.sfx.click();
  if (c.outdent) { cardInsert(null, { outdent: true }); return; }
  const v = cardVals[c.key];
  const text = c.dir ? c.code(null, c.dir[v][1]) : c.code(v);
  cardInsert(text, { block: !!c.block, needs: c.needs });
});

let caret = null;            // 指令卡要插入的位置
const undoStack = [];
function pushUndo() { undoStack.push(ta.value); if (undoStack.length > 50) undoStack.shift(); }
function rememberCaret() { if (document.activeElement === ta) caret = ta.selectionStart; markGutter(); }
["keyup", "click", "select", "input"].forEach((ev) => ta.addEventListener(ev, rememberCaret));
function caretLine() {
  const v = ta.value, pos = caret === null ? v.length : clamp(caret, 0, v.length);
  return v.slice(0, pos).split("\n").length;
}
function smartCaret() {
  const ls = ta.value.split("\n");
  let idx = -1;
  for (let i = ls.length - 1; i >= 0; i--) if (/^\s*tello\.land\(\)/.test(ls[i])) { idx = i; break; }
  let target;
  if (idx > 0) {
    let k = idx - 1;
    if (ls[k].trim() === "") target = k;            // land() 前面的空白行
    else target = k;
  } else {
    target = ls.length - 1;
    while (target > 0 && ls[target].trim() === "" && ls[target - 1].trim() === "") target--;
  }
  let pos = 0;
  for (let i = 0; i < target; i++) pos += ls[i].length + 1;
  caret = pos + ls[target].length;
  markGutter();
}
function setCaretTo(pos) {
  caret = pos;
  try { ta.setSelectionRange(pos, pos); } catch (e) {}
  markGutter();
  const line = ta.value.slice(0, pos).split("\n").length;
  const top = 12 + (line - 1) * 24, h = ta.clientHeight;
  if (top < ta.scrollTop + 8 || top + 24 > ta.scrollTop + h - 8) { ta.scrollTop = Math.max(0, top - h / 2); syncScroll(); }
}
function cardInsert(text, { block = false, outdent = false, needs = null } = {}) {
  pushUndo();
  let v = ta.value;
  if (!v.trim()) { v = HEADER; caret = v.length; }
  if (caret === null) caret = v.length;
  if (needs === "time" && !/^\s*import time\b/m.test(v)) {
    const firstEnd = v.indexOf("\n");
    const ins = "import time\n";
    v = v.slice(0, firstEnd + 1) + ins + v.slice(firstEnd + 1);
    if (caret > firstEnd) caret += ins.length;
  }
  const pos = clamp(caret, 0, v.length);
  const ls = v.lastIndexOf("\n", pos - 1) + 1;
  let le = v.indexOf("\n", pos); if (le < 0) le = v.length;
  const cur = v.slice(ls, le);
  let ind = cur.match(/^ */)[0];
  let out, newCaret;
  if (outdent) {
    const base = cur.trim() === "" ? ind : (cur.trimEnd().endsWith(":") ? ind + "    " : ind);
    const nind = " ".repeat(Math.max(0, base.length - 4));
    if (cur.trim() === "") { out = v.slice(0, ls) + nind + v.slice(le); newCaret = ls + nind.length; }
    else { out = v.slice(0, le) + "\n" + nind + v.slice(le); newCaret = le + 1 + nind.length; }
  } else if (cur.trim() === "") {
    let line = ind + text;
    if (block) line += "\n" + ind + "    ";
    out = v.slice(0, ls) + line + v.slice(le);
    newCaret = ls + line.length;
  } else {
    if (cur.trimEnd().endsWith(":")) ind += "    ";
    let line = "\n" + ind + text;
    if (block) line += "\n" + ind + "    ";
    out = v.slice(0, le) + line + v.slice(le);
    newCaret = le + line.length;
  }
  ta.value = out;
  onCodeInput();
  setCaretTo(newCaret);
}
$("undoBtn").addEventListener("click", () => {
  if (!undoStack.length) { hint("沒有可以復原的動作了。"); return; }
  ta.value = undoStack.pop();
  onCodeInput();
  setCaretTo(Math.min(caret ?? ta.value.length, ta.value.length));
});
$("delLineBtn").addEventListener("click", () => {
  const v = ta.value;
  if (!v) return;
  pushUndo();
  const pos = clamp(caret ?? v.length, 0, v.length);
  const ls = v.lastIndexOf("\n", pos - 1) + 1;
  let le = v.indexOf("\n", pos); if (le < 0) le = v.length;
  let out, np;
  if (ls === 0) { out = v.slice(le + 1); np = 0; }
  else { out = v.slice(0, ls - 1) + v.slice(le); np = ls - 1; }
  ta.value = out;
  onCodeInput();
  setCaretTo(np);
});
// 點行號 = 選擇插入位置（平板不會跳出鍵盤）
gutter.parentElement.addEventListener("click", (e) => {
  const d = e.target.closest("[data-l]");
  if (!d) return;
  const ls = ta.value.split("\n");
  const n = +d.dataset.l;
  let pos = 0;
  for (let i = 0; i < n - 1; i++) pos += ls[i].length + 1;
  setCaretTo(pos + ls[n - 1].length);
});

/* =========================================================
   程式拼圖
   ========================================================= */
function shuffle(arr, seedStr) {
  let h = 0; for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { h = (h * 1664525 + 1013904223) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function buildParsons(L, reset) {
  const blocks = [...L.parsons.lines, ...(L.parsons.extra || [])].map((text, id) => ({ id, text }));
  let state = null;
  if (!reset) { try { state = JSON.parse(store.get("pz:" + L.id, "null")); } catch (e) { state = null; } }
  if (!state || !Array.isArray(state.ans)) state = { ans: [], pool: shuffle(blocks.map((b) => b.id), L.id) };
  pz = { L, blocks, ans: state.ans, pool: state.pool, hl: null, err: false };
  renderParsons();
}
function pzCode() { return pz.ans.map((id) => pz.blocks[id].text).join("\n") + "\n"; }
function pzSave() { store.set("pz:" + pz.L.id, JSON.stringify({ ans: pz.ans, pool: pz.pool })); }
function pzBlock(id, where, i) {
  const t = pz.blocks[id].text;
  const ind = t.match(/^ */)[0].length / 4;
  const cls = "pz-block" + (where === "ans" && pz.hl === i ? (pz.err ? " err" : " cur") : "");
  const ctrl = where === "ans" ? `<span class="pz-ctrl"><button data-a="up" data-i="${i}">▲</button><button data-a="down" data-i="${i}">▼</button><button data-a="out" data-i="${i}">✕</button></span>` : "";
  return `<div class="${cls}" data-w="${where}" data-id="${id}" data-i="${i}" style="--ind:${ind}">${where === "ans" ? `<span class="pz-n">${i + 1}</span>` : ""}<code>${highlight(t.trim()).replace(/\n $/, "")}</code>${ctrl}</div>`;
}
function renderParsons() {
  $("pzPool").innerHTML = pz.pool.length ? pz.pool.map((id, i) => pzBlock(id, "pool", i)).join("") : '<div class="pz-empty">積木都用完了！</div>';
  $("pzAns").innerHTML = pz.ans.length ? pz.ans.map((id, i) => pzBlock(id, "ans", i)).join("") : '<div class="pz-empty">點上面的積木，它就會排到這裡</div>';
}
$("parsons").addEventListener("click", (e) => {
  if (!pz) return;
  const btn = e.target.closest("button[data-a]");
  if (btn) {
    const i = +btn.dataset.i, a = btn.dataset.a;
    if (a === "up" && i > 0) [pz.ans[i - 1], pz.ans[i]] = [pz.ans[i], pz.ans[i - 1]];
    else if (a === "down" && i < pz.ans.length - 1) [pz.ans[i + 1], pz.ans[i]] = [pz.ans[i], pz.ans[i + 1]];
    else if (a === "out") pz.pool.push(...pz.ans.splice(i, 1));
    Sound.sfx.click();
    pzChanged();
    return;
  }
  const blk = e.target.closest(".pz-block[data-w='pool']");
  if (blk) {
    const id = +blk.dataset.id;
    pz.pool.splice(pz.pool.indexOf(id), 1);
    pz.ans.push(id);
    Sound.sfx.click();
    pzChanged();
  }
});
function pzChanged() {
  pz.hl = null;
  pzSave();
  renderParsons();
  if (run && !codeDirty) { codeDirty = true; hint("積木改過了，再按一次「起飛！執行程式」看看新的結果。", true); }
}
$("pzReset").addEventListener("click", () => { if (curLevel.mode === "parsons") { buildParsons(curLevel, true); pzSave(); } });

$("helpBtn").addEventListener("click", () => $("helpDlg").showModal());
$("helpClose").addEventListener("click", () => $("helpDlg").close());

/* =========================================================
   比賽模式（需要老師電腦的 serve.py）
   ========================================================= */
const NET = { ok: false, fails: 0, since: -1, arenaVersion: 0, arena: null, contest: null, board: [], offset: 0, team: null };
try { NET.team = JSON.parse(store.get("team", "null")); } catch (e) { NET.team = null; }
const MODE_NAME = { first: "最先完成", time: "飛行時間最短", lines: "程式最短" };

function makeContestLevel(a) {
  if (!a) return null;
  const ns = (a.stars || []).length, nr = (a.rings || []).length;
  const parts = [];
  if (ns) parts.push(`摘下 <b>${ns} 顆星星</b>`);
  if (nr) parts.push(`照順序穿過 <b>${nr} 個圈</b>`);
  parts.push(a.pad ? `最後降落在<b>停機坪</b>上（前方 ${a.pad.x}、左方 ${a.pad.y} 公分）` : "最後降落");
  const danger = [(a.walls || []).length ? "牆" : "", (a.pillars || []).length ? "柱子" : "", nr ? "圈的框" : ""].filter(Boolean);
  return {
    id: "contest", tier: "contest", name: "比賽場地", cards: true,
    desc: parts.join("、") + "。" + (danger.length ? "小心別撞到" + danger.join("、") + "！" : "") + "<br><small>星星和圈的位置可以看老師的場地圖，或在 3D 畫面裡轉動視角觀察。</small>",
    starter: HEADER + "tello.takeoff()\n\ntello.land()\n",
    scene: { stars: a.stars || [], rings: a.rings || [], pillars: a.pillars || [], walls: a.walls || [], pad: a.pad || null },
    goal: { stars: ns > 0, rings: nr > 0, land: a.pad ? { x: a.pad.x, y: a.pad.y, r: a.pad.r || 35 } : "any" },
    stars: [],
  };
}

async function netPoll() {
  let ok = false;
  try {
    const r = await fetch("api/state?since=" + NET.since + (NET.team ? "&team=" + NET.team.id : ""), { cache: "no-store" });
    if (r.ok) {
      const st = await r.json();
      ok = true;
      const first = !NET.ok;
      NET.ok = true; NET.fails = 0;
      NET.offset = st.now - Date.now() / 1000;
      NET.contest = st.contest;
      NET.board = st.leaderboard || [];
      if (NET.team && !NET.board.some((b) => b.id === NET.team.id)) { NET.team = null; store.set("team", "null"); }
      if (st.arenaVersion !== NET.arenaVersion) {
        NET.arenaVersion = st.arenaVersion;
        NET.arena = st.arena;
        CONTEST_LEVEL = makeContestLevel(st.arena);
        if (curLevel.tier === "contest" || (first && (store.get("level", "") === "contest" || SCREEN))) {
          if (CONTEST_LEVEL) {
            const was = curLevel.tier === "contest";
            setLevel("contest");
            if (was) hint("老師更新了比賽場地！", true);
          }
        }
      }
      if (NET.since >= 0) for (const f of st.flights || []) spawnGhost(f);
      NET.since = st.seq;
      paintContest();
    }
  } catch (e) { ok = false; }
  if (!ok) { NET.fails++; if (NET.fails > 2) { NET.ok = false; paintContest(); } }
  setTimeout(netPoll, ok ? 1500 : 8000);
}

async function netPostFlight(R) {
  if (!NET.ok || !NET.team || SCREEN) return;
  const smp = R.samples, path = [];
  const end = R.crash ? R.crash.t : Infinity;
  for (let i = 0; i < smp.length; i += 2) {
    const s = smp[i];
    if (s.t > end) break;
    path.push([+s.t.toFixed(2), Math.round(s.x), Math.round(s.y), Math.round(s.z), Math.round(s.yaw), s.motors ? 1 : 0]);
  }
  if (R.crash) { const c = R.crash.pose; path.push([+(R.crash.t + 0.6).toFixed(2), Math.round(c.x), Math.round(c.y), 0, Math.round(c.yaw), 0]); }
  try {
    await fetch("api/flight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      teamId: NET.team.id, path, success: !!(R.judge && R.judge.done), flightTime: R.result.total,
      lines: R.result.analysis ? R.result.analysis.lines : 999, crashT: R.crash ? R.crash.t : null, arenaVersion: NET.arenaVersion,
    }) });
  } catch (e) {}
}

// ---- 加入隊伍 ----
function openJoin() {
  $("joinName").value = NET.team ? NET.team.name : "";
  $("joinErr").textContent = "";
  $("joinDlg").showModal();
  setTimeout(() => $("joinName").focus(), 50);
}
async function doJoin() {
  const name = $("joinName").value.trim();
  if (!name) { $("joinErr").textContent = "請輸入隊名"; return; }
  try {
    const r = await (await fetch("api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, teamId: NET.team ? NET.team.id : null }) })).json();
    if (!r.ok) { $("joinErr").textContent = r.error || "加入失敗"; return; }
    NET.team = r.team;
    store.set("team", JSON.stringify(r.team));
    $("joinDlg").close();
    hint("歡迎「" + r.team.name + "」！按「起飛！執行程式」開始挑戰。");
    paintContest();
  } catch (e) { $("joinErr").textContent = "連不上老師的電腦"; }
}
$("joinBtn").addEventListener("click", doJoin);
$("joinName").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) doJoin(); });
$("joinCancel").addEventListener("click", () => $("joinDlg").close());
$("cbTeam").addEventListener("click", openJoin);
$("cbBoard").addEventListener("click", () => { boardOpen = !boardOpen; paintContest(); });
let boardOpen = SCREEN;

// ---- 比賽列與排行榜 ----
const fmtClock = (s) => { if (s == null || !isFinite(s)) return "--:--"; s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };
function contestClock() {
  const c = NET.contest;
  if (!c || !c.startedAt) return null;
  const now = Date.now() / 1000 + NET.offset;
  if (c.status === "running") return c.duration ? c.duration - (now - c.startedAt) : now - c.startedAt;
  return (c.endedAt || now) - c.startedAt;
}
function metricText(r, mode) {
  if (!r.done) return "—";
  if (mode === "time") return r.bestTime + " 秒";
  if (mode === "lines") return r.bestLines + " 行";
  return fmtClock(r.firstAt);
}
function paintContest() {
  const show = NET.ok && curLevel.tier === "contest";
  $("contestBar").hidden = !show;
  $("boardPanel").hidden = !(show && boardOpen);
  if (!show) return;
  const c = NET.contest || { status: "idle", mode: "first" };
  const pill = $("cbStatus");
  pill.textContent = { idle: "等待老師開始", running: "比賽中", ended: "比賽結束" }[c.status];
  pill.className = "cb-pill " + c.status;
  $("cbMode").textContent = "排名：" + MODE_NAME[c.mode];
  const me = NET.team && NET.board.find((b) => b.id === NET.team.id);
  $("cbTeam").innerHTML = NET.team ? `<i style="background:${NET.team.color}"></i>${esc(NET.team.name)}${me && me.rank ? `・第 <b>${me.rank}</b> 名` : ""}` : "＋ 輸入隊名加入";
  $("cbBoard").classList.toggle("on", boardOpen);
  const rows = NET.board;
  $("boardRows").innerHTML = rows.length ? rows.map((r) => `<div class="br${NET.team && r.id === NET.team.id ? " me" : ""}">
      <span class="rk">${r.rank ? ["🥇", "🥈", "🥉"][r.rank - 1] || r.rank : "—"}</span>
      <span class="nm"><i style="background:${r.color}"></i>${esc(r.name)}</span>
      <span class="mt">${metricText(r, c.mode)}</span>
      <span class="tr">${r.tries} 次</span></div>`).join("") : '<div class="br-empty">還沒有隊伍加入</div>';
  $("boardMode").textContent = MODE_NAME[c.mode];
}
setInterval(() => {
  if ($("contestBar").hidden) return;
  const c = NET.contest, t = contestClock();
  $("cbTimer").textContent = c && c.status === "running" && c.duration ? "⏱ 剩 " + fmtClock(t) : c && c.startedAt ? "⏱ " + fmtClock(t) : "⏱ --:--";
}, 250);

// ---- 其他隊伍的無人機（幽靈）----
const ghosts = new Map();
function makeNameSprite(name, color) {
  const tex = canvasTex((g, w, h) => {
    g.font = "bold 44px " + FONT;
    const tw = Math.min(w - 20, g.measureText(name).width + 40);
    g.fillStyle = color; const x0 = (w - tw) / 2;
    g.beginPath(); g.roundRect ? g.roundRect(x0, 14, tw, 70, 35) : g.rect(x0, 14, tw, 70); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name, w / 2, 51);
  }, 512, 100);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.1, 0.215, 1);
  sp.renderOrder = 10;
  return sp;
}
function spawnGhost(f) {
  if (curLevel.tier !== "contest") return;
  if (!SCREEN && NET.team && f.teamId === NET.team.id) return;
  if (!f.path || f.path.length < 2) return;
  removeGhost(f.teamId);
  const d = makeDrone();
  const mats = [];
  d.root.traverse((o) => {
    if (o.material && o.material !== d.led.glow.material && o.material !== d.discMat && o.material !== d.led.mat) {
      o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = SCREEN ? 0.95 : 0.65; mats.push(o.material);
    }
  });
  // 隊伍顏色的光圈，方便分辨是哪一隊
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.19, 40), new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = -0.005;
  d.root.add(halo); mats.push(halo.material);
  const label = makeNameSprite(f.name, f.color);
  label.position.set(0, 0.32, 0);
  d.root.add(label);
  mats.push(label.material);
  scene.add(d.root);
  // 隊伍顏色軌跡
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(f.path.length * 3);
  f.path.forEach((p, i) => { const v = S(p[1], p[2], p[3]); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; });
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const tmat = new THREE.PointsMaterial({ size: 0.045, map: dotTex, color: new THREE.Color(f.color), transparent: true, opacity: 0.7, depthWrite: false, alphaTest: 0.2 });
  const trailPts = new THREE.Points(geo, tmat);
  trailPts.frustumCulled = false;
  scene.add(trailPts);
  mats.push(tmat);
  ghosts.set(f.teamId, { d, trail: trailPts, geo, mats, path: f.path, t: 0, end: f.path[f.path.length - 1][0], success: f.success, name: f.name });
}
function removeGhost(id) {
  const g = ghosts.get(id);
  if (!g) return;
  scene.remove(g.d.root); scene.remove(g.trail);
  ghosts.delete(id);
}
function clearGhosts() { for (const id of [...ghosts.keys()]) removeGhost(id); }
function updateGhosts(dt) {
  for (const [id, g] of ghosts) {
    g.t += dt * (SCREEN ? 1.5 : Math.max(1, speed));
    const P = g.path;
    let lo = 0, hi = P.length - 1;
    const t = Math.min(g.t, g.end);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m][0] <= t) lo = m; else hi = m; }
    const a = P[lo], b = P[hi];
    const k = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 1;
    const x = a[1] + (b[1] - a[1]) * k, y = a[2] + (b[2] - a[2]) * k, z = a[3] + (b[3] - a[3]) * k, yaw = a[4] + (b[4] - a[4]) * k;
    g.d.root.position.copy(S(x, y, z));
    g.d.root.rotation.y = yaw * Math.PI / 180;
    spinProps(g.d, !!a[5], dt);
    setLED(g.d, ledPattern("ok", clock + g.end));
    g.geo.setDrawRange(0, lo + 1);
    const hold = SCREEN ? 25 : 10;
    if (g.t > g.end + hold) {
      const fade = 1 - (g.t - g.end - hold) / 2;
      for (const m of g.mats) m.opacity = Math.max(0, Math.min(m.opacity, fade));
      if (fade <= 0) removeGhost(id);
    }
  }
}

/* =========================================================
   機身外觀切換（Tello EDU 深灰／Tello 白色）
   ========================================================= */
function setBodyStyle(k) {
  bodyStyle = k;
  store.set("body", k);
  const old = drone;
  const nd = makeDrone();
  nd.root.position.copy(old.root.position);
  nd.root.rotation.copy(old.root.rotation);
  scene.remove(old.root);
  scene.add(nd.root);
  drone = nd;
  if (SCREEN) drone.root.visible = false;
  $("bodyBtn").textContent = k === "edu" ? "⬛ EDU" : "⬜ Tello";
  updateFrame(true);
}
$("bodyBtn").addEventListener("click", () => setBodyStyle(bodyStyle === "edu" ? "white" : "edu"));
$("bodyBtn").textContent = bodyStyle === "edu" ? "⬛ EDU" : "⬜ Tello";

/* =========================================================
   啟動
   ========================================================= */
buildCards();
if (SCREEN) { document.body.classList.add("screen"); orbit.r = 9.5; orbit.phi = 0.95; orbit.theta = 2.6; drone.root.visible = false; shadow.visible = false; }
setLevel(curLevel.id);
applyMissionOpen();
netPoll();
$("loading").remove();
startWorker();
requestAnimationFrame(loop);
