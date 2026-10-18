"""Single-file launcher: embedded resources are temporary; personal data persists."""
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS = ('browser_worker.cjs', 'category_reader.cjs', 'learning_visits.cjs',
           'study_records.cjs', 'mooc_login.cjs', 'mooc_scanner.cjs',
           'yuketang.cjs', 'yuketang_worker.cjs')


def _app_dir():
    return Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent


def _resource_dir():
    return Path(sys._MEIPASS) if getattr(sys, 'frozen', False) else _app_dir()


def _check_runtime(root):
    files = ('.runtime/node.exe', '.runtime/playwright-core/package.json', 'cx_font_map.json', *SCRIPTS)
    return [name for name in files if not (root / name).is_file()]


def _check_embedded_runtime(root, report):
    # Diagnostic mode never opens a browser or reads saved accounts/API settings.
    code = """
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.argv[1],scripts=JSON.parse(process.argv[2]);
const {chromium}=require(path.join(root,'.runtime/playwright-core'));
if(typeof chromium.launch!=='function')throw Error('Browser runtime unavailable');
JSON.parse(fs.readFileSync(path.join(root,'cx_font_map.json'),'utf8'));
for(const name of scripts)new vm.Script(fs.readFileSync(path.join(root,name),'utf8'));
process.stdout.write(JSON.stringify({browser_runtime:true,font_map:true,scripts:scripts.length}));
"""
    result = subprocess.run([str(root / '.runtime/node.exe'), '-e', code, str(root), json.dumps(SCRIPTS)],
                            capture_output=True, text=True, encoding='utf-8', timeout=30,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('内置浏览器组件自检失败。')
    Path(report).write_text(result.stdout, encoding='utf-8')
    return 0


def main():
    root = _resource_dir()
    missing = _check_runtime(root)
    if missing:
        message = '缺少程序组件，请重新下载完整 EXE 或安装源码依赖。\n' + '\n'.join(missing)
        if sys.stderr is not None:
            sys.stderr.write(message + '\n')
        else:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message, '课程助手', 0x10)
        return 1
    if len(sys.argv) == 3 and sys.argv[1] == '--check-runtime':
        return _check_embedded_runtime(root, sys.argv[2])
    import settings
    (settings.ROOT / 'data').mkdir(parents=True, exist_ok=True)
    from qt_app import main as qt_main
    return qt_main()


if __name__ == '__main__':
    raise SystemExit(main())
