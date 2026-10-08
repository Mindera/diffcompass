package billing

/** Format a receipt in the billing domain. */
fun receipt(value: String): String = "Receipt: $value"

fun String.decorate(): String = "[$this]"
fun Int.decorate(): String = "#$this"

fun convert(value: String): String = value
fun convert(value: Int): Int = value

// Local receiver types remove any dependency on a standard-library index.
class Card
class Cash
fun Card.label(): String = "card"
fun Cash.label(): String = "cash"
fun describe(value: Card): String = "card"
fun describe(value: Cash): String = "cash"
