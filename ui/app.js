/* =========================================================================
   Notepad Frontend — with support for recursive sub-tasks.

   General flow:
     1. pywebviewready → loads initial snapshot from Python.
     2. Each user action calls an Api method (Python).
     3. The Api returns the updated state → refresh() redraws everything.

   Parent selection (to add children):
     - Click the ⊕ button on a task → "selects" it as parent.
     - The input bar changes its placeholder to indicate the parent.
     - Enter/+ Task → adds a child to the selected parent.
     - Esc or + Note → clears the selection (back to root level).
   ========================================================================= */

const api = () => window.pywebview.api;

// Fixed references to elements that always exist on the page.
const els = {
  body: document.body,
  list: document.getElementById("list"),
  entry: document.getElementById("entry"),
  btnAddTask: document.getElementById("btn-add-task"),
  btnAddNote: document.getElementById("btn-add-note"),
  btnPin: document.getElementById("btn-pin"),
  btnOpacity: document.getElementById("btn-opacity"),
  btnClear: document.getElementById("btn-clear"),
  btnClose: document.getElementById("btn-close"),
  inputBar: document.querySelector(".input-bar"),
  selectionLabel: document.getElementById("selection-label"),
};

// Path of the item selected as parent for the next child.
// null = root level. e.g.: [0, 2] = third child of the first root item.
let selectedPath = null;

// Drag-and-drop state.
// draggedPath: path of the item being dragged.
// dropTarget : { path, position } where position = "before"|"after"|"child".
let draggedPath = null;
let dropTarget  = null;
// Flag to ensure drag only starts from the ⠿ handle.
let dragFromHandle = false;
document.addEventListener("mouseup", () => { dragFromHandle = false; });

/* =========================================================================
   Boot
   ========================================================================= */
window.addEventListener("pywebviewready", async () => {
  bindToolbar();
  bindInput();
  refresh(await api().snapshot());
});

/* =========================================================================
   Main render
   ========================================================================= */

/** Applies the full state returned by Api and redraws the UI. */
function refresh(state) {
  applyOpacity(state.opacity);
  applyPin(state.pinned);
  renderList(state.items);
}

function applyOpacity({ index, label }) {
  els.body.className = `opacity-${index}`;
  els.btnOpacity.textContent = `◐ ${label}`;
}

function applyPin(pinned) {
  els.btnPin.classList.toggle("active", pinned);
  els.btnPin.textContent = pinned ? "📌" : "📍";
  els.btnPin.title = pinned ? "Pinned on top" : "Unpinned";
}

/* =========================================================================
   List render (recursive)
   ========================================================================= */

/** Entry point: renders root items in the main container. */
function renderList(items) {
  renderItems(items, els.list, []);
}

/**
 * Recursively renders an array of items into a DOM container.
 * @param {Array}      items       - array of items from the snapshot
 * @param {Element}    container   - DOM element where items go
 * @param {number[]}   parentPath  - parent path ([] = root)
 */
function renderItems(items, container, parentPath) {
  container.replaceChildren();

  if (items.length === 0 && parentPath.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "Nothing here yet.<br>Add a task or note below.";
    container.appendChild(empty);
    return;
  }

  items.forEach((item, idx) => {
    const path = [...parentPath, idx];

    const wrapper = document.createElement("div");
    wrapper.className = "row-wrapper";

    const row = item.kind === "task" ? buildTaskRow(item, path) : buildNoteRow(item, path);
    wrapper.appendChild(row);

    // Drag-and-drop only at root level (empty parentPath).
    if (parentPath.length === 0) {
      setupDrag(wrapper, path);
      setupDrop(wrapper, path);
    }

    // Render children, if any.
    if (item.children && item.children.length > 0) {
      const childContainer = document.createElement("div");
      childContainer.className = "children";
      renderItems(item.children, childContainer, path);
      wrapper.appendChild(childContainer);
    }

    container.appendChild(wrapper);
  });
}

/* =========================================================================
   Row construction
   ========================================================================= */

function buildTaskRow(item, path) {
  const row = document.createElement("div");
  row.className = "row task" + (item.done ? " done" : "");
  row.dataset.path = JSON.stringify(path);

  if (selectedPath && pathEqual(selectedPath, path)) row.classList.add("selected");

  const handle = makeDragHandle();
  const label  = document.createElement("label");
  label.className = "check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item.done;
  const box = document.createElement("span");
  box.className = "box";
  label.append(input, box);
  input.addEventListener("change", () => callAndRefresh("toggle_done", path));

  const text = makeTextSpan(item.text);
  text.addEventListener("dblclick", () => startEdit(text, path, item.text));

  const actions = buildRowActions(path, text, item.text);

  row.append(handle, label, text, actions);
  return row;
}

