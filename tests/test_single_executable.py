"""Frozen resources are disposable; AppData state survives executable updates."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import browser_link
import launcher
import settings


class SingleExecutableTests(unittest.TestCase):
    def test_frozen_paths_separate_resources_from_persistent_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            with patch.object(sys, 'frozen', True, create=True), patch.object(sys, '_MEIPASS', str(base / 'unpacked'), create=True), patch.dict(os.environ, {'LOCALAPPDATA': str(base / 'local')}):
                values = runpy.run_path(str(Path(settings.__file__)))
                self.assertEqual(values['ROOT'], base / 'local' / 'CourseAssistant')
                self.assertEqual(values['CONFIG'], base / 'local' / 'CourseAssistant' / 'data' / 'settings.json')
                self.assertEqual(values['RESOURCE_ROOT'], base / 'unpacked')

    def test_worker_uses_embedded_resources_when_data_is_elsewhere(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            resources = base / 'unpacked'
            (resources / '.runtime/playwright-core').mkdir(parents=True)
            (resources / '.runtime/node.exe').touch()
            (resources / '.runtime/playwright-core/package.json').write_text('{}')
            with patch.object(settings, 'ROOT', base / 'local'), patch.object(settings, 'RESOURCE_ROOT', resources):
                args = browser_link.command('scan', address='background')
                self.assertEqual(Path(args[0]), resources / '.runtime/node.exe')
                self.assertEqual(Path(args[1]), resources / 'browser_worker.cjs')

    def test_question_bank_persists_in_user_data_not_resource_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary) / 'local' / 'data'
            worker = Path(__file__).resolve().parents[1] / 'browser_worker.cjs'
            code = r'''
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const filename=process.argv[1],data=process.argv[2];
function load(){const c=vm.createContext({require:createRequire(filename),module:{exports:{}},
__filename:filename,__dirname:path.dirname(filename),Buffer,console,process:{env:{COURSE_ASSISTANT_DATA_ROOT:data}},
setTimeout,clearTimeout,setInterval,clearInterval});vm.runInContext(fs.readFileSync(filename,'utf8'),c);return c;}
vm.runInContext("bankImport([{stem:'packing fixture question',correct:'A'}])",load());
if(vm.runInContext("bankLookup('packing fixture question')",load())!=='A')throw Error('Persistent cache lost');
'''
            subprocess.run([str(worker.parent / '.runtime/node.exe'), '-e', code, str(worker), str(data)], check=True)
            self.assertTrue((data / 'quiz_bank.json').is_file())

    def test_launcher_checks_all_embedded_worker_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            missing = launcher._check_runtime(Path(temporary))
            self.assertIn('yuketang_worker.cjs', missing)
            self.assertIn('cx_font_map.json', missing)


if __name__ == '__main__':
    unittest.main()
