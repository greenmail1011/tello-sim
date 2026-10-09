// =========================================================
// Tello 飛行模擬器 —— 關卡資料
// 老師可以在這裡修改或新增關卡。座標單位：公分
//   x = 起飛時的正前方、y = 左方（負數 = 右方）、z = 高度
// =========================================================

const H = `from djitellopy import Tello

tello = Tello()
tello.connect()
`;

// ---- 工具：算出路線上的點 ----
function walk(side, turnDeg, times, ccw = true) {
  const pts = [];
  let x = 0, y = 0, h = 0;
  for (let i = 0; i < times; i++) {
    x += side * Math.cos(h * Math.PI / 180);
    y += side * Math.sin(h * Math.PI / 180);
    pts.push({ x: Math.round(x), y: Math.round(y), z: 80 });
    h += ccw ? turnDeg : -turnDeg;
  }
  return pts.filter((p) => Math.hypot(p.x, p.y) > 30); // 回到起點的那一點不放星星
}
function circlePts(cx, cy, r, n) {
  const pts = [];
  for (let k = 1; k < n; k++) {
    const a = Math.PI + (k * 2 * Math.PI) / n;
    pts.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)), z: 80 });
  }
  return pts;
}

const RINGS3 = [
  { x: 150, y: 0, z: 120, axis: "x", color: 0xff5d5d },
  { x: 350, y: 0, z: 200, axis: "x", color: 0xffbf1f },
  { x: 450, y: 150, z: 200, axis: "y", color: 0xa66cff },
];
const SQUARE = [{ x: 150, y: 0, z: 80 }, { x: 150, y: 150, z: 80 }, { x: 0, y: 150, z: 80 }];
const STAIRS = [{ x: 50, y: 0, z: 110 }, { x: 100, y: 0, z: 140 }, { x: 150, y: 0, z: 170 }, { x: 200, y: 0, z: 200 }];
const HEX = walk(100, 60, 6, true);
const PENTA = walk(150, 144, 5, false);
const HOME = { x: 0, y: 0, r: 35 };

// ---- 星星判定小工具 ----
const calls = (c, name) => c.a && c.a.calls.includes(name);
const lines = (c) => (c.a ? c.a.lines : 999);
const has = (c, key) => c.a && c.a[key] > 0;

export const TIERS = [
  { id: "free", name: "🎈 自由飛行", who: "所有人" },
  { id: "t1", name: "🌱 初級", who: "國小・用指令卡就能玩" },
  { id: "t2", name: "🌿 中級", who: "國小高年級～國中・學會迴圈" },
  { id: "t3", name: "🌳 高級", who: "國中～高中・函式、感測器、數學" },
  { id: "bug", name: "🐞 抓蟲任務", who: "找出程式哪裡寫錯" },
  { id: "puz", name: "🧩 程式拼圖", who: "把程式排成正確的順序" },
];

