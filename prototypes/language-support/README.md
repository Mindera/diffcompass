# Language support compatibility lab

This is an isolated evaluation, not a bundled provider or a production resolver.
The product target is **review assistance, not IDE IntelliSense**: Kotlin syntax,
folding, useful signature/documentation hovers and inline Peek. Android/KMP files
should remain useful without importing/executing their builds. Ambiguous targets
must be labelled candidates, not silently presented as verified definitions.

## Reproduce the Kotlin probe

```sh
bun test prototypes/language-support/protocol.test.mjs
bun prototypes/language-support/probe-kotlin.mjs /absolute/path/to/kmp-lsp
```

Supply a locally downloaded and verified binary. The script never downloads or
installs one. It copies the checked-in source-only fixture into a fresh temporary
directory, isolates provider/Gradle caches, excludes the host Android SDK and
global library sources, waits for indexing completion, and sends real LSP
definition, hover, references and folding requests. The report and logs stay in
the printed temporary directory. Exit 1 means a compatibility assertion failed.
No user project, build script or production DiffCompass file is changed.

The fixture is **not a buildable Android/KMP application**. Its Composable
annotation is a local stub, not proof of Compose library/compiler support. No
standard-library JARs are indexed. Local Card/Cash receiver tests separately
exercise overload ambiguity without relying on a standard-library type index.
Revision isolation, real dependency imports, hierarchical source sets, generated
code, real Compose, and compiler correctness are not established by this probe.

## Observed 2026-10-04: kmp-lsp v0.26.0

Candidate: [Hessesian/kmp-lsp v0.26.0](https://github.com/Hessesian/kmp-lsp/releases/tag/v0.26.0),
MIT. Tested the native `darwin-aarch64` release archive, SHA-256:

```text
887a355d9fbfbd92cbc11f60a210cf944080f715e4ad772245bd8cffd3a779dc
```

Two fresh runs of the final 16-check fixture produced **9 passes, 7 failures**.
The cases below are observations of this source-only configuration, not claims
about every possible project import/configuration.

| Check | Result |
| --- | --- |
| Common and Android calls | Correct source set in this fixture |
| iOS call to `platformName()` | Incorrectly returned Android's `actual` |
| Explicit import of `billing.receipt` | Correct; excluded unrelated `other.receipt` |
| String `decorate()` extension | Incorrectly returned Int extension |
| String `convert(...)` overload | Incorrectly returned Int overload |
| Int extension/overload | Correct in this fixture |
| Local Card receiver extension | Incorrectly returned Cash extension |
| Local Cash receiver extension | Correct in this fixture |
| Qualified Card/Cash `describe(...)` calls | No definition for either |
| Local annotated function, hover, method/if fold ranges | Passed; annotation is a stub |
| References | Found the code usage but also counted a word in a documentation comment |

Decision: do not expose these single-target results as authoritative Peek
destinations. The provider might still be useful for bounded review assistance,
but that needs capability-specific integration and safe candidate handling.
Restricting the product to JVM-only would remove the cross-platform expectation,
**not** the observed same-language overload/receiver ambiguity. The official
[Kotlin LSP](https://github.com/Kotlin/kotlin-lsp#supported-features) is a separate
option for project-aware JVM support; this probe does not evaluate it.
