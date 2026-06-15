package com.smsgateway

import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.smsgateway.databinding.ActivitySettingsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding

    private var simSubIds: List<Int> = listOf(-1)
    private val gatewayIds = arrayOf("(none)", "GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01")
    private val primaryIds = arrayOf("GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        if (Prefs.hasPinSet(this)) {
            showPinGate()
        } else {
            initSettings()
        }
    }

    private fun showPinGate() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "Enter PIN"
            gravity = Gravity.CENTER
            textSize = 20f
        }
        val frame = FrameLayout(this).apply {
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }

        var attempts = 0
        val dialog = AlertDialog.Builder(this)
            .setTitle("Settings Locked")
            .setMessage("Enter your PIN to access settings.")
            .setView(frame)
            .setCancelable(false)
            .setPositiveButton("Unlock", null)
            .setNegativeButton("Cancel") { _, _ -> finish() }
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val entered = input.text.toString()
                if (Prefs.verifyPin(this, entered)) {
                    dialog.dismiss()
                    initSettings()
                } else {
                    attempts++
                    input.text.clear()
                    if (attempts >= 5) {
                        dialog.dismiss()
                        Toast.makeText(this, "Too many wrong attempts.", Toast.LENGTH_LONG).show()
                        finish()
                    } else {
                        input.error = "Wrong PIN — ${5 - attempts} attempt${if (5 - attempts == 1) "" else "s"} left"
                    }
                }
            }
        }
        dialog.show()
        input.requestFocus()
    }

    private fun initSettings() {
        binding.spinnerGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, primaryIds)
        binding.spinnerSecondaryGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, gatewayIds)

        setupSimSpinner()
        loadSettings()

        binding.btnSave.setOnClickListener { saveSettings() }
        binding.btnTestConnection.setOnClickListener { testConnection() }
        binding.btnCheckUpdate.setOnClickListener {
            Toast.makeText(this, "Checking for updates…", Toast.LENGTH_SHORT).show()
            UpdateChecker.checkInBackground(this, showResult = true)
        }
    }

    private fun setupSimSpinner() {
        val sims = SmsSender.listSims(this)
        if (sims.isEmpty()) {
            simSubIds = listOf(-1)
            binding.spinnerSim.adapter = ArrayAdapter(
                this, android.R.layout.simple_spinner_dropdown_item, arrayOf("Default SIM")
            )
            binding.tvSimHint.text = "SIM info unavailable (grant READ_PHONE_STATE)"
            binding.cardSecondaryGateway.isVisible = false
        } else {
            simSubIds = listOf(-1) + sims.map { it.first }
            val labels = listOf("Default SIM") + sims.map { (_, name, slot) -> "SIM ${slot + 1}: $name" }
            binding.spinnerSim.adapter =
                ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
            binding.tvSimHint.text = "Select which SIM sends operator SMS"
            if (sims.size >= 2) {
                binding.cardSecondaryGateway.isVisible = true
                binding.spinnerSecondarySim.adapter =
                    ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
            } else {
                binding.cardSecondaryGateway.isVisible = false
            }
        }
    }

    private fun loadSettings() {
        val currentId = Prefs.getGatewayId(this)
        binding.spinnerGatewayId.setSelection(primaryIds.indexOf(currentId).coerceAtLeast(0))

        val savedSubId = Prefs.getPreferredSubId(this)
        binding.spinnerSim.setSelection(simSubIds.indexOf(savedSubId).coerceAtLeast(0))

        val secondaryId = Prefs.getSecondaryGatewayId(this)
        binding.spinnerSecondaryGatewayId.setSelection(gatewayIds.indexOf(secondaryId).coerceAtLeast(0))
        val secSubId = Prefs.getSecondarySubId(this)
        binding.spinnerSecondarySim.setSelection(simSubIds.indexOf(secSubId).coerceAtLeast(0))

        binding.etBackendUrl.setText(Prefs.getBackendUrl(this))
        binding.etAdminApiKey.setText(Prefs.getAdminApiKey(this))
        binding.switchAutoStart.isChecked = Prefs.isAutoStartOnBoot(this)

        // About section
        val version = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (_: Exception) { "—" }
        binding.tvAboutVersion.text = "v$version"
        binding.tvAboutGatewayId.text = Prefs.getGatewayId(this)
    }

    private fun testConnection() {
        val url = binding.etBackendUrl.text.toString().trim()
        if (url.isBlank()) {
            binding.tvConnectionResult.text = "Enter a URL first"
            binding.tvConnectionResult.setTextColor(getColor(R.color.warning))
            return
        }

        binding.btnTestConnection.isEnabled = false
        binding.tvConnectionResult.text = "Connecting…"
        binding.tvConnectionResult.setTextColor(getColor(R.color.text_secondary))

        lifecycleScope.launch {
            val start = System.currentTimeMillis()
            val ok = withContext(Dispatchers.IO) { BackendClient.checkHealth(url) }
            val ms = System.currentTimeMillis() - start

            binding.btnTestConnection.isEnabled = true
            if (ok) {
                binding.tvConnectionResult.text = "✓ Connected (${ms}ms)"
                binding.tvConnectionResult.setTextColor(getColor(R.color.success))
            } else {
                binding.tvConnectionResult.text = "✗ Not reachable"
                binding.tvConnectionResult.setTextColor(getColor(R.color.danger))
            }
        }
    }

    private fun saveSettings() {
        val gatewayId = binding.spinnerGatewayId.selectedItem?.toString() ?: ""
        val backendUrl = binding.etBackendUrl.text.toString().trim()

        val selectedSimIdx = binding.spinnerSim.selectedItemPosition.coerceIn(0, simSubIds.lastIndex)
        Prefs.setPreferredSubId(this, simSubIds[selectedSimIdx])

        if (binding.cardSecondaryGateway.isVisible) {
            val secGwId = binding.spinnerSecondaryGatewayId.selectedItem?.toString().orEmpty()
            Prefs.setSecondaryGatewayId(this, if (secGwId == "(none)") "" else secGwId)
            val secSimIdx = binding.spinnerSecondarySim.selectedItemPosition.coerceIn(0, simSubIds.lastIndex)
            Prefs.setSecondarySubId(this, simSubIds[secSimIdx])
        }

        Prefs.setGatewayId(this, gatewayId)
        Prefs.setBackendUrl(this, backendUrl)
        Prefs.setAdminApiKey(this, binding.etAdminApiKey.text.toString().trim())
        Prefs.setAutoStartOnBoot(this, binding.switchAutoStart.isChecked)

        Toast.makeText(this, "Saved. Restart service to apply connection changes.", Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
