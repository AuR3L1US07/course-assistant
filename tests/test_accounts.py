import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import accounts


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "accounts.json"
        self.patch = patch.object(accounts, "ACCOUNTS_FILE", self.path)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_encrypted_roundtrip_and_password_spaces(self):
        original = accounts.Account(" test-user@example.com ", "  密码-with-spaces  ")
        accounts.save_account("mooc", original)
        restored = accounts.load_account("mooc")
        self.assertEqual(restored.username, "test-user@example.com")
        self.assertEqual(restored.password, original.password)
        stored = self.path.read_text()
        self.assertNotIn(restored.username, stored)
        self.assertNotIn("with-spaces", stored)
        self.assertNotIn(original.password, repr(original))

    def test_platform_isolation_update_and_clear(self):
        cx = accounts.Account("cx-user", "cx-pass")
        mooc = accounts.Account("mooc-user", "mooc-pass")
        accounts.save_account("chaoxing", cx)
        accounts.save_account("mooc", mooc)
        accounts.save_account("chaoxing", accounts.Account("changed", "new-pass"))
        self.assertEqual(accounts.load_account("mooc"), mooc)
        accounts.clear_account("chaoxing")
        self.assertEqual(accounts.load_account("chaoxing"), accounts.Account())
        self.assertEqual(accounts.load_account("mooc"), mooc)

    def test_missing_account_is_empty(self):
        self.assertEqual(accounts.load_account("mooc"), accounts.Account())

    def test_incomplete_credentials_do_not_overwrite(self):
        original = accounts.Account("user", "password")
        accounts.save_account("mooc", original)
        with self.assertRaises(ValueError):
            accounts.save_account("mooc", accounts.Account("user", ""))
        self.assertEqual(accounts.load_account("mooc"), original)

    def test_bad_file_not_overwritten(self):
        self.path.write_text("not json")
        with self.assertRaises(ValueError):
            accounts.save_account("mooc", accounts.Account("user", "pass"))
        self.assertEqual(self.path.read_text(), "not json")

    def test_unknown_platform_rejected(self):
        with self.assertRaises(ValueError):
            accounts.save_account("unknown", accounts.Account("user", "pass"))
        self.assertFalse(self.path.exists())

    def test_encryption_failure_preserves_saved_data(self):
        original = accounts.Account("user", "password")
        accounts.save_account("mooc", original)
        before = self.path.read_bytes()
        with patch.object(accounts.settings, "protect", side_effect=OSError("test failure")):
            with self.assertRaises(OSError):
                accounts.save_account("mooc", accounts.Account("new", "new"))
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
