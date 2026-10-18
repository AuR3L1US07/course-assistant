import os
os.environ['QT_QPA_PLATFORM']='offscreen'
import unittest
from unittest.mock import patch
import qt_app as ui
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication, QDialog, QDialogButtonBox
import browser_link
import json

class BrushOptionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])
        for name in ('msyh.ttc', 'msyhbd.ttc'):
            ui.QFontDatabase.addApplicationFont('C:/Windows/Fonts/' + name)
        cls.app.setStyle('Fusion')
        cls.app.setStyleSheet(ui.STYLE)
    def choose(self, values=None, cancel=False):
        def interact():
            dialog=self.app.activeModalWidget()
            self.assertIsInstance(dialog,QDialog)
            checks={key:dialog.findChild(ui.PlainCheckBox,'brush_option_'+key) for key in ('materials','quiz','exam')}
            self.assertTrue(all(c.isChecked() for c in checks.values()))
            dialog.grab().save(str(ui.ROOT / '.test-artifacts' / 'brush-options.png'))
            if cancel:
                dialog.reject();return
            for c in checks.values(): c.setChecked(False)
            start=dialog.findChild(QDialogButtonBox).button(QDialogButtonBox.Ok)
            self.assertFalse(start.isEnabled())
            for key in values or checks: checks[key].setChecked(True)
            self.assertTrue(start.isEnabled())
            dialog.accept()
        QTimer.singleShot(0,interact)
        return ui.Window.brush_options_dialog(ui.QWidget())
    def test_defaults_and_selection(self):
        self.assertEqual(self.choose(),dict(materials=True,quiz=True,exam=True))
        self.assertEqual(self.choose(['quiz']),dict(materials=False,quiz=True,exam=False))
    def test_cancel(self):
        self.assertIsNone(self.choose(cancel=True))
    def test_yuketang_options_reserve_exam_and_allow_video_or_exercises(self):
        window=ui.QWidget()
        window.platform='yuketang'
        def interact():
            dialog=self.app.activeModalWidget()
            exam=dialog.findChild(ui.PlainCheckBox,'brush_option_exam')
            self.assertFalse(exam.isEnabled())
            self.assertFalse(exam.isChecked())
            dialog.findChild(ui.PlainCheckBox,'brush_option_materials').setChecked(False)
            dialog.grab().save(str(ui.ROOT / '.test-artifacts/yuketang-brush-options.png'))
            dialog.accept()
        QTimer.singleShot(0,interact)
        self.assertEqual(ui.Window.brush_options_dialog(window),dict(materials=False,quiz=True,exam=False))
    def test_command_options(self):
        with patch.object(browser_link,'endpoint',return_value='http://localhost:9222'):
            args=browser_link.command('brush','https://example.com',address='http://localhost:9222',task_options={'materials':False,'quiz':True,'exam':False})
        self.assertEqual(json.loads(args[-1]),dict(materials=False,quiz=True,exam=False))

if __name__=='__main__': unittest.main()

