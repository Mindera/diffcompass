import { expect, test } from "bun:test";
import { kotlinReferences } from "../src/kotlin-references.ts";

test("Kotlin private properties resolve from declarations and uses without matching comments, strings or named arguments", async () => {
  const source = [
    "private val Searching = LoadStates()",
    "fun search() {",
    "  // Searching is only a comment",
    '  println("Searching")',
    "  emit(PagingData.empty(sourceLoadStates = Searching))",
    "  other.Searching()",
    "  call(Searching = 1)",
    '  println("$Searching ${Searching}")',
    "}",
  ].join("\n");
  for (const line of [1, 5]) {
    expect(await kotlinReferences(source, "Searching", line)).toEqual({ definition: 1, usages: [5, 8], truncated: false, partial: false });
  }
  for (const line of [3, 4, 6, 7]) expect(await kotlinReferences(source, "Searching", line)).toBeUndefined();
});

test("Kotlin explicit scopes keep local, parameter, lambda, loop, catch and destructured bindings separate", async () => {
  const source = [
    "private val value = 1",
    "fun outer() {",
    "  println(value)",
    "  run { val value = value + 1; println(value) }",
    "  items.map { value -> println(value) }",
    "  for (value in values) { println(value) }",
    "  try { work() } catch (value: Exception) { println(value) }",
    "  when (val value = input()) { else -> println(value) }",
    "  run { val (value, other) = pair; println(value) }",
    "  println(value)",
    "}",
    "fun withParameter(value: Int) { println(value) }",
  ].join("\n");
  expect(await kotlinReferences(source, "value", 1)).toEqual({ definition: 1, usages: [3, 4, 10], truncated: false, partial: false });
  for (const line of [4, 5, 6, 7, 8, 9, 12]) {
    const text = source.split("\n")[line - 1]!;
    expect(await kotlinReferences(source, "value", line, text.lastIndexOf("value") + 1)).toEqual({ definition: line, usages: [line], truncated: false, partial: false });
  }
});

test("Kotlin members distinguish this from other receivers and parameter shadowing", async () => {
  const source = [
    "class State(val count: Int) {",
    "  private val value = 1",
    "  fun show(value: Int) {",
    "    println(value)",
    "    println(this.value)",
    "    println(other.value)",
    "    println(count)",
    "    println(this.count)",
    "  }",
    "  fun again() = value",
    "}",
    "class Other { val value = 2; fun show() = value; }",
  ].join("\n");
  expect(await kotlinReferences(source, "value", 2)).toEqual({ definition: 2, usages: [5, 10], truncated: false, partial: false });
  expect(await kotlinReferences(source, "value", 4)).toEqual({ definition: 3, usages: [4], truncated: false, partial: false });
  expect(await kotlinReferences(source, "count", 1)).toEqual({ definition: 1, usages: [7, 8], truncated: false, partial: false });
  expect(await kotlinReferences(source, "value", 6)).toBeUndefined();
});

test("Kotlin functions resolve calls while overloads and extension receivers remain ambiguous", async () => {
  const source = "fun lookup() = 1\nfun run() = lookup()\nfun other() = obj.lookup()\n";
  expect(await kotlinReferences(source, "lookup", 2)).toEqual({ definition: 1, usages: [2], truncated: false, partial: false });
  expect(await kotlinReferences(source + "fun lookup(value: Int) = value\n", "lookup", 2)).toBeUndefined();
  expect(await kotlinReferences("fun String.lookup() = this\nfun run() = lookup()\n", "lookup", 1)).toBeUndefined();
});

test("Kotlin positions use UTF-16 columns and do not guess among repeated identifiers", async () => {
  const source = 'val value = 1\nfun run() { println("🚀"); println(value + other.value) }\n';
  const text = source.split("\n")[1]!;
  expect(await kotlinReferences(source, "value", 2)).toBeUndefined();
  expect(await kotlinReferences(source, "value", 2, text.indexOf("value") + 1)).toEqual({ definition: 1, usages: [2], truncated: false, partial: false });
  expect(await kotlinReferences(source, "value", 2, text.lastIndexOf("value") + 1)).toBeUndefined();
  expect(await kotlinReferences(source, "value", 2, 1)).toBeUndefined();
});

test("Kotlin lookup rejects broken or oversized source and caps usage output", async () => {
  expect(await kotlinReferences("val value =\nfun (", "value", 1)).toBeUndefined();
  expect(await kotlinReferences(`val value = 1\n// ${"x".repeat(256_000)}`, "value", 1)).toBeUndefined();
  const result = await kotlinReferences(`val value = 1\nfun run() {\n${"println(value)\n".repeat(60)}}\n`, "value", 1);
  expect(result?.definition).toBe(1);
  expect(result?.usages).toHaveLength(49);
  expect(result?.truncated).toBe(true);
});

test("unsupported backing-field syntax does not hide unrelated Kotlin declarations and usages", async () => {
  const source = [
    "private val Searching = LoadStates()",
    "class PeopleViewModel {",
    "  internal val state: StateFlow<State>",
    "    field = MutableStateFlow(State())",
    "  val pages = queries.flatMapLatest { query ->",
    "    flow { emit(PagingData.empty(sourceLoadStates = Searching)) }",
    "  }",
    "}",
  ].join("\n");
  expect(await kotlinReferences(source, "Searching", 1)).toEqual({ definition: 1, usages: [6], truncated: false, partial: true });
});