function buildNoteRow(item, path) {
  const row = document.createElement("div");
  row.className = "row note";
  row.dataset.path = JSON.stringify(path);

  if (selectedPath && pathEqual(selectedPath, path)) row.classList.add("selected");

  const handle = makeDragHandle();
  const icon   = document.createElement("span");
  icon.className = "note-icon";
  icon.textContent = "✎";

  const text = makeTextSpan(item.text);
  text.addEventListener("dblclick", () => startEdit(text, path, item.text));

  const actions = buildRowActions(path, text, item.text);

  row.append(handle, icon, text, actions);
  return row;
}

/** Creates the drag handle (⠿), visible only on row hover. */
function makeDragHandle() {
  const h = document.createElement("span");
  h.className = "drag-handle";
  h.textContent = "⠿";
  h.title = "Drag to reorder";
  h.addEventListener("mousedown", () => { dragFromHandle = true; });
  return h;
}

/** Creates the text <span> reused by tasks and notes. */
function makeTextSpan(content) {
  const span = document.createElement("span");
  span.className = "text";
  span.textContent = content;
  span.tabIndex = 0;
  return span;
}

/** Creates the action buttons container (⊕ edit delete). */
function buildRowActions(path, textEl, originalText) {
  const actions = document.createElement("div");
  actions.className = "row-actions";

  const addChildBtn = document.createElement("button");
  addChildBtn.className = "btn icon add-child";
  addChildBtn.title = "Add sub-item";
  addChildBtn.textContent = "⊕";
  addChildBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    selectParent(path, originalText);
  });
  actions.appendChild(addChildBtn);

  const editBtn = document.createElement("button");
  editBtn.className = "btn icon";
  editBtn.title = "Edit";
  editBtn.textContent = "✎";
  editBtn.addEventListener("click", () => startEdit(textEl, path, originalText));

  const delBtn = document.createElement("button");
  delBtn.className = "btn icon danger";
  delBtn.title = "Delete";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    if (selectedPath && pathEqual(selectedPath, path)) clearSelection();
    callAndRefresh("delete_item", path);
  });

  actions.append(editBtn, delBtn);
  return actions;
}

/* =========================================================================
   Parent selection
   ========================================================================= */

/** Selects a task as parent for the next child to be added. */
function selectParent(path, taskText) {
  selectedPath = path;
  els.entry.placeholder = `Sub-task of: "${taskText}"`;
  els.selectionLabel.textContent = `↳ Sub-task of: ${taskText}`;
  els.selectionLabel.hidden = false;
  els.inputBar.classList.add("has-selection");
  els.entry.focus();

  document.querySelectorAll(".row.selected").forEach((r) => r.classList.remove("selected"));
  const row = document.querySelector(`.row[data-path='${JSON.stringify(path)}']`);
  if (row) row.classList.add("selected");
}

/** Clears the selection and returns to root-level addition mode. */
function clearSelection() {
  selectedPath = null;
  els.entry.placeholder = "Type and press Enter...";
  els.selectionLabel.hidden = true;
  els.inputBar.classList.remove("has-selection");
  document.querySelectorAll(".row.selected").forEach((r) => r.classList.remove("selected"));
}

/* =========================================================================
   Inline editing (double-click on text)
   ========================================================================= */

function startEdit(textEl, path, originalText) {
  textEl.setAttribute("contenteditable", "true");
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const commit = async (save) => {
    textEl.removeEventListener("blur", onBlur);
    textEl.removeEventListener("keydown", onKey);
    textEl.removeAttribute("contenteditable");
    window.getSelection().removeAllRanges();

    const newText = textEl.textContent.trim();
    if (save && newText && newText !== originalText) {
      refresh(await api().edit_item(path, newText));
    } else {
      textEl.textContent = originalText;
    }
  };

  const onBlur = () => commit(true);
  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    if (e.key === "Escape") { e.preventDefault(); commit(false); }
  };

  textEl.addEventListener("blur", onBlur);
  textEl.addEventListener("keydown", onKey);
}

/* =========================================================================
   Toolbar and input
   ========================================================================= */

function bindToolbar() {
  els.btnPin.addEventListener("click", () => callAndRefresh("toggle_pin"));
  els.btnOpacity.addEventListener("click", () => callAndRefresh("cycle_opacity"));
  els.btnClose.addEventListener("click", () => api().close_app());
  els.btnClear.addEventListener("click", async () => {
    if (confirm("Remove all items?")) {
      clearSelection();
      refresh(await api().clear_all());
    }
  });
}

