package com.smsgateway

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.smsgateway.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding

    // Parallel list of subIds matching the SIM spinner entries; -1 = system default
    private var simSubIds: List<Int> = listOf(-1)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val gatewayIds = arrayOf("GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01")
        binding.spinnerGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, gatewayIds)

        setupSimSpinner()
        loadSettings(gatewayIds)
        binding.btnSave.setOnClickListener { saveSettings() }
    }

    private fun setupSimSpinner() {
        val sims = SmsSender.listSims(this)
        if (sims.isEmpty()) {
            // No READ_PHONE_STATE permission yet or single-SIM — show a placeholder
            simSubIds = listOf(-1)
            binding.spinnerSim.adapter = ArrayAdapter(
                this, android.R.layout.simple_spinner_dropdown_item,
                arrayOf("Default SIM")
            )
            binding.tvSimHint.text = "SIM info unavailable (grant READ_PHONE_STATE)"
        } else {
            simSubIds = listOf(-1) + sims.map { it.first }
            val labels = listOf("Default SIM") + sims.map { (_, name, slot) -> "SIM ${slot + 1}: $name" }
            binding.spinnerSim.adapter = ArrayAdapter(
                this, android.R.layout.simple_spinner_dropdown_item, labels
            )
            binding.tvSimHint.text = "Select which SIM sends operator SMS"
        }
    }

    private fun loadSettings(gatewayIds: Array<String>) {
        val currentId = Prefs.getGatewayId(this)
        binding.spinnerGatewayId.setSelection(gatewayIds.indexOf(currentId).coerceAtLeast(0))

        val savedSubId = Prefs.getPreferredSubId(this)
        val simIdx = simSubIds.indexOf(savedSubId).coerceAtLeast(0)
        binding.spinnerSim.setSelection(simIdx)

        binding.etBackendUrl.setText(Prefs.getBackendUrl(this))
        binding.etApiKey.setText(Prefs.getApiKey(this))
        binding.etPort.setText(Prefs.getHttpPort(this).toString())
        binding.etTestGroupId.setText(Prefs.getTestGroupId(this))
        binding.etTestRequesterId.setText(Prefs.getTestRequesterId(this))
        binding.etTestRequesterName.setText(Prefs.getTestRequesterName(this))
    }

    private fun saveSettings() {
        val gatewayId = binding.spinnerGatewayId.selectedItem?.toString() ?: ""
        val backendUrl = binding.etBackendUrl.text.toString().trim()
        val apiKey = binding.etApiKey.text.toString().trim()
        val port = binding.etPort.text.toString().trim().toIntOrNull()

        if (port == null || port !in 1024..65535) {
            Toast.makeText(this, "Port must be between 1024 and 65535", Toast.LENGTH_SHORT).show()
            return
        }

        val selectedSimIdx = binding.spinnerSim.selectedItemPosition.coerceIn(0, simSubIds.lastIndex)
        Prefs.setPreferredSubId(this, simSubIds[selectedSimIdx])

        Prefs.setGatewayId(this, gatewayId)
        Prefs.setBackendUrl(this, backendUrl)
        Prefs.setApiKey(this, apiKey)
        Prefs.setHttpPort(this, port)
        Prefs.setTestGroupId(this, binding.etTestGroupId.text.toString().trim())
        Prefs.setTestRequesterId(this, binding.etTestRequesterId.text.toString().trim())
        Prefs.setTestRequesterName(this, binding.etTestRequesterName.text.toString().trim())

        Toast.makeText(this, "Saved. Restart service to apply connection changes.", Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
