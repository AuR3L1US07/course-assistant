"""Persist course observations from the shared browser worker."""
import browser_link
import course_store as store
import time


def scan_courses(scan_id, stop, report, platform='chaoxing'):
    started = time.monotonic()
    added = 0
    def on_event(event):
        nonlocal added
        if event.get("type") == "catalog":
            added += store.discover(event["courses"], scan_id)
            report(f"发现 {len(event['courses'])} 门课程，新增 {added} 门，正在读取{'分类进度' if platform in {'mooc', 'yuketang'} else '任务点'}…")
        elif event.get("type") == "course":
            counts = event.get("counts")
            store.record(event["url"], tuple(counts) if counts is not None else None,
                         event.get("error", ""), visits=event.get("visits"), scan=scan_id,
                         metrics=event.get("metrics"))
            report(event["message"])
        elif event.get("type") == "progress":
            report(event["message"])
    action = {'chaoxing': 'scan', 'mooc': 'mooc_scan', 'yuketang': 'yuketang_scan'}[platform]
    result = browser_link.run_task(action, stop, on_event)
    return result + f" 本次新增 {added} 门，用时 {time.monotonic() - started:.1f} 秒。"
