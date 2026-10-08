// Each iframe owns a Monaco service. One theme update covers its diff, source,
// peek and editable suggestion without rebuilding models, selections or drafts.
export function installSyntaxThemes(monaco, catalog, root) {
  for (const [key, modes] of Object.entries(catalog)) for (const [mode, data] of Object.entries(modes)) {
    monaco.editor.defineTheme(`diffcompass-${key}-${mode}`, data);
  }
  let applied;
  return (preference = "github", light = false) => {
    const key = Object.hasOwn(catalog, preference) ? preference : "github";
    const mode = light ? "light" : "dark", name = `diffcompass-${key}-${mode}`;
    if (applied === name) return;
    applied = name;
    const data = catalog[key][mode];
    root.dataset.syntaxTheme = key;
    root.toggleAttribute("data-code-dark", data.base === "vs-dark");
    root.style.setProperty("--syntax-background", data.colors["editor.background"]);
    monaco.editor.setTheme(name);
  };
}
