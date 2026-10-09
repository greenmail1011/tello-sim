// 在背景執行學生的 Python 程式（Pyodide），避免無窮迴圈卡住整個網頁
const LOCAL_PYODIDE = "lib/pyodide/";
const CDN_PYODIDE = "https://cdn.jsdelivr.net/npm/pyodide@0.26.4/";

let pyodide = null;

async function init(baseUrl) {
  let indexURL = new URL(LOCAL_PYODIDE, baseUrl).href;
  try {
    importScripts(indexURL + "pyodide.js");
  } catch (e) {
    indexURL = CDN_PYODIDE;
    importScripts(indexURL + "pyodide.js");
  }
  pyodide = await loadPyodide({ indexURL });
  const src = await (await fetch(new URL("tello_sim.py", baseUrl).href, { cache: "no-cache" })).text();
  pyodide.runPython(src);
  return indexURL === CDN_PYODIDE ? "cdn" : "local";
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    try {
      const where = await init(msg.baseUrl);
      self.postMessage({ type: "ready", where });
    } catch (e) {
      self.postMessage({ type: "fatal", message: String(e && e.message || e) });
    }
  } else if (msg.type === "run") {
    try {
      pyodide.globals.set("STUDENT_SRC", msg.code);
      const out = pyodide.runPython("run_student(STUDENT_SRC)");
      self.postMessage({ type: "result", id: msg.id, result: JSON.parse(out) });
    } catch (e) {
      self.postMessage({ type: "result", id: msg.id, result: {
        events: [], warnings: [], total: 0, final: null,
        error: { title: "模擬器內部錯誤", msg: String(e && e.message || e), hint: "請把這段程式給老師看看。", line: null }
      }});
    }
  }
};
