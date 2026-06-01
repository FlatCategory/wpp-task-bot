"""Data models and JSON persistence.

Item is a recursive tree: each task can have ``children``,
which are also ``Item``. Notes are always leaves.

The "path" of an item is a list of indices, e.g.:
    [2]      -> third root item
    [2, 0]   -> first child of that item
    [2, 0, 1] -> second child of that child
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

DATA_FILE = Path.home() / ".agenda_notepad.json"

OPACITY_LEVELS: list[float] = [1.0, 0.75, 0.5]
OPACITY_LABELS: list[str] = ["100%", "75%", "50%"]


@dataclass
class Item:
    kind: Literal["task", "note"]
    text: str
    done: bool = False
    children: list[Item] = field(default_factory=list)


@dataclass
class WindowGeom:
    x: int = 120
    y: int = 120
    width: int = 340
    height: int = 480


@dataclass
class AppState:
    items: list[Item] = field(default_factory=list)
    pinned: bool = True
    opacity_index: int = 0
    window: WindowGeom = field(default_factory=WindowGeom)


# ---------------------------------------------------------------------------
# (De)serialization helpers
# ---------------------------------------------------------------------------

def _item_from_dict(d: dict) -> Item:
    """Build an Item recursively from a JSON dictionary."""
    return Item(
        kind=d["kind"],
        text=d["text"],
        done=d.get("done", False),
        children=[_item_from_dict(c) for c in d.get("children", [])],
    )


def load_state() -> AppState:
    """Read JSON from disk; return default state if missing or invalid."""
    if not DATA_FILE.exists():
        return AppState()
    try:
        raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return AppState(
            items=[_item_from_dict(it) for it in raw.get("items", [])],
            pinned=raw.get("pinned", True),
            opacity_index=raw.get("opacity_index", 0),
            window=WindowGeom(**raw.get("window", {})),
        )
    except (json.JSONDecodeError, TypeError, KeyError):
        return AppState()


def save_state(state: AppState) -> None:
    """Write state to the JSON file. ``asdict`` serializes children recursively."""
    DATA_FILE.write_text(
        json.dumps(asdict(state), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# External input (WhatsApp, CLI, etc.)
# ---------------------------------------------------------------------------

def _dict_to_item(name: str, children: dict | None) -> Item:
    """Convert a nested dict node into a recursive Item.

    Format: ``{"name": {"sub1": {}, "sub2": {"sub2a": {}}}}``
    Value ``None`` or ``{}`` = leaf with no children.
    """
    item = Item(kind="task", text=name.strip())
    if isinstance(children, dict):
        for child_name, grandchildren in children.items():
            item.children.append(_dict_to_item(child_name, grandchildren))
    return item


def append_tasks(data: dict) -> None:
    """Receive a nested dict and append as tasks to the notepad.

    Expected format::

        {
          "Shopping": {
            "Milk": {},
            "Bread": {},
            "Grocery store": {
              "Rice": {},
              "Beans": {}
            }
          },
          "Study": {}
        }

    Each key is the task name; the value is ``{}``/``None`` (leaf)
    or another dict with subtasks (recursive, unlimited depth).
    """
    state = load_state()
    for name, children in data.items():
        if name.strip():
            state.items.append(_dict_to_item(name, children))
    save_state(state)
