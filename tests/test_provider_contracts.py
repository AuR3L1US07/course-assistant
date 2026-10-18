"""Request/response contract checks using mocked transport, never paid API calls."""
import io
import json
import unittest
from unittest.mock import Mock, patch

from api_client import APIConfig, AnswerProvider, ProviderError
from model_catalog import PROVIDERS


class ProviderContractTests(unittest.TestCase):
    def run_response(self, config, response):
        opener = Mock()
        opener.open.return_value = io.BytesIO(json.dumps(response).encode())
        with patch('api_client.urllib.request.build_opener', return_value=opener):
            result = AnswerProvider(config).answer('1+1 等于多少？', ['2', '3'])
        return result, opener.open.call_args

    def test_all_catalog_models_send_minimal_official_chat_contract(self):
        for name, base, models in PROVIDERS:
            for model in models:
                with self.subTest(provider=name, model=model):
                    config = APIConfig(base, model, 'test-key', 300)
                    result, call = self.run_response(config, {
                        'choices': [{'finish_reason': 'stop', 'message': {
                            'content': '答案：2', 'reasoning_content': 'not the answer'}}]})
                    request = call.args[0]
                    self.assertEqual(request.full_url, base + '/chat/completions')
                    self.assertEqual(request.get_method(), 'POST')
                    self.assertEqual(request.get_header('Authorization'), 'Bearer test-key')
                    self.assertEqual(request.get_header('Content-type'), 'application/json')
                    body = json.loads(request.data)
                    self.assertEqual(set(body), {'model', 'messages', 'stream'})
                    self.assertEqual(body['model'], model)
                    self.assertFalse(body['stream'])
                    self.assertEqual([m['role'] for m in body['messages']], ['system', 'user'])
                    self.assertEqual(json.loads(body['messages'][1]['content'])['options'], ['2', '3'])
                    self.assertEqual(call.kwargs['timeout'], 300)
                    self.assertEqual(result, '答案：2')

    def test_missing_remote_key_stops_before_network(self):
        with patch('api_client.urllib.request.build_opener') as transport:
            with self.assertRaisesRegex(ProviderError, '密钥'):
                AnswerProvider(APIConfig(PROVIDERS[0][1], PROVIDERS[0][2][0])).test_connection()
            transport.assert_not_called()

    def test_rejects_header_newlines(self):
        with patch('api_client.urllib.request.build_opener') as transport:
            with self.assertRaisesRegex(ProviderError, '换行'):
                AnswerProvider(APIConfig(PROVIDERS[0][1], 'model', 'key\r\ninjected')).test_connection()
            transport.assert_not_called()

    def test_incomplete_refused_filtered_and_tool_results_are_not_answers(self):
        responses = [
            ({'finish_reason': 'length', 'message': {'content': 'partial'}}, '不完整'),
            ({'finish_reason': 'content_filter', 'message': {'content': None}}, '过滤'),
            ({'finish_reason': 'stop', 'message': {'content': None, 'refusal': 'refused'}}, '拒绝'),
            ({'finish_reason': 'tool_calls', 'message': {'content': 'preface', 'tool_calls': [{}]}}, '工具调用'),
            ({'finish_reason': 'stop', 'message': {'content': None, 'reasoning_content': 'internal'}}, '没有返回文本'),
        ]
        for choice, expected in responses:
            with self.subTest(choice=choice):
                with self.assertRaisesRegex(ProviderError, expected):
                    self.run_response(APIConfig(PROVIDERS[0][1], 'model', 'key'), {'choices': [choice]})

    def test_endpoint_and_long_reasoning_timeout(self):
        url = PROVIDERS[0][1] + '/chat/completions'
        self.assertEqual(APIConfig(url + '/', 'model', timeout=3600).endpoint(), url)
        for timeout in (4, 3601):
            with self.assertRaises(ProviderError):
                APIConfig(url, 'model', timeout=timeout).endpoint()
