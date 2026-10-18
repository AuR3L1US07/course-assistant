"""PCL-inspired native desktop front end; the existing Python services own data."""
import json
import math
import queue
import sys
import threading
import uuid
from pathlib import Path

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.runtime' / 'python-libs'))

from PySide6.QtCore import Qt, QEvent, QRectF, QPointF, QSize, QTimer, QVariantAnimation, QEasingCurve
from PySide6.QtGui import QColor, QPainter, QPainterPath, QRegion, QPen, QFont, QFontDatabase, QIcon, QPixmap, QPalette, QLinearGradient
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QFrame, QLabel, QPushButton, QAbstractButton,
    QHBoxLayout, QVBoxLayout, QGridLayout, QStackedWidget, QScrollArea,
    QLineEdit, QComboBox, QListView, QCheckBox, QSpinBox, QTableWidget, QTableWidgetItem,
    QHeaderView, QAbstractItemView, QStyledItemDelegate, QStyle,
    QProgressBar, QMessageBox, QDialog, QDialogButtonBox, QFormLayout, QStyleOptionButton,
    QSizePolicy,
)

import accounts
import settings
import course_store
import browser_link
import ui_motion as motion
from api_client import APIConfig, AnswerProvider
from model_catalog import PROVIDERS, AI_HELP_URL

BLUE = '#1675c9'
INK = '#263b50'
MUTED = '#718297'

# Original vector paths, rendered at the screen's pixel density.
PATHS = {
    'book': 'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z M12 6v15',
    'user': 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
    'key': 'M14 5a5 5 0 1 1-4 8L3 20H1v-3l7-7a5 5 0 0 1 6-5 M15 8h.01',
    'settings': 'M9.206 5.256L10.234 4.917L10.264 2.152L13.736 2.152L13.766 4.917L14.794 5.256L14.794 5.256L15.760 5.743L17.736 3.808L20.192 6.264L18.257 8.240L18.744 9.206L18.744 9.206L19.083 10.234L21.848 10.264L21.848 13.736L19.083 13.766L18.744 14.794L18.744 14.794L18.257 15.760L20.192 17.736L17.736 20.192L15.760 18.257L14.794 18.744L14.794 18.744L13.766 19.083L13.736 21.848L10.264 21.848L10.234 19.083L9.206 18.744L9.206 18.744L8.240 18.257L6.264 20.192L3.808 17.736L5.743 15.760L5.256 14.794L5.256 14.794L4.917 13.766L2.152 13.736L2.152 10.264L4.917 10.234L5.256 9.206L5.256 9.206L5.743 8.240L3.808 6.264L6.264 3.808L8.240 5.743L9.206 5.256Z M15.2 12a3.2 3.2 0 1 0-6.4 0a3.2 3.2 0 1 0 6.4 0',
    'refresh': 'M20 10a8 8 0 0 0-14-5L3 8 M3 3v5h5 M4 14a8 8 0 0 0 14 5l3-3 M21 21v-5h-5',
    'arrow': 'M5 12h14 M14 7l5 5-5 5',
    'play': 'M8 4l12 8-12 8z',
    'stop': 'M6 6h12v12H6z',
    'globe': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 5-5 13 0 18 5-5 5-13 0-18',
    'check': 'M5 12l4 4L19 6',
    'clock': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2',
    'shield': 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6',
    'search': 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6',
    'minimize': 'M4 12h16',
    'maximize': 'M5 5h14v14H5z',
    'restore': 'M8 5V3h13v13h-2 M3 8h13v13H3z',
    'close': 'M5 5l14 14 M19 5L5 19',
}


def icon(name, color=BLUE, size=20):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
           f'<path d="{PATHS.get(name, "")}" fill="none" stroke="{color}" stroke-width="1.7" '
           'stroke-linecap="round" stroke-linejoin="round"/></svg>')
    if name == 'gpt':
        # Simple Icons OpenAI mark (CC0), monochrome to match the navigation.
        # https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/openai.svg
        path = ('M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073'
                'M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494'
                'M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646'
                'M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872z'
                'm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667'
                'm2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66z'
                'm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681z'
                'm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
               f'<path d="{path}" fill="{color}"/></svg>')
    pix = QPixmap(size * 2, size * 2)
    pix.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pix)
    QSvgRenderer(svg.encode()).render(painter)
    painter.end()
    pix.setDevicePixelRatio(2)
    return QIcon(pix)


STYLE = '''
QWidget { font-family: "Microsoft YaHei UI"; font-size: 15px; color: #263b50; }
QLabel { background: transparent; }
QWidget#courseNav, QWidget#contextNav { background: #ffffff; }
QMainWindow, QWidget#shell { background: #edf4fa; }
QFrame#topbar { background: #126dca; }
QLabel#brand { color: white; font-size: 20px; font-weight: 500; }
QLabel#topNote { color: #d5ebfb; font-size: 11px; }
QPushButton { background: white; color: #1675c9; border: 1px solid #bad4e9;
              border-radius: 10px; padding: 8px 16px; min-height: 18px; }
QPushButton:hover { background: #ecf6ff; border-color: #1675c9; }
QPushButton:pressed { background: #dceeff; }
QPushButton:focus { border: 2px solid #1675c9; padding: 8px 15px; }
QPushButton:disabled { background: #f3f5f7; color: #9ba9b8; border-color: #e0e6ec; }
QPushButton#primary { background: #1675c9; border-color: #1675c9; color: white; }
QPushButton#primary:hover { background: #0868ba; }
QPushButton#primary:disabled { background: #dce8f2; border-color: #dce8f2; color: #7e97ae; }
QPushButton#danger { color: #bd4d53; border-color: #e6bfc2; }
QPushButton#danger:hover { background: #fff2f2; }
QPushButton#topTab { color: #ffffff; background: transparent; border: none; border-radius: 17px;
                     font-size: 15px; padding: 0 14px; min-height: 0; }
QPushButton#topTab:hover { background: rgba(255,255,255,24); color: white; }
QPushButton#topTab:checked { background: #ffffff; color: #126dca; font-weight: 500; }
QPushButton#topTab:focus { border: 1px solid #b9ddff; padding: 5px 15px; }
QPushButton#windowControl, QPushButton#windowClose { background: transparent; border: none;
    border-radius: 4px; padding: 0; min-height: 0; }
QPushButton#windowControl:hover { background: rgba(255,255,255,28); }
QPushButton#windowClose:hover { background: #d94f5b; }
QPushButton#windowControl:focus, QPushButton#windowClose:focus { border: none; padding: 0; }
QFrame#sidebar { background: #ffffff; border-right: 1px solid #dfeaf2; }
QLabel#sideSection { color: #718297; font-size: 13px; padding: 6px 12px; }
QPushButton#nav { text-align: left; background: transparent; color: #526a80;
                   border: 1px solid transparent; padding: 11px 17px; border-radius: 5px; font-size: 16px; }
QPushButton#nav:hover { background: #f1f7fc; }
QPushButton#nav:checked { background: #e8f3fd; color: #1675c9; border-color: #dceefc; font-weight: 600; }
QFrame#card { background: #ffffff; border: 1px solid #e0eaf2; border-radius: 5px; }
QLabel#title { font-size: 23px; font-weight: 600; color: #234460; }
QLabel#sectionTitle { font-size: 17px; font-weight: 600; color: #234460; }
QLabel#muted { color: #718297; font-size: 14px; }
QLabel#metric { font-size: 28px; font-weight: 500; color: #246ca7; }
QLabel#pill { background: #ecf7f1; color: #2b8057; border-radius: 11px; padding: 4px 10px; font-size: 11px; }
QLabel#note { background: #edf6fd; color: #527795; padding: 13px; border: 1px solid #dcebf8; border-radius: 6px; }
QLabel#dangerNote { color: #a65359; }
QLineEdit, QSpinBox, QComboBox { background: #fbfdff; border: 1px solid #cfdeeb; border-radius: 5px;
                      padding: 10px; selection-background-color: #1675c9; }
QLineEdit:focus, QSpinBox:focus, QComboBox:focus { border: 1px solid #1675c9; background: white; }
QComboBox { combobox-popup: 0; padding-right: 42px; }
QComboBox::drop-down { subcontrol-origin: padding; subcontrol-position: top right;
    width: 36px; border: none; border-top-right-radius: 5px; border-bottom-right-radius: 5px;
    background: #f0f7fd; }
QComboBox::drop-down:hover { background: #e3f0fc; }
QComboBox::down-arrow { image: none; width: 0; height: 0; }
QComboBox QLineEdit { background: transparent; border: none; border-radius: 0; padding: 0; }
QSpinBox QLineEdit { background: transparent; border: none; border-radius: 0;
    padding: 0; color: #263b50; }
QComboBox QAbstractItemView { background: white; color: #263b50; border: none; outline: none;
    selection-background-color: #e7f2ff; selection-color: #126dca; padding: 4px; }
QComboBox QAbstractItemView::item { min-height: 30px; padding: 2px 8px; border: none; }
QCheckBox { spacing: 8px; }
QTableWidget { background: white; border: none; outline: none; selection-background-color: #e8f3fd;
               selection-color: #205f91; gridline-color: #edf2f7; border-radius: 0; }
QTableWidget::item { border-bottom: 1px solid #edf2f7; padding: 8px; }
QTableWidget::item:hover { background: #f5faff; }
QTableWidget::item:selected { background: #e8f3fd; }
QHeaderView::section { background: #f7fafc; color: #7b8da0; border: none;
                       border-bottom: 1px solid #e7eef5; padding: 12px 8px; font-size: 14px; }
QStackedWidget#pageStack, QScrollArea, QWidget#pageRoot, QWidget#pageViewport {
    background: #edf4fa; border: none;
}
QScrollBar:vertical { background: transparent; width: 8px; margin: 0; }
QScrollBar::handle:vertical { background: #cbdbe9; border-radius: 4px; min-height: 30px; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
QScrollBar:horizontal { background: #f3f7fb; height: 8px; margin: 0; border: none; }
QScrollBar::handle:horizontal { background: #cbdbe9; border-radius: 4px; min-width: 30px; }
QScrollBar::handle:horizontal:hover { background: #a9c4d9; }
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0; border: none; }
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal { background: transparent; }
QAbstractScrollArea::corner { background: #f3f7fb; border: none; }
QProgressBar { background: #eaf1f7; border: none; border-radius: 3px; height: 6px; text-align: center; }
QProgressBar::chunk { background: #2389d6; border-radius: 3px; }
QFrame#statusbar { background: #f7fbfe; border-top: 1px solid #dde9f3; }
QDialog { background: #f4f8fc; }
'''


def label(text='', role='', wrap=False):
    w = QLabel(text)
    if role:
        w.setObjectName(role)
    w.setWordWrap(wrap)
    return w


def model_display_name(model_id):
    if model_id.lower().startswith('gpt-'):
        return 'GPT' + model_id[3:]
    return model_id[:1].upper() + model_id[1:]


class SecondsSpinBox(QSpinBox):
    """Keep the editor visible with Qt's styled, buttonless spin box."""
    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.lineEdit().setGeometry(12, 1, max(1, self.width() - 24), self.height() - 2)

    def showEvent(self, event):
        super().showEvent(event)
        self.lineEdit().setGeometry(12, 1, max(1, self.width() - 24), self.height() - 2)


class AccountLineEdit(QLineEdit):
    """Keep login credentials separate from the masked phone display."""

    def __init__(self, username='', verified=False):
        super().__init__(username)
        self._username = username
        self._verified = verified
        self.textEdited.connect(self._remember_edit)
        self._refresh_display()

    def account_text(self):
        return self._username

    def _remember_edit(self, text):
        self._username = text
        self._verified = False

    def setText(self, text):
        self._username = text
        self._verified = False
        super().setText(text)

    def clear(self):
        self.setText('')

    def set_verified(self, verified):
        self._verified = verified
        self._refresh_display()

    def _refresh_display(self):
        text = self._username
        phone = text.strip()
        if self._verified and not self.hasFocus() and len(phone) == 11 and phone.isascii() and phone.isdigit() and phone.startswith('1'):
            text = phone[:3] + '****' + phone[7:]
        super().setText(text)

    def focusInEvent(self, event):
        super().focusInEvent(event)
        self._refresh_display()

    def focusOutEvent(self, event):
        super().focusOutEvent(event)
        self._refresh_display()


