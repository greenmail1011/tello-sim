// Tello 飛行模擬器 —— 網頁介面、3D 場景、時間軸播放
let THREE;
try {
  THREE = await import("./lib/three.module.min.js");
} catch (e) {
  THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js");
}

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("tello-sim:" + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("tello-sim:" + k, v); } catch (e) {} },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
  ["遙控模式：畫圓圈", `from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()

# 一邊往前、一邊順時針旋轉，就會繞圓圈
tello.send_rc_control(0, 40, 0, 40)
time.sleep(9)

# 全部設成 0 = 停下來
tello.send_rc_control(0, 0, 0, 0)
time.sleep(1)
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
   任務（座標單位：公分；x = 前方、y = 左方、z = 高度）
   ========================================================= */
const RINGS = [
  { x: 150, y: 0, z: 120, axis: "x" },
  { x: 350, y: 0, z: 200, axis: "x" },
  { x: 450, y: 150, z: 200, axis: "y" },
];
const RING_PASS = 40, RING_FRAME = 62;
const PILLAR = { x: 250, y: 0, r: 20, h: 300 };
const PAD = { x: 200, y: 0, r: 35 };

const MISSIONS = {
  free: {
    name: "自由飛行",
    desc: "沒有任務，盡情測試你的程式！場地 <b>10 × 10 公尺</b>，地上每一格 <b>50 公分</b>。",
  },
  pad: {
    name: "任務 1｜降落停機坪",
    desc: "停機坪在起點<b>正前方 2 公尺</b>。起飛、飛過去，然後準確降落在停機坪上（誤差 35 公分內）。",
  },
  rings: {
    name: "任務 2｜穿越三個圈",
    desc: "照順序穿過 3 個圈，最後降落：<br>① 前方 1.5 m、高度 1.2 m<br>② 前方 3.5 m、高度 2 m<br>③ 前方 4.5 m、<b>左邊 1.5 m</b>、高度 2 m（圈面向側邊）<br>碰到圈的框會撞機喔！",
  },
  pillar: {
    name: "任務 3｜繞柱子一圈",
    desc: "柱子在起點<b>正前方 2.5 公尺</b>。讓 Tello 繞柱子一整圈，再回到起點 H 降落（誤差 50 公分內）。小心別撞到柱子！",
  },
};

/* =========================================================
   程式編輯器（textarea + 語法上色）
   ========================================================= */
const ta = $("code"), hl = $("hl"), layer = $("layer"), gutter = $("gutter"), hlLine = $("hlLine");
const KW = new Set("False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const TELLO_METHODS = new Set(("connect takeoff land emergency end move move_forward move_back move_left move_right move_up move_down " +
  "rotate_clockwise rotate_counter_clockwise flip flip_left flip_right flip_forward flip_back set_speed go_xyz_speed curve_xyz_speed " +
  "send_rc_control get_battery get_height get_yaw get_flight_time get_temperature get_distance_tof get_barometer get_pitch get_roll " +
  "streamon streamoff get_frame_read send_control_command send_command_with_return query_battery get_current_state get_state_field").split(" "));
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
  if (line === edLine && isErr === edErr) return;
  edLine = line; edErr = isErr;
  if (!line) { hlLine.style.display = "none"; }
  else {
    hlLine.style.display = "block";
    hlLine.style.top = (12 + (line - 1) * 24) + "px";
    hlLine.classList.toggle("err", !!isErr);
    // 讓目前這一行留在畫面裡
    const top = 12 + (line - 1) * 24, h = ta.clientHeight;
    if (top < ta.scrollTop + 8 || top + 24 > ta.scrollTop + h - 8) {
      ta.scrollTop = Math.max(0, top - h / 3);
      syncScroll();
    }
  }
  markGutter();
}
function markGutter() {
  for (const d of gutter.children) {
    const l = +d.dataset.l;
    d.className = l === edLine ? (edErr ? "err" : "cur") : "";
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
  saveTimer = setTimeout(() => store.set("code", ta.value), 400);
  if (run && !codeDirty) {
    codeDirty = true;
    setEditorLine(null);
    hint("程式改過了，再按一次「執行程式」看看新的結果。", true);
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

// 範例、開啟、下載、清空
const exSel = $("exampleSel");
EXAMPLES.forEach(([name], i) => { const o = document.createElement("option"); o.value = i; o.textContent = name; exSel.appendChild(o); });
exSel.addEventListener("change", () => {
  if (exSel.value === "") return;
  const [name, code] = EXAMPLES[+exSel.value];
  if (ta.value.trim() && ta.value.trim() !== code.trim() && !confirmReplace()) { exSel.value = ""; return; }
  setCode(code);
  exSel.value = "";
  hint("已載入範例「" + name + "」，按「執行程式」試試看！");
});
function confirmReplace() { return window.confirm("要用範例取代目前的程式嗎？（目前的程式會不見）"); }
function setCode(code) {
  ta.value = code;
  ta.scrollTop = 0;
  onCodeInput();
  store.set("code", code);
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
function setPyStatus(kind, text) { $("pyDot").className = "dot " + kind; $("pyText").textContent = text; }
function startWorker() {
  workerReady = false;
  $("runBtn").disabled = true;
  $("runText").textContent = "Python 準備中…";
  setPyStatus("busy", "Python 載入中…");
  worker = new Worker("worker.js");
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") {
      workerReady = true;
      $("runBtn").disabled = false;
      $("runText").textContent = "執行程式";
      setPyStatus("ok", m.where === "cdn" ? "Python 準備好了（線上版）" : "Python 準備好了");
    } else if (m.type === "fatal") {
      setPyStatus("bad", "Python 載入失敗");
      $("runText").textContent = "無法執行";
      hint("Python 載入失敗：" + m.message + "。請確認是用老師的網址開啟（不是直接點兩下 html 檔）。", true);
    } else if (m.type === "result") {
      if (m.id !== runId) return;
      clearTimeout(runTimer);
      $("runBtn").disabled = false;
      $("runText").textContent = "執行程式";
      loadRun(m.result);
    }
  };
  worker.onerror = (e) => {
    setPyStatus("bad", "Python 載入失敗");
    hint("Python 載入失敗：" + (e.message || "未知錯誤"), true);
  };
  worker.postMessage({ type: "init", baseUrl: location.href });
}

function doRun() {
  if (!workerReady) return;
  const cleaned = cleanCode(ta.value);
  if (cleaned !== ta.value) { setCode(cleaned); hint("已自動整理程式（拿掉 ``` 標記、Tab 換成空白）。"); }
  if (!ta.value.trim()) { hint("先貼上或寫一段程式喔！"); return; }
  hideBanner();
  if (window.innerWidth <= 1000) {
    const r = document.querySelector(".view-card").getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) document.querySelector(".view-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  runId++;
  $("runBtn").disabled = true;
  $("runText").textContent = "執行中…";
  worker.postMessage({ type: "run", id: runId, code: ta.value });
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
scene.background = new THREE.Color(0xcfe6fb);
scene.fog = new THREE.Fog(0xcfe6fb, 18, 45);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);

scene.add(new THREE.HemisphereLight(0xffffff, 0xa8bccf, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-4, 8, 5);
scene.add(sun);

const S = (x, y, z) => new THREE.Vector3(x / 100, z / 100, -y / 100); // 模擬座標(公分) → 3D(公尺)

function canvasTex(draw, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
function flatLabel(text, x, z, size = 0.32, color = "#5b6e82", rot = 0) {
  const tex = canvasTex((g, w, h) => {
    g.font = "bold 92px " + getComputedStyle(document.body).fontFamily;
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2);
  }, 512, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = rot;
  m.position.set(x, 0.004, z);
  return m;
}

// 地面
const outer = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0xd6e4cc }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.002; scene.add(outer);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshLambertMaterial({ color: 0xf7f9fc }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const g1 = new THREE.GridHelper(10, 20, 0xd5dee8, 0xe1e8ef); g1.position.y = 0.001; scene.add(g1);
const g2 = new THREE.GridHelper(10, 10, 0xb9c6d4, 0xc3cfdc); g2.position.y = 0.0015; scene.add(g2);
{
  const pts = [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]].map(([a, b]) => new THREE.Vector3(a, 0.003, b));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7d90a5 })));
}
// 起飛點 H
{
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "#1d2b3a"; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#ffffff"; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 20, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#ffffff"; g.font = "bold 130px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("H", w / 2, h / 2 + 8);
  }, 256, 256);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.28, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  pad.rotation.x = -Math.PI / 2; pad.rotation.z = -Math.PI / 2; pad.position.y = 0.005; scene.add(pad);
}
// 前方箭頭與距離標示
{
  const sh = new THREE.Shape();
  sh.moveTo(0.38, 0.05); sh.lineTo(0.8, 0.05); sh.lineTo(0.8, 0.13); sh.lineTo(1.0, 0); sh.lineTo(0.8, -0.13); sh.lineTo(0.8, -0.05); sh.lineTo(0.38, -0.05);
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.y = 0.006; scene.add(arrow);
  scene.add(flatLabel("前方", 1.3, 0.0, 0.26, "#e0620a", -Math.PI / 2));
  for (let i = 1; i <= 4; i++) scene.add(flatLabel("前 " + i + " m", i, 0.5, 0.2, "#6f8297"));
  for (let i = 1; i <= 4; i++) {
    scene.add(flatLabel("左 " + i + " m", -0.6, -i, 0.2, "#6f8297"));
    scene.add(flatLabel("右 " + i + " m", -0.6, i, 0.2, "#6f8297"));
  }
}

