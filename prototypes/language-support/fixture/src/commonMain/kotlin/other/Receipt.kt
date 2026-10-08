package other

/** Deliberately unrelated same-name function. */
fun receipt(value: String): String = "Not billing: $value"

fun unrelatedUsage(): String = receipt("other")
