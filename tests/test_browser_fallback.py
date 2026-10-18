import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import browser_link

class BrowserFallbackTests(unittest.TestCase):
    def test_chrome_priority_and_edge_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            edge=root/'system/Microsoft/Edge/Application/msedge.exe'
            chrome=root/'user/Google/Chrome/Application/chrome.exe'
            edge.parent.mkdir(parents=True); edge.touch()
            chrome.parent.mkdir(parents=True); chrome.touch()
            with patch.dict(os.environ,{'PROGRAMFILES':str(root/'system'),'PROGRAMFILES(X86)':str(root/'x86'),'LOCALAPPDATA':str(root/'user')},clear=True):
                self.assertEqual(browser_link.find_browser(),chrome)
                chrome.unlink()
                self.assertEqual(browser_link.find_browser(),edge)
                edge.unlink()
                with self.assertRaisesRegex(RuntimeError,'Chrome.*Edge'):
                    browser_link.find_browser()

    def test_edge_user_install_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            edge=root/'Microsoft/Edge/Application/msedge.exe'
            edge.parent.mkdir(parents=True); edge.touch()
            with patch.dict(os.environ,{'LOCALAPPDATA':str(root)},clear=True):
                self.assertEqual(browser_link.find_browser(),edge)

    def test_visible_login_starts_selected_edge(self):
        with tempfile.TemporaryDirectory() as directory:
            edge=Path(directory)/'msedge.exe'
            with patch.object(browser_link,'find_browser',return_value=edge), \
                 patch.object(browser_link,'PROFILE',Path(directory)/'profile'), \
                 patch.object(browser_link,'endpoint',side_effect=[None,'http://127.0.0.1:12345']), \
                 patch.object(browser_link.subprocess,'Popen') as launched:
                self.assertEqual(browser_link.ensure_browser(),'http://127.0.0.1:12345')
                self.assertEqual(launched.call_args.args[0][0],str(edge))

if __name__=='__main__': unittest.main()
