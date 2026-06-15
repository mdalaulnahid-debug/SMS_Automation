package com.smsgateway

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
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

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var serviceToggleInFlight = false
    private var pulseAnimator: ObjectAnimator? = null
    private var noInternetSnackbar: Snackbar? = null
    private var selectedSimIndex = 0

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { updateUI() }

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ServiceEvents.ACTION_STATUS) return
            if (isFinishing || isDestroyed) return
            serviceToggleInFlight = false

            if (intent.hasExtra(ServiceEvents.EXTRA_NO_INTERNET)) {
                val noInternet = intent.getBooleanExtra(ServiceEvents.EXTRA_NO_INTERNET, false)
                if (noInternet) {
                    noInternetSnackbar = Snackbar.make(
                        binding.root,
                        "No internet — polling paused",
                        Snackbar.LENGTH_INDEFINITE
                    ).also { it.show() }
                } else {
                    noInternetSnackbar?.dismiss()
                    noInternetSnackbar = null
                    Snackbar.make(binding.root, "Internet restored — polling resumed", Snackbar.LENGTH_SHORT).show()
                }
                return
            }

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

        binding.btnToggleService.setOnClickListener { toggleService() }

        observeActivityLog()
        requestPermissions()

        // Auto-restart service after upgrade if it was running before
        if (Prefs.isServiceEnabled(this)) {
            ContextCompat.startForegroundService(this, Intent(this, GatewayForegroundService::class.java))
        }
    }

    private val qrScanLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val gwId = result.data?.getStringExtra(QrScanActivity.EXTRA_GATEWAY_ID) ?: ""
            if (gwId.isNotBlank()) {
                com.google.android.material.snackbar.Snackbar
                    .make(binding.root, "Provisioned as $gwId — restart service to apply", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                    .show()
                invalidateOptionsMenu()
                updateUI()
            }
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_toolbar, menu)
        menu.findItem(R.id.action_admin)?.isVisible = Prefs.isAdminConfigured(this)
        menu.findItem(R.id.action_scan_qr)?.isVisible = !Prefs.isProvisioned(this)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_check_update -> {
                android.widget.Toast.makeText(this, "Checking for updates…", android.widget.Toast.LENGTH_SHORT).show()
                UpdateChecker.checkInBackground(this, showResult = true)
                true
            }
            R.id.action_scan_qr -> {
                qrScanLauncher.launch(Intent(this, QrScanActivity::class.java))
                true
            }
            R.id.action_admin -> {
                startActivity(Intent(this, AdminActivity::class.java))
                true
            }
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            R.id.action_logs -> {
                startActivity(Intent(this, LogActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun observeActivityLog() {
        lifecycleScope.launch {
            AppDatabase.get(this@MainActivity).logDao().getRecent().collectLatest { logs ->
                val sent = logs.filter { it.direction == "OUTBOUND" }
                val received = logs.filter { it.direction == "INBOUND" }
                val retryCount = logs.count { it.status == "PENDING_RETRY" }

                binding.tvStatSent.text = sent.size.toString()
                binding.tvStatReceived.text = received.size.toString()
                binding.tvStatPending.text = retryCount.toString()

                val fmt = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
                val lastSent = sent.firstOrNull()
                binding.tvLastSent.text = if (lastSent != null) {
                    "${fmt.format(java.util.Date(lastSent.timestamp))}  →  ${lastSent.recipient}\n${lastSent.messageBody.take(80)}"
                } else "—"

                val lastReceived = received.firstOrNull()
                binding.tvLastReceived.text = if (lastReceived != null) {
                    "${fmt.format(java.util.Date(lastReceived.timestamp))}  ←  ${lastReceived.sender}\n${lastReceived.messageBody.take(80)}"
                } else "—"
            }
        }
    }

    override fun onResume() {
        super.onResume()
        invalidateOptionsMenu()
        LocalBroadcastManager.getInstance(this).registerReceiver(
            serviceReceiver,
            IntentFilter(ServiceEvents.ACTION_STATUS)
        )
        setupSimSwitcher()
        updateUI()
        discoverAndCheckBackend()
    }

    override fun onPause() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(serviceReceiver)
        pulseAnimator?.cancel()
        super.onPause()
    }

    private fun isDualSimHardware(): Boolean {
        val sm = getSystemService(SubscriptionManager::class.java)
        if ((sm?.activeSubscriptionInfoCountMax ?: 0) >= 2) return true
        if ((sm?.activeSubscriptionInfoCount ?: 0) >= 2) return true
        val simsSize = SmsSender.listSims(this).size
        if (simsSize >= 2) return true
        val tm = getSystemService(TelephonyManager::class.java) ?: return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && tm.activeModemCount >= 2) return true
        @Suppress("DEPRECATION")
        return tm.phoneCount >= 2
    }

    private fun setupSimSwitcher() {
        val secondary = Prefs.getSecondaryGatewayId(this)
        val isDualSim = isDualSimHardware()
        if (secondary.isBlank() && !isDualSim) {
            binding.simSwitcher.visibility = View.GONE
            return
        }
        binding.simSwitcher.visibility = View.VISIBLE

        val sims = SmsSender.listSims(this)
        val primaryId = Prefs.getGatewayId(this)
        val sim1Label = if (primaryId.isNotBlank()) primaryId.substringBefore("_")
                        else if (sims.isNotEmpty()) sims[0].second else "SIM 1"
        val sim2Label = if (secondary.isNotBlank()) secondary.substringBefore("_")
                        else if (sims.size >= 2) sims[1].second else "SIM 2"
        binding.tvSim1Name.text = sim1Label
        binding.tvSim2Name.text = sim2Label

        updateSimVisuals()

        binding.btnSim1.setOnClickListener {
            if (selectedSimIndex != 0) { selectedSimIndex = 0; updateGatewayIdDisplay(); updateSimVisuals() }
        }
        binding.btnSim2.setOnClickListener {
            if (selectedSimIndex != 1) { selectedSimIndex = 1; updateGatewayIdDisplay(); updateSimVisuals() }
        }
    }

    private fun updateSimVisuals() {
        val dark      = getColor(R.color.bg_primary)
        val secondary = getColor(R.color.text_secondary)
        val cyan      = getColor(R.color.accent)
        val violet    = getColor(R.color.sim2_color)

        if (selectedSimIndex == 0) {
            binding.btnSim1.setBackgroundResource(R.drawable.bg_sim1_active)
            binding.tvSim1Slot.setTextColor(dark)
            binding.tvSim1Name.setTextColor(dark)
            binding.btnSim2.setBackgroundResource(R.drawable.bg_sim2_inactive)
            binding.tvSim2Slot.setTextColor(violet)
            binding.tvSim2Name.setTextColor(secondary)
        } else {
            binding.btnSim2.setBackgroundResource(R.drawable.bg_sim2_active)
            binding.tvSim2Slot.setTextColor(dark)
            binding.tvSim2Name.setTextColor(dark)
            binding.btnSim1.setBackgroundResource(R.drawable.bg_sim1_inactive)
            binding.tvSim1Slot.setTextColor(cyan)
            binding.tvSim1Name.setTextColor(secondary)
        }
    }

    private fun updateGatewayIdDisplay() {
        val gId = if (selectedSimIndex == 0) {
            Prefs.getGatewayId(this)
        } else {
            Prefs.getSecondaryGatewayId(this).ifBlank { "Not configured — set in Settings" }
        }
        binding.tvGatewayId.text = gId
        supportActionBar?.subtitle = gId
    }

    private fun discoverAndCheckBackend() {
        val savedUrl = Prefs.getBackendUrl(this).trim()
        binding.tvBackendHealth.text = "Backend: connecting…"
        binding.tvBackendHealth.setTextColor(getColor(R.color.text_secondary))
        setBackendDotColor(R.color.warning)

        lifecycleScope.launch {
            val connected = withContext(Dispatchers.IO) {
                val phoneIp = NetworkUtils.getLocalIp(this@MainActivity)
                if (phoneIp.isNotBlank()) {
                    val lanUrl = BackendDiscovery.discoverBackendUrl(phoneIp, savedUrl.takeIf { it.isLanUrl() })
                    if (lanUrl != null) {
                        Prefs.setBackendUrl(this@MainActivity, lanUrl)
                        return@withContext lanUrl
                    }
                }
                if (savedUrl.isNotBlank() && BackendClient.checkHealth(savedUrl)) {
                    return@withContext savedUrl
                }
                null
            }

            if (connected != null) {
                binding.tvBackendHealth.text = "Backend: connected"
                binding.tvBackendHealth.setTextColor(getColor(R.color.success))
                setBackendDotColor(R.color.success)
            } else {
                binding.tvBackendHealth.text =
                    if (savedUrl.isNotBlank()) "Backend: not reachable"
                    else "Backend: not found"
                binding.tvBackendHealth.setTextColor(getColor(R.color.danger))
                setBackendDotColor(R.color.danger)
            }
        }
    }

    private fun setBackendDotColor(colorRes: Int) {
        binding.backendDot.background.setTint(getColor(colorRes))
    }

    private fun String.isLanUrl(): Boolean =
        matches(Regex("https?://(192\\.168|10\\.|172\\.(1[6-9]|2[0-9]|3[01]))\\..*"))

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
        binding.btnToggleService.text = "Starting…"
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

        binding.tvPollingStatus.visibility = if (running) View.VISIBLE else View.GONE

        if (running) {
            binding.statusGlow.backgroundTintList =
                android.content.res.ColorStateList.valueOf(getColor(R.color.status_running_glow))
            startPulse()
        } else {
            binding.statusGlow.backgroundTintList =
                android.content.res.ColorStateList.valueOf(getColor(R.color.status_stopped_glow))
            stopPulse()
        }

        binding.btnToggleService.isEnabled = !serviceToggleInFlight
        binding.btnToggleService.text = when {
            serviceToggleInFlight && !running -> "Starting…"
            running -> "Stop Service"
            else -> "Start Service"
        }

        updateGatewayIdDisplay()
    }

    private fun startPulse() {
        if (pulseAnimator?.isRunning == true) return
        pulseAnimator = ObjectAnimator.ofPropertyValuesHolder(
            binding.statusGlow,
            PropertyValuesHolder.ofFloat("scaleX", 1f, 1.08f, 1f),
            PropertyValuesHolder.ofFloat("scaleY", 1f, 1.08f, 1f),
            PropertyValuesHolder.ofFloat("alpha", 0.7f, 1f, 0.7f)
        ).apply {
            duration = 2000
            repeatCount = ObjectAnimator.INFINITE
            interpolator = AccelerateDecelerateInterpolator()
            start()
        }
    }

    private fun stopPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = null
        binding.statusGlow.scaleX = 1f
        binding.statusGlow.scaleY = 1f
        binding.statusGlow.alpha = 1f
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
