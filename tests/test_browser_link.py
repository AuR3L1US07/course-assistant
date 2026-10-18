from pathlib import Path
import tempfile
import threading
import subprocess
import unittest
from unittest.mock import patch

import accounts
import browser_link

NODE = Path(__file__).resolve().parents[1] / '.runtime/node.exe'


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(browser_link, '_load_session', return_value=None))

    def test_high_playback_speed_reaches_worker(self):
        for speed in ('auto', 4, 8, 10, 16):
            command = browser_link.command('brush', 'https://fixture.chaoxing.com/course',
                                           address='http://127.0.0.1:9222', playback_speed=speed)
            self.assertEqual(command[-1], str(speed))
        self.assertEqual(browser_link.command('brush', 'https://fixture.chaoxing.com/course',
                                              address='http://127.0.0.1:9222')[-1], 'auto')
        command = browser_link.command('brush', 'https://fixture.chaoxing.com/course',
                                       address='http://127.0.0.1:9222', playback_speed=32)
        self.assertEqual(command[-1], '1')

    def test_manual_login_uses_visible_action_and_typed_result(self):
        for platform, action in [('chaoxing', 'login_manual'), ('mooc', 'mooc_login_manual')]:
            def task(actual, stop, on_event, url):
                self.assertEqual(actual, action)
                on_event({'type': 'login_result', 'status': 'success'})
            with patch.object(browser_link, 'run_task', side_effect=task):
                result = browser_link.login_account(threading.Event(), manual=True, platform=platform)
                self.assertEqual(result, {'status': 'success'})

    def test_manual_login_worker(self):
        subprocess.run([str(NODE), str(NODE.parents[1] / 'tests/test_manual_login.cjs')], check=True)

    def test_background_profile_is_separate_from_web_login(self):
        subprocess.run([str(NODE), str(NODE.parents[1] / 'tests/test_browser_session.cjs')], check=True)

    def test_login_session_payload_is_saved_and_never_forwarded_to_ui(self):
        events = []
        with patch.object(browser_link, '_save_session') as saved:
            result = self.run_script('''
              console.log(JSON.stringify({type:'session_state',state:{cookies:[],origins:[]}}));
              console.log(JSON.stringify({type:'done',message:'saved'}));
            ''', on_event=events.append)
            self.assertEqual(result, 'saved')
            saved.assert_called_once_with('chaoxing', {'cookies': [], 'origins': []})
            self.assertEqual(events, [])

    def test_session_save_failure_is_not_reported_as_login_saved(self):
        def task(action, stop, on_event, url):
            on_event({'type': 'login_result', 'status': 'success'})
            raise RuntimeError('登录状态保存失败')
        with patch.object(browser_link, 'run_task', side_effect=task):
            with self.assertRaises(RuntimeError):
                browser_link.login_account(threading.Event())

    def test_background_login_does_not_launch_visible_browser(self):
        with patch.object(browser_link, 'endpoint', return_value=None), patch.object(browser_link, 'ensure_browser') as visible:
            args = browser_link.command('login')
            self.assertEqual(args[-2:], ['background', 'login'])
            visible.assert_not_called()

    def test_login_returns_typed_status_and_ignores_untrusted_status(self):
        def task(action, stop, on_event, url):
            self.assertEqual(action, 'login')
            on_event({'type': 'login_result', 'status': 'invalid_credentials'})
            return 'done'
        with patch.object(browser_link, 'run_task', side_effect=task):
            self.assertEqual(browser_link.login_account(threading.Event()), {'status': 'invalid_credentials'})

    def test_login_status_does_not_submit_password(self):
        def task(action, stop, on_event, url):
            self.assertEqual(action, 'login_status')
            on_event({'type': 'login_result', 'status': 'success'})
        with patch.object(browser_link, 'run_task', side_effect=task):
            self.assertEqual(browser_link.login_account(threading.Event(), check_only=True)['status'], 'success')

    def test_login_worker_scenarios(self):
        subprocess.run([str(NODE), str(NODE.parents[1] / 'tests/test_login.cjs')], check=True)

    def test_open_course_login_and_return(self):
        subprocess.run([str(NODE), str(NODE.parents[1] / 'tests/test_open_course.cjs')], check=True)

    def test_open_sends_saved_account_through_stdin(self):
        script = '''
          require('node:readline').createInterface({input:process.stdin}).once('line',line=>{
            const cred=JSON.parse(line);
            console.log(JSON.stringify({type:'done',message:cred.username==='test'&&cred.password==='secret'?'received':'missing'}));
            process.stdin.destroy();
          });
        '''
        with patch.object(browser_link, 'command', return_value=[str(NODE), '-e', script]), \
             patch.object(accounts, 'load_account', return_value=accounts.Account(username='test', password='secret')):
            self.assertEqual(browser_link.open_url('https://mooc2-ans.chaoxing.com/'), 'received')

    def test_scan_does_not_start_visible_chrome(self):
        with patch.object(browser_link, 'endpoint', return_value=None), \
             patch.object(browser_link, 'ensure_browser') as visible:
            args = browser_link.command('scan')
        self.assertEqual(args[-2:], ['background', 'scan'])
        visible.assert_not_called()

    def test_scan_reuses_visible_session_without_opening_tabs(self):
        with patch.object(browser_link, 'endpoint', return_value='http://127.0.0.1:12345'), \
             patch.object(browser_link, 'ensure_browser') as visible:
            args = browser_link.command('scan')
        self.assertEqual(args[-2:], ['http://127.0.0.1:12345', 'scan'])
        visible.assert_not_called()

    def run_script(self, script, stop=None, on_event=None):
        with patch.object(browser_link, 'command', return_value=[str(NODE), '-e', script]), \
             patch.object(accounts, 'load_account', return_value=accounts.Account()):
            return browser_link.run_task('scan', stop or threading.Event(), on_event or (lambda event: None))

    def test_worker_events_and_result(self):
        events = []
        result = self.run_script('''
          console.log(JSON.stringify({type:'progress',message:'reading'}));
          console.log(JSON.stringify({type:'done',message:'finished'}));
        ''', on_event=events.append)
        self.assertEqual(result, 'finished')
        self.assertEqual(events, [{'type': 'progress', 'message': 'reading'}])

    def test_worker_error_is_not_success(self):
        with self.assertRaisesRegex(RuntimeError, 'failed'):
            self.run_script("console.log(JSON.stringify({type:'done',message:'failed'}));process.exitCode=1;")

    def test_missing_result_is_error(self):
        with self.assertRaises(RuntimeError):
            self.run_script("console.log(JSON.stringify({type:'progress',message:'partial'}));")

    def test_cancel_running_worker(self):
        stop = threading.Event()
        result = self.run_script('''
          const rl=require('node:readline').createInterface({input:process.stdin});
          rl.on('line',line=>{
            if(JSON.parse(line)==='stop'){
              console.log(JSON.stringify({type:'done',message:'stopped'}));
              rl.close();process.stdin.destroy();
            }
          });
          console.log(JSON.stringify({type:'progress',message:'ready'}));
        ''', stop=stop, on_event=lambda event: stop.set())
        self.assertEqual(result, 'stopped')

    def test_cancel_before_start_does_not_open_browser(self):
        stop = threading.Event()
        stop.set()
        with patch.object(browser_link, 'command') as command:
            browser_link.run_task('scan', stop, lambda event: None)
            command.assert_not_called()

    def test_clear_profile_rejects_outside_directory(self):
        with patch.object(browser_link, 'PROFILE', Path('C:/unrelated-profile')), \
             patch.object(browser_link.shutil, 'rmtree') as remove:
            with self.assertRaises(RuntimeError):
                browser_link.clear_profile()
            remove.assert_not_called()

    def test_clear_profile_preserves_other_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            profile = root / 'data/browser'
            (profile / 'Default').mkdir(parents=True)
            (profile / 'keep.txt').write_text('keep')
            background = root / 'data/browser-background'
            background.mkdir()
            with patch.object(browser_link.settings, 'ROOT', root), \
                 patch.object(browser_link, 'PROFILE', profile), \
                 patch.object(browser_link, 'endpoint', return_value=None):
                browser_link.clear_profile()
            self.assertFalse((profile / 'Default').exists())
            self.assertTrue((profile / 'keep.txt').exists())
            self.assertFalse(background.exists())
