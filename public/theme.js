(() => {
  const storageKey = "code-review-tour-theme";
  const choices = new Set(["system", "dark", "light"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function preference() {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return choices.has(stored) ? stored : "system";
    } catch {
      return "system";
    }
  }

  function apply(choice = preference()) {
    const resolved = choice === "system" ? (media.matches ? "dark" : "light") : choice;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    return resolved;
  }

  function set(choice) {
    const next = choices.has(choice) ? choice : "system";
    try {
      if (next === "system") window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, next);
    } catch {
      // The preference still applies for this page when storage is unavailable.
    }
    apply(next);
  }

  media.addEventListener("change", () => {
    if (preference() === "system") apply("system");
  });
  apply();
  window.reviewTourTheme = { preference, set };
})();
