from pathlib import Path
import tempfile
import unittest
import subprocess
import sqlite3
from unittest.mock import patch
import course_store as store


def course(number=1, name="测试课程"):
    return {"name": name, "url": f"https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid={number}&clazzid=123&cpi=456"}


class CourseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch.object(store, "DB", Path(self.temp.name) / "courses.db")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_taskpoint_text(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([str(root / '.runtime/node.exe'), str(root / 'tests/test_progress.cjs')], check=True)

    def test_learning_space_enters_course_list_before_reading(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([str(root / '.runtime/node.exe'), str(root / 'tests/test_course_navigation.cjs')], check=True)

    def test_category_loading_does_not_hide_tasks(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([str(root / '.runtime/node.exe'), str(root / 'tests/test_categories.cjs')], check=True)

    def test_refresh_uses_actual_counts_and_stops(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([str(root / '.runtime/node.exe'), str(root / 'tests/test_visits.cjs')], check=True)

    def test_four_categories_filter_and_sort_independently(self):
        items=[course(i,str(i)) for i in range(1,4)]
        store.discover(items,'scan')
        store.record(items[0]['url'],(0,0),visits={'done':1,'required':5},scan='scan',
                     metrics={'task':{'required':2,'done':0,'applies':True},'discussion':{'required':0,'done':0,'applies':False}})
        store.record(items[1]['url'],(5,5),visits={'done':3,'required':5},scan='scan',
                     metrics={'task':{'required':0,'done':0,'applies':False},'discussion':{'required':4,'done':1,'applies':True}})
        store.record(items[2]['url'],(0,10),visits={'done':0,'required':None},scan='scan')
        rows=store.rows()
        self.assertEqual([r['name'] for r,m in store.category_rows(rows,'chapter','scan')],['3','2'])
        self.assertEqual([r['name'] for r,m in store.category_rows(rows,'visits','scan')],['1','2'])
        self.assertEqual([r['name'] for r,m in store.category_rows(rows,'task','scan')],['1'])
        self.assertEqual([r['name'] for r,m in store.category_rows(rows,'discussion','scan')],['2'])

    def test_unquantified_requirement_kept_but_unknown_absence_not_assumed(self):
        item=course()
        store.discover([item],'scan')
        store.record(item['url'],(0,0),scan='scan',metrics={'discussion':{'required':None,'done':None,'applies':True,'topics':3}})
        pair=store.category_rows(store.rows(),'discussion','scan')[0]
        self.assertIsNone(pair[1]['remaining'])
        self.assertEqual(store.category_rows(store.rows(),'task','scan'),[])

    def test_legacy_score_weight_is_not_a_confirmed_discussion_task(self):
        item=course()
        store.discover([item],'old')
        store.record(item['url'],(0,0),scan='old',metrics={'discussion':{'required':None,'done':None,'applies':True}})
        self.assertEqual(store.category_rows(store.rows(),'discussion','old'),[])
        self.assertIsNone(store.category_metric(store.rows()[0],'discussion','old')['applies'])

    def test_live_visits_update_does_not_change_chapter_progress(self):
        item=course()
        store.discover([item],'scan')
        store.record(item['url'],(26,42))
        store.record_visits(item['url'],{'done':336,'required':300},'scan')
        row=store.rows()[0]
        self.assertEqual((row['done'],row['total'],row['status']),(26,42,'已读取'))
        self.assertEqual(store.category_metric(row,'visits','scan')['remaining'],0)

    def test_new_course_merge_and_deduplicate(self):
        self.assertEqual(store.discover([course()], "first"), 1)
        self.assertEqual(store.discover([course(), course(2)], "second"), 1)
        self.assertEqual(len(store.rows()), 2)

    def test_url_tokens_do_not_change_identity(self):
        first = course()
        changed = dict(first, url=first["url"] + "&enc=changed&t=123")
        self.assertEqual(store.discover([first, changed], "scan"), 1)
        self.assertEqual(len(store.rows()), 1)

    def test_failure_retains_old_counts_but_excludes_plan(self):
        item = course()
        store.discover([item], "old")
        store.record(item["url"], (26, 42))
        store.discover([item], "new")
        store.record(item["url"], error="登录失效")
        row = store.rows()[0]
        self.assertEqual((row["done"], row["total"]), (26, 42))
        self.assertEqual(row["status"], "读取失败")
        self.assertEqual(store.plan(store.rows(), "new"), [])

    def test_plan_omits_old_unknown_and_complete(self):
        items = [course(i, str(i)) for i in range(1, 6)]
        store.discover(items, "scan")
        for item, counts in zip(items, [(26, 42), (3, 5), (5, 5)]):
            store.record(item["url"], counts)
        store.discover([items[4]], "old")
        store.record(items[4]["url"], (0, 1))
        self.assertEqual([r["name"] for r in store.plan(store.rows(), "scan")], ["1", "2"])
        self.assertEqual(store.plan(store.rows(), None), [])

    def test_missing_on_partial_scan_does_not_delete(self):
        store.discover([course(1), course(2)], "old")
        store.discover([course(1)], "new")
        self.assertEqual(len(store.rows()), 2)
        self.assertEqual(store.plan(store.rows(), "new"), [])

    def test_untrusted_course_link_rejected(self):
        with self.assertRaises(ValueError):
            store.course_key("https://chaoxing.com.evil.test/?courseid=1&clazzid=2")

    def test_learning_counts_above_target_are_complete(self):
        item = course()
        store.discover([item], 'scan')
        store.record(item['url'], (0, 0), visits={'done': 335, 'required': 300}, scan='scan')
        row = store.rows()[0]
        self.assertEqual(store.visits_remaining(row, 'scan'), 0)
        self.assertEqual(row['visits_done'], 335)
        self.assertEqual(row['visits_required'], 300)
        self.assertIsNone(store.visits_remaining(row, 'next-scan'))

    def test_learning_counts_under_target_and_unknown(self):
        item = course()
        store.discover([item], 'scan')
        store.record(item['url'], (0, 0), visits={'done': 120, 'required': 300}, scan='scan')
        self.assertEqual(store.visits_remaining(store.rows()[0], 'scan'), 180)
        store.record(item['url'], (0, 0), visits={'done': 120, 'required': None}, scan='scan')
        self.assertIsNone(store.visits_remaining(store.rows()[0], 'scan'))

    def test_failed_rescan_does_not_mark_old_counts_current(self):
        item = course()
        store.discover([item], 'old')
        store.record(item['url'], (0, 0), visits={'done': 335, 'required': 300}, scan='old')
        store.discover([item], 'new')
        store.record(item['url'], error='读取失败')
        self.assertIsNone(store.visits_remaining(store.rows()[0], 'new'))
        self.assertEqual(store.rows()[0]['visits_done'], 335)

    def test_old_database_migration_preserves_courses(self):
        with sqlite3.connect(store.DB) as db:
            db.execute('''CREATE TABLE courses (id TEXT PRIMARY KEY,name TEXT,url TEXT,done INTEGER,
                total INTEGER,status TEXT,checked TEXT,seen TEXT,scan TEXT,error TEXT)''')
            db.execute("INSERT INTO courses(id,name,url,done,total,status) VALUES(?,?,?,?,?,?)",
                       (store.course_key(course()['url']), '原课程', course()['url'], 26, 42, '已读取'))
        db.close()
        row = store.rows()[0]
        self.assertEqual((row['name'], row['done'], row['total']), ('原课程', 26, 42))
        self.assertIsNone(row['visits_required'])


if __name__ == "__main__":
    unittest.main()