// Tello 模型
function makeDrone() {
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const body = new THREE.Group(); tilt.add(body);
  body.scale.setScalar(2.2);
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa6b3, roughness: 0.5 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); body.add(m); return m; };
  add(new THREE.BoxGeometry(0.075, 0.028, 0.055), white, 0, 0.012, 0);
  add(new THREE.BoxGeometry(0.06, 0.008, 0.045), grey, -0.004, 0.03, 0);
  add(new THREE.BoxGeometry(0.004, 0.012, 0.04), orange, 0.038, 0.014, 0);
  const cam = add(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 16), dark, 0.041, 0.012, 0);
  cam.rotation.z = Math.PI / 2;
  const props = [];
  for (const [cx, cz] of [[0.045, 0.045], [0.045, -0.045], [-0.045, 0.045], [-0.045, -0.045]]) {
    const arm = add(new THREE.BoxGeometry(0.05, 0.008, 0.01), white, cx / 2, 0.012, cz / 2);
    arm.rotation.y = Math.atan2(-cz, cx);
    const guard = add(new THREE.TorusGeometry(0.031, 0.0035, 8, 32), cx > 0 ? grey : dark, cx, 0.014, cz);
    guard.rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.014, 12), dark, cx, 0.014, cz);
    const prop = new THREE.Group(); prop.position.set(cx, 0.023, cz); body.add(prop);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.4, transparent: true, opacity: 0.9 });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.0015, 0.007), bladeMat); prop.add(b1);
    props.push(prop);
  }
  return { root, tilt, props };
}
const drone = makeDrone();
scene.add(drone.root);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), new THREE.MeshBasicMaterial({ color: 0x1d2b3a, transparent: true, opacity: 0.25, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.007; scene.add(shadow);

// 飛行軌跡
const TRAIL_MAX = 20000;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xff7a1a }));
trail.frustumCulled = false;
scene.add(trail);

