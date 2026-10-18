"""Verification lifecycle tests; mock encryption, never touch personal accounts."""
import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import accounts


class VerificationTests(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.path = Path(folder) / 'accounts.json'
        self.enterContext(patch.object(accounts, 'ACCOUNTS_FILE', self.path))
        self.enterContext(patch.object(accounts.settings, 'protect', side_effect=lambda raw, decrypt=False: raw))
        self.credential = accounts.Account('user', 'password')

    def test_restart_and_unchanged_save_keep_success(self):
        accounts.save_account('mooc', self.credential)
        self.assertFalse(accounts.load_account('mooc').verified)
        self.assertTrue(accounts.set_verified('mooc', True, self.credential))
        self.assertTrue(accounts.load_account('mooc').verified)
        accounts.save_account('mooc', self.credential)
        self.assertTrue(accounts.load_account('mooc').verified)

    def test_changed_username_or_password_requires_verification(self):
        for changed in (accounts.Account('another', 'password'), accounts.Account('user', 'new-password')):
            accounts.save_account('chaoxing', self.credential)
            accounts.set_verified('chaoxing', True, self.credential)
            accounts.save_account('chaoxing', changed)
            self.assertFalse(accounts.load_account('chaoxing').verified)
            self.assertFalse(accounts.set_verified('chaoxing', True, self.credential))

    def test_edit_invalidation_clear_and_platform_isolation(self):
        for platform in accounts.PLATFORMS:
            accounts.save_account(platform, self.credential)
            accounts.set_verified(platform, True, self.credential)
        accounts.set_verified('mooc', False)
        self.assertFalse(accounts.load_account('mooc').verified)
        self.assertTrue(accounts.load_account('chaoxing').verified)
        accounts.clear_account('chaoxing')
        self.assertFalse(accounts.load_account('chaoxing').verified)

    def test_old_account_file_without_flag_remains_readable(self):
        legacy = base64.b64encode(json.dumps({'username': 'u', 'password': 'p'}).encode()).decode()
        self.path.write_text(json.dumps({'mooc': legacy}))
        self.assertFalse(accounts.load_account('mooc').verified)
