package ui

import billing.receipt
import billing.decorate
import billing.convert
import billing.label

// Local annotation stub: this is NOT a real Compose dependency test.
annotation class Composable

@Composable
fun Checkout() {
    ReceiptView(receipt("café 🧭"))
}

@Composable
fun ReceiptView(text: String) {
    if (text.isNotEmpty()) {
        println(text)
    }
}

fun stringExtension(): String = "label".decorate()
fun intExtension(): String = 42.decorate()
fun stringOverload(): String = convert("label")
fun intOverload(): Int = convert(42)

fun cardExtension(card: billing.Card): String = card.label()
fun cashExtension(cash: billing.Cash): String = cash.label()
fun cardOverload(card: billing.Card): String = billing.describe(card)
fun cashOverload(cash: billing.Cash): String = billing.describe(cash)
