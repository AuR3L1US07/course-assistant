"""Persistent course observations. Unknown counts are never treated as zero."""
from contextlib import contextmanager
import sqlite3
import json
import re
from datetime import datetime
from urllib.parse import urlsplit, parse_qs
import settings

DB = settings.ROOT / "data" / "courses.sqlite3"


def course_key(url):
    parsed = urlsplit(url)
    if parsed.scheme == 'https' and parsed.hostname == 'changjiang.yuketang.cn':
        match = re.fullmatch(r'/v2/web/studentLog/(\d+)/?', parsed.path)
        university = parse_qs(parsed.query).get('university_id', [''])[0]
        if not match or not university.isdigit():
            raise ValueError('长江雨课堂课程链接无效')
        return f'yuketang:{university}:{match[1]}'
    if parsed.scheme == 'https' and parsed.hostname in {'www.icourse163.org', 'icourse163.org'}:
        match = re.fullmatch(r'/(?:spoc/)?learn/([A-Za-z0-9_-]+)/?', parsed.path)
        term = parse_qs(parsed.query).get('tid', [''])[0]
        if not match or (term and not term.isdigit()):
            raise ValueError('MOOC 课程链接无效')
        kind = 'spoc' if parsed.path.startswith('/spoc/') else 'mooc'
        return f'mooc:{kind}:{match[1]}:{term or "current"}'
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".chaoxing.com"):
        raise ValueError("不是超星课程链接")
    query = {k.lower(): v[0] for k, v in parse_qs(parsed.query).items()}
    course = query.get("courseid", "")
    clazz = query.get("clazzid", query.get("classid", ""))
    if not course.isdigit() or not clazz.isdigit():
        raise ValueError("课程链接缺少课程或班级编号")
    return f"cx:{course}:{clazz}:{query.get('cpi', '')}"


@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('''CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
        done INTEGER, total INTEGER, status TEXT NOT NULL DEFAULT '待读取',
        checked TEXT, seen TEXT, scan TEXT, error TEXT NOT NULL DEFAULT '')''')
    columns = {row[1] for row in db.execute('PRAGMA table_info(courses)')}
    for name, kind in (("visits_done", "INTEGER"), ("visits_required", "INTEGER"),
                       ("visits_scan", "TEXT"), ("visits_checked", "TEXT"), ("visits_error", "TEXT"),
                       ("metrics", "TEXT"), ("manual", "TEXT"), ("course_type", "TEXT")):
        if name not in columns:
            db.execute(f'ALTER TABLE courses ADD COLUMN {name} {kind}')
    try:
        with db:
            yield db
    finally:
        db.close()


def timestamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def discover(courses, scan):
    added = 0
    with connect() as db:
        for item in courses:
            key = course_key(item["url"])
            exists = db.execute("SELECT 1 FROM courses WHERE id=?", (key,)).fetchone()
            added += not bool(exists)
            db.execute('''INSERT INTO courses(id,name,url,seen,scan,course_type) VALUES(?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,
                seen=excluded.seen,scan=excluded.scan,course_type=excluded.course_type,status='待读取',error='' ''',
                (key, item["name"], item["url"], timestamp(), scan, item.get('course_type', '')))
    return added


def record(url, progress=None, error="", visits=None, scan=None, metrics=None):
    key = course_key(url)
    with connect() as db:
        manual = db.execute("SELECT manual FROM courses WHERE id=?", (key,)).fetchone()
        if manual and manual[0]:
            # 手工确认过的课程不覆盖，保留用户记录
            return
        if progress is None:
            db.execute("UPDATE courses SET status='读取失败',error=? WHERE id=?", (error, key))
        else:
            done, total = progress
            if not (isinstance(done, int) and isinstance(total, int) and 0 <= done <= total):
                raise ValueError("任务点数无效")
            db.execute("UPDATE courses SET done=?,total=?,status='已读取',checked=?,error='' WHERE id=?",
                       (done, total, timestamp(), key))
        if visits is not None:
            done, required = visits.get("done"), visits.get("required")
            if any(value is not None and (type(value) is not int or value < 0) for value in (done, required)):
                raise ValueError("学习次数无效")
            db.execute('''UPDATE courses SET visits_done=?,visits_required=?,visits_scan=?,
                          visits_checked=?,visits_error=? WHERE id=?''',
                       (done, required, scan, timestamp(), visits.get("error", ""), key))
        if metrics is not None:
            for metric in metrics.values():
                if any(v is not None and (type(v) is not int or v < 0)
                       for v in (metric.get("done"), metric.get("required"))):
                    raise ValueError("分类数量无效")
                metric.update(scan=scan, checked=timestamp())
            db.execute('UPDATE courses SET metrics=? WHERE id=?',
                       (json.dumps(metrics, ensure_ascii=False), key))


def rows():
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT * FROM courses ORDER BY seen DESC,name")]


def clear_all():
    with connect() as db:
        db.execute("DELETE FROM courses")


