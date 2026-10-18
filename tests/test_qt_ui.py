"""Native UI checks: no browser, real API requests, or personal-data writes."""
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
import qt_app as ui
from PySide6.QtTest import QTest


class NativeUITests(unittest.TestCase):
    def test_yuketang_platform_categories_and_account_panel(self):
        window = self.window
        window.show_platform('yuketang')
        self.assertEqual(window.category, 'video')
        self.assertFalse(window.category_buttons['video'].isHidden())
        self.assertFalse(window.category_buttons['exercise'].isHidden())
        self.assertFalse(window.category_buttons['exam'].isHidden())
        self.assertFalse(window.category_buttons['exam'].isHidden())
        self.assertTrue(window.category_buttons['chapter'].isHidden())
        window.show_category('exam')
        self.assertEqual(window.table_title.text(), '考试进度')
        window.show_platform('chaoxing')
        window.show_platform('yuketang')
        self.assertEqual(window.category, 'exam')
        window.show()
        self.application.processEvents()
        window.grab().save(str(Path(__file__).resolve().parents[1] / '.test-artifacts/yuketang-exam.png'))
        window.show_page('accounts')
        window.select_section('accounts', 'yuketang')
        self.assertFalse(window.account_panels['yuketang'].isHidden())
        window.show()
        self.application.processEvents()
        window.grab().save(str(Path(__file__).resolve().parents[1] / '.test-artifacts/yuketang-account.png'))

    def test_high_playback_speed_choices_default_to_auto(self):
        choices = self.window.playback_speed
        self.assertEqual(choices.currentData(), 'auto')
        for speed in (4, 8, 10, 16):
            index = choices.findData(speed)
            self.assertGreaterEqual(index, 0)
            choices.setCurrentIndex(index)
            self.assertEqual(choices.currentData(), speed)

    @classmethod
    def setUpClass(cls):
        cls.application = ui.QApplication.instance() or ui.QApplication([])
        cls.application.setStyle('Fusion')
        cls.application.setStyleSheet(ui.STYLE)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ui.ROOT / '.test-artifacts')
        self.addCleanup(self.temp.cleanup)
        self.enterContext(patch.object(ui, 'ROOT', Path(self.temp.name)))
        self.enterContext(patch.object(ui.accounts, 'load_account', return_value=ui.accounts.Account()))
        self.enterContext(patch.object(ui.accounts, 'set_verified', return_value=True))
        self.enterContext(patch.object(ui.settings, 'load', return_value=ui.APIConfig()))
        self.rows = [dict(id='cx:1:1:', name='课程甲', total=42, done=26, status='已读取', scan='s', checked='2026-10-17T12:00:00', url='https://mooc1.chaoxing.com/course?courseid=1&clazzid=1', visits_required=300, visits_done=335, visits_scan='s'),
                     dict(id='cx:2:2:', name='课程乙', total=0, done=0, status='已读取', scan='s', url='https://mooc1.chaoxing.com/course?courseid=2&clazzid=2', visits_required=100, visits_done=20, visits_scan='s')]
        self.enterContext(patch.object(ui.course_store, 'rows', side_effect=lambda: self.rows))
        self.window = ui.Window(auto_start=False)
        self.addCleanup(self.dispose_window)

    def dispose_window(self):
        self.window.close()
        self.window.deleteLater()
        self.application.sendPostedEvents(None, ui.QEvent.Type.DeferredDelete)
        self.application.processEvents()

    def test_categories_search_and_platform_preserve_filters(self):
        w = self.window
        w.current_scan = 's'
        w.refresh()
        self.assertEqual(w.table.rowCount(), 1)
        self.assertEqual(w.stat_values['left'].text(), '16')
        w.show_category('visits')
        self.assertEqual(w.table.rowCount(), 2)
        self.assertEqual(w.table.item(0, 1).text(), '课程乙')
        self.assertEqual(w.stat_values['left'].text(), '80')
        w.search.setText('甲')
        self.assertEqual(w.table.rowCount(), 1)
        w.show_page('accounts')
        w.show_page('courses')
        self.assertEqual(w.search.text(), '甲')
        w.show_platform('mooc')
        self.assertEqual(w.table.rowCount(), 0)
        self.assertTrue(w.scan_button.isEnabled())
        self.assertFalse(w.all_button.isEnabled())
        w.show_platform('chaoxing')
        self.assertTrue(w.scan_button.isEnabled())

    def test_startup_bounce_settles_and_only_runs_once(self):
        w = self.window
        w.show()
        self.application.processEvents()
        origin = w._startup_origin
        self.assertIsNotNone(origin)
        overlay = w._startup_overlay
        w.startup_animation.setCurrentTime(56)
        first_angle, sway, blur = ui.motion.startup_pose(overlay.progress)
        self.assertGreater(first_angle, 0)
        self.assertGreater(blur, 0)
        self.assertFalse(overlay.pixmap.isNull())
        self.assertEqual(overlay.soft.size(), overlay.pixmap.size())
        w.startup_animation.setCurrentTime(168)
        self.assertLess(ui.motion.startup_pose(overlay.progress)[0], 0)
        self.assertEqual(w.pos(), origin)
        w.startup_animation.setCurrentTime(ui.motion.STARTUP_DURATION)
        self.assertEqual(w.pos(), origin)
        self.assertIsNone(w._startup_origin)
        self.assertIsNone(w._startup_overlay)
        self.assertEqual(w.windowOpacity(), 1.0)
        w.hide()
        w.show()
        self.application.processEvents()
        self.assertIsNone(w._startup_origin)

    def test_startup_bounce_respects_reduced_motion_and_interruption(self):
        w = self.window
        w.reduced_motion = True
        w.show()
        self.application.processEvents()
        self.assertIsNone(w._startup_origin)
        w.reduced_motion = False
        w._start_startup()
        origin = w._startup_origin
        w.startup_animation.setCurrentTime(56)
        QTest.mousePress(w.title_bar, ui.Qt.MouseButton.LeftButton)
        QTest.mouseRelease(w.title_bar, ui.Qt.MouseButton.LeftButton)
        self.assertEqual(w.pos(), origin)
        self.assertIsNone(w._startup_origin)
        self.assertEqual(w.startup_animation.state(), ui.QVariantAnimation.State.Stopped)

    def test_busy_controls_and_cancel(self):
        w = self.window
        w.table.selectRow(0)
        w.scanning = True
        w.update_controls()
        for b in [w.one_button, w.all_button, w.open_button, w.manual_button]:
            self.assertFalse(b.isEnabled())
        self.assertTrue(w.stop_button.isEnabled())
        self.assertTrue(w.clear_button.isEnabled())
        w.stop_work()
        self.assertTrue(w.stop_event.is_set())

    def test_mooc_categories_include_both_types_and_keep_platform_snapshots(self):
        import json
        w = self.window
        w.current_scan = 'cx-scan'
        self.rows.extend([dict(id='mooc:mooc:HDU-1:current', name='数学', course_type='MOOC',
                               url='https://www.icourse163.org/learn/HDU-1',
                               metrics=json.dumps({'courseware': dict(required=3, done=2, scan='mooc-scan',
                                                   videos=dict(required=2, done=1), documents=dict(required=1, done=1))})),
                          dict(id='mooc:spoc:HDU-2:current', name='学校课程', course_type='SPOC',
                               url='https://www.icourse163.org/spoc/learn/HDU-2', metrics='{}')])
        w.show_platform('mooc')
        w.current_scan = 'mooc-scan'
        w.refresh()
        self.assertEqual(w.category, 'courseware')
        self.assertEqual(w.table.rowCount(), 2)
        self.assertIn('[MOOC]', w.table.item(0, 1).text())
        self.assertIn('[SPOC]', w.table.item(1, 1).text())
        self.assertEqual(w.stat_values['left'].text(), '1')
        self.assertTrue(w.category_buttons['chapter'].isHidden())
        self.assertFalse(w.category_buttons['quiz'].isHidden())
        w.table.selectRow(0)
        self.assertIn('视频 1/2', w.detail_note.text())
        w.show_category('quiz')
        self.assertEqual(w.table.rowCount(), 2)
        w.show_platform('chaoxing')
        self.assertEqual(w.current_scan, 'cx-scan')
        self.assertEqual(w.category, 'chapter')
        w.show_platform('mooc')
        self.assertEqual(w.current_scan, 'mooc-scan')
        self.assertEqual(w.category, 'quiz')
        self.assertFalse(w.one_button.isEnabled())

    def test_stale_rows_do_not_enter_automatic_queue(self):
        w = self.window
        with patch.object(ui.browser_link, 'run_task') as run:
            w.start_brush(False)
            run.assert_not_called()
        self.assertFalse(w.brushing)

    def test_switch_keyboard_and_persistence_and_reduced_motion(self):
        w = self.window
        w.show_page('settings')
        w.auto_switch.setChecked(False)
        w.motion_switch.setChecked(True)
        saved = json_load(w.preferences_path)
        self.assertFalse(saved['auto_scan'])
        self.assertTrue(saved['reduced_motion'])
        self.assertFalse(w.auto_switch.animate)
        QTest.keyClick(w.auto_switch, ui.Qt.Key.Key_Space)
        self.assertTrue(w.auto_switch.isChecked())
        self.assertEqual(w.auto_switch.position, 1)

    def test_scan_failure_recovers_controls(self):
        w = self.window
        with patch('course_scanner.scan_courses', side_effect=RuntimeError('登录失效')):
            w.start_scan()
            for t in list(w.threads):
                t.join(2)
            w.poll()
        self.assertFalse(w.scanning)
        self.assertTrue(w.scan_button.isEnabled())
        self.assertEqual(w.status.text(), '登录失效')

    def test_mooc_scan_uses_mooc_reader(self):
        w = self.window
        w.show_platform('mooc')
        with patch('course_scanner.scan_courses', return_value='检查结束') as scan:
            w.start_scan()
            for t in list(w.threads):
                t.join(2)
            w.poll()
        self.assertEqual(scan.call_args.kwargs['platform'], 'mooc')
        self.assertFalse(w.scanning)
        self.assertEqual(w.platform_scans['mooc'], w.current_scan)
        self.assertTrue(w.scan_button.isEnabled())

    def test_homework_shows_only_offered_review_phases(self):
        import json
        w = self.window
        metric = dict(required=1, done=1, scan='s', reviews={'peer': dict(required=1, done=0),
                                                         'self': dict(required=1, done=1)})
        self.rows = [dict(id='mooc:mooc:HDU-1:current', name='数学实验', course_type='MOOC',
                          url='https://www.icourse163.org/learn/HDU-1', metrics=json.dumps({'homework': metric}))]
        w.show_platform('mooc')
        w.current_scan = 's'
        w.show_category('homework')
        w.table.selectRow(0)
        self.assertEqual(w.table.item(0, 3).text(), '1')
        self.assertIn('互评已完成 0/1', w.detail_note.text())
        self.assertIn('自评已完成 1/1', w.detail_note.text())
        metric.pop('reviews')
        self.rows[0]['metrics'] = json.dumps({'homework': metric})
        w.refresh()
        self.assertNotIn('互评', w.detail_note.text())
        self.assertNotIn('自评', w.detail_note.text())

    def test_selection_survives_refresh_but_not_filter_removal(self):
        w = self.window
        w.table.selectRow(0)
        w.refresh()
        self.assertEqual(w.selected()[0]['name'], '课程甲')
        w.search.setText('does not exist')
        self.assertIsNone(w.selected()[0])
        self.assertFalse(w.open_button.isEnabled())

    def test_clear_cancel_preserves_running_work(self):
        w = self.window
        w.brushing = True
        with patch.object(ui.course_store, 'clear_all') as clear, patch.object(ui.QMessageBox, 'exec', return_value=ui.QMessageBox.StandardButton.No) as confirm:
            w.clear_data()
            clear.assert_not_called()
            confirm.assert_called_once()
            self.assertFalse(w.stop_event.is_set())
            self.assertFalse(w.pending_clear)

    def test_clear_waits_for_task_to_exit_after_confirmation(self):
        w = self.window
        w.scanning = True
        with patch.object(ui.QMessageBox, 'exec', return_value=ui.QMessageBox.StandardButton.Yes), patch.object(ui.QTimer, 'singleShot') as scheduled, patch.object(w, 'clear_data_after_stop') as clear:
            w.clear_data()
            self.assertTrue(w.pending_clear)
            self.assertTrue(w.stop_event.is_set())
            self.assertFalse(w.clear_button.isEnabled())
            clear.assert_not_called()
            scheduled.assert_called_once()
            w.scanning = False
            w.wait_to_clear_data()
            clear.assert_called_once()

    def test_rapid_navigation_finishes_at_latest_page(self):
        w = self.window
        w.show()
        self.application.processEvents()
        for page in ['accounts', 'api', 'settings', 'courses']:
            w.show_page(page)
        QTest.qWait(w.stack.fade.duration() + 60)
        self.assertIs(w.stack.currentWidget(), w.pages['courses'][0])
        self.assertIsNone(w.stack.moving_page)
        self.assertEqual(w.stack.currentWidget().pos().y(), 0)
        self.assertTrue(w.top_buttons['courses'].isChecked())

    def test_minimum_window_keeps_actions_inside_scrollable_page(self):
        w = self.window
        w.resize(1020, 720)
        w.show()
        self.application.processEvents()
        for b in [w.scan_button, w.all_button, w.open_button, w.manual_button]:
            self.assertGreater(b.width(), 0)
            self.assertLessEqual(b.geometry().right(), b.parentWidget().width())
        self.assertEqual(w.width(), 1020)

    def test_dark_system_palette_has_opaque_background_during_slide(self):
        palette = self.application.palette()
        dark = ui.QPalette(palette)
        dark.setColor(ui.QPalette.ColorRole.Window, ui.QColor('#202020'))
        dark.setColor(ui.QPalette.ColorRole.Base, ui.QColor('#202020'))
        self.application.setPalette(dark)
        self.addCleanup(lambda: self.application.setPalette(palette))
        w = self.window
        w.show()
        self.application.processEvents()
        w.show_page('settings')
        self.assertLess(w.stack.overlay.offset, 0)
        self.assertEqual(w.stack.currentWidget().y(), 0)
        for delay in (0, 60, 90):
            QTest.qWait(delay)
            frame = w.stack.grab().toImage()
            self.assertEqual(frame.pixelColor(frame.width() - 2, frame.height() - 2).name(), '#edf4fa')
        w.grab().save(str(Path(__file__).resolve().parents[1] / '.test-artifacts' / 'transition-mid.png'))
        QTest.qWait(150)
        self.assertEqual(w.stack.currentWidget().y(), 0)
        w.show_category('visits')
        self.assertLess(w.stack.overlay.offset, 0)
        QTest.qWait(w.stack.fade.duration() + 60)
        self.assertEqual(w.stack.currentWidget().y(), 0)

    def test_hover_tooltips_removed(self):
        for row in range(self.window.table.rowCount()):
            for col in range(self.window.table.columnCount()):
                self.assertEqual(self.window.table.item(row, col).toolTip(), '')
        self.window.events.put(('notice', '测试提示'))
        self.window.poll()
        self.assertEqual(self.window.status.toolTip(), '')

    def test_sidebar_follows_page_and_remembers_account_and_category(self):
        w = self.window
        w.show_category('visits')
        w.show_page('accounts')
        self.assertIs(w.side_stack.currentWidget(), w.context_nav['accounts'])
        self.assertFalse(w.category_group.isVisible())
        w.select_section('accounts', 'mooc')
        self.assertFalse(w.account_panels['chaoxing'].isVisible())
        self.assertFalse(w.account_panels['mooc'].isHidden())
        w.show_page('api')
        self.assertIs(w.side_stack.currentWidget(), w.context_nav['api'])
        self.assertEqual(list(w.context_buttons['api']), ['connection'])
        w.show_page('settings')
        self.assertIs(w.side_stack.currentWidget(), w.context_nav['settings'])
        w.show_page('courses')
        self.assertIs(w.side_stack.currentWidget(), w.course_nav)
        self.assertEqual(w.category, 'visits')
        w.show_page('accounts')
        self.assertEqual(w.account_platform, 'mooc')

    def test_animation_uses_opaque_cached_frame_and_fixed_live_geometry(self):
        w = self.window
        w.show()
        self.application.processEvents()
        w.show_page('settings')
        overlay = w.stack.overlay
        self.assertIsNotNone(overlay)
        self.assertTrue(overlay.testAttribute(ui.Qt.WidgetAttribute.WA_OpaquePaintEvent))
        self.assertIsNone(overlay.graphicsEffect())
        self.assertIsNone(w.general_panel.graphicsEffect())
        QTest.qWait(90)
        self.assertGreater(overlay.offset, -40)
        self.assertLess(overlay.offset, 0)
        self.assertEqual(w.stack.currentWidget().y(), 0)
        QTest.qWait(w.stack.fade.duration() + 60)
        self.assertIsNone(w.stack.overlay)

    def test_background_refresh_is_coalesced_and_waits_for_animation(self):
        w = self.window
        w.show()
        self.application.processEvents()
        w.show_page('settings')
        with patch.object(w, 'refresh') as refresh:
            for _ in range(10):
                w.schedule_refresh()
            QTest.qWait(100)
            refresh.assert_not_called()
            QTest.qWait(w.stack.fade.duration() + 120)
            refresh.assert_called_once()

    def test_pcl_titlebar_navigation_and_window_controls(self):
        w = self.window
        w.show()
        self.application.processEvents()
        self.assertTrue(w.windowFlags() & ui.Qt.WindowType.FramelessWindowHint)
        self.assertEqual(w.title_bar.height(), 56)
        for key, control in w.top_buttons.items():
            self.assertFalse(control.icon().isNull())
            QTest.mouseClick(control, ui.Qt.MouseButton.LeftButton)
            self.assertTrue(control.isChecked())
            self.assertEqual(sum(b.isChecked() for b in w.top_buttons.values()), 1)
            self.assertIs(w.stack.currentWidget(), w.pages[key][0])
        w.stack.fade.stop()
        w.stack.finish()
        QTest.mouseClick(w.maximize_button, ui.Qt.MouseButton.LeftButton)
        self.application.processEvents()
        self.assertTrue(w.isMaximized())
        self.assertEqual(w.maximize_button.accessibleName(), '还原')
        QTest.mouseClick(w.maximize_button, ui.Qt.MouseButton.LeftButton)
        self.application.processEvents()
        self.assertFalse(w.isMaximized())
        QTest.mouseClick(w.minimize_button, ui.Qt.MouseButton.LeftButton)
        self.assertTrue(w.isMinimized())
        w.showNormal()
        QTest.mouseClick(w.close_button, ui.Qt.MouseButton.LeftButton)
        self.assertTrue(w.stop_event.is_set())
        self.assertFalse(w.isVisible())

    def test_titlebar_navigation_does_not_overlap_window_controls(self):
        w = self.window
        w.resize(1020, 720)
        w.show()
        self.application.processEvents()
        last_tab = w.top_buttons['settings']
        self.assertLess(last_tab.geometry().right(), w.minimize_button.geometry().left())
        self.assertGreater(w.top_buttons['courses'].geometry().left(), 170)

    def test_window_corners_and_caption_button_proportions(self):
        w = self.window
        w.show()
        self.application.processEvents()
        self.assertFalse(w.mask().isEmpty())
        self.assertFalse(w.mask().contains(ui.QPointF(0, 0).toPoint()))
        self.assertTrue(w.mask().contains(w.rect().center()))
        for control in [w.minimize_button, w.maximize_button, w.close_button]:
            self.assertEqual(control.size(), ui.QSize(40, 40))
            self.assertEqual(control.iconSize(), ui.QSize(24, 24))
        w.showMaximized()
        self.application.processEvents()
        self.assertTrue(w.mask().isEmpty())
        w.showNormal()
        self.application.processEvents()
        self.assertFalse(w.mask().isEmpty())

    def test_reference_motion_staggers_cards_and_sidebar_finishes_first(self):
        w = self.window
        w.show()
        self.application.processEvents()
        w.show_page('settings')
        layer = w.stack.overlay
        self.assertIsNotNone(layer.old)
        self.assertGreater(len(layer.bands), 2)
        layer.progress = .35
        first_offset, first_alpha = layer.band_state(0)
        last_offset, last_alpha = layer.band_state(len(layer.bands) - 1)
        self.assertGreater(first_offset, last_offset)
        self.assertGreater(first_alpha, last_alpha)
        self.assertEqual(w.side_stack.axis, 'left')
        self.assertEqual(w.stack.axis, 'right')
        w.motion_switch.setChecked(True)
        self.assertIsNone(w.stack.overlay)
        self.assertIsNone(w.side_stack.overlay)

    def test_sidebar_snapshot_background_stays_white_under_dark_palette(self):
        old_palette = self.application.palette()
        dark = ui.QPalette(old_palette)
        dark.setColor(ui.QPalette.ColorRole.Window, ui.QColor('#101010'))
        dark.setColor(ui.QPalette.ColorRole.Base, ui.QColor('#101010'))
        self.application.setPalette(dark)
        self.addCleanup(lambda: self.application.setPalette(old_palette))
        w = self.window
        w.show()
        self.application.processEvents()
        for page in ['accounts', 'api', 'settings', 'courses']:
            w.show_page(page)
            layer = w.side_stack.overlay
            self.assertIsNotNone(layer)
            for pixmap in (layer.pixmap, layer.old):
                frame = pixmap.toImage()
                self.assertFalse(frame.hasAlphaChannel())
                # Empty left/right margins of the heading must retain the white pane.
                scale = pixmap.devicePixelRatio()
                for y in (5, 10, 17, 23, 30):
                    self.assertEqual(frame.pixelColor(round(2*scale), round(y*scale)).name(), '#ffffff')
            for progress in (0, .05, .12, .25, .5, .9):
                w.side_stack.frame(progress)
                self.application.processEvents()
                frame = layer.grab().toImage()
                # Horizontal entry may carry the pale selected-row fill into this
                # margin; reject dark backing rather than requiring pure white.
                sample = frame.pixelColor(2, 10)
                self.assertGreaterEqual(min(sample.red(), sample.green(), sample.blue()), 220)
                self.assertEqual(frame.pixelColor(frame.width()-2, frame.height()-2).name(), '#ffffff')

    def test_source_motion_distinct_axes_stagger_and_settling(self):
        model = ui.motion
        self.assertEqual(model.entrance(140, 0, 'left'), (-25, 0, 0))
        self.assertEqual(model.entrance(140, 0, 'right'), (0, -16, 0))
        self.assertEqual(model.entrance(164, 1, 'right')[2], 0)
        self.assertEqual(model.entrance(240, 0, 'right')[2], 1)
        self.assertEqual(model.entrance(490, 0, 'right'), (0, 0, 1))
        self.assertEqual(model.entrance(440, 0, 'left'), (0, 0, 1))
        # Preserve PCL's gentle overshoot, while settling exactly at the final position.
        self.assertTrue(any(model.entrance(t, 0, 'right')[1] > 0 for t in range(300, 450)))
        self.assertTrue(any(model.entrance(t, 0, 'left')[0] > 0 for t in range(300, 420)))
        for axis in ('left', 'right'):
            for t in range(0, 800, 5):
                x, y, alpha = model.entrance(t, 3, axis)
                self.assertTrue(0 <= alpha <= 1)
                self.assertLessEqual(max(x, y), 5)
            self.assertEqual(model.exit_state(110, 0, 5, axis)[2], 0)

    def test_button_press_feedback_preserves_geometry_and_reduced_motion(self):
        w = self.window
        w.show()
        self.application.processEvents()
        b = w.all_button
        before = b.geometry()
        QTest.mousePress(b, ui.Qt.MouseButton.LeftButton)
        QTest.qWait(110)
        self.assertLess(b.visual_scale, 1)
        self.assertEqual(before, b.geometry())
        QTest.mouseRelease(b, ui.Qt.MouseButton.LeftButton)
        QTest.qWait(350)
        self.assertAlmostEqual(b.visual_scale, 1)
        w.motion_switch.setChecked(True)
        QTest.mousePress(b, ui.Qt.MouseButton.LeftButton)
        self.assertEqual(b.visual_scale, 1)
        QTest.mouseRelease(b, ui.Qt.MouseButton.LeftButton)

    def finish_login_workers(self):
        for _ in range(4):
            for thread in list(self.window.threads):
                thread.join(2)
            self.window.poll()
            if not self.window.logging_in:
                break

    def test_save_account_attempts_hidden_login_and_reports_password_error(self):
        w = self.window
        user, password = w.account_fields['chaoxing']
        user.setText('test-user')
        password.setText('test-secret')
        with patch.object(ui.accounts, 'save_account') as saved, patch.object(ui.browser_link, 'login_account', return_value={'status':'invalid_credentials'}) as login, patch.object(ui.browser_link, 'open_url') as opened:
            w.save_account('chaoxing')
            self.assertTrue(w.logging_in)
            self.assertEqual(w.account_login_badges['chaoxing'].text(), '正在验证登录…')
            self.assertFalse(w.scan_button.isEnabled())
            self.assertFalse(user.isEnabled())
            self.finish_login_workers()
            saved.assert_called_once()
            self.assertFalse(login.call_args.kwargs['visible'])
            opened.assert_not_called()
            self.assertIn('密码错误', w.account_notes['chaoxing'].text())
            self.assertEqual(w.account_login_badges['chaoxing'].text(), '登录失败')
            self.assertFalse(w.logging_in)
            self.assertTrue(user.isEnabled())

    def test_captcha_opens_manual_login_only_after_hidden_worker_finishes(self):
        w = self.window
        with patch.object(ui.browser_link, 'login_account', side_effect=[{'status':'captcha'}, {'status':'captcha'}]) as login:
            w.start_account_login()
            self.finish_login_workers()
            self.assertEqual(login.call_count, 2)
            self.assertFalse(login.call_args_list[0].kwargs['visible'])
            self.assertTrue(login.call_args_list[1].kwargs['visible'])
            self.assertIn('验证码', w.account_notes['chaoxing'].text())
            self.assertFalse(w.account_verify_buttons['chaoxing'].isHidden())
        with patch.object(ui.browser_link, 'login_account', return_value={'status':'success'}) as login:
            w.start_account_login(check_only=True)
            self.finish_login_workers()
            self.assertTrue(login.call_args.kwargs['check_only'])
            self.assertEqual(w.account_notes['chaoxing'].text(), '登录成功')
            self.assertEqual(w.account_login_badges['chaoxing'].text(), '登录成功')
            with patch.object(w, 'run_worker'):
                w.start_scan()
                self.assertEqual(w.account_login_badges['chaoxing'].text(), '登录成功')
            w.account_edited('chaoxing')
            self.assertEqual(w.account_login_badges['chaoxing'].text(), '未验证')

    def test_login_error_recovers_and_blocks_concurrent_scan(self):
        w = self.window
        with patch.object(ui.browser_link, 'login_account', side_effect=RuntimeError('offline')):
            w.start_account_login()
            w.start_scan()
            self.assertFalse(w.scanning)
            self.finish_login_workers()
            self.assertFalse(w.logging_in)
            self.assertTrue(w.account_save_buttons['chaoxing'].isEnabled())
            self.assertIn('登录失败', w.account_notes['chaoxing'].text())

    def test_mooc_save_logs_in_and_remembers_success(self):
        w = self.window
        with patch.object(ui.accounts, 'save_account'), patch.object(ui.browser_link, 'login_account', return_value={'status': 'success'}) as login:
            w.save_account('mooc')
            self.assertEqual(w.account_login_badges['mooc'].text(), '正在验证登录…')
            self.finish_login_workers()
            self.assertEqual(login.call_args.kwargs['platform'], 'mooc')
            self.assertEqual(w.account_login_badges['mooc'].text(), '登录成功')
            ui.accounts.set_verified.assert_called_with('mooc', True, w.login_account_snapshot)
            w.save_account('mooc')
            self.assertEqual(login.call_count, 1)
            w.account_edited('mooc')
            self.assertEqual(w.account_login_badges['mooc'].text(), '未验证')
            ui.accounts.set_verified.assert_called_with('mooc', False)

    def test_saved_verified_account_restores_badge_on_restart(self):
        with patch.object(ui.accounts, 'load_account', return_value=ui.accounts.Account('u', 'p', True)):
            other = ui.Window(auto_start=False)
        try:
            for platform in ui.accounts.PLATFORMS:
                self.assertEqual(other.account_login_badges[platform].text(), '登录成功')
        finally:
            other.close()
            other.deleteLater()

    def test_mooc_web_login_opens_visible_credential_flow(self):
        w = self.window
        w.account_fields['mooc'][0].setText('test@example.com')
        w.account_fields['mooc'][1].setText('test-secret')
        w.account_verified['mooc'] = True
        with patch.object(ui.accounts, 'save_account') as saved, patch.object(ui.browser_link, 'login_account', return_value={'status': 'success'}) as login, patch.object(w, 'open_link') as plain_open:
            w.open_account_login('mooc')
            self.finish_login_workers()
            saved.assert_called_once()
            self.assertEqual(saved.call_args.args[0], 'mooc')
            self.assertEqual(login.call_args.kwargs['platform'], 'mooc')
            self.assertTrue(login.call_args.kwargs['visible'])
            plain_open.assert_not_called()

    def test_blank_account_can_login_in_web_without_saving_credentials(self):
        w = self.window
        for platform in ('chaoxing', 'mooc'):
            with patch.object(ui.accounts, 'save_account') as saved, \
                 patch.object(ui.accounts, 'set_verified') as verified, \
                 patch.object(ui.browser_link, 'login_account', return_value={'status': 'success'}) as login:
                w.open_account_login(platform)
                self.assertFalse(w.account_web_buttons[platform].isEnabled())
                self.finish_login_workers()
                self.assertTrue(login.call_args.kwargs['manual'])
                self.assertTrue(login.call_args.kwargs['visible'])
                self.assertEqual(login.call_args.kwargs['platform'], platform)
                saved.assert_not_called()
                verified.assert_not_called()
                self.assertEqual(w.account_login_badges[platform].text(), '登录成功')
                self.assertIn('保留在本机', w.account_notes[platform].text())
                self.assertEqual(w.account_fields[platform][0].account_text(), '')
                self.assertTrue(w.account_web_buttons[platform].isEnabled())

    def test_web_window_launch_failure_restores_buttons_and_shows_cause(self):
        w = self.window
        with patch.object(ui.browser_link, 'login_account', side_effect=RuntimeError('无法连接课程浏览器。')):
            w.open_account_login('chaoxing')
            self.assertEqual(w.account_notes['chaoxing'].text(), '正在启动网页登录窗口…')
            self.finish_login_workers()
            self.assertFalse(w.logging_in)
            self.assertTrue(w.account_web_buttons['chaoxing'].isEnabled())
            self.assertEqual(w.account_notes['chaoxing'].text(), '无法连接课程浏览器。')

    def test_mooc_error_reports_failed_step(self):
        w = self.window
        with patch.object(ui.browser_link, 'login_account', return_value={'status': 'error', 'reason': 'select_mode'}):
            w.start_account_login(platform='mooc')
            self.finish_login_workers()
        self.assertIn('切换 MOOC 登录方式', w.account_notes['mooc'].text())
        self.assertEqual(w.account_login_badges['mooc'].text(), '登录失败')

    def test_large_text_and_removed_heading_subtitle(self):
        labels = [item.text() for item in self.window.findChildren(ui.QLabel)]
        self.assertNotIn('检查课程进度，按剩余量安排待办。', labels)
        self.assertNotIn('账号密码在本机加密保存，不会发送给答题 API。', labels)
        self.assertEqual(self.window.title_bar.height(), 56)

    def test_columns_fit_unknown_values_and_timestamp_and_allow_manual_width(self):
        w = self.window
        w.show()
        self.application.processEvents()
        for col, text in [(2,'未量化'), (3,'未识别'), (4,'未识别'), (7,'2026-10-17 13:44')]:
            w.table.setItem(0, col, ui.QTableWidgetItem(text))
        w.table.horizontalHeaderItem(2).setText('进行中')
        w.table.update_content_widths()
        for col in (2, 3, 4, 7):
            text = w.table.item(0, col).text()
            self.assertGreaterEqual(w.table.columnWidth(col), w.table.fontMetrics().horizontalAdvance(text) + 28)
        wider = w.table.columnWidth(4) + 40
        w.table.horizontalHeader().resizeSection(4, wider)
        self.application.processEvents()
        w.refresh()
        self.assertEqual(w.table.columnWidth(4), wider)

    def test_small_window_scrolls_table_instead_of_crushing_columns(self):
        w = self.window
        w.resize(1020, 720)
        w.show()
        self.application.processEvents()
        w.table.update_content_widths()
        self.assertGreaterEqual(w.table.columnWidth(1), 240)
        self.assertGreaterEqual(w.table.columnWidth(4), 84)
        self.assertGreater(w.table.horizontalScrollBar().maximum(), 0)
        w.resize(1600, 950)
        self.application.processEvents()
        self.assertEqual(w.table.horizontalScrollBar().maximum(), 0)

    def test_action_button_border_is_visible_on_all_four_sides(self):
        w = self.window
        w.show()
        w.scanning = True
        w.update_controls()
        w.stop_button.setFocus()
        self.application.processEvents()
        frame = w.stop_button.grab().toImage()
        width, height = frame.width(), frame.height()
        depth = max(5, round(5*w.stop_button.devicePixelRatioF()))
        blue = lambda color: color.blue() > color.red()+35 and color.blue() > color.green()+5
        strips = [[frame.pixelColor(width//2,y) for y in range(depth)],
                  [frame.pixelColor(width//2,height-1-y) for y in range(depth)],
                  [frame.pixelColor(x,height//2) for x in range(depth)],
                  [frame.pixelColor(width-1-x,height//2) for x in range(depth)]]
        for strip in strips:
            self.assertTrue(any(blue(color) for color in strip))
        w.stop_button.grab().save(str(Path(__file__).resolve().parents[1]/'.test-artifacts/button-border.png'))

    def test_busy_sweep_lifecycle_seam_and_reduced_motion(self):
        w = self.window
        w.show()
        w.scanning = True
        w.update_controls()
        self.application.processEvents()
        indicator = w.busy
        self.assertEqual(indicator.animation.state(), ui.QVariantAnimation.State.Running)
        indicator.animation.stop()
        indicator.frame(0)
        start = indicator.grab().toImage()
        indicator.frame(1)
        end = indicator.grab().toImage()
        self.assertEqual(start, end)
        indicator.frame(.5)
        self.assertNotEqual(start, indicator.grab().toImage())
        w.motion_switch.setChecked(True)
        self.assertEqual(indicator.animation.state(), ui.QVariantAnimation.State.Stopped)
        self.assertEqual(indicator.phase, .5)
        w.scanning = False
        w.update_controls()
        self.assertTrue(indicator.isHidden())


def json_load(path):
    import json
    return json.loads(path.read_text())
