import threading
import unittest
from unittest.mock import patch
import browser_link


class MoocRoutingTests(unittest.TestCase):
    def test_platform_and_action_are_routed_without_secret_arguments(self):
        for visible, check_only, action in ((False, False, 'mooc_login'),
                                             (True, False, 'mooc_login_visible'),
                                             (False, True, 'mooc_login_status')):
            def worker(selected, stop, callback, url):
                self.assertEqual(selected, action)
                self.assertEqual(url, 'https://www.icourse163.org/')
                callback({'type': 'login_result', 'status': 'success'})
            with self.subTest(action=action), patch.object(browser_link, 'run_task', side_effect=worker):
                result = browser_link.login_account(threading.Event(), visible=visible, check_only=check_only, platform='mooc')
                self.assertEqual(result, {'status': 'success'})
