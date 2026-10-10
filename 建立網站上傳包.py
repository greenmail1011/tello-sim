"""檢查網站必要檔案後，建立可解壓上傳到 GitHub Pages 的完整 ZIP。"""
from pathlib import Path
import hashlib
import zipfile

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / "GitHubPages_修正版.zip"
FILES = [
    "index.html", "app.js", "levels.js", "worker.js", "tello_sim.py", "teacher.html",
    "lib/three.module.min.js", "lib/three-LICENSE.txt",
    "lib/pyodide/pyodide.js", "lib/pyodide/pyodide.asm.js",
    "lib/pyodide/pyodide.asm.wasm", "lib/pyodide/python_stdlib.zip",
    "lib/pyodide/pyodide-lock.json",
]


def main():
    missing = [name for name in FILES if not (HERE / name).is_file()]
    if missing:
        raise SystemExit("缺少必要檔案，未建立上傳包：" + "、".join(missing))
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(HERE / name, name)
        archive.writestr(".nojekyll", "")
    with zipfile.ZipFile(OUTPUT) as archive:
        assert archive.testzip() is None, "ZIP 完整性檢查失敗"
        for name in FILES:
            assert hashlib.sha256(archive.read(name)).digest() == hashlib.sha256((HERE / name).read_bytes()).digest(), name
    print(f"已建立並核對 {len(FILES)} 個網站檔案：{OUTPUT}")


if __name__ == "__main__":
    main()
