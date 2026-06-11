package com.smsgateway

import android.Manifest
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.smsgateway.databinding.ActivityMainBinding
import com.smsgateway.db.AppDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val requestTypes = arrayOf("LRL", "LCL", "MS-NID", "NID-MS", "IMEI-MS")
    private var serviceToggleInFlight = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { updateUI() }

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ServiceEvents.ACTION_STATUS) return
            if (isFinishing || isDestroyed) return
            serviceToggleInFlight = false
            val error = intent.getStringExtra(ServiceEvents.EXTRA_ERROR)
            if (!error.isNullOrBlank()) {
                Snackbar.make(binding.root, error, Snackbar.LENGTH_LONG).show()
            }
            if (intent.hasExtra(ServiceEvents.EXTRA_RUNNING)) {
                Prefs.setServiceEnabled(
                    this@MainActivity,
                    intent.getBooleanExtra(ServiceEvents.EXTRA_RUNNING, false)
                )
            }
            updateUI()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.subtitle = "Operator bridge"

        setupRequestTypeSpinner()
        setupTestPreviewWatcher()
        loadTestFields()

        binding.btnToggleService.setOnClickListener { toggleService() }
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        binding.btnLogs.setOnClickListener {
            startActivity(Intent(this, LogActivity::class.java))
        }
        binding.btnCopyIp.setOnClickListener { copyLocalIp() }
        binding.btnSendTest.setOnClickListener { sendTestRequest() }

        lifecycleScope.launch {
            AppDatabase.get(this@MainActivity).logDao().getRecent().collectLatest { logs ->
                val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                val sent = logs.firstOrNull { it.direction == "OUTBOUND" }
                binding.tvLastSent.text = if (sent != null) {
                    "${fmt.format(Date(sent.timestamp))}  →  ${sent.recipient}\n${sent.messageBody.take(80)}"
                } else "—"

                val received = logs.firstOrNull { it.direction == "INBOUND" }
                binding.tvLastReceived.text = if (received != null) {
                    "${fmt.format(Date(received.timestamp))}  ←  ${received.sender}\n${received.messageBody.take(80)}"
                } else "—"

                val retryCount = logs.count { it.status == "PENDING_RETRY" }
                binding.tvRetryCount.text = if (retryCount > 0) "$retryCount pending" else "None"
            }
        }

        requestPermissions()
    }

    override fun onResume() {
        super.onResume()
        LocalBroadcastManager.getInstance(this).registerReceiver(
            serviceReceiver,
            IntentFilter(ServiceEvents.ACTION_STATUS)
        )
        updateUI()
        discoverAndCheckBackend()
    }

    override fun onPause() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(serviceReceiver)
        super.onPause()
    }

    private fun setupRequestTypeSpinner() {
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, requestTypes)
        binding.spinnerRequestType.adapter = adapter
        binding.spinnerRequestType.setSelection(0)
    }

    private fun setupTestPreviewWatcher() {
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                updateTestPreview()
            }
            override fun afterTextChanged(s: Editable?) {}
        }
        binding.etPayload.addTextChangedListener(watcher)
        binding.spinnerRequestType.setOnItemSelectedListener(object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                updateTestPreview()
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        })
    }

    private fun loadTestFields() {
        val lastTarget = Prefs.getLastTestTarget(this)
        if (lastTarget.isNotBlank()) {
            binding.etTargetNumber.setText(lastTarget)
        }
        updateTestPreview()
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
                    backendUrl = Prefs.getBackendUrl(this@MainActivity),
                    requestText = requestText,
                    testDestination = target,
                    whatsappGroupId = Prefs.getTestGroupId(this@MainActivity),
                    requesterWhatsappId = Prefs.getTestRequesterId(this@MainActivity),
                    requesterName = Prefs.getTestRequesterName(this@MainActivity)
                )
            }

            binding.btnSendTest.isEnabled = true
            binding.btnSendTest.text = "Send Test Request"

            result.onSuccess { requestId ->
                Prefs.setLastTestTarget(this@MainActivity, target)
                Snackbar.make(
                    binding.root,
                    "Request $requestId sent to $target. Reply manually from that number.",
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

    private fun discoverAndCheckBackend() {
        val savedUrl = Prefs.getBackendUrl(this).trim()
        binding.tvBackendHealth.text = "Backend: connecting…"
        binding.tvBackendHealth.setTextColor(getColor(R.color.text_secondary))

        lifecycleScope.launch {
            val connected = withContext(Dispatchers.IO) {
                val phoneIp = NetworkUtils.getLocalIp(this@MainActivity)

                // 1. LAN auto-discovery — fastest when phone and PC are on the same network.
                //    Skip if phone has no Wi-Fi IP (on mobile data).
                if (phoneIp.isNotBlank()) {
                    val lanUrl = BackendDiscovery.discoverBackendUrl(phoneIp, savedUrl.takeIf { it.isLanUrl() })
                    if (lanUrl != null) {
                        Prefs.setBackendUrl(this@MainActivity, lanUrl)
                        return@withContext lanUrl
                    }
                }

                // 2. Fallback: try the manually saved URL (ngrok / domain / different subnet).
                if (savedUrl.isNotBlank() && BackendClient.checkHealth(savedUrl)) {
                    return@withContext savedUrl
                }

                null
            }

            if (connected != null) {
                binding.tvBackendHealth.text = "Backend: connected"
                binding.tvBackendUrl.text = connected
                binding.tvBackendHealth.setTextColor(getColor(R.color.success))
            } else {
                binding.tvBackendHealth.text =
                    if (savedUrl.isNotBlank()) "Backend: not reachable — check URL or start backend on PC"
                    else "Backend: not found — start backend on PC, or set internet URL in Settings"
                binding.tvBackendHealth.setTextColor(getColor(R.color.danger))
            }
        }
    }

    private fun String.isLanUrl(): Boolean =
        matches(Regex("https?://(192\\.168|10\\.|172\\.(1[6-9]|2[0-9]|3[01]))\\..*"))

    private fun copyLocalIp() {
        val ip = getLocalIp()
        if (ip == "Not connected to Wi-Fi") {
            Toast.makeText(this, ip, Toast.LENGTH_SHORT).show()
            return
        }
        val clipboard = getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newPlainText("gateway_ip", ip))
        Snackbar.make(binding.root, "Copied $ip — phone registers this with backend when service starts", Snackbar.LENGTH_LONG).show()
    }

    private fun toggleService() {
        if (serviceToggleInFlight) return

        val running = Prefs.isServiceEnabled(this)
        val intent = Intent(this, GatewayForegroundService::class.java)
        if (running) {
            serviceToggleInFlight = true
            binding.btnToggleService.isEnabled = false
            intent.action = GatewayForegroundService.ACTION_STOP
            startService(intent)
            binding.root.postDelayed({
                serviceToggleInFlight = false
                updateUI()
            }, 500)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Snackbar.make(
                binding.root,
                "Allow notifications before starting the gateway service.",
                Snackbar.LENGTH_LONG
            ).show()
            permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            return
        }

        serviceToggleInFlight = true
        binding.btnToggleService.isEnabled = false
        binding.btnToggleService.text = "Starting..."
        try {
            ContextCompat.startForegroundService(this, intent)
        } catch (e: Exception) {
            serviceToggleInFlight = false
            Prefs.setServiceEnabled(this, false)
            Snackbar.make(
                binding.root,
                "Could not start service: ${e.message}",
                Snackbar.LENGTH_LONG
            ).show()
            updateUI()
            return
        }

        binding.root.postDelayed({
            if (serviceToggleInFlight) {
                serviceToggleInFlight = false
                updateUI()
            }
        }, 3000)
    }

    private fun updateUI() {
        val running = Prefs.isServiceEnabled(this)
        binding.tvServiceStatus.text = if (running) "RUNNING" else "STOPPED"
        binding.tvServiceStatus.setTextColor(getColor(if (running) R.color.success else R.color.danger))
        binding.btnToggleService.isEnabled = !serviceToggleInFlight
        binding.btnToggleService.text = when {
            serviceToggleInFlight && !running -> "Starting..."
            running -> "Stop Service"
            else -> "Start Service"
        }
        binding.tvGatewayId.text = Prefs.getGatewayId(this)
        binding.tvPort.text = ":${Prefs.getHttpPort(this)}"
        binding.tvBackendUrl.text = Prefs.getBackendUrl(this)
        binding.tvLocalIp.text = getLocalIp()
        supportActionBar?.subtitle = if (running) "Service active" else "Service stopped"
    }

    private fun getLocalIp(): String {
        val ip = NetworkUtils.getLocalIp(this)
        return ip.ifBlank { "Not connected to Wi-Fi" }
    }

    private fun requestPermissions() {
        val needed = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.READ_PHONE_STATE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }
}
