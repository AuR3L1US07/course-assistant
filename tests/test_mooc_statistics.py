import json
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import course_store as store
import course_scanner


class MoocStatisticsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.enterContext(patch.object(store, 'DB', Path(temp.name) / 'courses.sqlite3'))

    def test_mooc_and_spoc_are_separate_and_metrics_survive_restart(self):
        items = [dict(name='相同名称', url=f'https://www.icourse163.org/{prefix}learn/HDU-123#/learn/content',
                      course_type=kind) for prefix, kind in [('', 'MOOC'), ('spoc/', 'SPOC')]]
        self.assertEqual(store.discover(items, 'scan'), 2)
        metrics = dict(courseware=dict(required=3, done=2, videos=dict(required=2, done=1), documents=dict(required=1, done=1)),
                       discussion=dict(required=0, done=0), quiz=dict(required=1, done=None), homework=dict(required=None, done=None))
        store.record(items[0]['url'], (2, 3), metrics=metrics, scan='scan')
        rows = store.rows()
        mooc = next(r for r in rows if r['course_type'] == 'MOOC')
        metric = store.category_metric(mooc, 'courseware', 'scan')
        self.assertEqual(metric['remaining'], 1)
        self.assertEqual(metric['videos'], dict(required=2, done=1))
        self.assertTrue(metric['fresh'])
        self.assertFalse(store.category_metric(mooc, 'courseware', 'another')['fresh'])
        self.assertIsNone(store.category_metric(mooc, 'quiz', 'scan')['remaining'])
        self.assertIsNone(store.category_metric(mooc, 'homework', 'scan')['applies'])
        self.assertFalse(store.category_metric(mooc, 'discussion', 'scan')['applies'])
        self.assertNotEqual(store.course_key(items[0]['url']), store.course_key(items[1]['url']))
        self.assertNotEqual(store.course_key(items[0]['url']), store.course_key(items[0]['url'].replace('#', '?tid=123#')))

    def test_mooc_scan_routes_and_persists_each_event(self):
        item = dict(name='课程', url='https://www.icourse163.org/learn/HDU-1', course_type='MOOC')
        def worker(action, stop, callback):
            self.assertEqual(action, 'mooc_scan')
            callback(dict(type='catalog', courses=[item]))
            callback(dict(type='course', url=item['url'], counts=[1, 2],
                          metrics={'courseware': dict(required=2, done=1)}, message='已检查'))
            return '检查结束'
        with patch.object(course_scanner.browser_link, 'run_task', side_effect=worker):
            result = course_scanner.scan_courses('scan', threading.Event(), lambda _: None, platform='mooc')
        self.assertIn('新增 1 门', result)
        self.assertEqual(store.category_metric(store.rows()[0], 'courseware', 'scan')['remaining'], 1)

    def test_browser_readers(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([str(root / '.runtime/node.exe'), str(root / 'tests/test_mooc_scanner.cjs')], check=True)
