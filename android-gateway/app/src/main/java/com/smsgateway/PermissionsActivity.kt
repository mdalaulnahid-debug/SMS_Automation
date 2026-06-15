package com.smsgateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.smsgateway.databinding.ActivityPermissionsBinding

class PermissionsActivity : AppCompatActivity() {
    private lateinit var binding: ActivityPermissionsBinding

    private val launcher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val allGranted = results.values.all { it }
        if (allGranted) {
            proceed()
        } else {
            val denied = results.filter { !it.value }.keys.joinToString("\n") { "• ${friendlyName(it)}" }
            Toast.makeText(
                this,
                "These permissions are required for the gateway to work:\n$denied",
                Toast.LENGTH_LONG
            ).show()
            binding.btnGrant.isEnabled = true
            binding.btnGrant.text = "Try Again"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPermissionsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (allPermissionsGranted()) {
            proceed()
            return
        }

        binding.btnGrant.setOnClickListener {
            binding.btnGrant.isEnabled = false
            binding.btnGrant.text = "Requesting…"
            launcher.launch(requiredPermissions())
        }
    }

    override fun onResume() {
        super.onResume()
        // Re-check after user returns from battery settings — if now exempted, proceed
        if (allPermissionsGranted() && !isBatteryOptimized()) {
            proceed()
        }
    }

    private fun allPermissionsGranted() = requiredPermissions().all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun isBatteryOptimized(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return !pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requiredPermissions(): Array<String> {
        val perms = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.READ_PHONE_STATE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        return perms.toTypedArray()
    }

    private fun proceed() {
        if (isBatteryOptimized()) {
            showBatteryOptimizationDialog()
            return
        }
        val destination = if (Prefs.isAdminConfigured(this)) {
            AdminActivity::class.java
        } else {
            MainActivity::class.java
        }
        startActivity(Intent(this, destination))
        finish()
    }

    private fun showBatteryOptimizationDialog() {
        AlertDialog.Builder(this)
            .setTitle("Disable Battery Optimization")
            .setMessage(
                "Samsung and other phones kill background apps to save battery.\n\n" +
                "Without this exemption, the gateway service will stop when the screen is off " +
                "and miss incoming SMS replies.\n\n" +
                "Tap \"Allow\" on the next screen to keep the gateway always running."
            )
            .setCancelable(false)
            .setPositiveButton("Open Settings") { _, _ ->
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            }
            .setNegativeButton("Skip (not recommended)") { _, _ ->
                val destination = if (Prefs.isAdminConfigured(this)) {
                    AdminActivity::class.java
                } else {
                    MainActivity::class.java
                }
                startActivity(Intent(this, destination))
                finish()
            }
            .show()
    }

    private fun friendlyName(permission: String) = when (permission) {
        Manifest.permission.SEND_SMS -> "Send SMS"
        Manifest.permission.RECEIVE_SMS -> "Receive SMS"
        Manifest.permission.READ_SMS -> "Read SMS"
        Manifest.permission.POST_NOTIFICATIONS -> "Show Notifications"
        else -> permission.substringAfterLast(".")
    }
}
