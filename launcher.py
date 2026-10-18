"""打包入口:确保运行时位于 exe 旁,再启动 Qt 界面。

单文件 exe 内嵌 Python 与 PySide6,但 .runtime(node.exe + playwright-core)
与 .cjs 脚本作为旁置资源随 exe 一起分发。本启动器只在"旁置资源缺失"时给出
明确提示,不承担自动复制 405M 运行时(部署时已一并拷贝到 exe 旁)。
"""
import sys
from pathlib import Path


def _app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _check_runtime(root: Path):
    missing = []
    if not (root / ".runtime" / "node.exe").is_file():
        missing.append(".runtime\\node.exe")
    if not (root / ".runtime" / "playwright-core" / "package.json").is_file():
        missing.append(".runtime\\playwright-core")
    for name in ("browser_worker.cjs", "category_reader.cjs",
                 "learning_visits.cjs", "study_records.cjs", "mooc_login.cjs", "mooc_scanner.cjs"):
        if not (root / name).is_file():
            missing.append(name)
    return missing


def main():
    root = _app_dir()
    missing = _check_runtime(root)
    if missing:
        # 首次运行:尝试从内置资源目录解出运行时;若仍缺失则明确报错。
        sys.stderr.write(
            "缺少浏览器组件:\n  " + "\n  ".join(missing) +
            "\n\n请把软件完整目录(.runtime 文件夹与 *.cjs 脚本)放到 exe 同一目录后重试。\n"
        )
        return 1
    from qt_app import main as qt_main
    return qt_main()


if __name__ == "__main__":
    raise SystemExit(main())