def visits_remaining(row, scan):
    if not scan or row.get("visits_scan") != scan:
        return None
    done, required = row.get("visits_done"), row.get("visits_required")
    return max(0, required - done) if done is not None and required is not None else None


def record_visits(url, visits, scan):
    done, required = visits.get('done'), visits.get('required')
    if any(value is not None and (type(value) is not int or value < 0) for value in (done, required)):
        raise ValueError('学习次数无效')
    with connect() as db:
        db.execute('''UPDATE courses SET visits_done=?,visits_required=?,visits_scan=?,
            visits_checked=?,visits_error=? WHERE id=?''',
            (done, required, scan, timestamp(), visits.get('error', ''), course_key(url)))


def manual_confirm(url, category, required, done, scan=None):
    """手工确认某课程的某一类要求数量，持久保存并带手工标记。

    手工标记 manual=1 的课程，自动检查时不会被覆盖（记录保留）；
    清除手工确认则 manual 置空，恢复自动读取。
    """
    key = course_key(url)
    if not isinstance(required, int) or not isinstance(done, int) or required < 0 or done < 0 or done > required:
        raise ValueError("数量无效")
    manual = json.dumps({"category": category, "required": required, "done": done,
                         "checked": timestamp()}, ensure_ascii=False)
    with connect() as db:
        if category == "chapter":
            db.execute("UPDATE courses SET total=?,done=?,status='已读取',checked=?,error='',manual=? WHERE id=?",
                       (required, done, timestamp(), manual, key))
        elif category == "visits":
            db.execute("UPDATE courses SET visits_required=?,visits_done=?,visits_checked=?,visits_error='',manual=? WHERE id=?",
                       (required, done, timestamp(), manual, key))
        else:
            try:
                metrics = json.loads(db.execute("SELECT metrics FROM courses WHERE id=?", (key,)).fetchone()[0] or '{}')
            except (ValueError, AttributeError):
                metrics = {}
            metrics[category] = {"required": required, "done": done, "applies": required > 0,
                                 "checked": timestamp(), "error": ""}
            db.execute("UPDATE courses SET metrics=?,manual=? WHERE id=?",
                       (json.dumps(metrics, ensure_ascii=False), manual, key))


def clear_manual(url):
    """清除手工确认标记，恢复自动检查的数据。"""
    key = course_key(url)
    with connect() as db:
        db.execute("UPDATE courses SET manual=NULL WHERE id=?", (key,))


CATEGORIES = {"chapter": "章节", "task": "任务", "homework": "作业", "discussion": "讨论", "visits": "学习次数"}
MOOC_CATEGORIES = {'courseware': '课件（视频与文档）', 'discussion': '讨论', 'quiz': '测验', 'homework': '作业'}
YUKETANG_CATEGORIES = {'video': '视频学习', 'exercise': '习题', 'exam': '考试'}


def category_metric(row, category, scan=None):
    """Return independently observed requirements; unknown is different from zero."""
    if category == 'chapter':
        metric = dict(required=row.get('total'), done=row.get('done'), scan=row.get('scan'),
                      checked=row.get('checked'), error=row.get('error', ''))
        valid = row.get('status') == '已读取'
    elif category == 'visits':
        metric = dict(required=row.get('visits_required'), done=row.get('visits_done'),
                      scan=row.get('visits_scan'), checked=row.get('visits_checked'),
                      error=row.get('visits_error', ''))
        valid = True
    else:
        try:
            metric = json.loads(row.get('metrics') or '{}').get(category, {})
        except (ValueError, AttributeError):
            metric = {}
        valid = True
    required, done = metric.get('required'), metric.get('done')
    applies = metric.get('applies')
    # Older snapshots inferred an obligation from a score weight alone.
    # Until the actual topic list has been checked, that is only unconfirmed.
    if category == 'discussion' and applies is True and required is None and metric.get('topics') is None:
        applies = None
    if applies is None and required is not None:
        applies = required > 0
    manual = bool(row.get('manual'))
    # 手工确认过的数据立即生效：不受 scan 匹配限制，视为新鲜。
    fresh = manual or bool(scan and metric.get('scan') == scan and valid)
    return dict(required=required, done=done, applies=applies,
                remaining=max(0, required-done) if required is not None and done is not None else None,
                fresh=fresh,
                manual=manual,
                checked=metric.get('checked'), error=metric.get('error') or '',
                videos=metric.get('videos'), documents=metric.get('documents'), reviews=metric.get('reviews'))


def category_rows(items, category, scan=None):
    included = [(row, category_metric(row, category, scan)) for row in items]
    included = [(row, metric) for row, metric in included if metric['applies'] is True]
    return sorted(included, key=lambda item: (item[1]['remaining'] is None,
                  -item[1]['remaining'] if item[1]['remaining'] is not None else 0,
                  item[0]['name'], item[0]['id']))


def plan(items, scan):
    if not scan:
        return []
    return sorted([r for r in items if r["scan"] == scan and r["status"] == "已读取"
                   and r["total"] is not None and r["total"] > r["done"]],
                  key=lambda r: (-(r["total"] - r["done"]), r["name"], r["id"]))
