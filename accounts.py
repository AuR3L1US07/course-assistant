"""Per-platform credentials, encrypted for the current Windows account."""
import base64
from dataclasses import dataclass, field
import json

import settings

ACCOUNTS_FILE = settings.ROOT / "data" / "accounts.json"
PLATFORMS = {"chaoxing": "超星泛雅", "mooc": "中国大学 MOOC", "yuketang": "长江雨课堂"}


@dataclass
class Account:
    username: str = field(default="", repr=False)
    password: str = field(default="", repr=False)
    verified: bool = field(default=False, compare=False)


def _validate_platform(platform):
    if platform not in PLATFORMS:
        raise ValueError("不支持的平台。")


def _read():
    if not ACCOUNTS_FILE.exists():
        return {}
    data = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or any(key not in PLATFORMS or not isinstance(value, str)
                                         for key, value in data.items()):
        raise ValueError("账号文件格式不正确，原文件未修改。")
    return data


def _write(data):
    ACCOUNTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = ACCOUNTS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temporary.replace(ACCOUNTS_FILE)


def load_account(platform):
    _validate_platform(platform)
    encrypted = _read().get(platform)
    if not encrypted:
        return Account()
    raw = settings.protect(base64.b64decode(encrypted, validate=True), decrypt=True)
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict) or not all(isinstance(data.get(key), str) for key in ("username", "password")):
        raise ValueError("账号内容格式不正确。")
    return Account(data["username"], data["password"], data.get("verified") is True)


def save_account(platform, account):
    _validate_platform(platform)
    username = account.username.strip()
    if not username or not account.password:
        raise ValueError("请填写账号和密码。")
    data = _read()
    previous = load_account(platform)
    verified = previous.verified and previous.username == username and previous.password == account.password
    # Preserve password whitespace exactly; it may be part of the password.
    raw = json.dumps({"username": username, "password": account.password, "verified": verified}, ensure_ascii=False).encode("utf-8")
    data[platform] = base64.b64encode(settings.protect(raw)).decode("ascii")
    _write(data)


def set_verified(platform, verified, expected=None):
    """Bind the remembered result to the exact stored credentials."""
    account = load_account(platform)
    if not account.username or (expected is not None and account != expected):
        return False
    data = _read()
    raw = json.dumps({"username": account.username, "password": account.password,
                      "verified": bool(verified)}, ensure_ascii=False).encode("utf-8")
    data[platform] = base64.b64encode(settings.protect(raw)).decode("ascii")
    _write(data)
    return True


def clear_account(platform):
    _validate_platform(platform)
    data = _read()
    data.pop(platform, None)
    _write(data)