// 任務物件
const missionGroup = new THREE.Group();
scene.add(missionGroup);
let ringMeshes = [];
function buildMissionScene(key) {
  missionGroup.clear();
  ringMeshes = [];
  if (key === "pad") {
    const tex = canvasTex((g, w, h) => {
      g.fillStyle = "#ffcf33"; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#1d2b3a"; g.lineWidth = 10;
      for (const r of [0.42, 0.22]) { g.beginPath(); g.arc(w / 2, h / 2, w * r, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = "#1d2b3a"; g.beginPath(); g.arc(w / 2, h / 2, 12, 0, Math.PI * 2); g.fill();
    }, 256, 256);
    const m = new THREE.Mesh(new THREE.CircleGeometry(PAD.r / 100 * 1.25, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.rotation.x = -Math.PI / 2; m.position.copy(S(PAD.x, PAD.y, 0.6)); missionGroup.add(m);
  } else if (key === "rings") {
    RINGS.forEach((r, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2f7de1, roughness: 0.4 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 14, 64), mat);
      ring.position.copy(S(r.x, r.y, r.z));
      if (r.axis === "x") ring.rotation.y = Math.PI / 2;
      missionGroup.add(ring);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, (r.z - 50) / 100, 8), new THREE.MeshStandardMaterial({ color: 0x9aa6b3 }));
      pole.position.copy(S(r.x, r.y, (r.z - 50) / 2));
      missionGroup.add(pole);
      const lab = flatLabel(["①", "②", "③"][i], 0, 0, 0.35, "#2f7de1");
      lab.position.copy(S(r.x, r.y, 1)); lab.position.x += r.axis === "x" ? -0.3 : 0; lab.position.z += r.axis === "y" ? 0.3 : 0;
      missionGroup.add(lab);
      ringMeshes.push(ring);
    });
  } else if (key === "pillar") {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR.r / 100, PILLAR.r / 100, PILLAR.h / 100, 32),
      new THREE.MeshStandardMaterial({ color: 0xe25555, roughness: 0.5 }));
    p.position.copy(S(PILLAR.x, PILLAR.y, PILLAR.h / 2)); missionGroup.add(p);
    for (let k = 0; k < 3; k++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR.r / 100 + 0.002, PILLAR.r / 100 + 0.002, 0.18, 32),
        new THREE.MeshStandardMaterial({ color: 0xffffff }));
      band.position.copy(S(PILLAR.x, PILLAR.y, 50 + k * 100)); missionGroup.add(band);
    }
  }
}