class PlainCheckBox(QCheckBox):
    """Neutral indicator with a visible tick instead of a solid accent fill."""
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        option = QStyleOptionButton()
        self.initStyleOption(option)
        indicator = self.style().subElementRect(QStyle.SubElement.SE_CheckBoxIndicator, option, self)
        box = QRectF(indicator).adjusted(0.5, 0.5, -0.5, -0.5)
        painter.setPen(QPen(QColor('#718297' if self.isEnabled() else '#cfdeeb'), 1))
        painter.setBrush(QColor('white'))
        painter.drawRoundedRect(box, 2, 2)
        if self.isChecked():
            painter.setPen(QPen(QColor(INK), 1.7, Qt.PenStyle.SolidLine,
                                Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
            tick = QPainterPath(QPointF(box.left() + box.width() * .22, box.center().y()))
            tick.lineTo(box.left() + box.width() * .43, box.top() + box.height() * .72)
            tick.lineTo(box.left() + box.width() * .8, box.top() + box.height() * .28)
            painter.drawPath(tick)
        text_rect = self.rect().adjusted(indicator.right() + 9, 0, 0, 0)
        painter.setPen(QColor(INK if self.isEnabled() else MUTED))
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                         self.text())
        painter.end()


class ModelComboBox(QComboBox):
    """Use a list popup with an explicitly styled outer frame on Windows."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setView(QListView(self))
        self.setMaxVisibleItems(10)

    def paintEvent(self, event):
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        color = QColor(BLUE if self.isEnabled() else MUTED)
        pen = QPen(color, 1.7, Qt.PenStyle.SolidLine,
                   Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        painter.setPen(pen)
        x, y = self.width() - 19, self.height() / 2
        path = QPainterPath(QPointF(x - 4, y - 2))
        path.lineTo(x, y + 2)
        path.lineTo(x + 4, y - 2)
        painter.drawPath(path)
        painter.end()

    def showPopup(self):
        popup = self.view().window()
        popup.setObjectName('modelPopup')
        popup.setStyleSheet(
            'QFrame#modelPopup { background: white; border: 1px solid #cfdeeb; }')
        popup.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, True)
        super().showPopup()


class PclButton(QPushButton):
    """Paint press feedback within fixed bounds, keeping neighbouring layout still."""
    def __init__(self, text):
        super().__init__(text)
        self.visual_scale = 1.0
        self.press_animation = QVariantAnimation(self)
        self.press_animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        self.press_animation.valueChanged.connect(self._scale_frame)
        self.pressed.connect(lambda: self._scale_to(.955, 80))
        self.released.connect(lambda: self._scale_to(1.0, 300))

    def _scale_frame(self, value):
        self.visual_scale = float(value)
        self.update()

    def _scale_to(self, target, duration):
        self.press_animation.stop()
        window = self.window()
        if getattr(window, 'reduced_motion', False) or self.objectName() in ('windowControl', 'windowClose', 'nav'):
            self._scale_frame(1.0)
            return
        self.press_animation.setDuration(duration)
        self.press_animation.setStartValue(self.visual_scale)
        self.press_animation.setEndValue(target)
        self.press_animation.start()

    def paintEvent(self, event):
        if self.objectName() == 'nav':
            # Draw CJK outlines rather than grid-fitted small bold glyph bitmaps:
            # dense strokes in characters such as 章 must survive fractional DPI.
            option = QStyleOptionButton()
            self.initStyleOption(option)
            text = option.text
            option.text = ''
            painter = QPainter(self)
            self.style().drawControl(QStyle.ControlElement.CE_PushButton, option, painter, self)
            contents = self.style().subElementRect(QStyle.SubElement.SE_PushButtonContents, option, self)
            font = QFont(self.font())
            font.setWeight(QFont.Weight.DemiBold if self.isChecked() else QFont.Weight.Normal)
            font.setHintingPreference(QFont.HintingPreference.PreferNoHinting)
            glyphs = QPainterPath()
            glyphs.addText(QPointF(0, 0), font, text)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(BLUE if self.isChecked() else '#526a80'))
            # Preserve the font's baseline and normal left bearing.
            metrics = self.fontMetrics()
            painter.translate(contents.left(), contents.top() + (contents.height() - metrics.height()) / 2 + metrics.ascent())
            painter.drawPath(glyphs)
            return
        option = QStyleOptionButton()
        self.initStyleOption(option)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.translate(self.width() / 2, self.height() / 2)
        painter.scale(self.visual_scale, self.visual_scale)
        painter.translate(-self.width() / 2, -self.height() / 2)
        if self.objectName() in ('nav', 'windowControl', 'windowClose'):
            self.style().drawControl(QStyle.ControlElement.CE_PushButton, option, painter, self)
            return
        primary = self.objectName() == 'primary'
        danger = self.objectName() == 'danger'
        if not self.isEnabled():
            fill, edge = ('#dce8f2', '#dce8f2') if primary else ('#f3f5f7', '#e0e6ec')
        elif primary:
            fill, edge = ('#0868ba' if self.isDown() or self.underMouse() else '#1675c9'), '#1675c9'
        else:
            fill = '#fff2f2' if danger and self.underMouse() else '#dceeff' if self.isDown() else '#ecf6ff' if self.underMouse() else '#ffffff'
            edge = '#bd4d53' if danger else '#1675c9' if self.hasFocus() or self.underMouse() else '#bad4e9'
        # Inset the entire stroke so high-DPI rounding/press scaling cannot clip it.
        stroke = 1.5 if self.hasFocus() else 1.1
        painter.setPen(QPen(QColor(edge), stroke))
        painter.setBrush(QColor(fill))
        painter.drawRoundedRect(QRectF(self.rect()).adjusted(1.5, 1.5, -1.5, -1.5), 10, 10)
        self.style().drawControl(QStyle.ControlElement.CE_PushButtonLabel, option, painter, self)


class BusyIndicator(QWidget):
    """Continuous soft light sweep, using Qt's animation clock and subpixel paint."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(132, 14)
        self.setAccessibleName('任务进行中')
        self.phase = 0.0
        self.animation = QVariantAnimation(self)
        self.animation.setStartValue(0.0)
        self.animation.setEndValue(1.0)
        self.animation.setDuration(1600)
        self.animation.setLoopCount(-1)
        self.animation.valueChanged.connect(self.frame)

    def frame(self, value):
        self.phase = float(value)
        self.update()

    def sync_animation(self):
        if self.isVisible() and not getattr(self.window(), 'reduced_motion', False):
            if self.animation.state() != QVariantAnimation.State.Running:
                self.animation.start()
        else:
            self.animation.stop()
            self.phase = .5
            self.update()

    def showEvent(self, event):
        super().showEvent(event)
        self.sync_animation()

    def hideEvent(self, event):
        self.animation.stop()
        super().hideEvent(event)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        track = QRectF(2, 4, self.width()-4, 6)
        path = QPainterPath()
        path.addRoundedRect(track, 3, 3)
        painter.fillPath(path, QColor('#e1edf7'))
        painter.setClipPath(path)
        length = track.width() * .64
        centre = track.left() - length/2 + (track.width()+length) * self.phase
        gradient = QLinearGradient(centre-length/2, 0, centre+length/2, 0)
        gradient.setColorAt(0, QColor(35, 137, 214, 0))
        gradient.setColorAt(.35, QColor('#65b5ed'))
        gradient.setColorAt(.65, QColor('#1675c9'))
        gradient.setColorAt(1, QColor(35, 137, 214, 0))
        painter.fillRect(QRectF(centre-length/2, track.top(), length, track.height()), gradient)


def button(text, callback, name='', glyph=None):
    b = PclButton(text)
    if name:
        b.setObjectName(name)
    if glyph:
        b.setIcon(icon(glyph, '#ffffff' if name == 'primary' else BLUE))
        b.setIconSize(QSize(16, 16))
    b.setCursor(Qt.CursorShape.PointingHandCursor)
    b.clicked.connect(callback)
    return b


def card(parent_layout=None):
    w = QFrame()
    w.setObjectName('card')
    layout = QVBoxLayout(w)
    layout.setContentsMargins(22, 18, 22, 18)
    layout.setSpacing(14)
    if parent_layout:
        parent_layout.addWidget(w)
    return w, layout


class Toggle(QAbstractButton):
    """Antialiased, high-DPI switch. Geometry remains fixed while its knob moves."""
    def __init__(self, checked=False, parent=None, animate=True):
        super().__init__(parent)
        self.setCheckable(True)
        self.setChecked(checked)
        self.setFixedSize(48, 30)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.position = float(checked)
        self.animate = animate
        self.animation = QVariantAnimation(self)
        self.animation.setDuration(150)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        self.animation.valueChanged.connect(self.frame)
        self.toggled.connect(self.transition)

    def frame(self, value):
        self.position = value
        self.update()

    def transition(self, checked):
        self.animation.stop()
        if not self.animate:
            self.frame(float(checked))
            return
        self.animation.setStartValue(self.position)
        self.animation.setEndValue(float(checked))
        self.animation.start()

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        t = self.position
        a, b = QColor('#b9c9d6'), QColor(BLUE)
        color = QColor(*[round(a.getRgb()[i] + (b.getRgb()[i] - a.getRgb()[i]) * t) for i in range(3)])
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(color if self.isEnabled() else QColor('#dce4eb'))
        p.drawRoundedRect(QRectF(2, 4, 44, 22), 11, 11)
        p.setBrush(QColor('white'))
        p.drawEllipse(QRectF(5 + 22 * t, 7, 16, 16))
        if self.hasFocus():
            p.setPen(QPen(QColor(BLUE), 1))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawRoundedRect(QRectF(.5, 1.5, 47, 27), 13, 13)


class CourseTable(QTableWidget):
    """Content-sized columns, a flexible name column and user-adjustable widths."""
    def __init__(self, parent=None):
        super().__init__(0, 8, parent)
        self.content_widths = [56, 240, 84, 84, 84, 144, 136, 180]
        self.user_widths = {}
        self._fitting = False
        header = self.horizontalHeader()
        header.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        header.setMinimumSectionSize(48)
        header.sectionResized.connect(self.column_resized)

    def column_resized(self, index, old, width):
        if not self._fitting:
            self.user_widths[index] = width
            QTimer.singleShot(0, self.fit_columns)

    def update_content_widths(self):
        floors = [56, 240, 84, 84, 84, 144, 136, 180]
        metrics = self.fontMetrics()
        header_metrics = self.horizontalHeader().fontMetrics()
        for column in range(8):
            item = self.horizontalHeaderItem(column)
            needed = max(floors[column], header_metrics.horizontalAdvance(item.text() if item else '') + 28)
            for row in range(self.rowCount()):
                cell = self.item(row, column)
                if cell:
                    needed = max(needed, metrics.horizontalAdvance(cell.text()) + 28)
            self.content_widths[column] = min(460, needed) if column == 1 else needed
        self.fit_columns()

    def fit_columns(self):
        if self._fitting:
            return
        self._fitting = True
        try:
            widths = [max(base, self.user_widths.get(i, 0)) for i, base in enumerate(self.content_widths)]
            if 1 not in self.user_widths:
                widths[1] = max(widths[1], self.viewport().width() - sum(widths[i] for i in range(8) if i != 1))
            for column, width in enumerate(widths):
                self.setColumnWidth(column, width)
        finally:
            self._fitting = False

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, 'content_widths'):
            self.fit_columns()


class CourseDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        if index.column() not in (5, 6):
            return super().paint(painter, option, index)
        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        selected = bool(option.state & QStyle.StateFlag.State_Selected)
        painter.fillRect(option.rect, QColor('#e8f3fd' if selected else '#ffffff'))
        rect = option.rect
        data = index.data(Qt.ItemDataRole.UserRole)
        if index.column() == 5 and data is not None:
            track = QRectF(rect.x() + 10, rect.center().y() - 3, max(18, rect.width() - 62), 6)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor('#e7eff6'))
            painter.drawRoundedRect(track, 3, 3)
            if data:
                painter.setBrush(QColor('#4097d2' if data < 100 else '#58a882'))
                painter.drawRoundedRect(QRectF(track.x(), track.y(), track.width() * data / 100, 6), 3, 3)
            painter.setPen(QColor(MUTED))
            painter.drawText(rect.adjusted(0, 0, -9, 0), Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter, f'{data}%')
        elif index.column() == 6:
            text = index.data()
            bg, fg = ('#ecf7f1', '#38845c') if data == 'done' else (('#fff6e7', '#a07934') if data == 'todo' else ('#f0f4f8', '#7a8fa3'))
            badge = QRectF(rect.x() + 9, rect.center().y() - 12, min(rect.width() - 18, 116), 24)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(bg))
            painter.drawRoundedRect(badge, 5, 5)
            painter.setPen(QColor(fg))
            painter.drawText(badge, Qt.AlignmentFlag.AlignCenter, text)
        else:
            painter.setPen(QColor(MUTED))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, '—')
        painter.setPen(QColor('#edf2f7'))
        painter.drawLine(rect.bottomLeft(), rect.bottomRight())
        painter.restore()


class TopTab(QPushButton):
    def sizeHint(self):
        width = self.fontMetrics().horizontalAdvance(self.text())
        return QSize(width + motion.TAB_ICON + motion.TAB_GAP + 2 * motion.TAB_PADDING, motion.TAB_HEIGHT)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        color = QColor('white') if self.isChecked() else QColor(255, 255, 255, 24 if self.underMouse() else 0)
        painter.setBrush(color)
        painter.drawRoundedRect(QRectF(self.rect()).adjusted(.5, .5, -.5, -.5), self.height()/2, self.height()/2)
        width = self.fontMetrics().horizontalAdvance(self.text())
        content_gap = motion.TAB_ICON + motion.TAB_GAP
        x = (self.width() - width - content_gap) / 2
        painter.drawPixmap(QPointF(x, (self.height() - motion.TAB_ICON) / 2), self.icon().pixmap(QSize(motion.TAB_ICON, motion.TAB_ICON)))
        painter.setPen(QColor('#126dca' if self.isChecked() else 'white'))
        painter.drawText(QRectF(x + content_gap, 0, width + 1, self.height()), Qt.AlignmentFlag.AlignVCenter, self.text())
        if self.hasFocus():
            painter.setPen(QPen(QColor('#b9ddff'), 1))
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawRoundedRect(QRectF(self.rect()).adjusted(1, 1, -1, -1), self.height()/2-1, self.height()/2-1)


class TitleBar(QFrame):
    """One draggable title/navigation bar; child buttons retain normal input."""
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            handle = self.window().windowHandle()
            if handle is not None:
                handle.startSystemMove()
                event.accept()
                return
        super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.window().toggle_maximized()
            event.accept()
            return
        super().mouseDoubleClickEvent(event)


