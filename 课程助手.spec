# -*- mode: python ; coding: utf-8 -*-
"""课程助手单文件打包配置。

入口 launcher.py;PySide6 从 .runtime/python-libs 收集。
data/(个人账号密文/课程记录/Cookie)、tests、.test-artifacts、__pycache__ 均不打包。
.runtime 与 *.cjs 作为旁置资源随 exe 一起分发(不内嵌,避免撑爆单文件)。
"""
from PyInstaller.utils.hooks import collect_all

runtime_libs = ".runtime/python-libs"

datas = []
binaries = []
hiddenimports = []

# 完整收集 PySide6 与 shiboken6 的模块、DLL、Qt 插件
for pkg in ("PySide6", "shiboken6"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# PySide6-Essentials 不打包 QtWebEngine 等重型模块,仅保证 GUI 所需
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
