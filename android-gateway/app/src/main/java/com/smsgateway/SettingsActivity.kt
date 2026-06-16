package com.smsgateway

import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
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

        initDisplaySettings()
        initPhoneSettings()
        setupAdminLock()
    }

    // ── Display settings (theme — no PIN) ─────────────────────────────────────

    private fun initDisplaySettings() {
        val themeLabels = arrayOf("Follow System", "Dark", "Light")
        binding.spinnerTheme.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, themeLabels)

        val savedThemeIdx = when (Prefs.getThemeMode(this)) {
            "dark"  -> 1
            "light" -> 2
            else    -> 0
        }
        binding.spinnerTheme.setSelection(savedThemeIdx)
        binding.spinnerTheme.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val mode = when (position) { 1 -> "dark"; 2 -> "light"; else -> "auto" }
                Prefs.setThemeMode(this@SettingsActivity, mode)
                GatewayApplication.applyTheme(this@SettingsActivity)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        val version = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "—" }
        binding.tvAboutVersion.text = "v$version"
        binding.tvAboutVersionInline.text = "v$version"
        binding.tvAboutGatewayId.text = Prefs.getGatewayId(this)

        binding.btnCheckUpdate.setOnClickListener {
            Toast.makeText(this, "Checking for updates…", Toast.LENGTH_SHORT).show()
            UpdateChecker.checkInBackground(this, showResult = true)
        }

        binding.btnToggleGatewaySetup.setOnClickListener {
            val expanded = binding.layoutGatewaySetupContent.isVisible
            binding.layoutGatewaySetupContent.visibility = if (expanded) View.GONE else View.VISIBLE
            binding.tvGatewaySetupChevron.text = if (expanded) "▼" else "▲"
        }

        binding.btnToggleAbout.setOnClickListener {
            val expanded = binding.layoutAboutContent.isVisible
            binding.layoutAboutContent.visibility = if (expanded) View.GONE else View.VISIBLE
            binding.tvAboutChevron.text = if (expanded) "▼" else "▲"
        }

        binding.btnToggleHelp.setOnClickListener {
            val expanded = binding.layoutHelpContent.isVisible
            binding.layoutHelpContent.visibility = if (expanded) View.GONE else View.VISIBLE
            binding.tvHelpChevron.text = if (expanded) "▼" else "▲"
        }
    }

    // ── Phone settings (gateway ID, SIM, backend URL, behaviour — no PIN) ────

    private fun initPhoneSettings() {
        binding.spinnerGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, primaryIds)
        binding.spinnerSecondaryGatewayId.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, gatewayIds)

        setupSimSpinner()
        loadPhoneSettings()

        binding.btnSave.setOnClickListener { savePhoneSettings() }
    }

    private fun setupSimSpinner() {
        val sims = SmsSender.listSims(this)
        if (sims.isEmpty()) {
            simSubIds = listOf(-1)
            binding.spinnerSim.adapter = ArrayAdapter(
                this, android.R.layout.simple_spinner_dropdown_item, arrayOf("Default SIM")
            )
            binding.tvSimHint.text = "SIM info unavailable (grant READ_PHONE_STATE)"
            binding.cardSecondaryGateway.visibility = View.GONE
        } else {
            simSubIds = listOf(-1) + sims.map { it.first }
            val labels = listOf("Default SIM") + sims.map { (_, name, slot) -> "SIM ${slot + 1}: $name" }
            binding.spinnerSim.adapter =
                ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
            binding.tvSimHint.text = "Select which SIM sends operator SMS"
            if (sims.size >= 2) {
                binding.cardSecondaryGateway.visibility = View.VISIBLE
                binding.spinnerSecondarySim.adapter =
                    ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
            } else {
                binding.cardSecondaryGateway.visibility = View.GONE
            }
        }
    }

    private fun loadPhoneSettings() {
        val currentId = Prefs.getGatewayId(this)
        binding.spinnerGatewayId.setSelection(primaryIds.indexOf(currentId).coerceAtLeast(0))

        val savedSubId = Prefs.getPreferredSubId(this)
        binding.spinnerSim.setSelection(simSubIds.indexOf(savedSubId).coerceAtLeast(0))

        val secondaryId = Prefs.getSecondaryGatewayId(this)
        binding.spinnerSecondaryGatewayId.setSelection(gatewayIds.indexOf(secondaryId).coerceAtLeast(0))
        val secSubId = Prefs.getSecondarySubId(this)
        binding.spinnerSecondarySim.setSelection(simSubIds.indexOf(secSubId).coerceAtLeast(0))

        binding.switchAutoStart.isChecked = Prefs.isAutoStartOnBoot(this)
    }

    private fun savePhoneSettings() {
        val gatewayId = binding.spinnerGatewayId.selectedItem?.toString() ?: ""

        val selectedSimIdx = binding.spinnerSim.selectedItemPosition.coerceIn(0, simSubIds.lastIndex)
        Prefs.setPreferredSubId(this, simSubIds[selectedSimIdx])

        if (binding.cardSecondaryGateway.visibility == View.VISIBLE) {
            val secGwId = binding.spinnerSecondaryGatewayId.selectedItem?.toString().orEmpty()
            Prefs.setSecondaryGatewayId(this, if (secGwId == "(none)") "" else secGwId)
            val secSimIdx = binding.spinnerSecondarySim.selectedItemPosition.coerceIn(0, simSubIds.lastIndex)
            Prefs.setSecondarySubId(this, simSubIds[secSimIdx])
        }

        Prefs.setGatewayId(this, gatewayId)
        Prefs.setAutoStartOnBoot(this, binding.switchAutoStart.isChecked)

        Toast.makeText(this, "Saved. Restart service to apply changes.", Toast.LENGTH_LONG).show()
        finish()
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

    // ── Admin API key lock row ─────────────────────────────────────────────────

    private fun setupAdminLock() {
        refreshAdminLockRow()
        binding.cardAdminLock.setOnClickListener {
            if (binding.layoutAdminContent.isVisible) {
                binding.layoutAdminContent.visibility = View.GONE
                refreshAdminLockRow()
            } else if (Prefs.hasPinSet(this)) {
                showPinGate()
            } else {
                unlockAdminSection()
            }
        }
    }

    private fun refreshAdminLockRow() {
        val unlocked = binding.layoutAdminContent.isVisible
        binding.tvAdminLockIcon.text = if (unlocked) "⚙️" else "🔒"
        binding.tvAdminLockHint.text = if (unlocked)
            "Tap to collapse"
        else if (Prefs.hasPinSet(this))
            "PIN required — only needed on the admin monitoring phone"
        else
            "Tap to set Admin API Key"
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
            .setTitle("Admin Access")
            .setMessage("Enter your PIN to access the Admin API Key.")
            .setView(frame)
            .setCancelable(true)
            .setPositiveButton("Unlock", null)
            .setNegativeButton("Cancel", null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val entered = input.text.toString()
                if (Prefs.verifyPin(this, entered)) {
                    dialog.dismiss()
                    unlockAdminSection()
                } else {
                    attempts++
                    input.text.clear()
                    if (attempts >= 5) {
                        dialog.dismiss()
                        Toast.makeText(this, "Too many wrong attempts.", Toast.LENGTH_LONG).show()
                    } else {
                        input.error = "Wrong PIN — ${5 - attempts} attempt${if (5 - attempts == 1) "" else "s"} left"
                    }
                }
            }
        }
        dialog.show()
        input.requestFocus()
    }

    private fun unlockAdminSection() {
        binding.layoutAdminContent.visibility = View.VISIBLE
        refreshAdminLockRow()
        binding.etBackendUrl.setText(Prefs.getBackendUrl(this))
        binding.etAdminApiKey.setText(Prefs.getAdminApiKey(this))
        binding.btnTestConnection.setOnClickListener { testConnection() }
        binding.btnSaveAdminKey.setOnClickListener {
            Prefs.setBackendUrl(this, binding.etBackendUrl.text.toString().trim())
            Prefs.setAdminApiKey(this, binding.etAdminApiKey.text.toString().trim())
            Toast.makeText(this, "Admin settings saved.", Toast.LENGTH_SHORT).show()
            binding.layoutAdminContent.visibility = View.GONE
            refreshAdminLockRow()
        }
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
