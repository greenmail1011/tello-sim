// 在背景執行學生的 Python 程式（Pyodide），避免無窮迴圈卡住整個網頁
const LOCAL_PYODIDE = "lib/pyodide/";
const CDN_PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const PYODIDE_FILES = ["pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

let pyodide = null;

async function init(baseUrl) {
  const sourceURL = new URL("tello_sim.py", baseUrl);
  const response = await fetch(sourceURL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`tello_sim.py 載入失敗（HTTP ${response.status}），請確認網站已上傳這個檔案。`);
  const src = await response.text();
  const localURL = new URL(LOCAL_PYODIDE, baseUrl).href;
  let where = "local";
  try {
    // 只檢查 loader 不夠：缺少 wasm 或標準函式庫也會讓 Python 無法啟動。
    await Promise.all(PYODIDE_FILES.map(async (file) => {
      const resource = await fetch(localURL + file, { method: "HEAD", cache: "no-cache" });
      if (!resource.ok) throw new Error(`${file}（HTTP ${resource.status}）`);
    }));
    importScripts(localURL + "pyodide.js");
    pyodide = await loadPyodide({ indexURL: localURL });
  } catch (e) {
    where = "cdn";
    self.postMessage({ type: "loading", message: "Python 線上版載入中…" });
    try {
      // 本機 runtime 若只載入一部分，改用 CDN 時必須重新載入配套的 asm.js。
      self._createPyodideModule = undefined;
      importScripts(CDN_PYODIDE + "pyodide.js");
      pyodide = await loadPyodide({ indexURL: CDN_PYODIDE });
    } catch (cdnError) {
      throw new Error(`本機 Python 資源載入失敗：${e.message || e}；線上備援也失敗：${cdnError.message || cdnError}。請檢查網路，或上傳完整 lib/pyodide 資料夾。`);
    }
  }
  pyodide.runPython(src);
  return where;
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