/* =========================================================
   相機控制（環繞／跟隨／俯視）
   ========================================================= */
let camMode = "orbit";
const orbit = { theta: 2.5, phi: 1.1, r: 3.3 };
const camTarget = new THREE.Vector3(0.6, 0.3, 0);
const camPos = new THREE.Vector3(-3, 2, 2);
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
let run = null;          // 目前這次執行的結果
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
  return basePose(run, t);
}

function evaluateMission(key, R) {
  const smp = R.samples;
  const out = { crash: null, marks: [], progress: null };
  if (key === "rings") {
    let next = 0;
    out.progress = new Array(smp.length);
    for (let i = 0; i < smp.length; i++) {
      if (i > 0) {
        const a = smp[i - 1], b = smp[i];
        for (let r = 0; r < RINGS.length; r++) {
          const R0 = RINGS[r];
          const da = R0.axis === "x" ? a.x - R0.x : a.y - R0.y;
          const db = R0.axis === "x" ? b.x - R0.x : b.y - R0.y;
          if ((da < 0 && db >= 0) || (da > 0 && db <= 0)) {
            const k = da / (da - db);
            const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k, pz = a.z + (b.z - a.z) * k;
            const dist = R0.axis === "x" ? Math.hypot(py - R0.y, pz - R0.z) : Math.hypot(px - R0.x, pz - R0.z);
            if (dist < RING_PASS) {
              if (r === next) { out.marks.push({ t: b.t, idx: r }); next++; }
            } else if (dist < RING_FRAME) {
              out.crash = { t: b.t, pose: b, msg: "撞到第 " + (r + 1) + " 個圈的框了！" };
            }
          }
        }
      }
      out.progress[i] = next;
      if (out.crash) break;
    }
    out.passed = next;
  } else if (key === "pillar") {
    let total = 0, prev = null;
    out.progress = new Array(smp.length);
    for (let i = 0; i < smp.length; i++) {
      const s = smp[i];
      const dx = s.x - PILLAR.x, dy = s.y - PILLAR.y;
      if (s.z > 3 && Math.hypot(dx, dy) < PILLAR.r + 13 && s.z < PILLAR.h + 5) {
        out.crash = { t: s.t, pose: s, msg: "撞到柱子了！" };
        out.progress[i] = total;
        break;
      }
      const ang = Math.atan2(dy, dx);
      if (prev !== null && s.z > 3) {
        let d = ang - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        total += d;
      }
      prev = ang;
      out.progress[i] = total;
    }
    out.angle = Math.abs(total) * 180 / Math.PI;
  }
  return out;
}

