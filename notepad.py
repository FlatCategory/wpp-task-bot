"""Notepad — GUI + CLI.

GUI:  python notepad.py
CLI:  python notepad.py '{"Shopping": {"Milk": {}, "Bread": {}}}'
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from src.storage import append_tasks


def _start_gui() -> None:
    os.environ.setdefault("QT_QPA_PLATFORM", "xcb")

    from PyQt6.QtCore import Qt
    from PyQt6.QtWidgets import QApplication

    if QApplication.instance() is None:
        QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
        QApplication(sys.argv[:1])

    import webview
    from src.api import Api
    from src.qt_bridge import init_dispatcher

    init_dispatcher()
    api = Api()

    window = webview.create_window(
        title="Notepad",
        url=str(Path(__file__).parent / "ui" / "index.html"),
        js_api=api,
        width=340,
        height=480,
        x=api.state.window.x,
        y=api.state.window.y,
        on_top=api.state.pinned,
        resizable=True,
    )

    api.attach_window(window)
    webview.start(debug=False, gui="qt")


def _clean_json(raw: str) -> str:
    """Strip markdown fences (```json ... ```) that LLMs often add."""
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
    if s.endswith("```"):
        s = s[: -3]
    return s.strip()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        data = json.loads(_clean_json(sys.argv[1]))
        append_tasks(data)
        print(json.dumps({"ok": True, "added": list(data.keys())}))
    else:
        _start_gui()
