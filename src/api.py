"""Python <-> JavaScript bridge.

All methods that operate on a specific item receive a ``path``
(list of integers) instead of a simple index, to support the
recursive tree structure.

Path examples:
    [0]      -> first root item
    [0, 2]   -> third child of the first root item
    [1, 0, 1] -> second child of the first child of the second root item

Every mutating method returns ``snapshot()`` so the JS can redraw
the UI with a single call.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import asdict
from typing import Any

from .storage import (
    DATA_FILE,
    OPACITY_LABELS,
    OPACITY_LEVELS,
    AppState,
    Item,
    load_state,
    save_state,
)


class Api:
    def __init__(self) -> None:
        self.state: AppState = load_state()
        self.window: Any = None
        self._file_mtime: float = self._get_mtime()

    def attach_window(self, window: Any) -> None:
        self.window = window
        window.events.closing += self._on_closing
        window.events.shown += self._on_shown
        self._start_watcher()

    def snapshot(self) -> dict:
        self._sync_from_disk()
        return {
            "items": [asdict(i) for i in self.state.items],
            "pinned": self.state.pinned,
            "opacity": {
                "index": self.state.opacity_index,
                "level": OPACITY_LEVELS[self.state.opacity_index],
                "label": OPACITY_LABELS[self.state.opacity_index],
            },
        }

    # --- root items ---------------------------------------------------------

    def add_task(self, text: str) -> dict:
        if text.strip():
            self.state.items.append(Item(kind="task", text=text.strip()))
        return self._persist()

    def add_note(self, text: str) -> dict:
        if text.strip():
            self.state.items.append(Item(kind="note", text=text.strip()))
        return self._persist()

    # --- creation with inline children --------------------------------------

    def create_task(self, nome: str, filhos: list[dict] | None = None) -> dict:
        nome = nome.strip()
        if not nome:
            return self.snapshot()
        self.state.items.append(self._build_item("task", nome, filhos))
        return self._persist()

    def create_note(self, nome: str, filhos: list[dict] | None = None) -> dict:
        nome = nome.strip()
        if not nome:
            return self.snapshot()
        self.state.items.append(self._build_item("note", nome, filhos))
        return self._persist()

    # --- children -----------------------------------------------------------

    def add_child(self, parent_path: list[int], text: str, kind: str = "task") -> dict:
        text = text.strip()
        if not text or kind not in ("task", "note"):
            return self.snapshot()
        parent = self._get(parent_path)
        if parent is not None:
            parent.children.append(Item(kind=kind, text=text))
        return self._persist()

    # --- item operations ----------------------------------------------------

    def toggle_done(self, path: list[int]) -> dict:
        item = self._get(path)
        if item is not None and item.kind == "task":
            item.done = not item.done
        return self._persist()

    def edit_item(self, path: list[int], new_text: str) -> dict:
        item = self._get(path)
        if item is not None and new_text.strip():
            item.text = new_text.strip()
        return self._persist()

    def edit_task(
        self,
        path: list[int],
        nome: str | None = None,
        filhos: list[dict] | None = None,
    ) -> dict:
        item = self._get(path)
        if item is None:
            return self.snapshot()
        if nome is not None and nome.strip():
            item.text = nome.strip()
        if filhos is not None:
            item.children = [
                self._build_item(
                    f.get("tipo", "task"),
                    str(f.get("nome", "")).strip(),
                    f.get("filhos"),
                )
                for f in filhos
                if str(f.get("nome", "")).strip()
            ]
        return self._persist()

    def delete_item(self, path: list[int]) -> dict:
        lst = self._get_list(path)
        idx = path[-1]
        if lst is not None and 0 <= idx < len(lst):
            del lst[idx]
        return self._persist()

    def move_item(self, from_path: list[int], to_parent_path: list[int], to_index: int) -> dict:
        if from_path == to_parent_path:
            return self.snapshot()
        if (len(to_parent_path) > len(from_path) and
                to_parent_path[: len(from_path)] == from_path):
            return self.snapshot()

        item = self._get(from_path)
        if item is None:
            return self.snapshot()
        from_list = self._get_list(from_path)
        if from_list is None:
            return self.snapshot()

        if to_parent_path:
            to_parent = self._get(to_parent_path)
            if to_parent is None:
                return self.snapshot()
            to_list = to_parent.children
        else:
            to_list = self.state.items

        from_idx = from_path[-1]
        same_parent = (from_path[:-1] == to_parent_path)
        from_list.pop(from_idx)

        if same_parent and from_idx < to_index:
            to_index -= 1

        to_index = max(0, min(to_index, len(to_list)))
        to_list.insert(to_index, item)
        return self._persist()

    def clear_all(self) -> dict:
        self.state.items.clear()
        return self._persist()

    # --- window -------------------------------------------------------------

    def toggle_pin(self) -> dict:
        self.state.pinned = not self.state.pinned
        if self.window is not None:
            self.window.on_top = self.state.pinned
        return self._persist()

    def cycle_opacity(self) -> dict:
        self.state.opacity_index = (self.state.opacity_index + 1) % len(OPACITY_LEVELS)
        self._apply_opacity(OPACITY_LEVELS[self.state.opacity_index])
        return self._persist()

    def close_app(self) -> None:
        if self.window is not None:
            self.window.destroy()

    # --- tree navigation ----------------------------------------------------

    def _get_list(self, path: list[int]) -> list[Item] | None:
        lst: list[Item] = self.state.items
        try:
            for idx in path[:-1]:
                lst = lst[idx].children
            return lst
        except (IndexError, AttributeError):
            return None

    def _get(self, path: list[int]) -> Item | None:
        lst = self._get_list(path)
        if lst is None:
            return None
        try:
            return lst[path[-1]]
        except IndexError:
            return None

    # --- internal helpers ---------------------------------------------------

    def _build_item(self, tipo: str, nome: str, filhos: list[dict] | None) -> Item:
        kind: Any = tipo if tipo in ("task", "note") else "task"
        children: list[Item] = []
        for f in filhos or []:
            f_tipo = f.get("tipo", "task")
            f_nome = str(f.get("nome", "")).strip()
            if f_nome:
                children.append(self._build_item(f_tipo, f_nome, f.get("filhos")))
        return Item(kind=kind, text=nome, children=children)

    def _persist(self) -> dict:
        save_state(self.state)
        self._file_mtime = self._get_mtime()
        return self.snapshot()

    @staticmethod
    def _get_mtime() -> float:
        try:
            return DATA_FILE.stat().st_mtime
        except FileNotFoundError:
            return 0.0

    def _sync_from_disk(self) -> None:
        mtime = self._get_mtime()
        if mtime > self._file_mtime:
            self.state = load_state()
            self._file_mtime = mtime

    def _start_watcher(self) -> None:
        self._watching = True
        t = threading.Thread(target=self._watch_loop, daemon=True)
        t.start()

    def _watch_loop(self) -> None:
        while self._watching:
            time.sleep(1)
            mtime = self._get_mtime()
            if mtime > self._file_mtime:
                self._file_mtime = mtime
                self.state = load_state()
                self._push_refresh()

    def _push_refresh(self) -> None:
        if self.window is None:
            return
        try:
            snap = json.dumps(self.snapshot(), ensure_ascii=False)
            self.window.evaluate_js(f"refresh({snap})")
        except Exception:
            pass

    def _on_shown(self) -> None:
        self._apply_opacity(OPACITY_LEVELS[self.state.opacity_index])

    def _apply_opacity(self, level: float) -> None:
        try:
            from src.qt_bridge import set_opacity
            set_opacity(self.window.uid, level)
        except Exception:
            pass

    def _on_closing(self) -> None:
        self._watching = False
        if self.window is None:
            return
        try:
            x = self.window.x
            y = self.window.y
            w = self.window.width
            h = self.window.height
            if None not in (x, y, w, h):
                self.state.window.x = int(x)
                self.state.window.y = int(y)
                self.state.window.width = int(w)
                self.state.window.height = int(h)
        except Exception:
            pass
        save_state(self.state)
