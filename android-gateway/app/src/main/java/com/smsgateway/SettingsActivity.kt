package com.smsgateway

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.smsgateway.databinding.ActivitySettingsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding
    private val requestTypes = arrayOf("LRL", "LCL", "MS-NID", "NID-MS", "IMEI-MS")

    private var simSubIds: List<Int> = listOf(-1)
    private val gatewayIds = arrayOf("(none)", "GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val primaryIds = arrayOf("GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01")
        binding.spinnerGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, primaryIds)

        binding.spinnerSecondaryGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, gatewayIds)

        setupSimSpinner()
        setupTestRequest()
        loadSettings(primaryIds)
        binding.btnSave.setOnClickListener { saveSettings() }
    }

    private fun setupSimSpinner() {
        val sims = SmsSender.listSims(this)
        if (sims.isEmpty()) {
            simSubIds = listOf(-1)
            binding.spinnerSim.adapter = ArrayAdapter(
                this, android.R.layout.simple_spinner_dropdown_item,
                arrayOf("Default SIM")
            )
            binding.tvSimHint.text = "SIM info unavailable (grant READ_PHONE_STATE)"
            binding.cardSecondaryGateway.isVisible = false
        } else {
            simSubIds = listOf(-1) + sims.map { it.first }
            val labels = listOf("Default SIM") + sims.map { (_, name, slot) -> "SIM ${slot + 1}: $name" }
            binding.spinnerSim.adapter = ArrayAdapter(
                this, android.R.layout.simple_spinner_dropdown_item, labels
            )
            binding.tvSimHint.text = "Select which SIM sends operator SMS"
            // Show secondary gateway card only when there are 2+ SIMs
            if (sims.size >= 2) {
                binding.cardSecondaryGateway.isVisible = true
                binding.spinnerSecondarySim.adapter = ArrayAdapter(
                    this, android.R.layout.simple_spinner_dropdown_item, labels
                )
            } else {
                binding.cardSecondaryGateway.isVisible = false
            }
        }
    }

    private fun setupTestRequest() {
        binding.spinnerRequestType.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, requestTypes)
        binding.spinnerRequestType.setSelection(0)

        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                updateTestPreview()
            }
            override fun afterTextChanged(s: Editable?) {}
        }
        binding.etPayload.addTextChangedListener(watcher)
        binding.spinnerRequestType.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                updateTestPreview()
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }

        val lastTarget = Prefs.getLastTestTarget(this)
        if (lastTarget.isNotBlank()) {
            binding.etTargetNumber.setText(lastTarget)
        }
        updateTestPreview()

        binding.btnSendTest.setOnClickListener { sendTestRequest() }
    }

    private fun updateTestPreview() {
        val type = binding.spinnerRequestType.selectedItem?.toString() ?: "LRL"
        val payload = binding.etPayload.text?.toString()?.trim().orEmpty()
        binding.tvTestPreview.text = if (payload.isBlank()) {
            "Preview: $type <payload>"
        } else {
            "Preview: $type $payload"
        }
    }

    private fun sendTestRequest() {
        if (!Prefs.isServiceEnabled(this)) {
            Snackbar.make(binding.root, "Start the gateway service first.", Snackbar.LENGTH_LONG).show()
            return
        }

        val type = binding.spinnerRequestType.selectedItem?.toString()?.trim().orEmpty()
        val payload = binding.etPayload.text?.toString()?.trim().orEmpty()
        val target = binding.etTargetNumber.text?.toString()?.trim().orEmpty()

        if (payload.isBlank()) {
            binding.etPayload.error = "Required"
            return
        }
        if (target.isBlank()) {
            binding.etTargetNumber.error = "Required"
            return
        }

        val requestText = "$type $payload"
        binding.btnSendTest.isEnabled = false
        binding.btnSendTest.text = "Sending..."

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                BackendClient.submitTestRequest(
                    backendUrl = Prefs.getBackendUrl(this@SettingsActivity),
                    requestText = requestText,
                    testDestination = target,
                    whatsappGroupId = Prefs.getTestGroupId(this@SettingsActivity),
                    requesterWhatsappId = Prefs.getTestRequesterId(this@SettingsActivity),
                    requesterName = Prefs.getTestRequesterName(this@SettingsActivity)
                )
            }

            binding.btnSendTest.isEnabled = true
            binding.btnSendTest.text = "Send Test Request"

            result.onSuccess { requestId ->
                Prefs.setLastTestTarget(this@SettingsActivity, target)
                Snackbar.make(
                    binding.root,
                    "Request $requestId sent to $target.",
                    Snackbar.LENGTH_LONG
                ).show()
            }.onFailure { error ->
                Snackbar.make(
                    binding.root,
                    error.message ?: "Failed to send test request",
                    Snackbar.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun loadSettings(primaryIds: Array<String>) {
        val currentId = Prefs.getGatewayId(this)
        binding.spinnerGatewayId.setSelection(primaryIds.indexOf(currentId).coerceAtLeast(0))

        val savedSubId = Prefs.getPreferredSubId(this)
        val simIdx = simSubIds.indexOf(savedSubId).coerceAtLeast(0)
        binding.spinnerSim.setSelection(simIdx)

        // Secondary gateway
        val secondaryId = Prefs.getSecondaryGatewayId(this)
        val secGwIdx = gatewayIds.indexOf(secondaryId).coerceAtLeast(0)
        binding.spinnerSecondaryGatewayId.setSelection(secGwIdx)
        val secSubId = Prefs.getSecondarySubId(this)
        binding.spinnerSecondarySim.setSelection(simSubIds.indexOf(secSubId).coerceAtLeast(0))

        binding.etBackendUrl.setText(Prefs.getBackendUrl(this))
        binding.etApiKey.setText(Prefs.getApiKey(this))
        binding.etPort.setText(Prefs.getHttpPort(this).toString())
        binding.etTestGroupId.setText(Prefs.getTestGroupId(this))
        binding.etTestRequesterId.setText(Prefs.getTestRequesterId(this))
        binding.etTestRequesterName.setText(Prefs.getTestRequesterName(this))
        binding.etAdminApiKey.setText(Prefs.getAdminApiKey(this))
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

        // Secondary gateway (only save when the card is visible)
        if (binding.cardSecondaryGateway.isVisible) {
            val secGwId = binding.spinnerSecondaryGatewayId.selectedItem?.toString().orEmpty()
            Prefs.setSecondaryGatewayId(this, if (secGwId == "(none)") "" else secGwId)
            val secSimIdx = binding.spinnerSecondarySim.selectedItemPosition.coerceIn(0, simSubIds.lastIndex)
            Prefs.setSecondarySubId(this, simSubIds[secSimIdx])
        }

        Prefs.setGatewayId(this, gatewayId)
        Prefs.setBackendUrl(this, backendUrl)
        Prefs.setApiKey(this, apiKey)
        Prefs.setHttpPort(this, port)
        Prefs.setTestGroupId(this, binding.etTestGroupId.text.toString().trim())
        Prefs.setTestRequesterId(this, binding.etTestRequesterId.text.toString().trim())
        Prefs.setTestRequesterName(this, binding.etTestRequesterName.text.toString().trim())
        Prefs.setAdminApiKey(this, binding.etAdminApiKey.text.toString().trim())

        Toast.makeText(this, "Saved. Restart service to apply connection changes.", Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