class StartupFrame(QWidget):
    """Rotate a cached window on a transparent surface, including its silhouette."""
    padding = 40

    def __init__(self, window):
        super().__init__(window, Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint
                         | Qt.WindowType.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.pixmap = window.grab()
        # A prefiltered image avoids a live blur pass over every control each frame.
        small = self.pixmap.toImage().scaled(
            max(1, self.pixmap.width() // 4), max(1, self.pixmap.height() // 4),
            Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        self.soft = QPixmap.fromImage(small.scaled(
            self.pixmap.size(), Qt.AspectRatioMode.IgnoreAspectRatio,
            Qt.TransformationMode.SmoothTransformation))
        self.soft.setDevicePixelRatio(self.pixmap.devicePixelRatio())
        self.progress = 0.0
        self.setGeometry(window.geometry().adjusted(-40, -40, 40, 40))

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        angle, sway, blur = motion.startup_pose(self.progress)
        painter.translate(self.width() / 2 + sway, self.height() / 2)
        painter.rotate(angle)
        width = self.pixmap.width() / self.pixmap.devicePixelRatio()
        height = self.pixmap.height() / self.pixmap.devicePixelRatio()
        path = QPainterPath()
        path.addRoundedRect(QRectF(-width / 2, -height / 2, width, height), 9, 9)
        painter.setClipPath(path)
        painter.drawPixmap(QPointF(-width / 2, -height / 2), self.pixmap)
        painter.setOpacity(blur)
        painter.drawPixmap(QPointF(-width / 2, -height / 2), self.soft)
        # Short directional exposures add a motion blur while the tilt settles.
        for offset in (-1.4, 1.4):
            painter.setOpacity(blur * .16)
            painter.drawPixmap(QPointF(-width / 2 + offset, -height / 2), self.soft)


class SlideFrame(QWidget):
    """An opaque cached frame; subpixel translation avoids integer-pixel stepping."""
    def __init__(self, parent, pixmap, bands, old=None, old_bands=None):
        super().__init__(parent)
        self.pixmap = pixmap
        self.bands = bands
        self.old = old
        self.old_bands = old_bands or bands
        self.axis = parent.axis
        self.duration = parent.fade.duration()
        self.progress = 0.0
        self.offset = -40.0
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.setGeometry(parent.rect())

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor(self.parentWidget().surface))
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        if self.old is not None:
            for index, (top, bottom) in enumerate(self.old_bands):
                x, y, alpha = motion.exit_state(self.progress * self.duration, index, len(self.old_bands), self.axis)
                self.paint_band(painter, self.old, top, bottom, x, y, alpha)
        for index, (top, bottom) in enumerate(self.bands):
            x, y, opacity = motion.entrance(self.progress * self.duration, index, self.axis)
            self.paint_band(painter, self.pixmap, top, bottom, x, y, opacity)

    def paint_band(self, painter, image, top, bottom, x, y, opacity):
        if opacity <= 0:
            return
        painter.save()
        painter.setClipRect(QRectF(x, top + y, self.width(), bottom - top))
        painter.setOpacity(opacity)
        painter.drawPixmap(QPointF(x, y), image)
        painter.restore()

    def band_state(self, index):
        x, y, opacity = motion.entrance(self.progress * self.duration, index, self.axis)
        return (x if self.axis == 'left' else y), opacity


class PageStack(QStackedWidget):
    """Render once, then move a cached opaque frame instead of every live control."""
    def __init__(self, surface='#edf4fa', axis='right'):
        super().__init__()
        self.surface = surface
        self.axis = axis
        self.setObjectName('pageStack')
        self.setAutoFillBackground(True)
        palette = self.palette()
        palette.setColor(QPalette.ColorRole.Window, QColor(surface))
        self.setPalette(palette)
        self.animate = True
        self.moving_page = None
        self.overlay = None
        self.fade = QVariantAnimation(self)
        self.fade.setDuration(380)
        self.fade.setEasingCurve(QEasingCurve.Type.Linear)
        self.fade.setStartValue(0.0)
        self.fade.setEndValue(1.0)
        self.fade.valueChanged.connect(self.frame)
        self.fade.finished.connect(self.finish)

    def frame(self, value):
        if self.overlay is not None:
            self.overlay.progress = float(value)
            self.overlay.offset = -40 * (1 - float(value))
            self.overlay.update()

    def finish(self):
        if self.moving_page is not None:
            self.moving_page = None
        if self.overlay is not None:
            self.overlay.hide()
            self.overlay.deleteLater()
            self.overlay = None

    def enter(self, old=None, old_bands=None):
        self.fade.stop()
        self.finish()
        if self.animate and self.isVisible():
            self.moving_page = self.currentWidget()
            self.moving_page.layout().activate() if self.moving_page.layout() else None
            if isinstance(self.moving_page, QScrollArea):
                self.moving_page.widget().layout().activate()
            content = self.moving_page.widget() if isinstance(self.moving_page, QScrollArea) else self.moving_page
            layout = content.layout()
            starts = []
            if layout:
                origin = content.mapTo(self.moving_page, content.rect().topLeft()).y()
                for i in range(layout.count()):
                    item = layout.itemAt(i)
                    if item.isEmpty() or item.geometry().height() < 3:
                        continue
                    y = origin + item.geometry().top() - 8
                    if 0 < y < self.height():
                        starts.append(y)
            if self.axis == 'left':
                controls = content.findChildren(QPushButton) + content.findChildren(QLabel)
                starts = [control.mapTo(self.moving_page, control.rect().topLeft()).y() - 5
                          for control in controls if control.isVisibleTo(content)]
                starts = [y for y in starts if 0 < y < self.height()]
            starts = [0] + sorted(set(starts))[1:]
            bands = list(zip(starts, starts[1:] + [self.height()]))
            self.current_bands = bands
            self.fade.setDuration(motion.duration(len(bands), self.axis))
            # Capture the opaque stack, not a transparent child rendered in isolation.
            # QWidget.grab() on a transparent pane can substitute the dark OS palette.
            self.overlay = SlideFrame(self, self.capture_surface(), bands, old, old_bands)
            self.overlay.show()
            self.overlay.raise_()
            self.fade.start()

    def switch(self, widget):
        if self.currentWidget() is widget:
            return
        self.fade.stop()
        self.finish()
        old = self.capture_surface() if self.animate and self.isVisible() and self.currentWidget() else None
        old_bands = getattr(self, 'current_bands', None)
        self.setCurrentWidget(widget)
        self.enter(old, old_bands)

    def capture_surface(self):
        captured = self.grab()
        opaque = QPixmap(captured.size())
        opaque.setDevicePixelRatio(captured.devicePixelRatio())
        opaque.fill(QColor(self.surface))
        painter = QPainter(opaque)
        painter.drawPixmap(0, 0, captured)
        painter.end()
        return opaque

    def resizeEvent(self, event):
        self.fade.stop()
        self.finish()
        super().resizeEvent(event)


class Window(QMainWindow):
    def __init__(self, auto_start=True):
        super().__init__()
        self.setWindowTitle('课程助手')
        self.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
        self.setWindowIcon(icon('book'))
        self.resize(1280, 880)
        self.setMinimumSize(1020, 720)
        self._startup_shown = False
        self._startup_origin = None
        self._startup_overlay = None
        self.startup_animation = QVariantAnimation(self)
        self.startup_animation.setDuration(motion.STARTUP_DURATION)
        self.startup_animation.setStartValue(0.0)
        self.startup_animation.setEndValue(1.0)
        self.startup_animation.valueChanged.connect(self._startup_frame)
        self.startup_animation.finished.connect(self._finish_startup)
        self.platform = 'chaoxing'
        self.category = 'chapter'
        self.current_scan = None
        self.platform_scans = {}
        self.platform_categories = {'chaoxing': 'chapter', 'mooc': 'courseware', 'yuketang': 'video'}
        self.scanning = self.brushing = False
        self.logging_in = False
        self.pending_clear = False
        self.login_stop = threading.Event()
        self.login_ticket = None
        self.stop_event = threading.Event()
        self.events = queue.Queue()
        self.pairs = []
        self.work_action = None
        self.threads = []
        self.refresh_pending = False
        self.preferences_path = ROOT / 'data' / 'scan_preferences.json'
        try:
            prefs = json.loads(self.preferences_path.read_text(encoding='utf-8'))
            self.auto_scan = prefs.get('auto_scan', True)
            self.reduced_motion = prefs.get('reduced_motion', False)
            if prefs.get('version') != 1 or type(self.auto_scan) is not bool or type(self.reduced_motion) is not bool:
                self.auto_scan, self.reduced_motion = True, False
        except (OSError, ValueError, AttributeError):
            self.auto_scan, self.reduced_motion = True, False
        shell = QWidget()
        shell.setObjectName('shell')
        self.setCentralWidget(shell)
        outer = QVBoxLayout(shell)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        top = TitleBar()
        self.title_bar = top
        top.setObjectName('topbar')
        top.setFixedHeight(motion.TITLE_HEIGHT)
        top_layout = QGridLayout(top)
        top_layout.setContentsMargins(20, 0, 10, 0)
        top_layout.setColumnStretch(0, 1)
        top_layout.setColumnStretch(2, 1)
        brand = QHBoxLayout()
        mark = QLabel()
        mark.setPixmap(icon('book', 'white', 23).pixmap(23, 23))
        brand.addWidget(mark)
        brand.addSpacing(7)
        brand.addWidget(label('课程助手', 'brand'))
        top_layout.addLayout(brand, 0, 0, Qt.AlignmentFlag.AlignLeft)
        navigation = QHBoxLayout()
        navigation.setSpacing(8)
        self.top_buttons = {}
        self.top_glyphs = {'courses': 'play', 'accounts': 'user', 'api': 'gpt', 'settings': 'settings'}
        for key, name in [('courses', '课程'), ('accounts', '账号'), ('api', 'AI答题'), ('settings', '设置')]:
            b = TopTab(name)
            b.setObjectName('topTab')
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(lambda checked=False, k=key: self.show_page(k))
            b.setCheckable(True)
            b.setFixedHeight(motion.TAB_HEIGHT)
            b.setIcon(icon(self.top_glyphs[key], 'white'))
            b.setIconSize(QSize(20, 20))
            self.top_buttons[key] = b
            navigation.addWidget(b)
        top_layout.addLayout(navigation, 0, 1, Qt.AlignmentFlag.AlignCenter)
        controls = QHBoxLayout()
        controls.setSpacing(0)
        self.minimize_button = button('', self.showMinimized, 'windowControl')
        self.maximize_button = button('', self.toggle_maximized, 'windowControl')
        self.close_button = button('', self.close, 'windowClose')
        for control, glyph, name in [(self.minimize_button, 'minimize', '最小化'),
                                     (self.maximize_button, 'maximize', '最大化'),
                                     (self.close_button, 'close', '关闭')]:
            control.setFixedSize(40, 40)
            control.setIcon(icon(glyph, 'white', 24))
            control.setIconSize(QSize(24, 24))
            control.setAccessibleName(name)
            controls.addWidget(control)
        top_layout.addLayout(controls, 0, 2, Qt.AlignmentFlag.AlignRight)
        outer.addWidget(top)
        middle = QHBoxLayout()
        middle.setSpacing(0)
        self.side = QFrame()
        self.side.setObjectName('sidebar')
        self.side.setFixedWidth(192)
        side_outer = QVBoxLayout(self.side)
        side_outer.setContentsMargins(14, 22, 14, 22)
        self.side_stack = PageStack(surface='#ffffff', axis='left')
        self.side_stack.setObjectName('sideStack')
        self.side_stack.setStyleSheet('QStackedWidget#sideStack { background: white; }')
        self.side_stack.animate = not self.reduced_motion
        side_outer.addWidget(self.side_stack, 1)
        self.course_nav = QWidget()
        self.course_nav.setObjectName('courseNav')
        self.side_stack.addWidget(self.course_nav)
        side_layout = QVBoxLayout(self.course_nav)
        side_layout.setContentsMargins(0, 0, 0, 0)
        side_layout.setSpacing(7)
        side_layout.addWidget(label('学习平台', 'sideSection'))
        self.platform_buttons = {}
        for key, title in [('chaoxing', '超星学习通'), ('mooc', '中国大学 MOOC'), ('yuketang', '长江雨课堂')]:
            b = button(title, lambda checked=False, k=key: self.show_platform(k), 'nav')
            b.setCheckable(True)
            self.platform_buttons[key] = b
            side_layout.addWidget(b)
        side_layout.addSpacing(22)
        self.category_group = QWidget()
        cat_layout = QVBoxLayout(self.category_group)
        cat_layout.setContentsMargins(0, 0, 0, 0)
        cat_layout.setSpacing(6)
        cat_layout.addWidget(label('课程分类', 'sideSection'))
        self.category_buttons = {}
        for key, title in (course_store.CATEGORIES | course_store.MOOC_CATEGORIES | course_store.YUKETANG_CATEGORIES).items():
            b = button(title, lambda checked=False, k=key: self.show_category(k), 'nav')
            b.setCheckable(True)
            self.category_buttons[key] = b
            cat_layout.addWidget(b)
        side_layout.addWidget(self.category_group)
        side_layout.addStretch()
        local = QHBoxLayout()
        lock = QLabel()
        lock.setPixmap(icon('shield', '#7f9bb1', 16).pixmap(16, 16))
        local.addWidget(lock)
        local.addWidget(label('数据保存在本机', 'muted'))
        local.addStretch()
        side_outer.addLayout(local)
        middle.addWidget(self.side)
        self.stack = PageStack()
        self.stack.animate = not self.reduced_motion
        middle.addWidget(self.stack, 1)
        outer.addLayout(middle, 1)
        self.pages = {}
        for key in self.top_buttons:
            scroll = QScrollArea()
            scroll.viewport().setObjectName('pageViewport')
            scroll.viewport().setAutoFillBackground(True)
            palette = scroll.viewport().palette()
            palette.setColor(QPalette.ColorRole.Window, QColor('#edf4fa'))
            scroll.viewport().setPalette(palette)
            scroll.setWidgetResizable(True)
            content = QWidget()
            content.setObjectName('pageRoot')
            layout = QVBoxLayout(content)
            layout.setContentsMargins(26, 24, 26, 24)
            layout.setSpacing(20)
            scroll.setWidget(content)
            self.stack.addWidget(scroll)
            self.pages[key] = (scroll, layout)
        self.build_courses(self.pages['courses'][1])
        self.build_accounts(self.pages['accounts'][1])
        self.build_api(self.pages['api'][1])
        self.build_settings(self.pages['settings'][1])
        self.build_context_navigation()
        statusbar = QFrame()
        statusbar.setObjectName('statusbar')
        status_layout = QHBoxLayout(statusbar)
        status_layout.setContentsMargins(22, 8, 22, 8)
        status_layout.addWidget(label('●', 'muted'))
        self.status = label('准备就绪', 'muted')
        status_layout.addWidget(self.status, 1)
        self.busy = BusyIndicator()
        self.busy.hide()
        status_layout.addWidget(self.busy)
        outer.addWidget(statusbar)
        self.show_page('courses')
        self.refresh()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(100)
        if auto_start and self.auto_scan:
            QTimer.singleShot(1000, self.start_scan)

    def heading(self, layout, title, subtitle):
        row = QHBoxLayout()
        text = QVBoxLayout()
        text.setSpacing(7)
        text.addWidget(label(title, 'title'))
        row.addLayout(text, 1)
        layout.addLayout(row)
        return row

    def build_courses(self, layout):
        heading = self.heading(layout, '课程与任务', '检查课程进度，按剩余量安排待办。')
        self.scan_button = button('检查课程信息', self.start_scan, 'primary', 'refresh')
        heading.addWidget(self.scan_button)
        self.stop_button = button('停止', self.stop_work, '', 'stop')
        heading.addWidget(self.stop_button)
        stats, stats_layout = card(layout)
        stats_layout.setContentsMargins(24, 19, 24, 19)
        stats_row = QHBoxLayout()
        self.stat_values = {}
        self.stat_titles = {}
        for i, (key, title) in enumerate([('count', '有要求的课程'), ('left', '本次已知剩余'), ('hidden', '无此要求'), ('unknown', '要求待确认')]):
            col = QVBoxLayout()
            col.setSpacing(5)
            stat_title = label(title, 'muted')
            self.stat_titles[key] = stat_title
            col.addWidget(stat_title)
            value = label('—', 'metric')
            self.stat_values[key] = value
            col.addWidget(value)
            stats_row.addLayout(col, 1)
            if i < 3:
                divider = QFrame()
                divider.setFixedSize(1, 45)
                divider.setStyleSheet('background: #e9f0f6;')
                stats_row.addWidget(divider)
                stats_row.addSpacing(24)
        stats_layout.addLayout(stats_row)
        table_card, table_layout = card()
        table_layout.setContentsMargins(0, 0, 0, 0)
        table_layout.setSpacing(0)
        title_row = QHBoxLayout()
        title_row.setContentsMargins(20, 15, 20, 15)
        self.table_title = label('章节进度', 'sectionTitle')
        title_row.addWidget(self.table_title)
        title_row.addSpacing(10)
        self.table_count = label('', 'muted')
        title_row.addWidget(self.table_count)
        title_row.addStretch()
        self.search = QLineEdit()
        self.search.setPlaceholderText('搜索课程')
        self.search.setAccessibleName('搜索课程')
        self.search.setFixedWidth(192)
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self.refresh)
        title_row.addWidget(self.search)
        table_layout.addLayout(title_row)
        self.table = CourseTable()
        self.table.setHorizontalHeaderLabels(['顺序', '课程名称', '要求', '已完成', '剩余', '完成度', '状态', '检查时间'])
        self.table.verticalHeader().hide()
        self.table.verticalHeader().setDefaultSectionSize(58)
        self.table.setShowGrid(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setMouseTracking(True)
        self.table.setItemDelegate(CourseDelegate(self.table))
        self.table.setMinimumHeight(240)
        self.table.setWordWrap(False)
        self.table.itemSelectionChanged.connect(self.select_course)
        self.table.cellDoubleClicked.connect(lambda r, c: self.manual_dialog())
        table_layout.addWidget(self.table, 1)
        self.empty = label('暂无课程，点击「检查课程信息」开始', 'muted', True)
        self.empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty.setMinimumHeight(100)
        table_layout.addWidget(self.empty)
        self.summary = label('按剩余数量排序 · 上次记录需重新检查', 'muted')
        self.summary.setContentsMargins(20, 11, 20, 13)
        table_layout.addWidget(self.summary)
        self.summary.hide()
        layout.addWidget(table_card, 1)
        details_card, details_layout = card(layout)
        selected_row = QHBoxLayout()
        self.detail_title = label('选择一门课程', 'sectionTitle')
        selected_row.addWidget(self.detail_title, 1)
        self.detail_meta = label('在上方列表中查看课程详情', 'muted')
        selected_row.addWidget(self.detail_meta)
        details_layout.addLayout(selected_row)
        self.detail_progress = QProgressBar()
        self.detail_progress.setRange(0, 100)
        self.detail_progress.setTextVisible(False)
        self.detail_progress.setFixedHeight(6)
        details_layout.addWidget(self.detail_progress)
        self.detail_note = label('首次使用，请先在「账号」中打开网页完成登录。', 'muted', True)
        details_layout.addWidget(self.detail_note)
        actions = QHBoxLayout()
        self.one_button = button('刷所选课程', lambda: self.start_brush(True), '', 'play')
        self.all_button = button('自动刷课', lambda: self.start_brush(False), '', 'play')
        self.open_button = button('打开课程', self.open_selected, '', 'globe')
        self.manual_button = button('手工确认', self.manual_dialog)
        for b in [self.one_button, self.all_button, self.open_button]:
            actions.addWidget(b)
        self.speed_label = label('播放倍速', 'muted')
        self.playback_speed = ModelComboBox()
        self.playback_speed.setAccessibleName('播放倍速')
        self.playback_speed.setToolTip('自动选择可用的最高倍速；手动选择时，不可用则逐档降低')
        self.playback_speed.addItem('自动最高', 'auto')
        for speed in settings.PLAYBACK_SPEEDS:
            self.playback_speed.addItem(f'{speed:g} 倍', speed)
        self.playback_speed.setCurrentIndex(0)
        self.playback_speed.setMinimumWidth(112)
        self.speed_label.setBuddy(self.playback_speed)
        actions.addWidget(self.speed_label)
        actions.addWidget(self.playback_speed)
        actions.addStretch()
        actions.addWidget(self.manual_button)
        details_layout.addLayout(actions)

    def build_accounts(self, layout):
        self.heading(layout, '平台账号', '账号密码在本机加密保存，不会发送给答题 API。')
        row = QHBoxLayout()
        row.setSpacing(20)
        self.account_fields = {}
        self.account_notes = {}
        self.account_login_badges = {}
        self.account_verified = {}
        self.password_visible = {}
        self.account_save_buttons = {}
        self.account_clear_buttons = {}
        self.account_web_buttons = {}
        self.account_verify_buttons = {}
        self.account_panels = {}
        self.account_platform = 'chaoxing'
        for platform, title in accounts.PLATFORMS.items():
            panel, form = card()
            self.account_panels[platform] = panel
            account_header = QHBoxLayout()
            account_header.addWidget(label(title, 'sectionTitle'))
            account_header.addStretch()
            badge = label('未验证', 'loginBadge')
            badge.setAccessibleName(title + '登录状态')
            self.account_login_badges[platform] = badge
            self.set_account_login_state(platform, 'unverified')
            account_header.addWidget(badge)
            form.addLayout(account_header)
            try:
                account = accounts.load_account(platform)
                state = '已加密保存' if account.username else '尚未保存账号'
            except Exception:
                account, state = accounts.Account(), '读取失败，原文件未修改'
            self.account_verified[platform] = account.verified
            if account.verified:
                state = '登录成功'
                self.set_account_login_state(platform, 'success')
            user, password = AccountLineEdit(account.username, account.verified), QLineEdit(account.password)
            password.setEchoMode(QLineEdit.EchoMode.Password)
            user.setAccessibleName(title + '账号')
            password.setAccessibleName(title + '密码')
            account_label = '账号（手机号 / 网易邮箱）' if platform == 'mooc' else '账号（手机号 / 邮箱）' if platform == 'yuketang' else '账号（手机号 / 邮箱 / 学号）'
            for title, entry in [(account_label, user), ('密码', password)]:
                form.addWidget(label(title, 'muted'))
                form.addWidget(entry)
            visible = PlainCheckBox('显示密码')
            visible.toggled.connect(lambda on, entry=password: entry.setEchoMode(QLineEdit.EchoMode.Normal if on else QLineEdit.EchoMode.Password))
            form.addWidget(visible)
            self.password_visible[platform] = visible
            self.account_fields[platform] = (user, password)
            buttons = QHBoxLayout()
            save = button('保存并登录', lambda checked=False, p=platform: self.save_account(p), 'primary')
            clear = button('清除保存', lambda checked=False, p=platform: self.clear_account(p))
            self.account_save_buttons[platform] = save
            self.account_clear_buttons[platform] = clear
            buttons.addWidget(save)
            buttons.addWidget(clear)
            form.addLayout(buttons)
            state_label = label(state, 'muted', True)
            self.account_notes[platform] = state_label
            form.addWidget(state_label)
            verify = button('验证已完成，重新检查', lambda checked=False, p=platform: self.start_account_login(check_only=True, platform=p))
            verify.hide()
            self.account_verify_buttons[platform] = verify
            form.addWidget(verify)
            web_login = button('打开网页登录', lambda checked=False, p=platform: self.open_account_login(p), '', 'globe')
            self.account_web_buttons[platform] = web_login
            form.addWidget(web_login)
            form.addWidget(label('无需填写账号密码；网页登录成功后自动保留登录状态。', 'muted', True))
            for entry in (user, password):
                entry.textEdited.connect(lambda text, p=platform: self.account_edited(p))
            row.addWidget(panel, 1)
        layout.addLayout(row)
        layout.addStretch()

    def build_api(self, layout):
        self.heading(layout, 'AI答题', '可选配置 · 仅在点击测试时发送请求')
        panel, form = card(layout)
        form.addWidget(label('连接配置', 'sectionTitle'))
        try:
            config = settings.load()
        except Exception:
            config = APIConfig()
        self.api_fields = {}
        form.addWidget(label('服务商', 'muted'))
        self.api_provider = ModelComboBox()
        self.api_provider.setAccessibleName('服务商')
        self.api_provider.addItems([item[0] for item in PROVIDERS])
        form.addWidget(self.api_provider)
        for key, title, value in [('base_url', '官方 API 地址', config.base_url), ('model', '模型名称', config.model), ('api_key', 'API 密钥', config.api_key)]:
            form.addWidget(label(title, 'muted'))
            if key == 'model':
                entry = ModelComboBox()
                entry.setEditable(True)
                entry.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
                entry.setMaxVisibleItems(10)
                entry.setEditText(value)
                entry.lineEdit().setPlaceholderText('选择模型或输入自定义模型 ID')
            else:
                entry = QLineEdit(value)
            entry.setAccessibleName(title)
            if key == 'api_key':
                entry.setEchoMode(QLineEdit.EchoMode.Password)
            self.api_fields[key] = entry
            form.addWidget(entry)
        selected = next((i for i, item in enumerate(PROVIDERS)
                         if config.base_url.rstrip('/') == item[1] and item[1]), -1)
        self.api_provider.setPlaceholderText('请选择服务商')
        new_config = not config.base_url and not config.model and not config.api_key
        if new_config:
            selected = 0
        self.api_provider.setCurrentIndex(selected)
        self.set_api_provider(selected, initial=not new_config)
        self.api_provider.currentIndexChanged.connect(self.set_api_provider)
        form.addWidget(label('请求超时', 'muted'))
        self.api_timeout = SecondsSpinBox()
        self.api_timeout.setRange(5, 3600)
        self.api_timeout.setValue(config.timeout)
        self.api_timeout.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        self.api_timeout.setFixedWidth(150)
        self.api_timeout.setFixedHeight(44)
        self.api_timeout.setAccessibleName('请求超时秒数')
        self.api_timeout.setToolTip('等待 API 回复的最长时间，默认 45 秒；复杂题目可适当调高。')
        timeout_row = QHBoxLayout()
        timeout_row.setSpacing(10)
        timeout_row.addWidget(self.api_timeout)
        timeout_row.addWidget(label('秒', 'muted'))
        timeout_row.addStretch()
        form.addLayout(timeout_row)
        buttons = QHBoxLayout()
        buttons.addWidget(button('保存配置', self.save_api, 'primary'))
        self.test_button = button('测试连接', self.test_api)
        buttons.addWidget(self.test_button)
        buttons.addStretch()
        self.api_help_button = button('不会配置？低价购买（暂未开放）', self.open_ai_help)
        buttons.addWidget(self.api_help_button)
        form.addLayout(buttons)
        layout.addWidget(label('测试连接会发送一条简短请求，服务商可能计费。密钥在本机加密保存。', 'note', True))
        layout.addStretch()

    def set_api_provider(self, index, initial=False):
        _, base_url, models = PROVIDERS[index] if index >= 0 else ('', '', [])
        self.api_fields['base_url'].setReadOnly(True)
        model = self.api_fields['model']
        previous = self.api_model_id()
        model.clear()
        model.setEditable(not bool(base_url))
        for model_id in models:
            model.addItem(model_display_name(model_id), model_id)
        if initial or not base_url:
            if model.isEditable():
                model.setEditText(previous)
                model.lineEdit().setPlaceholderText('输入自定义模型 ID')
            elif previous:
                selected = model.findData(previous)
                if selected < 0:
                    model.addItem(model_display_name(previous), previous)
                    selected = model.count() - 1
                model.setCurrentIndex(selected)
        if base_url:
            self.api_fields['base_url'].setText(base_url)
        if not initial and base_url:
            self.api_fields['api_key'].clear()

    def api_model_id(self):
        model = self.api_fields['model']
        return model.currentText() if model.isEditable() else (model.currentData() or '')

    def open_ai_help(self):
        if AI_HELP_URL:
            self.open_link(AI_HELP_URL)
        else:
            QMessageBox.information(self, '暂未开放', '配置帮助与低价购买服务暂未开放，敬请期待。')

    def build_settings(self, layout):
        self.heading(layout, '设置', '启动选项与本机数据管理')
        panel, form = card(layout)
        self.general_panel = panel
        form.addWidget(label('常规', 'sectionTitle'))
        self.auto_switch = Toggle(self.auto_scan, animate=not self.reduced_motion)
        self.auto_switch.setAccessibleName('启动时自动检查课程')
        self.motion_switch = Toggle(self.reduced_motion, animate=not self.reduced_motion)
        self.motion_switch.setAccessibleName('减少动画')
        for title, subtitle, control in [('启动时自动检查课程', '检查新增课程与任务点', self.auto_switch), ('减少动画', '关闭页面与开关过渡，操作即时响应', self.motion_switch)]:
            row = QHBoxLayout()
            text = QVBoxLayout()
            text.addWidget(label(title))
            text.addWidget(label(subtitle, 'muted'))
            row.addLayout(text, 1)
            row.addWidget(control)
            form.addLayout(row)
        self.auto_switch.toggled.connect(self.save_preferences)
        self.motion_switch.toggled.connect(self.save_preferences)
        panel, form = card(layout)
        self.data_panel = panel
        form.addWidget(label('本机数据', 'sectionTitle'))
        form.addWidget(label('清除平台账号、课程记录和独立浏览器登录资料。API 配置会保留。', 'muted', True))
        self.clear_button = button('清除本机账号与课程数据', self.clear_data, 'danger')
        form.addWidget(self.clear_button, alignment=Qt.AlignmentFlag.AlignLeft)
        layout.addStretch()

    def show_page(self, key):
        if hasattr(self, 'context_nav'):
            self.side_stack.switch(self.course_nav if key == 'courses' else self.context_nav[key])
        self.stack.switch(self.pages[key][0])
        for name, b in self.top_buttons.items():
            b.setChecked(name == key)
            b.setIcon(icon(self.top_glyphs[name], '#126dca' if name == key else 'white'))

    def toggle_maximized(self):
        self.showNormal() if self.isMaximized() else self.showMaximized()

    def changeEvent(self, event):
        super().changeEvent(event)
        if event.type() == QEvent.Type.WindowStateChange and hasattr(self, 'maximize_button'):
            maximized = self.isMaximized()
            self.maximize_button.setIcon(icon('restore' if maximized else 'maximize', 'white', 24))
            self.maximize_button.setAccessibleName('还原' if maximized else '最大化')
            self.update_window_shape()

    def update_window_shape(self):
        if self.isMaximized() or self.isFullScreen():
            self.clearMask()
            return
        # Windows 11 supplies smooth compositor corners. Other platforms use a mask.
        native_rounding = False
        if sys.platform == 'win32' and QApplication.platformName() == 'windows':
            if getattr(self, '_native_rounding', False):
                self.clearMask()
                return
            import ctypes
            from ctypes import wintypes
            preference = ctypes.c_int(2)
            try:
                result = ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    wintypes.HWND(int(self.winId())), 33,
                    ctypes.byref(preference), ctypes.sizeof(preference))
                native_rounding = result == 0
                self._native_rounding = native_rounding
            except (AttributeError, OSError):
                pass
        if native_rounding:
            self.clearMask()
        else:
            path = QPainterPath()
            path.addRoundedRect(QRectF(self.rect()), 9, 9)
            self.setMask(QRegion(path.toFillPolygon().toPolygon()))

    def showEvent(self, event):
        super().showEvent(event)
        self.enable_native_resize()
        self.update_window_shape()
        if not self._startup_shown:
            self._startup_shown = True
            QTimer.singleShot(0, self._start_startup)

    def _start_startup(self):
        if (getattr(self, '_closing', False) or self.reduced_motion
                or not self.isVisible() or self.isMaximized()
                or self.isFullScreen() or self.isMinimized()):
            return
        self._startup_origin = self.pos()
        self._startup_opacity = self.windowOpacity()
        self._startup_overlay = StartupFrame(self)
        QApplication.instance().installEventFilter(self)
        self._startup_overlay.show()
        self.setWindowOpacity(0.0)
        self.startup_animation.start()

    def _startup_frame(self, progress):
        if self._startup_origin is not None:
            self._startup_overlay.progress = float(progress)
            self._startup_overlay.update()

    def _finish_startup(self):
        self.startup_animation.stop()
        QApplication.instance().removeEventFilter(self)
        if self._startup_overlay is not None:
            self.setWindowOpacity(self._startup_opacity)
            self._startup_overlay.hide()
            self._startup_overlay.deleteLater()
            self._startup_overlay = None
        if self._startup_origin is not None:
            self.move(self._startup_origin)
            self._startup_origin = None

    def eventFilter(self, watched, event):
        if self._startup_origin is not None:
            if event.type() in (QEvent.Type.MouseButtonPress, QEvent.Type.NonClientAreaMouseButtonPress):
                if isinstance(watched, QWidget) and watched.window() in (self, self._startup_overlay):
                    overlay_click = watched.window() is self._startup_overlay
                    self._finish_startup()
                    if overlay_click:
                        return True
            elif watched is self and event.type() in (QEvent.Type.Hide, QEvent.Type.WindowStateChange):
                # Do not restore normal-window coordinates after maximizing/minimizing.
                if event.type() == QEvent.Type.WindowStateChange:
                    self._startup_origin = None
                self._finish_startup()
            elif watched is self and event.type() in (QEvent.Type.Resize, QEvent.Type.Move):
                self._startup_origin = None
                self._finish_startup()
        return super().eventFilter(watched, event)

    def enable_native_resize(self):
        """Frameless Qt windows omit WS_THICKFRAME; edge hits alone cannot resize."""
        if sys.platform != 'win32' or QApplication.platformName() != 'windows':
            return
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        hwnd = wintypes.HWND(int(self.winId()))
        get_style = user32.GetWindowLongPtrW
        get_style.argtypes = [wintypes.HWND, ctypes.c_int]
        get_style.restype = ctypes.c_ssize_t
        style = get_style(hwnd, -16)
        if style & 0x00040000:
            return
        set_style = user32.SetWindowLongPtrW
        set_style.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
        set_style.restype = ctypes.c_ssize_t
        set_style(hwnd, -16, style | 0x00040000 | 0x00010000 | 0x00020000)
        user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, 0x0037)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.update_window_shape()

    def nativeEvent(self, event_type, message):
        # Keep system edge/corner resizing despite removing the separate title bar.
        if sys.platform == 'win32':
            import ctypes
            from ctypes import wintypes
            msg = wintypes.MSG.from_address(int(message))
            if msg.message == 0x0083 and msg.wParam:  # WM_NCCALCSIZE
                return True, 0  # Retain the custom client/title bar, without native trim.
        if sys.platform == 'win32' and not self.isMaximized() and not self.isFullScreen():
            import ctypes
            from ctypes import wintypes
            msg = wintypes.MSG.from_address(int(message))
            if msg.message == 0x0084:  # WM_NCHITTEST, physical screen coordinates
                rect = wintypes.RECT()
                if ctypes.windll.user32.GetWindowRect(wintypes.HWND(int(self.winId())), ctypes.byref(rect)):
                    x = ctypes.c_short(msg.lParam & 0xffff).value
                    y = ctypes.c_short((msg.lParam >> 16) & 0xffff).value
                    border = max(5, round(5 * self.devicePixelRatioF()))
                    left, right = x < rect.left + border, x >= rect.right - border
                    upper, lower = y < rect.top + border, y >= rect.bottom - border
                    hit = (13 if left else 14 if right else 12) if upper else ((16 if left else 17 if right else 15) if lower else (10 if left else 11 if right else 0))
                    if hit:
                        return True, hit
        return super().nativeEvent(event_type, message)

    def build_context_navigation(self):
        self.context_nav = {}
        self.context_buttons = {}
        sections = {
            'accounts': ('平台账号', list(accounts.PLATFORMS.items())),
            'api': ('答题服务', [('connection', '连接配置')]),
            'settings': ('应用设置', [('general', '常规'), ('data', '本机数据')]),
        }
        for page, (heading, entries) in sections.items():
            pane = QWidget()
            pane.setObjectName('contextNav')
            layout = QVBoxLayout(pane)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(7)
            layout.addWidget(label(heading, 'sideSection'))
            self.context_buttons[page] = {}
            for index, (key, title) in enumerate(entries):
                control = button(title, lambda checked=False, p=page, k=key: self.select_section(p, k), 'nav')
                control.setCheckable(True)
                control.setChecked(index == 0)
                self.context_buttons[page][key] = control
                layout.addWidget(control)
            layout.addStretch()
            self.side_stack.addWidget(pane)
            self.context_nav[page] = pane
        for platform, panel in self.account_panels.items():
            panel.setVisible(platform == self.account_platform)

    def select_section(self, page, key):
        for name, control in self.context_buttons[page].items():
            control.setChecked(name == key)
        if page == 'accounts':
            self.account_platform = key
            for platform, panel in self.account_panels.items():
                panel.setVisible(platform == key)
            self.stack.enter()
        elif page == 'settings':
            target = self.general_panel if key == 'general' else self.data_panel
            self.pages[page][0].ensureWidgetVisible(target, 0, 16)
        else:
            self.api_fields['base_url'].setFocus()

    def show_platform(self, platform):
        self.platform_scans[self.platform] = self.current_scan
        self.platform_categories[self.platform] = self.category
        self.platform = platform
        self.current_scan = self.platform_scans.get(platform)
        self.category = self.platform_categories[platform]
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
        self.show_page('courses')
        self.refresh()
        self.stack.enter()

    def show_category(self, category):
        self.category = category
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
        self.show_page('courses')
        self.refresh()
        self.stack.enter()

    def selected(self):
        i = self.table.currentRow()
        return self.visible_pairs[i] if 0 <= i < len(self.visible_pairs) else (None, None)

    def refresh(self, *args):
        old, _ = self.selected() if hasattr(self, 'visible_pairs') else (None, None)
        try:
            prefix = {'chaoxing': 'cx:', 'mooc': 'mooc:', 'yuketang': 'yuketang:'}[self.platform]
            rows = [r for r in course_store.rows() if r['id'].startswith(prefix)]
        except Exception:
            self.status.setText('课程缓存读取失败，请检查目录权限后重试。')
            return
        self.pairs = (course_store.category_rows(rows, self.category, self.current_scan)
                      if self.platform == 'chaoxing' else
                      sorted([(r, course_store.category_metric(r, self.category, self.current_scan)) for r in rows],
                             key=lambda pair: (pair[1]['remaining'] is None, -(pair[1]['remaining'] or 0), pair[0]['name'])))
        query = self.search.text().strip().casefold()
        self.visible_pairs = [(r, m) for r, m in self.pairs if query in r['name'].casefold()]
        self.table.blockSignals(True)
        self.table.setRowCount(len(self.visible_pairs))
        for i, (row, m) in enumerate(self.visible_pairs):
            left = m['remaining']
            state = '上次记录' if not m['fresh'] else ('待确认' if left is None else ('已达标' if left == 0 else '待完成'))
            if self.platform == 'mooc' and m['fresh'] and left == 0:
                state = '已完成'
            if m.get('manual'):
                state += ' · 手工'
            tag = 'stale' if not m['fresh'] else ('unknown' if left is None else ('done' if left == 0 else 'todo'))
            pct = min(100, m['done'] * 100 // m['required']) if m['required'] and m['done'] is not None else None
            name = f"[{row.get('course_type') or 'MOOC'}] {row['name']}" if self.platform == 'mooc' else row['name']
            if self.platform == 'mooc' and m['required'] == 0 and m['fresh']:
                state = '暂无已发布项目'
            values = [str(i + 1).zfill(2), name, m['required'] if m['required'] is not None else '未量化', m['done'] if m['done'] is not None else '未识别', left if left is not None else '未识别', '', state, (m['checked'] or '—').replace('T', ' ')[:16]]
            for j, value in enumerate(values):
                item = QTableWidgetItem(str(value))
                item.setTextAlignment(Qt.AlignmentFlag.AlignVCenter | (Qt.AlignmentFlag.AlignLeft if j in (1, 6, 7) else Qt.AlignmentFlag.AlignHCenter))
                if j == 5:
                    item.setData(Qt.ItemDataRole.UserRole, pct)
                elif j == 6:
                    item.setData(Qt.ItemDataRole.UserRole, tag)
                self.table.setItem(i, j, item)
        if old:
            match = next((i for i, (r, m) in enumerate(self.visible_pairs) if r['id'] == old['id']), -1)
            if match >= 0:
                self.table.selectRow(match)
        self.table.blockSignals(False)
        self.select_course()
        metrics = [course_store.category_metric(r, self.category, self.current_scan) for r in rows]
        values = [sum(m['applies'] is True for m in metrics), sum(m['remaining'] for r, m in self.pairs if m['fresh'] and m['remaining'] is not None), sum(m['applies'] is False for m in metrics), sum(m['applies'] is None for m in metrics)]
        if self.platform == 'mooc':
            values[3] = sum(m['remaining'] is None for m in metrics)
        for key, value in zip(self.stat_values, values):
            self.stat_values[key].setText(str(value))
        for key, cx_title, mooc_title in [('count', '有要求的课程', '有已发布项目的课程'),
                                         ('hidden', '无此要求', '暂无已发布项目'),
                                         ('unknown', '要求待确认', '进度待确认')]:
            self.stat_titles[key].setText(mooc_title if self.platform == 'mooc' else cx_title)
        categories = {'chaoxing': course_store.CATEGORIES, 'mooc': course_store.MOOC_CATEGORIES,
                      'yuketang': course_store.YUKETANG_CATEGORIES}[self.platform]
        for index, key in enumerate(categories, 1):
            self.category_group.layout().insertWidget(index, self.category_buttons[key])
        self.table_title.setText(categories[self.category] + '进度')
        self.table_count.setText(f'{len(self.visible_pairs)} 门课程')
        self.table.horizontalHeaderItem(2).setText('已发布' if self.platform == 'mooc' else ('进行中' if self.category == 'task' else '要求'))
        self.table.update_content_widths()
        self.empty.setVisible(not self.visible_pairs)
        self.table.setVisible(bool(self.visible_pairs))
        self.empty.setText('没有匹配的课程' if query else '暂无课程记录，点击「检查课程信息」开始')
        self.summary.setText('包含 MOOC 与 SPOC · 统计当前已发布项目 · 讨论按课堂讨论完成标记统计' if self.platform == 'mooc' else '按剩余数量排序 · 上次记录需重新检查 · 双击待确认课程可手工核对')
        if self.platform == 'yuketang':
            self.summary.setText('按学习内容目录统计 · 自动跳过已打勾任务 · 考试仅保留入口')
        for k, b in self.platform_buttons.items():
            b.setChecked(k == self.platform)
        for k, b in self.category_buttons.items():
            b.setVisible(k in categories)
            if k in categories:
                b.setText('课件' if k == 'courseware' else categories[k])
            b.setChecked(k == self.category)
        self.update_controls()

    def select_course(self):
        row, m = self.selected()
        if not row:
            self.detail_title.setText('选择一门课程')
            self.detail_meta.setText('在上方列表中查看课程详情')
            self.detail_progress.setValue(0)
            self.detail_note.setText('首次使用，请先在「账号」中打开网页完成登录。')
        else:
            fmt = lambda x: str(x) if x is not None else '未识别'
            self.detail_title.setText(row['name'])
            self.detail_meta.setText(f"{'已发布' if self.platform == 'mooc' else '要求'} {fmt(m['required'])}   /   已完成 {fmt(m['done'])}   /   剩余 {fmt(m['remaining'])}")
            self.detail_progress.setValue(min(100, m['done'] * 100 // m['required']) if m['required'] and m['done'] is not None else 0)
            self.detail_note.setText(m['error'] or ('手工确认数据已保留，自动检查不会覆盖。' if m.get('manual') else ('上次保存的记录，请检查课程获取最新进度。' if not m['fresh'] else '可以打开课程核对，完成情况以平台记录为准。')))
            if self.platform == 'mooc' and self.category == 'courseware' and m.get('videos') is not None:
                video, document = m['videos'], m['documents']
                self.detail_note.setText(f"视频 {video['done']}/{video['required']}，文档 {document['done']}/{document['required']} 已完成。绿色标记为已完成，灰色为未完成。" + (' 上次记录，请重新检查。' if not m['fresh'] else '') + (' ' + m['error'] if m['error'] else ''))
            if self.platform == 'mooc' and self.category == 'homework':
                parts = ['作业按提交状态统计']
                for phase, title in [('peer', '互评'), ('self', '自评')]:
                    review = (m.get('reviews') or {}).get(phase)
                    if review is not None:
                        parts.append(f"{title}已完成 {fmt(review.get('done'))}/{fmt(review.get('required'))}")
                if not m['fresh']:
                    parts.append('上次记录，请重新检查')
                if m['error']:
                    parts.append(m['error'])
                self.detail_note.setText(' · '.join(parts))
        self.update_controls()

    def update_controls(self):
        busy = self.scanning or self.brushing or self.logging_in or self.pending_clear
        available = self.platform in {'chaoxing', 'yuketang'} and not busy
        runnable = self.category in (('video', 'exercise') if self.platform == 'yuketang' else ('chapter', 'visits'))
        video_controls = self.platform == 'chaoxing' and self.category == 'chapter' or self.platform == 'yuketang' and self.category == 'video'
        self.speed_label.setVisible(video_controls)
        self.playback_speed.setVisible(video_controls)
        self.playback_speed.setEnabled(not busy)
        row, m = self.selected() if hasattr(self, 'visible_pairs') else (None, None)
        self.scan_button.setEnabled(not busy)
        self.stop_button.setEnabled(busy)
        self.busy.setVisible(busy)
        self.one_button.setEnabled(available and row is not None and runnable)
        self.all_button.setEnabled(available and runnable)
        self.open_button.setEnabled(not busy and row is not None)
        self.manual_button.setEnabled(not busy and row is not None and (m.get('manual') or not m['fresh'] or m['remaining'] is None))
        self.clear_button.setEnabled(not self.pending_clear)
        self.clear_button.setText('正在停止任务…' if self.pending_clear else '清除本机账号与课程数据')
        self.clear_button.setToolTip('确认后先停止后台任务，再清除本机数据。' if busy else '清除本机账号、课程记录和浏览器登录资料，API 配置保留。')
        for platform, fields in self.account_fields.items():
            for field in fields:
                field.setEnabled(not self.logging_in)
            self.account_save_buttons[platform].setEnabled(not busy)
            self.account_clear_buttons[platform].setEnabled(not busy)
            self.account_verify_buttons[platform].setEnabled(not busy)
            self.account_web_buttons[platform].setEnabled(not busy)
        self.one_button.setText('补足所选次数' if self.category == 'visits' else '刷所选课程')
        self.all_button.setText('自动补足学习次数' if self.category == 'visits' else '自动刷课')

    def run_worker(self, fn, event='notice'):
        def work():
            try:
                result = fn()
            except Exception as exc:
                result = str(exc) if isinstance(exc, (RuntimeError, ValueError)) else '操作失败，请检查网络与本机权限后重试。'
            self.events.put((event, result))
        thread = threading.Thread(target=work, daemon=True)
        self.threads.append(thread)
        thread.start()

    def start_scan(self):
        if self.pending_clear or self.scanning or self.brushing or self.logging_in:
            return
        self.scanning = True
        self.stop_event.clear()
        self.current_scan = uuid.uuid4().hex
        scan_id = self.current_scan
        platform = self.platform
        self.platform_scans[platform] = scan_id
        self.status.setText('正在后台检查课程…')
        self.refresh()
        def work():
            from course_scanner import scan_courses
            report = lambda msg: self.events.put(('scan_progress', msg))
            return scan_courses(scan_id, self.stop_event, report, platform=platform)
        self.run_worker(work, 'scan_done')

    def stop_work(self):
        self.stop_event.set()
        self.login_stop.set()
        self.status.setText('正在停止，请等待后台任务退出…')

    def brush_options_dialog(self):
        rain = getattr(self, 'platform', '') == 'yuketang'
        dialog = QDialog(self)
        dialog.setWindowTitle('选择刷课内容')
        dialog.setMinimumWidth(420)
        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(16)
        layout.addWidget(label('选择本次处理内容', 'sectionTitle'))
        choices = {}
        for key, title in (('materials', '视频学习' if rain else '视频课件（含 PPT、文档、知识扩展）'),
                           ('quiz', '习题' if rain else '测验'), ('exam', '考试（预留）' if rain else '考试')):
            check = PlainCheckBox(title)
            check.setObjectName('brush_option_' + key)
            check.setChecked(not (rain and key == 'exam'))
            check.setEnabled(not (rain and key == 'exam'))
            choices[key] = check
            layout.addWidget(check)
        layout.addWidget(label('自动跳过目录中已打勾的任务；考试仅保留入口。' if rain else '考试暂未接入自动处理，需在课程页面手动完成。', 'muted', True))
        actions = QDialogButtonBox(QDialogButtonBox.Cancel | QDialogButtonBox.Ok)
        actions.button(QDialogButtonBox.Cancel).setText('取消')
        start = actions.button(QDialogButtonBox.Ok)
        start.setText('开始刷课')
        def update():
            start.setEnabled(any(check.isChecked() for check in choices.values()))
        for check in choices.values():
            check.toggled.connect(update)
        actions.accepted.connect(dialog.accept)
        actions.rejected.connect(dialog.reject)
        layout.addWidget(actions)
        if dialog.exec() != QDialog.Accepted:
            return None
        return {key: check.isChecked() for key, check in choices.items()}

    def start_brush(self, only_selected):
        rain = self.platform == 'yuketang'
        if self.pending_clear or self.scanning or self.brushing or self.logging_in or self.platform not in {'chaoxing', 'yuketang'} or self.category not in (('video', 'exercise') if rain else ('chapter', 'visits')):
            return
        row, metric = self.selected()
        task_options = self.brush_options_dialog() if rain else None
        if rain and task_options is None:
            return
        if only_selected:
            items = [row] if row else []
        elif rain:
            chosen = [key for key, option in (('video', 'materials'), ('exercise', 'quiz')) if task_options[option]]
            items = [row for row, metric in self.pairs if any(
                (progress := course_store.category_metric(row, category, self.current_scan))['fresh']
                and progress['remaining'] is not None and progress['remaining'] > 0 for category in chosen)]
        elif self.category == 'visits':
            items = [r for r, m in self.pairs if m['fresh'] and m['remaining'] is not None and m['remaining'] > 0]
        else:
            items = course_store.plan([r for r, m in self.pairs], self.current_scan)
        if not items:
            self.status.setText('暂无可执行的待办，请先检查课程并选择课程。')
            return
        if self.category == 'chapter':
            task_options = self.brush_options_dialog()
            if task_options is None:
                return
            if not task_options['materials'] and not task_options['quiz']:
                self.status.setText('考试暂未接入自动处理，请打开课程手动完成。')
                return
        self.brushing = True
        self.stop_event.clear()
        action = self.work_action = 'yuketang_brush' if rain else 'visits' if self.category == 'visits' else 'brush'
        playback_speed = self.playback_speed.currentData()
        scan = self.current_scan = self.current_scan or uuid.uuid4().hex
        self.update_controls()
        def event_received(event):
            if event.get('type') == 'progress':
                self.events.put(('notice', event['message']))
            elif event.get('type') == 'visits':
                self.events.put(('visit_result', dict(url=event['url'], visits=event['visits'], scan=scan)))
        def work():
            last_result = None
            for i, row in enumerate(items, 1):
                if self.stop_event.is_set():
                    break
                self.events.put(('notice', f"正在处理 {i}/{len(items)}：{row['name']}"))
                options = {'playback_speed': playback_speed, 'task_options': task_options} if action in {'brush', 'yuketang_brush'} else {}
                result = browser_link.run_task(action, self.stop_event, event_received, row['url'], **options)
                last_result = str(result)
                self.events.put(('notice', str(result)))
                if any(s in str(result) for s in ('暂停', '失败', '未识别', '未登录', '未能识别', '未找到', '出错', '已保留', '保留课程页面')):
                    return str(result)
            return '任务已停止。' if self.stop_event.is_set() else (last_result if only_selected and last_result else '队列处理结束，请重新检查课程确认平台实际进度。')
        self.run_worker(work, 'brush_done')

    def open_link(self, url):
        if self.scanning or self.brushing or self.logging_in:
            self.status.setText('请先停止当前任务，再打开网页。')
            return
        self.run_worker(lambda: browser_link.open_url(url))

    def open_selected(self):
        row, _ = self.selected()
        if row:
            self.open_link(row['url'])

    def manual_dialog(self):
        if self.scanning or self.brushing or self.logging_in:
            return
        row, metric = self.selected()
        if not row or (metric['fresh'] and metric['remaining'] is not None and not metric.get('manual')):
            return
        dialog = QDialog(self)
        dialog.setWindowTitle('手工确认数量')
        dialog.setMinimumWidth(430)
        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(16)
        layout.addWidget(label(row['name'], 'sectionTitle'))
        layout.addWidget(label('手工确认的数值会保存，自动检查不会覆盖。', 'muted', True))
        form = QFormLayout()
        required, done = QSpinBox(), QSpinBox()
        for field in (required, done):
            field.setRange(0, 10000000)
        required.setValue(metric['required'] or 0)
        done.setValue(metric['done'] or 0)
        form.addRow('要求总数', required)
        form.addRow('已完成', done)
        layout.addLayout(form)
        actions = QHBoxLayout()
        def save():
            try:
                course_store.manual_confirm(row['url'], self.category, required.value(), done.value(), self.current_scan)
            except Exception as exc:
                QMessageBox.warning(dialog, '无法保存', str(exc))
                return
            dialog.accept()
            self.refresh()
        def clear():
            try:
                course_store.clear_manual(row['url'])
            except Exception:
                QMessageBox.warning(dialog, '无法清除', '记录未能修改，请重试。')
                return
            dialog.accept()
            self.refresh()
        actions.addWidget(button('清除手工确认', clear))
        actions.addStretch()
        actions.addWidget(button('取消', dialog.reject))
        actions.addWidget(button('保存', save, 'primary'))
        layout.addLayout(actions)
        dialog.exec()

    def set_account_login_state(self, platform, state):
        if self.account_verified.get(platform) and state != 'unverified':
            state = 'success'
        styles = {
            'success': ('登录成功', '#eaf6ef', '#28764e'),
            'pending': ('正在验证登录…', '#e8f3fd', '#1675c9'),
            'captcha': ('需要验证', '#fff5e6', '#9a651c'),
            'invalid_credentials': ('登录失败', '#fff0f0', '#b3424a'),
            'error': ('登录失败', '#fff0f0', '#b3424a'),
            'not_logged_in': ('未登录', '#f0f3f7', '#718297'),
            'cancelled': ('已取消', '#f0f3f7', '#718297'),
            'unverified': ('未验证', '#f0f3f7', '#718297'),
        }
        text, background, color = styles.get(state, styles['unverified'])
        badge = self.account_login_badges[platform]
        badge.setText(text)
        badge.setStyleSheet(f'background: {background}; color: {color}; border-radius: 5px; padding: 5px 10px;')

    def account_edited(self, platform):
        was_verified = self.account_verified.get(platform, False)
        self.account_verified[platform] = False
        self.account_fields[platform][0].set_verified(False)
        try:
            if was_verified:
                accounts.set_verified(platform, False)
        except Exception:
            self.status.setText('认证状态未能保存，请保存修改后的账号重新认证。')
        self.account_notes[platform].setText('有未保存的修改')
        self.account_notes[platform].setStyleSheet('')
        self.set_account_login_state(platform, 'unverified')

    def open_account_login(self, platform):
        if platform in {'mooc', 'yuketang'} and all(field.text() for field in self.account_fields[platform]):
            self.save_account(platform, visible=True)
        else:
            self.start_account_login(visible=True, manual=True, platform=platform)

    def save_account(self, platform, visible=False):
        if self.scanning or self.brushing or self.logging_in:
            self.account_notes[platform].setText('请先停止当前任务，再保存并登录。')
            return
        user, password = self.account_fields[platform]
        try:
            accounts.save_account(platform, accounts.Account(user.account_text(), password.text()))
        except Exception as exc:
            QMessageBox.warning(self, '无法保存账号', str(exc))
            return
        self.password_visible[platform].setChecked(False)
        if self.account_verified.get(platform) and not visible:
            self.account_notes[platform].setText('登录成功')
            self.set_account_login_state(platform, 'success')
            return
        self.account_notes[platform].setText('已加密保存')
        self.start_account_login(platform=platform, visible=visible)

    def start_account_login(self, visible=False, check_only=False, platform='chaoxing', manual=False):
        if self.pending_clear or self.scanning or self.brushing or self.logging_in:
            return
        self.logging_in = True
        user, password = self.account_fields[platform]
        self.login_account_snapshot = accounts.Account(user.account_text().strip(), password.text())
        self.set_account_login_state(platform, 'pending')
        self.account_notes[platform].setStyleSheet('')
        self.login_stop.clear()
        ticket = self.login_ticket = uuid.uuid4().hex
        self.account_notes[platform].setText(('正在打开 MOOC 登录框并填写账号…' if platform == 'mooc' else '请在打开的网页完成验证码。') if visible else '正在检查登录状态…' if check_only else '已保存，正在后台登录…')
        if platform == 'yuketang' and not check_only:
            self.account_notes[platform].setText('正在打开长江雨课堂登录页，请在网页完成验证。')
        if manual:
            self.account_notes[platform].setText('正在启动网页登录窗口…')
        self.account_verify_buttons[platform].hide()
        self.update_controls()
        def work():
            try:
                options = dict(visible=visible, check_only=check_only, platform=platform)
                if manual:
                    options['manual'] = True
                    options['on_progress'] = lambda message: self.events.put(('account_login_progress', dict(ticket=ticket, platform=platform, message=message)))
                result = browser_link.login_account(self.login_stop, **options)
            except Exception as error:
                result = {'status': 'cancelled' if self.login_stop.is_set() else 'error'}
                if manual and isinstance(error, RuntimeError):
                    result['message'] = str(error)
            if not isinstance(result, dict):
                result = {'status': 'error'}
            return dict(result, ticket=ticket, visible=visible, platform=platform, manual=manual, check_only=check_only)
        self.run_worker(work, 'account_login_done')

    def account_login_done(self, result):
        if not isinstance(result, dict) or result.get('ticket') != self.login_ticket:
            return
        self.logging_in = False
        platform = result.get('platform', 'chaoxing')
        status = result.get('status')
        remembered = True
        if status == 'success':
            self.account_verified[platform] = True
            self.account_fields[platform][0].set_verified(not result.get('manual'))
            try:
                if not result.get('manual') and (self.login_account_snapshot.username or not result.get('check_only')):
                    remembered = accounts.set_verified(platform, True, self.login_account_snapshot)
            except Exception:
                remembered = False
        self.set_account_login_state(platform, status)
        messages = {'success': '登录成功', 'invalid_credentials': '账号或密码错误，请修改后重新登录。',
                    'captcha': '需要验证码，请在网页中完成验证后点击重新检查。',
                    'error': '登录失败，请检查网络或打开网页登录后重试。',
                    'cancelled': '登录已取消。', 'not_logged_in': '尚未登录，请先在网页完成验证。'}
        note = self.account_notes[platform]
        note.setText(messages.get(status, messages['error']))
        if result.get('manual') and status == 'success':
            note.setText('网页登录成功，登录状态已保留在本机，下次可继续使用。')
        elif result.get('manual') and status == 'error':
            note.setText(result.get('message') or '登录窗口连接或页面加载失败，请重试。')
        if platform == 'mooc' and status in ('error', 'not_logged_in'):
            reasons = {
                'open_page': 'MOOC 页面打开失败，请检查网络后重试。',
                'open_login': '未能打开 MOOC 登录框，请打开网页登录后重新检查。',
                'select_mode': '未能切换 MOOC 登录方式，请打开网页登录后重新检查。',
                'load_form': 'MOOC 密码登录框未加载完成，请重试或打开网页登录。',
                'fill_form': 'MOOC 账号或密码输入框不可用，请打开网页登录后重新检查。',
                'submit': 'MOOC 登录按钮未能提交，请打开网页登录后重新检查。',
                'confirm_login': '尚未确认 MOOC 登录成功，请在网页完成验证后重新检查。',
            }
            note.setText(reasons.get(result.get('reason'), note.text()))
        if status == 'success' and not remembered:
            note.setText('登录成功，但认证状态未能保存，请重新保存账号后验证。')
        note.setStyleSheet('color: #b3424a;' if status == 'invalid_credentials' else 'color: #28764e;' if status == 'success' else '')
        self.status.setText(note.text())
        self.account_verify_buttons[platform].setVisible(status in ('captcha', 'not_logged_in'))
        self.update_controls()
        if status == 'captcha' and not result.get('visible') and not self.login_stop.is_set():
            self.start_account_login(visible=True, platform=platform)

    def clear_account(self, platform):
        if self.logging_in or self.scanning or self.brushing:
            return
        try:
            accounts.clear_account(platform)
        except Exception:
            QMessageBox.warning(self, '无法清除', '账号文件未能修改，请重试。')
            return
        for field in self.account_fields[platform]:
            field.clear()
        self.password_visible[platform].setChecked(False)
        self.account_notes[platform].setText('已清除保存，浏览器登录状态不受影响')
        self.account_verified[platform] = False
        self.account_notes[platform].setStyleSheet('')
        self.set_account_login_state(platform, 'unverified')

    def api_config(self):
        config = APIConfig(**{k: (self.api_model_id() if isinstance(v, QComboBox) else v.text()).strip()
                              for k, v in self.api_fields.items()}, timeout=self.api_timeout.value())
        config.endpoint()
        return config

    def save_api(self):
        try:
            settings.save(self.api_config())
        except Exception as exc:
            QMessageBox.warning(self, '无法保存', str(exc))
            return
        self.status.setText('API 配置已保存，密钥在本机加密。')

    def test_api(self):
        try:
            provider = AnswerProvider(self.api_config())
        except Exception as exc:
            QMessageBox.warning(self, '请检查配置', str(exc))
            return
        self.test_button.setEnabled(False)
        self.status.setText('正在测试连接…')
        self.run_worker(provider.test_connection, 'api_done')

    def save_preferences(self, *args):
        self.auto_scan = self.auto_switch.isChecked()
        self.reduced_motion = self.motion_switch.isChecked()
        if self.reduced_motion:
            self._finish_startup()
        self.busy.sync_animation()
        self.stack.animate = not self.reduced_motion
        self.side_stack.animate = not self.reduced_motion
        if self.reduced_motion:
            self.stack.fade.stop()
            self.stack.finish()
            self.side_stack.fade.stop()
            self.side_stack.finish()
        for control in (self.auto_switch, self.motion_switch):
            control.animate = not self.reduced_motion
            if self.reduced_motion:
                control.animation.stop()
                control.frame(float(control.isChecked()))
        try:
            self.preferences_path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.preferences_path.with_suffix('.tmp')
            temp.write_text(json.dumps(dict(version=1, auto_scan=self.auto_scan, reduced_motion=self.reduced_motion)), encoding='utf-8')
            temp.replace(self.preferences_path)
            self.status.setText('设置已保存。')
        except OSError:
            self.status.setText('设置保存失败，请检查目录权限。')

    def clear_data(self):
        if self.pending_clear:
            return
        busy = self.scanning or self.brushing or self.logging_in
        message = ('将先停止当前后台任务，再清除平台账号、课程记录和独立浏览器登录资料。' if busy else '将清除平台账号、课程记录和独立浏览器登录资料。') + 'API 配置保留。确定清除？'
        confirm = QMessageBox(QMessageBox.Icon.Question, '清除本机数据', message,
                              QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, self)
        confirm.button(QMessageBox.StandardButton.Yes).setText('是的！')
        confirm.button(QMessageBox.StandardButton.No).setText('点错了')
        confirm.setDefaultButton(QMessageBox.StandardButton.No)
        confirm.setEscapeButton(QMessageBox.StandardButton.No)
        if confirm.exec() != QMessageBox.StandardButton.Yes:
            return
        self.pending_clear = True
        if self.scanning or self.brushing or self.logging_in:
            self.stop_work()
        self.update_controls()
        self.wait_to_clear_data()

    def wait_to_clear_data(self):
        if getattr(self, '_closing', False):
            self.pending_clear = False
            return
        if self.scanning or self.brushing or self.logging_in:
            QTimer.singleShot(250, self.wait_to_clear_data)
            return
        self.clear_data_after_stop()

    def clear_data_after_stop(self):
        errors = []
        for platform in self.account_fields:
            try:
                accounts.clear_account(platform)
                for field in self.account_fields[platform]:
                    field.clear()
                self.account_notes[platform].setText('已清除保存')
                self.account_verified[platform] = False
                self.account_notes[platform].setStyleSheet('')
                self.set_account_login_state(platform, 'unverified')
            except Exception:
                errors.append(accounts.PLATFORMS[platform] + '账号清除失败')
        for title, fn in [('课程记录', course_store.clear_all), ('浏览器资料', browser_link.clear_profile)]:
            try:
                fn()
            except Exception:
                errors.append(title + '清除失败')
        self.current_scan = None
        self.platform_scans.clear()
        self.pending_clear = False
        self.refresh()
        self.update_controls()
        self.status.setText('；'.join(errors) if errors else '本机数据已清除，请重新登录。')

    def poll(self):
        self.threads = [t for t in self.threads if t.is_alive()]
        while True:
            try:
                kind, result = self.events.get_nowait()
            except queue.Empty:
                return
            if kind == 'visit_result':
                try:
                    course_store.record_visits(result['url'], result['visits'], result['scan'])
                except Exception:
                    self.status.setText('次数保存失败，请重新检查。')
                self.schedule_refresh()
                continue
            if kind == 'account_login_done':
                self.account_login_done(result)
                continue
            if kind == 'account_login_progress':
                if result.get('ticket') == self.login_ticket and self.logging_in:
                    self.account_notes[result['platform']].setText(result['message'])
                    self.status.setText(result['message'])
                continue
            self.status.setText(str(result))
            if kind == 'scan_done':
                self.scanning = False
            if kind == 'brush_done':
                self.brushing = False
            if kind == 'api_done':
                self.test_button.setEnabled(True)
            if kind in ('scan_progress', 'scan_done', 'brush_done'):
                self.schedule_refresh()
            self.update_controls()

    def schedule_refresh(self):
        if getattr(self, '_closing', False):
            return
        if self.refresh_pending:
            return
        self.refresh_pending = True
        QTimer.singleShot(60, self.flush_refresh)

    def flush_refresh(self):
        if getattr(self, '_closing', False):
            return
        if self.stack.moving_page is not None:
            QTimer.singleShot(40, self.flush_refresh)
            return
        self.refresh_pending = False
        self.refresh()

    def closeEvent(self, event):
        self._closing = True
        self._finish_startup()
        self.stop_event.set()
        self.login_stop.set()
        self.timer.stop()
        self.busy.animation.stop()
        for stack in (self.stack, self.side_stack):
            stack.fade.stop()
            stack.finish()
        for control in self.findChildren(PclButton):
            control.press_animation.stop()
        event.accept()


def main():
    application = QApplication(sys.argv)
    # The offscreen platform does not discover Windows system fonts itself.
    if application.platformName() == 'offscreen':
        import os
        for file in ('msyh.ttc', 'msyhbd.ttc', 'segoeui.ttf'):
            path = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / file
            if path.exists():
                QFontDatabase.addApplicationFont(str(path))
    application.setStyle('Fusion')
    application.setStyleSheet(STYLE)
    application.setFont(QFont('Microsoft YaHei UI', 10))
    window = Window(auto_start='--preview' not in sys.argv)
    window.show()
    if '--preview' in sys.argv:
        # Paint widgets directly to a high-DPI pixmap, without capturing other apps.
        def capture():
            folder = ROOT / '.test-artifacts'
            folder.mkdir(exist_ok=True)
            window.stack.animate = False
            window.side_stack.animate = False
            # Preview never reads account plaintext into an exported screenshot.
            for fields in window.account_fields.values():
                for entry in fields:
                    entry.clear()
            for page in window.pages:
                window.show_page(page)
                application.processEvents()
                window.grab().save(str(folder / f'pcl-{page}.png'))
                if page == 'courses':
                    window.title_bar.grab().save(str(folder / 'pcl-topbar.png'))
            window.close()
        QTimer.singleShot(600, capture)
    result = application.exec()
    window.close()
    window.deleteLater()
    application.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
