import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from api_client import APIConfig, AnswerProvider, ProviderError
import settings


class Handler(BaseHTTPRequestHandler):
    status = 200
    content = {"choices": [{"message": {"content": "OK"}}]}
    received = None

    def do_POST(self):
        Handler.received = (self.path, self.headers.get("Authorization"),
                            json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(Handler.status)
        if Handler.status == 302:
            self.send_header("Location", "http://127.0.0.1:1/stolen")
        self.end_headers()
        self.wfile.write(json.dumps(Handler.content).encode())

    def log_message(self, *args):
        pass


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        Handler.status = 200
        Handler.content = {"choices": [{"message": {"content": "OK"}}]}
        self.config = APIConfig(f"http://127.0.0.1:{self.server.server_port}/v1", "test-model", "test-secret")

    def test_protocol(self):
        self.assertEqual(AnswerProvider(self.config).answer("测试题", ["选项一"]), "OK")
        path, auth, body = Handler.received
        self.assertEqual(path, "/v1/chat/completions")
        self.assertEqual(auth, "Bearer test-secret")
        self.assertEqual(body["model"], "test-model")
        self.assertEqual(json.loads(body["messages"][1]["content"])["options"], ["选项一"])

    def test_missing_configuration(self):
        with self.assertRaises(ProviderError):
            AnswerProvider(APIConfig()).test_connection()

    def test_remote_plaintext_rejected(self):
        with self.assertRaises(ProviderError):
            APIConfig("http://example.com/v1", "model").endpoint()

    def test_redirect_rejected(self):
        Handler.status = 302
        with self.assertRaisesRegex(ProviderError, "重定向"):
            AnswerProvider(self.config).test_connection()

    def test_auth_failure_has_no_key(self):
        Handler.status = 401
        with self.assertRaises(ProviderError) as result:
            AnswerProvider(self.config).test_connection()
        self.assertIn("401", str(result.exception))
        self.assertNotIn("test-secret", str(result.exception))
        self.assertNotIn("test-secret", repr(self.config))

    def test_invalid_response(self):
        Handler.content = {"choices": []}
        with self.assertRaises(ProviderError):
            AnswerProvider(self.config).test_connection()

    def test_empty_answer(self):
        Handler.content = {"choices": [{"message": {"content": " "}}]}
        with self.assertRaises(ProviderError):
            AnswerProvider(self.config).test_connection()

    def test_encrypted_settings_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            with patch.object(settings, "CONFIG", path):
                settings.save(self.config)
                self.assertNotIn("test-secret", path.read_text())
                self.assertEqual(settings.load(), self.config)


if __name__ == "__main__":
    unittest.main()
