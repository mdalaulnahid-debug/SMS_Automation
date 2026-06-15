package com.smsgateway

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject

/**
 * Launches ZXing QR scanner, parses the provisioning payload, and writes it to Prefs.
 *
 * Expected QR JSON:
 *   { "v": 1, "url": "http://...", "gwId": "GP_PHONE_01", "pin": "1234", "secret": "..." }
 *
 * All fields except "url" and "gwId" are optional.
 * Calls finish() when done (success or cancel); caller observes Prefs changes on resume.
 */
class QrScanActivity : AppCompatActivity() {

    private val scanLauncher = registerForActivityResult(ScanContract()) { result: ScanIntentResult ->
        if (result.contents == null) {
            finish()
            return@registerForActivityResult
        }
        handleQrResult(result.contents)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launchScanner()
    }

    private fun launchScanner() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("Scan the provisioning QR code from the admin app or dashboard")
            setBeepEnabled(false)
            setOrientationLocked(true)
        }
        scanLauncher.launch(options)
    }

    private fun handleQrResult(content: String) {
        val url: String
        val gwId: String
        val pin: String
        val secret: String

        try {
            val json = JSONObject(content)
            url    = json.optString("url").ifBlank { json.optString("backendUrl") }.trim()
            gwId   = json.optString("gwId").ifBlank { json.optString("gatewayId") }.trim()
            pin    = json.optString("pin").ifBlank { json.optString("adminPin") }
            secret = json.optString("secret")
        } catch (e: Exception) {
            Toast.makeText(this, "Invalid QR code: ${e.message}", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        if (url.isBlank() || gwId.isBlank()) {
            Toast.makeText(this, "QR code missing backend URL or gateway ID", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Confirm Provisioning")
            .setMessage("Configure this phone as:\n\nGateway: $gwId\nBackend: $url")
            .setPositiveButton("Apply") { _, _ ->
                Prefs.setFromQrPayload(this, url, gwId, pin, secret)
                val result = Intent().apply {
                    putExtra(EXTRA_GATEWAY_ID, gwId)
                    putExtra(EXTRA_BACKEND_URL, url)
                }
                setResult(Activity.RESULT_OK, result)
                Toast.makeText(this, "Gateway configured: $gwId", Toast.LENGTH_LONG).show()
                finish()
            }
            .setNegativeButton("Cancel") { _, _ -> finish() }
            .setCancelable(false)
            .show()
    }

    companion object {
        const val EXTRA_GATEWAY_ID  = "extra_gateway_id"
        const val EXTRA_BACKEND_URL = "extra_backend_url"
    }
}
