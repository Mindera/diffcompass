// web-tree-sitter 0.25.10 refers to this global without shipping Emscripten types.
// Only the runtime option used by our adapter is declared; no skipLibCheck needed.
interface EmscriptenModule {
  wasmBinary?: Uint8Array;
}
