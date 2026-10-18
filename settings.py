"""Windows DPAPI storage scoped to the current Windows account."""
import base64
import ctypes
from ctypes import wintypes
import json
import os
import sys
from pathlib import Path
from api_client import APIConfig

def _app_root():
    """打包版个人数据使用 LocalAppData，源码版保留项目内的数据目录。"""
    if getattr(sys, "frozen", False):
        return Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'CourseAssistant'
    return Path(__file__).resolve().parent


ROOT = _app_root()
RESOURCE_ROOT = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else ROOT
CONFIG = ROOT / "data" / "settings.json"
PLAYBACK_SPEEDS = (.75, 1, 1.25, 1.5, 2, 4, 8, 10, 16)


class Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def protect(raw, decrypt=False):
    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buffer)
    target = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError("Windows 无法处理密钥，请使用保存密钥时的 Windows 账户。")
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel.LocalFree(target.pbData)


def save(config):
    data = {"base_url": config.base_url, "model": config.model, "timeout": config.timeout,
            "encrypted_key": base64.b64encode(protect(config.api_key.encode())).decode() if config.api_key else ""}
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(CONFIG)


def load():
    if not CONFIG.exists():
        return APIConfig()
    data = json.loads(CONFIG.read_text(encoding="utf-8"))
    key = protect(base64.b64decode(data["encrypted_key"]), decrypt=True).decode() if data.get("encrypted_key") else ""
    return APIConfig(data.get("base_url", ""), data.get("model", ""), key, int(data.get("timeout", 45)))
