package demo

expect fun platformName(): String

fun sharedGreeting(): String = platformName()
