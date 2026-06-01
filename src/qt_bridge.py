"""Thread-safe bridge for Qt operations that must run on the main thread."""
from __future__ import annotations

from PyQt6.QtCore import QObject, pyqtSignal, pyqtSlot

_dispatcher: "_OpacityDispatcher | None" = None


class _OpacityDispatcher(QObject):
    _sig = pyqtSignal(str, float)

    def __init__(self) -> None:
        super().__init__()
        self._sig.connect(self._on_set_opacity)

    @pyqtSlot(str, float)
    def _on_set_opacity(self, uid: str, level: float) -> None:
        try:
            from webview.platforms.qt import BrowserView
            bv = BrowserView.instances.get(uid)
            if bv is not None:
                bv.setWindowOpacity(level)
        except Exception:
            pass

    def emit_opacity(self, uid: str, level: float) -> None:
        self._sig.emit(uid, level)


def init_dispatcher() -> None:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = _OpacityDispatcher()


def set_opacity(uid: str, level: float) -> None:
    if _dispatcher is not None:
        _dispatcher.emit_opacity(uid, level)