function bindInput() {
  els.btnAddTask.addEventListener("click", () => submit("task"));
  els.btnAddNote.addEventListener("click", () => submit("note"));
  els.entry.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { clearSelection(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit(e.shiftKey ? "note" : "task");
  });
}

/**
 * Sends the input text as a new item.
 * If selectedPath is set and kind is "task", adds as child.
 * Shift+Enter / "+ Note" always adds a note and clears selection.
 */
async function submit(kind) {
  const text = els.entry.value.trim();
  if (!text) return;
  els.entry.value = "";

  if (kind === "note") {
    if (selectedPath) {
      refresh(await api().add_child(selectedPath, text, "note"));
    } else {
      refresh(await api().add_note(text));
    }
    return;
  }

  // Adds as child if a parent is selected, otherwise goes to root level.
  if (selectedPath) {
    refresh(await api().add_child(selectedPath, text, kind));
  } else {
    refresh(await api().add_task(text));
  }
}

/* =========================================================================
   Drag-and-drop
   ========================================================================= */

/**
 * Sets up DRAG behavior on a wrapper.
 * Drag only starts if mousedown came from the ⠿ handle (dragFromHandle = true).
 */
function setupDrag(wrapper, path) {
  wrapper.setAttribute("draggable", "true");

  wrapper.addEventListener("dragstart", (e) => {
    if (!dragFromHandle) { e.preventDefault(); return; }
    dragFromHandle = false;
    draggedPath = [...path];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    requestAnimationFrame(() => wrapper.classList.add("dragging"));
  });

  wrapper.addEventListener("dragend", () => {
    wrapper.classList.remove("dragging");
    clearAllDropIndicators();
    draggedPath = null;
    dropTarget  = null;
  });
}

/**
 * Sets up DROP behavior on a wrapper.
 * Row zones:
 *   - 0–35%   → drop BEFORE (line above)
 *   - 35–65%  → drop AS CHILD (orange highlight)
 *   - 65–100% → drop AFTER (line below)
 */
function setupDrop(wrapper, path) {
  wrapper.addEventListener("dragover", (e) => {
    if (!draggedPath) return;
    if (pathEqual(draggedPath, path)) return;
    if (path.length > draggedPath.length &&
        pathEqual(path.slice(0, draggedPath.length), draggedPath)) return;

    e.preventDefault();
    e.stopPropagation();

    const directRow = wrapper.querySelector(":scope > .row");
    const rect = directRow.getBoundingClientRect();
    const pct  = (e.clientY - rect.top) / rect.height;

    clearAllDropIndicators();

    if (pct < 0.35) {
      wrapper.classList.add("drop-before");
      dropTarget = { path, position: "before" };
    } else if (pct > 0.65) {
      wrapper.classList.add("drop-after");
      dropTarget = { path, position: "after" };
    } else {
      directRow.classList.add("drop-child");
      dropTarget = { path, position: "child" };
    }

    e.dataTransfer.dropEffect = "move";
  });

  wrapper.addEventListener("dragleave", (e) => {
    if (!wrapper.contains(e.relatedTarget)) {
      wrapper.classList.remove("drop-before", "drop-after");
      wrapper.querySelector(":scope > .row")?.classList.remove("drop-child");
    }
  });

  wrapper.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedPath || !dropTarget) return;

    const fromPath = [...draggedPath];
    const { path: targetPath, position } = dropTarget;

    clearAllDropIndicators();
    draggedPath = null;
    dropTarget  = null;

    let toParentPath, toIndex;

    if (position === "child") {
      toParentPath = targetPath;
      toIndex = 9999;
    } else {
      toParentPath = targetPath.slice(0, -1);
      toIndex = targetPath.at(-1) + (position === "after" ? 1 : 0);
    }

    refresh(await api().move_item(fromPath, toParentPath, toIndex));
  });
}

/** Removes all visual drop indicators from the page. */
function clearAllDropIndicators() {
  document.querySelectorAll(".drop-before, .drop-after")
    .forEach((el) => el.classList.remove("drop-before", "drop-after"));
  document.querySelectorAll(".drop-child")
    .forEach((el) => el.classList.remove("drop-child"));
}

/* =========================================================================
   Helpers
   ========================================================================= */

async function callAndRefresh(method, ...args) {
  refresh(await api()[method](...args));
}

/** Compares two paths (arrays of integers) by value. */
function pathEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