export const LEVELS = [
  // ------------------------------------------------ 自由飛行
  {
    id: "free", tier: "free", name: "自由飛行", cards: true,
    desc: "沒有任務，盡情測試你的程式！場地 <b>10 × 10 公尺</b>，每一塊彩色地墊是 <b>1 公尺</b>。",
    starter: H + "tello.takeoff()\n\ntello.land()\n",
    scene: {}, goal: null, stars: [],
  },
  // ------------------------------------------------ 初級
  {
    id: "t1-1", tier: "t1", name: "第一次起飛", cards: true,
    desc: "讓 Tello <b>起飛</b>，再<b>降落</b>。點下面的指令卡「🚀 起飛」和「🛬 降落」就可以完成！",
    starter: H + "\n",
    scene: {}, goal: { land: "any" },
    stars: [
      { text: "用「💬 說話」讓 Tello 說一句話", check: (c) => c.a && c.a.names.includes("print") },
      { text: "飛到 150 公分以上再降落", check: (c) => c.maxZ >= 148 },
    ],
  },
  {
    id: "t1-2", tier: "t1", name: "摘星星", cards: true,
    desc: "星星在起點<b>正前方 1.5 公尺</b>，就在起飛後的高度。飛過去碰到它就能摘下來！",
    starter: H + "tello.takeoff()\n\n# 往前飛去拿星星\n\ntello.land()\n",
    scene: { stars: [{ x: 150, y: 0, z: 80 }], pad: { x: 250, y: 0, r: 35 }, padOptional: true },
    goal: { stars: true, land: "any" },
    stars: [
      { text: "最後降落在黃色停機坪上（前方 2.5 公尺）", check: (c) => c.landErr !== null && c.landErr <= 35 },
      { text: "程式不超過 6 行", check: (c) => lines(c) <= 6 },
    ],
  },
  {
    id: "t1-3", tier: "t1", name: "降落停機坪", cards: true,
    desc: "停機坪在起點<b>正前方 2 公尺</b>。把 <code>___</code> 換成正確的數字，讓 Tello 準確降落！",
    starter: H + "tello.takeoff()\ntello.move_forward(___)   # 停機坪在前方幾公分？\ntello.land()\n",
    scene: { pad: { x: 200, y: 0, r: 35 } },
    goal: { land: { x: 200, y: 0, r: 35 } },
    stars: [
      { text: "降落誤差在 15 公分以內", check: (c) => c.landErr !== null && c.landErr <= 15 },
      { text: "程式不超過 6 行", check: (c) => lines(c) <= 6 },
    ],
  },
  {
    id: "t1-4", tier: "t1", name: "轉個彎", cards: true,
    desc: "先摘<b>前方 1.5 公尺</b>的星星，再摘它<b>左邊 1.5 公尺</b>的星星，最後降落在停機坪上。",
    starter: H + "tello.takeoff()\ntello.move_forward(150)\ntello.move_left(___)\ntello.land()\n",
    scene: { stars: [{ x: 150, y: 0, z: 80 }, { x: 150, y: 150, z: 80 }], pad: { x: 150, y: 150, r: 35 } },
    goal: { stars: true, land: { x: 150, y: 150, r: 35 } },
    stars: [
      { text: "改用「↩️ 左轉」＋「⏩ 前進」完成（用轉彎指令）", check: (c) => calls(c, "rotate_counter_clockwise") || calls(c, "rotate_clockwise") },
      { text: "程式不超過 8 行", check: (c) => lines(c) <= 8 },
    ],
  },
  {
    id: "t1-5", tier: "t1", name: "高高低低", cards: true,
    desc: "三顆星星高度不一樣：<br>① 前方 1 m、高 1.5 m　② 前方 2 m、高 0.6 m　③ 前方 3 m、高 1.5 m<br>用上升、下降、前進把它們全部摘下來！",
    starter: H + "tello.takeoff()\n\n",
    scene: { stars: [{ x: 100, y: 0, z: 150 }, { x: 200, y: 0, z: 60 }, { x: 300, y: 0, z: 150 }], pad: { x: 400, y: 0, r: 35 }, padOptional: true },
    goal: { stars: true, land: "any" },
    stars: [
      { text: "最後降落在前方 4 公尺的停機坪上", check: (c) => c.landErr !== null && c.landErr <= 35 },
      { text: "程式不超過 12 行", check: (c) => lines(c) <= 12 },
    ],
  },
  // ------------------------------------------------ 中級
  {
    id: "t2-1", tier: "t2", name: "正方形巡邏", cards: true,
    desc: "沿著邊長 1.5 公尺的正方形巡邏：摘下 3 個角落的星星，最後回到 H 降落。<br>提示：「前進＋左轉」要重複幾次？",
    starter: H + "tello.takeoff()\n\nfor i in range(___):\n    tello.move_forward(150)\n    tello.rotate_counter_clockwise(___)\n\ntello.land()\n",
    scene: { stars: SQUARE, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "使用 for 迴圈", check: (c) => has(c, "for") },
      { text: "程式不超過 8 行", check: (c) => lines(c) <= 8 },
    ],
  },
  {
    id: "t2-2", tier: "t2", name: "爬樓梯", cards: true,
    desc: "星星排成樓梯：每一階往前 50 公分、往上 30 公分，一共 4 階。全部摘下來再降落！",
    starter: H + "tello.takeoff()\n\n# 用 for 迴圈重複「前進 + 上升」\n\ntello.land()\n",
    scene: { stars: STAIRS },
    goal: { stars: true, land: "any" },
    stars: [
      { text: "使用 for 迴圈", check: (c) => has(c, "for") },
      { text: "程式不超過 8 行", check: (c) => lines(c) <= 8 },
    ],
  },
  {
    id: "t2-3", tier: "t2", name: "穿越三個圈", cards: false,
    desc: "照順序穿過 3 個圈，最後降落：<br>① 前方 1.5 m、高 1.2 m　② 前方 3.5 m、高 2 m<br>③ 前方 4.5 m、<b>左邊 1.5 m</b>、高 2 m（圈面向側邊）<br>碰到圈的框會撞機喔！",
    starter: H + "tello.takeoff()\n\n",
    scene: { rings: RINGS3 },
    goal: { rings: true, land: "any" },
    stars: [
      { text: "程式不超過 10 行", check: (c) => lines(c) <= 10 },
      { text: "在「🌬️ 有風」模式下也過關", check: (c) => c.windy },
    ],
  },
  {
    id: "t2-4", tier: "t2", name: "繞糖果柱", cards: false,
    desc: "糖果柱在起點<b>正前方 2.5 公尺</b>。繞柱子一整圈，再回到 H 降落（誤差 50 公分內）。小心別撞到！",
    starter: H + "tello.takeoff()\n\n",
    scene: { pillars: [{ x: 250, y: 0, r: 20, h: 300 }], pad: { x: 0, y: 0, r: 50 } },
    goal: { circle: 0, land: { x: 0, y: 0, r: 50 } },
    stars: [
      { text: "用 curve_xyz_speed 或 send_rc_control 飛出圓弧", check: (c) => calls(c, "curve_xyz_speed") || calls(c, "send_rc_control") },
      { text: "在「🌬️ 有風」模式下也過關", check: (c) => c.windy },
    ],
  },
  {
    id: "t2-5", tier: "t2", name: "畫一顆星", cards: false,
    desc: "每次往前 150 公分再<b>順時針</b>轉一個角度，重複 5 次就能畫出星星。摘下 4 個尖角的星星，回到 H 降落。<br>提示：要轉幾度？（不是 72 喔）",
    starter: H + "tello.takeoff()\n\nfor i in range(5):\n    tello.move_forward(150)\n    tello.rotate_clockwise(___)\n\ntello.land()\n",
    scene: { stars: PENTA, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "使用 for 迴圈", check: (c) => has(c, "for") },
      { text: "程式不超過 8 行", check: (c) => lines(c) <= 8 },
    ],
  },
  // ------------------------------------------------ 高級
  {
    id: "t3-1", tier: "t3", name: "多邊形函式", cards: false,
    desc: "寫一個函式 <code>polygon(sides, length)</code>，用它飛出<b>邊長 100 公分的正六邊形</b>（逆時針轉）。摘下 5 顆星星後回到 H 降落。",
    starter: H + "\ndef polygon(sides, length):\n    # 在這裡完成：重複 sides 次「前進 length、轉彎」\n    pass\n\ntello.takeoff()\npolygon(6, 100)\ntello.land()\n",
    scene: { stars: HEX, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "自己定義函式（def）", check: (c) => has(c, "def") },
      { text: "程式不超過 11 行", check: (c) => lines(c) <= 11 },
    ],
  },
  {
    id: "t3-2", tier: "t3", name: "感測器定高", cards: false,
    desc: "星星就在 H 正上方 <b>1.8 公尺</b>。用 <code>while</code> 迴圈讀取 <code>get_height()</code>，讓 Tello 自己判斷什麼時候停下來！",
    starter: H + "import time\n\ntello.takeoff()\n\nwhile tello.get_height() < ___:\n    tello.send_rc_control(0, 0, 40, 0)\n    time.sleep(0.1)\n\ntello.send_rc_control(0, 0, 0, 0)\ntello.land()\n",
    scene: { stars: [{ x: 0, y: 0, z: 180 }] },
    goal: { stars: true, land: "any" },
    stars: [
      { text: "使用 while 迴圈", check: (c) => has(c, "while") },
      { text: "用 get_height() 讀取高度", check: (c) => calls(c, "get_height") },
    ],
  },
  {
    id: "t3-3", tier: "t3", name: "一次到位", cards: false,
    desc: "星星在<b>前方 3 m、左邊 2 m、高 1.5 m</b>，停機坪在它正下方。試著用一個指令就直線飛到星星！",
    starter: H + "tello.takeoff()\ntello.go_xyz_speed(___, ___, ___, 50)\ntello.land()\n",
    scene: { stars: [{ x: 300, y: 200, z: 150 }], pad: { x: 300, y: 200, r: 35 } },
    goal: { stars: true, land: { x: 300, y: 200, r: 35 } },
    stars: [
      { text: "只用 go_xyz_speed 移動（不用 move_ 指令）", check: (c) => calls(c, "go_xyz_speed") && !c.a.calls.some((n) => n.startsWith("move_")) },
      { text: "程式不超過 6 行", check: (c) => lines(c) <= 6 },
    ],
  },
  {
    id: "t3-4", tier: "t3", name: "數學畫圓", cards: false,
    desc: "7 顆星星排在<b>以前方 1.2 m 為圓心、半徑 1.2 m</b> 的圓上（起點也在圓上）。用 <code>math</code> 的 sin、cos 算出每個點，或用曲線飛行，繞一圈回到 H。",
    starter: H + "import math\n\ntello.takeoff()\n\n# 提示：圓上第 k 個點的角度是 k × 45 度\n\ntello.land()\n",
    scene: { stars: circlePts(120, 0, 120, 8), pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "使用 math 模組計算", check: (c) => c.a && c.a.imports.includes("math") },
      { text: "在「🌬️ 有風」模式下也過關", check: (c) => c.windy },
    ],
  },
  {
    id: "t3-5", tier: "t3", name: "有風大挑戰", cards: false, forceWindy: true,
    desc: "<b>強風來了！</b>（這關固定是有風模式）照順序穿過 3 個圈，最後降落在左邊的停機坪（前方 4.5 m、左邊 2 m）。",
    starter: H + "tello.takeoff()\n\n",
    scene: { rings: RINGS3, pad: { x: 450, y: 200, r: 35 } },
    goal: { rings: true, land: { x: 450, y: 200, r: 35 } },
    stars: [
      { text: "程式不超過 10 行", check: (c) => lines(c) <= 10 },
      { text: "整趟飛行 25 秒內完成（試試 set_speed）", check: (c) => c.total <= 25 },
    ],
  },
  // ------------------------------------------------ 抓蟲
  {
    id: "bug-1", tier: "bug", name: "停機坪在哪裡？", cards: true,
    desc: "這段程式想讓 Tello 降落在<b>前方 2 公尺</b>的停機坪，但它有 <b>2 個錯誤</b>。先按執行看看錯誤訊息，再把它修好！",
    starter: "from djitellopy import Tello\n\ntello = Tello()\ntello.takeoff()\ntello.move_forward(10)\ntello.move_forward(190)\ntello.land()\n",
    scene: { pad: { x: 200, y: 0, r: 35 } },
    goal: { land: { x: 200, y: 0, r: 35 } },
    stars: [
      { text: "執行不超過 4 次就修好", check: (c) => c.attempts <= 4 },
      { text: "程式不超過 6 行", check: (c) => lines(c) <= 6 },
    ],
  },
  {
    id: "bug-2", tier: "bug", name: "正方形壞掉了", cards: false,
    desc: "這段正方形巡邏程式有 <b>2 個打字錯誤</b>，Python 看不懂。找出來修好，摘下 3 顆星星並回到 H！",
    starter: H + "tello.takeoff()\n\nfor i in range(4)\n    tello.move_forward(150)\n    tello.rotate_counter_clockwise（90）\n\ntello.land()\n",
    scene: { stars: SQUARE, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "執行不超過 4 次就修好", check: (c) => c.attempts <= 4 },
      { text: "執行不超過 2 次就修好", check: (c) => c.attempts <= 2 },
    ],
  },
  {
    id: "bug-3", tier: "bug", name: "飛錯方向了", cards: false,
    desc: "這段程式沒有任何錯誤訊息，卻<b>飛錯地方</b>、也沒回到 H！看看它飛到哪裡，想想是哪裡不對。（有 2 個地方要改）",
    starter: H + "tello.takeoff()\n\nfor i in range(3):\n    tello.move_forward(150)\n    tello.rotate_clockwise(90)\n\ntello.land()\n",
    scene: { stars: SQUARE, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "執行不超過 4 次就修好", check: (c) => c.attempts <= 4 },
      { text: "執行不超過 2 次就修好", check: (c) => c.attempts <= 2 },
    ],
  },
  // ------------------------------------------------ 拼圖
  {
    id: "puz-1", tier: "puz", name: "正方形拼圖", mode: "parsons",
    desc: "把程式積木排成正確的順序，讓 Tello 繞正方形、摘下 3 顆星星並回到 H。<b>小心：有一塊是多出來的！</b>",
    parsons: {
      lines: ["from djitellopy import Tello", "tello = Tello()", "tello.connect()", "tello.takeoff()", "for i in range(4):", "    tello.move_forward(150)", "    tello.rotate_counter_clockwise(90)", "tello.land()"],
      extra: ["    tello.rotate_clockwise(90)"],
    },
    scene: { stars: SQUARE, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "2 次內排對", check: (c) => c.attempts <= 2 },
      { text: "1 次就排對", check: (c) => c.attempts <= 1 },
    ],
  },
  {
    id: "puz-2", tier: "puz", name: "樓梯拼圖", mode: "parsons",
    desc: "排出能爬 4 階樓梯的程式（每階往前 50、往上 30），摘下所有星星再降落。<b>有一塊是多出來的！</b>",
    parsons: {
      lines: ["from djitellopy import Tello", "tello = Tello()", "tello.connect()", "tello.takeoff()", "for step in range(4):", "    tello.move_forward(50)", "    tello.move_up(30)", "tello.land()"],
      extra: ["    tello.move_down(30)"],
    },
    scene: { stars: STAIRS },
    goal: { stars: true, land: "any" },
    stars: [
      { text: "2 次內排對", check: (c) => c.attempts <= 2 },
      { text: "1 次就排對", check: (c) => c.attempts <= 1 },
    ],
  },
  {
    id: "puz-3", tier: "puz", name: "函式拼圖", mode: "parsons",
    desc: "用函式 <code>polygon()</code> 飛出正六邊形：要先<b>定義</b>函式，才能<b>呼叫</b>它。摘下 5 顆星星回到 H。<b>有一塊是多出來的！</b>",
    parsons: {
      lines: ["from djitellopy import Tello", "tello = Tello()", "def polygon(sides, length):", "    for i in range(sides):", "        tello.move_forward(length)", "        tello.rotate_counter_clockwise(int(360 / sides))", "tello.connect()", "tello.takeoff()", "polygon(6, 100)", "tello.land()"],
      extra: ["polygon(4, 100)"],
    },
    scene: { stars: HEX, pad: HOME },
    goal: { stars: true, land: HOME },
    stars: [
      { text: "2 次內排對", check: (c) => c.attempts <= 2 },
      { text: "1 次就排對", check: (c) => c.attempts <= 1 },
    ],
  },
];

