package com.smsgateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.text.format.Formatter
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.smsgateway.databinding.ActivityMainBinding
import com.smsgateway.db.AppDatabase
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { updateUI() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnToggleService.setOnClickListener { toggleService() }
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        binding.btnLogs.setOnClickListener {
            startActivity(Intent(this, LogActivity::class.java))
        }

        lifecycleScope.launch {
            AppDatabase.get(this@MainActivity).logDao().getRecent().collectLatest { logs ->
                val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

                val sent = logs.firstOrNull { it.direction == "OUTBOUND" }
                binding.tvLastSent.text = if (sent != null)
                    "${fmt.format(Date(sent.timestamp))}  →  ${sent.recipient}  |  ${sent.messageBody.take(35)}"
                else "—"

                val received = logs.firstOrNull { it.direction == "INBOUND" }
                binding.tvLastReceived.text = if (received != null)
                    "${fmt.format(Date(received.timestamp))}  ←  ${received.sender}  |  ${received.messageBody.take(35)}"
                else "—"

                val retryCount = logs.count { it.status == "PENDING_RETRY" }
                binding.tvRetryCount.text = if (retryCount > 0) "$retryCount pending" else "None"
            }
        }

        requestPermissions()
    }

    override fun onResume() {
        super.onResume()
        updateUI()
    }

    private fun toggleService() {
        val running = Prefs.isServiceEnabled(this)
        val intent = Intent(this, GatewayForegroundService::class.java)
        if (running) {
            intent.action = GatewayForegroundService.ACTION_STOP
            startService(intent)
        } else {
            ContextCompat.startForegroundService(this, intent)
        }
        binding.root.postDelayed({ updateUI() }, 300)
    }

    private fun updateUI() {
        val running = Prefs.isServiceEnabled(this)
        binding.tvServiceStatus.text = if (running) "RUNNING" else "STOPPED"
        binding.tvServiceStatus.setTextColor(
            getColor(if (running) android.R.color.holo_green_dark else android.R.color.holo_red_dark)
        )
        binding.btnToggleService.text = if (running) "Stop Service" else "Start Service"
        binding.tvGatewayId.text = Prefs.getGatewayId(this)
        binding.tvPort.text = ":${Prefs.getHttpPort(this)}"
        binding.tvBackendUrl.text = Prefs.getBackendUrl(this)
        binding.tvLocalIp.text = getLocalIp()
    }

    @Suppress("DEPRECATION")
    private fun getLocalIp(): String {
        val wifiManager = applicationContext.getSystemService(WifiManager::class.java)
        val ip = wifiManager?.connectionInfo?.ipAddress ?: 0
        return if (ip == 0) "Not connected to Wi-Fi" else Formatter.formatIpAddress(ip)
    }

    private fun requestPermissions() {
        val needed = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS
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