function verdictFor(key, R) {
  const res = R.result, fin = res.final;
  if (R.crash) return { cls: "bad", title: "撞機了！", text: R.crash.msg + " 調整一下距離或高度再試一次。" };
  if (res.error) {
    return { cls: "bad", title: res.error.title || "程式出錯了",
      text: (res.error.line ? "第 " + res.error.line + " 行出了問題。" : "") + "詳細說明在下方「飛行步驟」的紅色框。" };
  }
  if (key === "free") {
    if (!res.events.length) return null;
    return { cls: "neutral", title: "飛行結束", text: "總共 " + res.total.toFixed(1) + " 秒，剩下電量 " + fin.battery + "%。" + (res.warnings.length ? "有 " + res.warnings.length + " 個提醒，記得看一下。" : "") };
  }
  if (!fin.ever_flew) return { cls: "bad", title: "還沒起飛喔", text: "要先 connect()、takeoff() 才能開始任務。" };
  const [x, y] = fin.pose;
  if (key === "pad") {
    if (fin.flying) return { cls: "bad", title: "還沒降落", text: "要在停機坪上 land() 才算完成。" };
    const d = Math.hypot(x - PAD.x, y - PAD.y);
    if (d <= PAD.r) return { cls: "good", title: "任務完成！", text: "降落在距離停機坪中心 " + Math.round(d) + " 公分的地方，好準！" };
    return { cls: "bad", title: "差一點！", text: "降落在離停機坪中心 " + Math.round(d) + " 公分的地方（要在 35 公分以內）。" };
  }
  if (key === "rings") {
    if (R.mission.passed < RINGS.length) return { cls: "bad", title: "還差 " + (RINGS.length - R.mission.passed) + " 個圈", text: "目前照順序穿過 " + R.mission.passed + " 個圈。看看高度和左右位置對不對？" };
    if (fin.flying) return { cls: "bad", title: "還沒降落", text: "三個圈都穿過了！最後記得 land()。" };
    return { cls: "good", title: "任務完成！", text: "三個圈全部穿過，漂亮！" };
  }
  if (key === "pillar") {
    const a = Math.round(R.mission.angle);
    if (a < 340) return { cls: "bad", title: "還沒繞完一圈", text: "目前繞了大約 " + a + " 度，要繞滿一整圈（360 度）。" };
    if (fin.flying) return { cls: "bad", title: "還沒降落", text: "繞完一圈了！最後要回到 H 降落。" };
    const d = Math.hypot(x, y);
    if (d > 50) return { cls: "bad", title: "降落位置太遠", text: "繞完一圈了，但降落點離 H 有 " + Math.round(d) + " 公分（要在 50 公分以內）。" };
    return { cls: "good", title: "任務完成！", text: "繞了 " + a + " 度，降落在離 H " + Math.round(d) + " 公分的地方！" };
  }
  return null;
}

