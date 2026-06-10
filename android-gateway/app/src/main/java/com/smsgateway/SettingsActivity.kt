package com.smsgateway

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.smsgateway.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        title = "Settings"

        val gatewayIds = arrayOf("GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01")
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, gatewayIds)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        binding.spinnerGatewayId.adapter = adapter

        loadSettings(gatewayIds)

        binding.btnSave.setOnClickListener { saveSettings() }
    }

    private fun loadSettings(gatewayIds: Array<String>) {
        val currentId = Prefs.getGatewayId(this)
        val idx = gatewayIds.indexOf(currentId).coerceAtLeast(0)
        binding.spinnerGatewayId.setSelection(idx)
        binding.etBackendUrl.setText(Prefs.getBackendUrl(this))
        binding.etApiKey.setText(Prefs.getApiKey(this))
        binding.etPort.setText(Prefs.getHttpPort(this).toString())
    }

    private fun saveSettings() {
        val gatewayId = binding.spinnerGatewayId.selectedItem?.toString() ?: ""
        val backendUrl = binding.etBackendUrl.text.toString().trim()
        val apiKey = binding.etApiKey.text.toString().trim()
        val port = binding.etPort.text.toString().trim().toIntOrNull()

        if (backendUrl.isBlank()) {
            Toast.makeText(this, "Backend URL is required", Toast.LENGTH_SHORT).show()
            return
        }
        if (port == null || port !in 1024..65535) {
            Toast.makeText(this, "Port must be between 1024 and 65535", Toast.LENGTH_SHORT).show()
            return
        }

        Prefs.setGatewayId(this, gatewayId)
        Prefs.setBackendUrl(this, backendUrl)
        Prefs.setApiKey(this, apiKey)
        Prefs.setHttpPort(this, port)

        Toast.makeText(this, "Saved. Restart service to apply changes.", Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
