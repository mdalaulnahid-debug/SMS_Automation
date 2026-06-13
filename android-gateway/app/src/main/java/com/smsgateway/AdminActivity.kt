package com.smsgateway

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.smsgateway.databinding.ActivityAdminBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AdminActivity : AppCompatActivity() {
    private lateinit var binding: ActivityAdminBinding

    private val pickApk = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) uploadApk(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAdminBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        binding.btnRefreshGateways.setOnClickListener { loadGatewayHealth() }
        binding.btnPublishUpdate.setOnClickListener {
            pickApk.launch(arrayOf("application/vnd.android.package-archive"))
        }

        loadGatewayHealth()
    }

    private fun loadGatewayHealth() {
        binding.btnRefreshGateways.isEnabled = false
        binding.tvGatewayStatus.text = "Loading…"
        binding.gatewayCardsContainer.removeAllViews()

        val backendUrl = Prefs.getBackendUrl(this)
        val adminKey = Prefs.getAdminApiKey(this)

        lifecycleScope.launch {
            val gateways = withContext(Dispatchers.IO) {
                BackendClient.fetchGatewayHealth(backendUrl, adminKey)
            }
            binding.btnRefreshGateways.isEnabled = true
            if (gateways.isEmpty()) {
                binding.tvGatewayStatus.text = "No gateways found (check backend URL and admin key)"
                return@launch
            }
            binding.tvGatewayStatus.text = "${gateways.count { it.online }}/${gateways.size} online"
            gateways.forEach { gw -> addGatewayCard(gw) }
        }
    }

    private fun addGatewayCard(gw: BackendClient.GatewayStatus) {
        val view = LayoutInflater.from(this).inflate(R.layout.item_gateway_card, null)
        view.findViewById<TextView>(R.id.tvGatewayName).text = "${gw.operatorName} — ${gw.id}"
        val tvStatus = view.findViewById<TextView>(R.id.tvGatewayOnline)
        tvStatus.text = if (gw.online) "ONLINE" else "OFFLINE"
        tvStatus.setTextColor(
            ContextCompat.getColor(this, if (gw.online) R.color.success else R.color.danger)
        )
        view.findViewById<TextView>(R.id.tvLastSeen).text = "Last seen: ${formatRelative(gw.lastSeenAt)}"
        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).also { it.bottomMargin = (8 * resources.displayMetrics.density).toInt() }
        binding.gatewayCardsContainer.addView(view, params)
    }

    private fun uploadApk(uri: Uri) {
        val backendUrl = Prefs.getBackendUrl(this)
        val adminKey = Prefs.getAdminApiKey(this)
        if (backendUrl.isBlank() || adminKey.isBlank()) {
            Snackbar.make(binding.root, "Backend URL and admin key required", Snackbar.LENGTH_LONG).show()
            return
        }

        binding.btnPublishUpdate.isEnabled = false
        binding.btnPublishUpdate.text = "Reading APK…"

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    // Read APK bytes
                    val apkBytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: return@withContext Result.failure<String>(Exception("Cannot read file"))

                    // Extract version info from APK
                    val tmpFile = java.io.File(cacheDir, "upload-check.apk")
                    tmpFile.writeBytes(apkBytes)
                    val info = packageManager.getPackageArchiveInfo(tmpFile.absolutePath, 0)
                    tmpFile.delete()

                    if (info == null) return@withContext Result.failure(Exception("Not a valid APK"))

                    val vc = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                        info.longVersionCode.toInt()
                    } else {
                        @Suppress("DEPRECATION") info.versionCode
                    }
                    val vn = info.versionName ?: "?"

                    BackendClient.publishApk(backendUrl, adminKey, apkBytes, vc, vn, "Published from admin phone")
                } catch (e: Exception) {
                    Result.failure(e)
                }
            }

            binding.btnPublishUpdate.isEnabled = true
            binding.btnPublishUpdate.text = "Publish Update"

            result.onSuccess { msg ->
                Snackbar.make(binding.root, msg, Snackbar.LENGTH_LONG).show()
                loadGatewayHealth()
            }.onFailure { err ->
                Snackbar.make(binding.root, "Upload failed: ${err.message}", Snackbar.LENGTH_LONG).show()
            }
        }
    }

    private fun formatRelative(iso: String): String {
        return try {
            val ms = java.time.Instant.parse(iso).toEpochMilli()
            val diff = System.currentTimeMillis() - ms
            when {
                diff < 60_000 -> "just now"
                diff < 3_600_000 -> "${diff / 60_000}m ago"
                diff < 86_400_000 -> "${diff / 3_600_000}h ago"
                else -> "${diff / 86_400_000}d ago"
            }
        } catch (_: Exception) { iso }
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