function loadRun(result) {
  const motion = result.events.filter((e) => e.dur > 0);
  const R = { result, motion, crash: null };
  run = R;
  // 取樣（軌跡、任務判定、電量）
  const samples = [];
  let ft = 0;
  const total = result.total;
  for (let i = 0; ; i++) {
    const t = Math.min(i * DT, total);
    const p = basePose(R, t);
    if (i > 0 && samples[samples.length - 1].motors) ft += t - samples[samples.length - 1].t;
    samples.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, motors: p.motors, ft });
    if (t >= total || samples.length >= TRAIL_MAX) break;
  }
  R.samples = samples;
  R.missionKey = missionKey;
  R.mission = evaluateMission(missionKey, R);
  R.crash = R.mission.crash;
  R.endT = R.crash ? R.crash.t + 0.7 : total;
  // 軌跡
  const pos = trailGeo.attributes.position.array;
  samples.forEach((s, i) => { const v = S(s.x, s.y, s.z); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; });
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.setDrawRange(0, 0);
  R.verdict = verdictFor(missionKey, R);
  codeDirty = false;
  hint("");
  buildLog(R);
  $("playBtn").disabled = $("restartBtn").disabled = $("scrub").disabled = false;
  $("scrub").max = Math.max(0.01, R.endT);
  playT = 0;
  bannerShown = false;
  playing = R.endT > 0;
  if (!playing) finish();
  updateFrame(true);
}

/* =========================================================
   飛行步驟清單
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
    return;
  }
  for (const it of items) {
    let el;
    if (it.kind === "ev") {
      const e = it.ev;
      el = document.createElement("div");
      el.className = "row" + (e.kind === "print" ? " print" : "") + (["info", "hover", "wait", "connect"].includes(e.kind) ? " dim" : "");
      el.innerHTML = `<span class="t">${fmtTime(e.t0)}</span><span class="ln">${e.line ? "第 " + e.line + " 行" : ""}</span><span class="msg">${esc(e.label)}</span>`;
      el.addEventListener("click", () => seek(e.t0 + 0.001, true));
      it.line = e.line;
    } else if (it.kind === "warn") {
      el = document.createElement("div");
      el.className = "note warn";
      el.innerHTML = `<div class="h">提醒</div>${esc(it.w.msg)}${it.w.line ? `<div class="where">第 ${it.w.line} 行</div>` : ""}`;
    } else if (it.kind === "crash") {
      el = document.createElement("div");
      el.className = "note err";
      el.innerHTML = `<div class="h">撞機了！</div>${esc(R.crash.msg)}<div class="where">發生在 ${fmtTime(R.crash.t)}</div>`;
    } else {
      const e = it.e;
      el = document.createElement("div");
      el.className = "note err";
      el.innerHTML = `<div class="h">${esc(e.title || "錯誤")}${e.line ? "（第 " + e.line + " 行）" : ""}</div>${esc(e.msg)}${e.hint ? `<div style="margin-top:4px">💡 ${esc(e.hint)}</div>` : ""}`;
      it.line = e.line;
      el.addEventListener("click", () => { if (e.line) setEditorLine(e.line, true); });
    }
    it.el = el;
    log.appendChild(el);
    logItems.push(it);
  }
  $("logSub").textContent = res.events.length + " 個步驟 · 點一下可以跳到那個時間";
}

let lastCur = -2;
function updateLog(t) {
  if (!logItems.length) return;
  let cur = -1;
  for (let i = 0; i < logItems.length; i++) {
    const it = logItems[i];
    if (it.kind === "ev" && it.t <= t + 1e-6) cur = i;
  }
  const doneAll = run && t >= run.endT - 1e-6;
  for (let i = 0; i < logItems.length; i++) {
    const it = logItems[i];
    const future = it.kind === "err" || it.kind === "crash" ? !doneAll && t < it.t : it.t > t + 1e-6;
    it.el.classList.toggle("future", future);
    if (it.kind === "ev") it.el.classList.toggle("now", i === cur && !doneAll);
  }
  if (cur !== lastCur || doneAll) {
    lastCur = cur;
    let target = doneAll ? logItems[logItems.length - 1] : logItems[cur];
    if (target) {
      const log = $("log");
      const top = target.el.offsetTop - log.offsetTop;
      if (top < log.scrollTop || top > log.scrollTop + log.clientHeight - 40) log.scrollTop = top - log.clientHeight / 2;
    }
    // 編輯器高亮
    if (codeDirty) setEditorLine(null);
    else if (doneAll && run.result.error && run.result.error.line) setEditorLine(run.result.error.line, true);
    else if (doneAll) setEditorLine(null);
    else setEditorLine(target && target.line ? target.line : null, false);
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
  updateFrame(true);
}
$("playBtn").addEventListener("click", () => {
  if (!run) return;
  if (playT >= run.endT - 1e-6) { playT = 0; bannerShown = false; }
  playing = !playing;
  hideBanner();
});
$("restartBtn").addEventListener("click", () => { if (!run) return; playT = 0; bannerShown = false; playing = true; hideBanner(); updateFrame(true); });
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
  $("bannerTitle").textContent = v.title;
  $("bannerText").textContent = v.text;
}
function hideBanner() { $("banner").classList.remove("show"); }
$("bannerClose").addEventListener("click", hideBanner);

/* =========================================================
   每一格畫面
   ========================================================= */
