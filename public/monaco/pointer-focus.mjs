// Monaco focuses its textarea before moving the cursor on the first mouse
// press. Its scroll restoration only covers ancestors inside this document;
// a page-sized iframe can also scroll the outer review to the OLD cursor.
// Focus without scrolling before Monaco handles the gesture. Do not change
// its selection or cancel the event: shift-click, dragging and menus stay native.
export function installPointerFocus({ root, editors, monaco }) {
  const focus = event => {
    const mouse = event.pointerType === "mouse" || (event.type === "contextmenu" && !event.pointerType);
    if (event.defaultPrevented || !mouse || ![0, 2].includes(event.button)) return;
    const node = event.target.closest?.(".monaco-editor");
    const editor = editors.find(editor => editor.getDomNode() === node);
    if (!editor) return;
    const hit = editor.getTargetAtClientPoint(event.clientX, event.clientY);
    if (!hit || ![monaco.editor.MouseTargetType.CONTENT_TEXT, monaco.editor.MouseTargetType.CONTENT_EMPTY, monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS].includes(hit.type)) return;
    node.querySelector("textarea.inputarea")?.focus({ preventScroll: true });
  };
  root.addEventListener("pointerdown", focus, true);
  // Right-button mousedown can blur the input again before Monaco's context
  // menu handler focuses it. Protect that second focus in the same way.
  root.addEventListener("contextmenu", focus, true);
  return () => {
    root.removeEventListener("pointerdown", focus, true);
    root.removeEventListener("contextmenu", focus, true);
  };
}
