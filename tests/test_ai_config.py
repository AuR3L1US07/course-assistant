"""AI provider selection and reserved help-link behavior; no external requests."""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
import qt_app as ui


class AIConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = ui.QApplication.instance() or ui.QApplication([])

    def setUp(self):
        with patch.object(ui.settings, 'load', return_value=ui.APIConfig(
                'https://custom.example/v1', 'custom-model', 'old-key')):
            self.window = ui.Window(auto_start=False)

    def tearDown(self):
        self.window.close()
        self.window.deleteLater()
        self.app.sendPostedEvents(None, ui.QEvent.Type.DeferredDelete)

    def test_existing_custom_configuration_survives(self):
        self.assertEqual(self.window.api_config(), ui.APIConfig(
            'https://custom.example/v1', 'custom-model', 'old-key'))

    def test_provider_switch_updates_endpoint_and_clears_foreign_key(self):
        self.window.api_provider.setCurrentIndex(1)
        config = self.window.api_config()
        self.assertEqual(config.endpoint(), 'https://api.deepseek.com/chat/completions')
        self.assertTrue(self.window.api_fields['base_url'].isReadOnly())
        self.assertEqual(config.model, 'deepseek-v4-flash')
        self.assertEqual(config.api_key, '')
        self.assertFalse(self.window.api_fields['model'].isEditable())
        self.window.api_fields['model'].setCurrentIndex(1)
        self.assertEqual(self.window.api_config().model, 'deepseek-v4-pro')
        self.window.api_provider.setCurrentIndex(-1)
        self.assertTrue(self.window.api_fields['model'].isEditable())
        self.window.api_fields['model'].setEditText('future-model')
        self.assertEqual(self.window.api_config().model, 'future-model')

    def test_model_field_click_opens_choices(self):
        from PySide6.QtTest import QTest
        self.window.api_provider.setCurrentIndex(0)
        self.window.stack.animate = False
        self.window.side_stack.animate = False
        self.window.show_page('api')
        self.window.show()
        self.app.processEvents()
        model = self.window.api_fields['model']
        QTest.mouseClick(model, ui.Qt.MouseButton.LeftButton, pos=model.rect().center())
        self.app.processEvents()
        self.assertTrue(model.view().isVisible())
        model.hidePopup()

    def test_unconfigured_help_shows_placeholder(self):
        with patch.object(ui.QMessageBox, 'information') as info, patch.object(self.window, 'open_link') as link:
            self.window.api_help_button.click()
            info.assert_called_once()
            link.assert_not_called()

    def test_configured_help_opens_reserved_url(self):
        with patch.object(ui, 'AI_HELP_URL', 'https://example.com/help'), patch.object(self.window, 'open_link') as link:
            self.window.api_help_button.click()
            link.assert_called_once_with('https://example.com/help')