function updateHUD(p, t) {
  $("hudH").textContent = Math.round(p.z) + " cm";
  let ft = 0;
  if (run && run.samples.length) {
    const i = clamp(Math.floor(Math.min(t, run.result.total) / DT), 0, run.samples.length - 1);
    ft = run.samples[i].ft;
  }
  $("hudB").textContent = Math.max(0, Math.floor(100 - ft / 7.8)) + "%";
  $("hudP").textContent = "前 " + Math.round(p.x) + " · 左 " + Math.round(p.y);
  let yaw = ((-p.yaw + 180) % 360 + 360) % 360 - 180;
  $("hudY").textContent = Math.round(yaw) + "°";
  $("hudT").textContent = t.toFixed(1) + " 秒";
}

function updateMissionProgress(t) {
  const box = $("missionProgress");
  if (!run || run.missionKey !== missionKey || !run.mission.progress) {
    if (missionKey === "rings") {
      box.innerHTML = RINGS.map((_, i) => `<span class="chip">第 ${i + 1} 圈</span>`).join("");
      ringMeshes.forEach((m) => m.material.color.set(0x2f7de1));
    } else box.innerHTML = "";
    return;
  }
  const i = clamp(Math.floor(Math.min(t, run.result.total) / DT), 0, run.mission.progress.length - 1);
  let v = run.mission.progress[i];
  if (v === undefined) v = run.mission.progress.filter((x) => x !== undefined).pop() || 0;
  if (missionKey === "rings") {
    box.innerHTML = RINGS.map((_, k) => `<span class="chip${k < v ? " done" : ""}">第 ${k + 1} 圈${k < v ? " ✓" : ""}</span>`).join("");
    ringMeshes.forEach((m, k) => m.material.color.set(k < v ? 0x1f9d55 : 0x2f7de1));
  } else if (missionKey === "pillar") {
    const a = Math.round(Math.abs(v) * 180 / Math.PI);
    box.innerHTML = `<span class="chip${a >= 340 ? " done" : ""}">已繞 ${a}°</span>`;
  }
}

