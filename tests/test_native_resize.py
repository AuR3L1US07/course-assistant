"""Windows integration checks; run with QT_QPA_PLATFORM=windows."""
import os
import sys
import ctypes
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import qt_app as ui


@unittest.skipUnless(sys.platform == 'win32' and os.environ.get('QT_QPA_PLATFORM') == 'windows', 'requires Windows native window')
class NativeResizeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.application = ui.QApplication.instance() or ui.QApplication([])
        cls.application.setStyleSheet(ui.STYLE)

    def test_system_resize_edges_restore_and_native_size_change(self):
        from ctypes import wintypes
        with patch.object(ui.accounts, 'load_account', return_value=ui.accounts.Account()), patch.object(ui.settings, 'load', return_value=ui.APIConfig()), patch.object(ui.course_store, 'rows', return_value=[]):
            w = ui.Window(auto_start=False)
        try:
            w.show()
            self.application.processEvents()
            user32 = ctypes.windll.user32
            hwnd = wintypes.HWND(int(w.winId()))
            user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
            user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            user32.SendMessageW.restype = ctypes.c_ssize_t
            self.assertTrue(user32.GetWindowLongPtrW(hwnd, -16) & 0x40000)
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            cx, cy = (rect.left+rect.right)//2, (rect.top+rect.bottom)//2
            points = [(rect.left+2,cy,10), (rect.right-2,cy,11), (cx,rect.top+2,12),
                      (cx,rect.bottom-2,15), (rect.left+2,rect.top+2,13),
                      (rect.right-2,rect.top+2,14), (rect.left+2,rect.bottom-2,16),
                      (rect.right-2,rect.bottom-2,17)]
            for x,y,expected in points:
                self.assertEqual(user32.SendMessageW(hwnd, 0x84, 0, ((y & 0xffff)<<16)|(x & 0xffff)), expected)
            old_width, old_height = rect.right-rect.left, rect.bottom-rect.top
            self.assertTrue(user32.SetWindowPos(hwnd,None,0,0,old_width+40,old_height+20,0x0016))
            self.application.processEvents()
            resized = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(resized))
            self.assertEqual(resized.right-resized.left, old_width+40)
            self.assertEqual(resized.bottom-resized.top, old_height+20)
            w.toggle_maximized()
            self.application.processEvents()
            self.assertTrue(w.isMaximized())
            w.toggle_maximized()
            self.application.processEvents()
            self.assertFalse(w.isMaximized())
            self.assertTrue(user32.GetWindowLongPtrW(hwnd, -16) & 0x40000)
            self.assertTrue(w.windowFlags() & ui.Qt.WindowType.FramelessWindowHint)
        finally:
            w.close()
            w.deleteLater()
            self.application.sendPostedEvents(None, ui.QEvent.Type.DeferredDelete)
