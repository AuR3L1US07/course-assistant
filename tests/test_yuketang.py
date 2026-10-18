import threading
import unittest
from unittest.mock import patch

import accounts
import browser_link
import course_store


class YuketangTests(unittest.TestCase):
    def test_course_identity_is_platform_isolated(self):
        self.assertEqual(course_store.course_key('https://changjiang.yuketang.cn/v2/web/studentLog/456?university_id=123'),
                         'yuketang:123:456')
        for url in ('http://changjiang.yuketang.cn/v2/web/student/123/456',
                    'https://fake.yuketang.cn/v2/web/student/123/456',
                    'https://changjiang.yuketang.cn/v2/web/index'):
            with self.assertRaises(ValueError):
                course_store.course_key(url)

    def test_password_login_and_status_routing(self):
        self.assertIn('yuketang', accounts.PLATFORMS)
        for options, action in (({}, 'yuketang_login'), ({'visible': True}, 'yuketang_login_visible'),
                                ({'check_only': True}, 'yuketang_login_status'),
                                ({'manual': True}, 'yuketang_login_manual')):
            def worker(selected, stop, callback, url):
                self.assertEqual(selected, action)
                self.assertEqual(url, 'https://changjiang.yuketang.cn/v2/web/index')
                callback({'type': 'login_result', 'status': 'success'})
            with self.subTest(action=action), patch.object(browser_link, 'run_task', side_effect=worker):
                self.assertEqual(browser_link.login_account(threading.Event(), platform='yuketang', **options),
                                 {'status': 'success'})

    def test_video_and_exercise_progress_remain_independent(self):
        row = {'metrics': '{"video":{"done":2,"required":3,"scan":"scan"},"exercise":{"done":null,"required":4,"scan":"scan"}}'}
        self.assertEqual(course_store.category_metric(row, 'video', 'scan')['remaining'], 1)
        self.assertIsNone(course_store.category_metric(row, 'exercise', 'scan')['remaining'])

    def test_brush_options_reach_yuketang_worker(self):
        options = {'materials': False, 'quiz': True, 'exam': False}
        args = browser_link.command('yuketang_brush', 'https://changjiang.yuketang.cn/v2/web/studentLog/456?university_id=123',
                                   address='http://localhost:9222', playback_speed=2, task_options=options)
        import json
        self.assertEqual(args[-2], '2')
        self.assertEqual(json.loads(args[-1]), options)


if __name__ == '__main__':
    unittest.main()
