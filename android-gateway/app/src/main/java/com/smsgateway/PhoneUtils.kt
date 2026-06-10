package com.smsgateway

object PhoneUtils {
    fun normalize(value: String): String {
        val digits = value.replace(Regex("\\D"), "")
        if (digits.isEmpty()) return ""
        return if (digits.startsWith("880") && digits.length >= 12) {
            "0${digits.substring(3)}"
        } else {
            digits
        }
    }
}
