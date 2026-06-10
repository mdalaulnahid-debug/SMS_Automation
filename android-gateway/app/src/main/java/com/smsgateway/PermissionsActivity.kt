package com.smsgateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
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

    private fun allPermissionsGranted() = requiredPermissions().all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun requiredPermissions(): Array<String> {
        val perms = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        return perms.toTypedArray()
    }

    private fun proceed() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun friendlyName(permission: String) = when (permission) {
        Manifest.permission.SEND_SMS -> "Send SMS"
        Manifest.permission.RECEIVE_SMS -> "Receive SMS"
        Manifest.permission.READ_SMS -> "Read SMS"
        Manifest.permission.POST_NOTIFICATIONS -> "Show Notifications"
        else -> permission.substringAfterLast(".")
    }
}