let lastUI = 0;
function updateFrame(force) {
  const t = playT;
  const p = poseAt(t);
  const v = S(p.x, p.y, p.z);
  drone.root.position.copy(v);
  drone.root.rotation.y = p.yaw * Math.PI / 180;
  // 傾斜：依照移動方向
  drone.tilt.rotation.set(0, 0, 0);
  if (p.flip) {
    const e = p.fu < 0.5 ? 2 * p.fu * p.fu : 1 - Math.pow(-2 * p.fu + 2, 2) / 2;
    const ang = e * Math.PI * 2;
    if (p.flip === "f") drone.tilt.rotation.z = -ang;
    else if (p.flip === "b") drone.tilt.rotation.z = ang;
    else if (p.flip === "l") drone.tilt.rotation.x = -ang;
    else drone.tilt.rotation.x = ang;
    drone.root.position.y += Math.sin(p.fu * Math.PI) * 0.25;
  } else if (p.crashed) {
    drone.tilt.rotation.z = p.crashed * 1.2;
    drone.tilt.rotation.x = p.crashed * 0.6;
  } else if (run && p.motors) {
    const q = poseAt(Math.min(t + 0.12, run.endT));
    const dx = (q.x - p.x) / 0.12, dy = (q.y - p.y) / 0.12;
    const a = p.yaw * Math.PI / 180;
    const fwd = dx * Math.cos(a) + dy * Math.sin(a);
    const left = -dx * Math.sin(a) + dy * Math.cos(a);
    drone.tilt.rotation.z = -clamp(fwd * 0.0035, -0.3, 0.3);
    drone.tilt.rotation.x = -clamp(left * 0.0035, -0.3, 0.3);
  }
  drone.spin = p.motors;
  shadow.position.set(v.x, 0.007, v.z);
  const hgt = Math.max(0, v.y);
  shadow.scale.setScalar(1 + hgt * 0.25);
  shadow.material.opacity = 0.28 / (1 + hgt * 0.6);
  // 軌跡
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
      updateLog(t);
    }
    updateMissionProgress(t);
    $("playIcon").innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  }
}

let lastFrame = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (run && playing) {
    playT += dt * speed;
    if (playT >= run.endT) { playT = run.endT; playing = false; updateFrame(true); finish(); }
  }
  updateFrame(false);
  if (drone.spin) for (const pr of drone.props) pr.rotation.y += dt * 45;
  // 相機
  const dp = drone.root.position;
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
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* =========================================================
   任務選擇
   ========================================================= */
const missionSel = $("missionSel");
for (const [k, m] of Object.entries(MISSIONS)) {
  const o = document.createElement("option"); o.value = k; o.textContent = m.name; missionSel.appendChild(o);
}
let missionKey = MISSIONS[store.get("mission", "free")] ? store.get("mission", "free") : "free";
function setMission(k) {
  missionKey = k;
  missionSel.value = k;
  store.set("mission", k);
  $("missionDesc").innerHTML = MISSIONS[k].desc;
  buildMissionScene(k);
  if (run) {
    // 換任務後用同一段程式重新判定
    loadRun(run.result);
    playing = false;
    playT = run.endT;
    bannerShown = false;
    updateFrame(true);
    finish();
  } else updateMissionProgress(0);
}
missionSel.addEventListener("change", () => setMission(missionSel.value));
let missionOpen = store.get("missionOpen", "1") === "1";
function applyMissionOpen() {
  $("missionBody").style.display = missionOpen ? "" : "none";
  $("missionToggle").textContent = missionOpen ? "收起說明" : "展開說明";
}
$("missionToggle").addEventListener("click", () => { missionOpen = !missionOpen; store.set("missionOpen", missionOpen ? "1" : "0"); applyMissionOpen(); });

/* =========================================================
   說明視窗
   ========================================================= */
$("helpBtn").addEventListener("click", () => $("helpDlg").showModal());
$("helpClose").addEventListener("click", () => $("helpDlg").close());

/* =========================================================
   啟動
   ========================================================= */
setMission(missionKey);
applyMissionOpen();
const saved = store.get("code", "");
ta.value = saved || EXAMPLES[0][1];
refreshEditor();
$("loading").remove();
startWorker();
requestAnimationFrame(loop);
