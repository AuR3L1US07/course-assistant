import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import browser_link


class WebSessionStoreTests(unittest.TestCase):
    def test_encrypted_round_trip_platform_isolation_and_clear(self):
        with tempfile.TemporaryDirectory(dir='.test-artifacts') as folder:
            root = Path(folder).resolve()
            def protect(raw, decrypt=False):
                return raw[::-1] if decrypt else raw[::-1]
            state = {'cookies': [{'name': 'test', 'value': 'fake-cookie'}], 'origins': []}
            with patch.object(browser_link.settings, 'ROOT', root), \
                 patch.object(browser_link.settings, 'protect', side_effect=protect), \
                 patch.object(browser_link, 'PROFILE', root / 'data/browser'), \
                 patch.object(browser_link, 'endpoint', return_value=None):
                browser_link._save_session('chaoxing', state)
                self.assertNotIn(b'fake-cookie', browser_link._session_file('chaoxing').read_bytes())
                self.assertEqual(browser_link._load_session('chaoxing'), state)
                self.assertIsNone(browser_link._load_session('mooc'))
                browser_link.clear_profile()
                self.assertIsNone(browser_link._load_session('chaoxing'))

    def test_bad_saved_state_falls_back_without_exposing_its_content(self):
        with patch.object(browser_link.settings, 'protect', side_effect=OSError('cannot decrypt')), \
             patch.object(Path, 'read_bytes', return_value=b'invalid'):
            self.assertIsNone(browser_link._load_session('chaoxing'))