// ---- 指令卡 ----
// v: 預設值、min/max/step: 範圍；dir: 選項（翻滾方向）
export const CARDS = [
  { key: "takeoff", icon: "🚀", label: "起飛", color: "#ff8a1f", code: () => "tello.takeoff()" },
  { key: "land", icon: "🛬", label: "降落", color: "#ff8a1f", code: () => "tello.land()" },
  { key: "forward", icon: "⏩", label: "前進", color: "#3fa9f5", v: 100, min: 20, max: 500, step: 10, unit: "cm", code: (v) => `tello.move_forward(${v})` },
  { key: "back", icon: "⏪", label: "後退", color: "#3fa9f5", v: 100, min: 20, max: 500, step: 10, unit: "cm", code: (v) => `tello.move_back(${v})` },
  { key: "left", icon: "⬅️", label: "左移", color: "#3fa9f5", v: 100, min: 20, max: 500, step: 10, unit: "cm", code: (v) => `tello.move_left(${v})` },
  { key: "right", icon: "➡️", label: "右移", color: "#3fa9f5", v: 100, min: 20, max: 500, step: 10, unit: "cm", code: (v) => `tello.move_right(${v})` },
  { key: "up", icon: "⬆️", label: "上升", color: "#3dbb5a", v: 50, min: 20, max: 500, step: 10, unit: "cm", code: (v) => `tello.move_up(${v})` },
  { key: "down", icon: "⬇️", label: "下降", color: "#3dbb5a", v: 30, min: 20, max: 500, step: 10, unit: "cm", code: (v) => `tello.move_down(${v})` },
  { key: "ccw", icon: "↩️", label: "左轉", color: "#a66cff", v: 90, min: 15, max: 360, step: 15, unit: "°", code: (v) => `tello.rotate_counter_clockwise(${v})` },
  { key: "cw", icon: "↪️", label: "右轉", color: "#a66cff", v: 90, min: 15, max: 360, step: 15, unit: "°", code: (v) => `tello.rotate_clockwise(${v})` },
  { key: "flip", icon: "🤸", label: "翻滾", color: "#ff6fa1", dir: [["前", "forward"], ["後", "back"], ["左", "left"], ["右", "right"]], code: (v, d) => `tello.flip_${d}()` },
  { key: "speed", icon: "⚡", label: "速度", color: "#ffbf1f", v: 50, min: 10, max: 100, step: 10, unit: "", code: (v) => `tello.set_speed(${v})` },
  { key: "wait", icon: "⏱️", label: "等待", color: "#8b9bb0", v: 1, min: 1, max: 10, step: 1, unit: "秒", needs: "time", code: (v) => `time.sleep(${v})` },
  { key: "say", icon: "💬", label: "說話", color: "#8b9bb0", code: () => `print("我在飛！電量", tello.get_battery(), "%")` },
  { key: "repeat", icon: "🔁", label: "重複", color: "#e5484d", v: 4, min: 2, max: 10, step: 1, unit: "次", block: true, code: (v) => `for i in range(${v}):` },
  { key: "endrepeat", icon: "⤴️", label: "結束重複", color: "#e5484d", outdent: true },
];
