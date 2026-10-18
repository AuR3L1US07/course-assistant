# -*- mode: python ; coding: utf-8 -*-
"""课程助手单文件打包配置。

入口 launcher.py;PySide6 从 .runtime/python-libs 收集。
data/(个人账号密文/课程记录/Cookie)、tests、.test-artifacts、__pycache__ 均不打包。
Node、Playwright、浏览器脚本和字体映射均内嵌，运行时解压至临时目录。
"""
runtime_libs = ".runtime/python-libs"

datas = [
    ('.runtime/node.exe', '.runtime'),
    ('.runtime/playwright-core', '.runtime/playwright-core'),
    ('cx_font_map.json', '.'),
]
for script in ('browser_worker.cjs', 'category_reader.cjs', 'learning_visits.cjs',
               'study_records.cjs', 'mooc_login.cjs', 'mooc_scanner.cjs',
               'yuketang.cjs', 'yuketang_worker.cjs'):
    datas.append((script, '.'))
binaries = []
hiddenimports = []

# 由标准 Qt hooks 收集所需 DLL 与插件，不收集 QML 开发资源、头文件和工具。
# collect_all 会引入未使用的深层 QML 路径，导致部分 Windows 环境解压失败。
hiddenimports += [
    "PySide6.QtCore",
    "PySide6.QtGui",
    "PySide6.QtWidgets",
    "PySide6.QtSvg",
]

a = Analysis(
    ["launcher.py"],
    pathex=[runtime_libs],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "PySide6.QtWebEngineCore",
        "PySide6.QtWebEngineWidgets",
        "PySide6.QtWebChannel",
        "PySide6.QtQml",
        "PySide6.QtQuick",
        "PySide6.QtMultimedia",
        "PySide6.Qt3DCore",
        "PySide6.QtCharts",
        "PySide6.QtDataVisualization",
        "tkinter",
        "unittest",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

# Qt 使用 Windows 自带的 ICU / UCRT。构建机 PATH 中的其他工具可能带有
# 同名、不兼容的 DLL，不能将它们混入发布包覆盖系统实现。
a.binaries = [entry for entry in a.binaries
              if entry[0].replace('\\', '/').rsplit('/', 1)[-1].lower()
              not in {'icuuc.dll', 'icudt78.dll', 'ucrtbase.dll'}]

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="课程助手",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # GUI 程序,不弹黑窗
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
