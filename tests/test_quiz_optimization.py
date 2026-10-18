"""Batching, validation, cancellation and accounting without paid API calls."""
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

import api_client
import browser_link


class QuizOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.log = self.enterContext(patch.object(browser_link, '_record_quiz_usage', return_value=True))
        self.enterContext(patch.object(browser_link.settings, 'load', return_value=api_client.APIConfig(
            'https://fixture.invalid/v1', 'model', 'secret')))
        self.provider = Mock(last_usage={'prompt_tokens': 120, 'completion_tokens': 10, 'total_tokens': 130})
        self.enterContext(patch.object(browser_link.api_client, 'AnswerProvider', return_value=self.provider))

    def questions(self, count):
        return [{'i': i * 2, 'type': 'single', 'stem': f'完整题目 {i}：T/4 是多少？',
                 'options': ['A 选项一', 'B 选项二', 'C 选项三']} for i in range(count)]

    def answer(self, questions, stop=None):
        return browser_link._answer_quiz({'token': 'token', 'questions': questions}, self.events.append, stop)

    def test_six_questions_per_request_and_complete_input(self):
        def respond(messages):
            batch = json.loads(messages[1]['content'])
            self.assertLessEqual(len(batch), 6)
            for question in batch:
                self.assertIn('T/4', question['stem'])
                self.assertEqual(len(question['options']), 3)
            return json.dumps({str(q['i']): 'B' for q in batch})
        self.provider.complete.side_effect = respond
        result = self.answer(self.questions(14))
        self.assertEqual(len(result['answers']), 14)
        self.assertEqual(self.provider.complete.call_count, 3)
        self.assertEqual([call.args[1] for call in self.log.call_args_list], [6, 6, 2])
        self.assertIn('390 token', self.events[-1]['message'])

    def test_partial_response_only_retries_missing_ids(self):
        self.provider.complete.side_effect = ['{"0":"A","4":"C","999":"B"}', 'B']
        result = self.answer(self.questions(3))
        self.assertEqual(result['answers'], [{'i': 0, 'choice': ['A']}, {'i': 2, 'choice': ['B']}, {'i': 4, 'choice': ['C']}])
        retry = json.loads(self.provider.complete.call_args.args[0][1]['content'])
        self.assertEqual([q['i'] for q in retry], [2])

    def test_diagrams_are_attached_to_their_question_ids(self):
        questions = self.questions(2)
        picture = 'data:image/png;base64,aW1hZ2U='
        questions[1].update(images=['https://private.invalid/diagram'], image_data=[picture])
        self.provider.complete.return_value = '{"0":"A","2":"B"}'
        self.assertEqual(len(self.answer(questions)['answers']), 2)
        content = self.provider.complete.call_args.args[0][1]['content']
        self.assertEqual(json.loads(content[0]['text'])[1]['i'], 2)
        self.assertIn('题号 2', content[1]['text'])
        self.assertEqual(content[2], {'type': 'image_url', 'image_url': {'url': picture}})
        self.assertNotIn('private.invalid', json.dumps(content))

    def test_unreadable_diagram_does_not_send_text_only_request(self):
        questions = self.questions(1)
        questions[0].update(images=['https://private.invalid/missing'], image_data=[''])
        self.assertEqual(self.answer(questions)['answers'], [])
        self.provider.complete.assert_not_called()
        self.assertTrue(any('图片读取失败' in event['message'] for event in self.events))

    def test_invalid_format_has_bounded_single_question_fallback(self):
        self.provider.complete.side_effect = ['Answer A, explanation B', 'A', 'C']
        self.assertEqual(len(self.answer(self.questions(2))['answers']), 2)
        self.assertEqual(self.provider.complete.call_count, 3)

    def test_strict_answer_parser(self):
        questions = self.questions(2)
        questions[1]['type'] = 'multiple'
        for text in ('{"0":"AB","2":"Z"}', '{"0":"A","0":"B"}',
                     'Here is A and B.', '{"0":["A"],"2":"AA"}'):
            self.assertEqual(browser_link._parse_quiz_batch(text, questions), {})
        self.assertEqual(browser_link._parse_quiz_batch('```json\n{"0":"A","2":"CA"}\n```', questions),
                         {0: ['A'], 2: ['A', 'C']})
        self.assertEqual(browser_link._parse_quiz_batch('Answer: A', questions[:1]), {})

    def test_provider_error_does_not_fan_out_into_more_requests(self):
        self.provider.complete.side_effect = api_client.ProviderError('额度不足')
        self.provider.last_usage = None
        self.assertEqual(self.answer(self.questions(14))['answers'], [])
        self.assertEqual(self.provider.complete.call_count, 1)
        self.assertIn('未返回', self.events[-1]['message'])
        self.assertIsNone(self.log.call_args.args[2])

    def test_stop_prevents_followup_batches_and_fallbacks(self):
        stop = threading.Event()
        def respond(messages):
            stop.set()
            return '{}'
        self.provider.complete.side_effect = respond
        self.assertEqual(self.answer(self.questions(14), stop)['answers'], [])
        self.assertEqual(self.provider.complete.call_count, 1)

    def test_usage_log_contains_counters_not_question_or_key(self):
        # Call the real writer through a separate reference saved below.
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.test-artifacts') as folder:
            with patch.object(browser_link.settings, 'ROOT', Path(folder)):
                self.assertTrue(REAL_USAGE_WRITER(api_client.APIConfig('https://fixture.invalid', 'model', 'top-secret'),
                                                4, {'total_tokens': 321}, True))
            data = (Path(folder) / 'data/ai-usage.jsonl').read_text(encoding='utf-8')
            self.assertNotIn('top-secret', data)
            self.assertNotIn('options', data)
            self.assertEqual(json.loads(data)['usage']['total_tokens'], 321)

    def test_worker_session_cache(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([str(root / '.runtime/node.exe'), str(root / 'tests/test_quiz_cache.cjs')], check=True)


REAL_USAGE_WRITER = browser_link._record_quiz_usage


class UsageResponseTests(unittest.TestCase):
    def test_usage_survives_rejected_answer_and_resets_on_next_response(self):
        provider = api_client.AnswerProvider(api_client.APIConfig('https://fixture.invalid', 'model', 'key'))
        responses = [
            {'usage': {'prompt_tokens': 50, 'completion_tokens': 30,
                       'prompt_tokens_details': {'cached_tokens': 20},
                       'completion_tokens_details': {'reasoning_tokens': 25}},
             'choices': [{'finish_reason': 'length', 'message': {'content': 'partial'}}]},
            {'choices': [{'message': {'content': 'A'}}]},
            {'usage': {'total_tokens': -1, 'completion_tokens': True},
             'choices': [{'message': {'content': 'A'}}]},
        ]
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(json.dumps(r).encode()) for r in responses]
        with patch('api_client.urllib.request.build_opener', return_value=opener):
            with self.assertRaises(api_client.ProviderError):
                provider.complete([])
            self.assertEqual(provider.last_usage, {'prompt_tokens': 50, 'completion_tokens': 30,
                                                  'total_tokens': 80, 'cached_tokens': 20, 'reasoning_tokens': 25})
            provider.complete([])
            self.assertIsNone(provider.last_usage)
            provider.complete([])
            self.assertIsNone(provider.last_usage)
