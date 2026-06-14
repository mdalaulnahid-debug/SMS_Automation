package com.smsgateway

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
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

        setupTabs()

        binding.btnRefreshGateways.setOnClickListener { loadGatewayHealth() }
        binding.btnPublishUpdate.setOnClickListener {
            pickApk.launch(arrayOf("application/vnd.android.package-archive"))
        }

        loadGatewayHealth()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.admin_toolbar, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_check_update -> {
                android.widget.Toast.makeText(this, "Checking for updates…", android.widget.Toast.LENGTH_SHORT).show()
                UpdateChecker.checkInBackground(this, showResult = true)
                true
            }
            R.id.action_logs -> {
                startActivity(Intent(this, LogActivity::class.java))
                true
            }
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun setupTabs() {
        binding.tabLayout.addTab(binding.tabLayout.newTab().setText("GATEWAYS"))
        binding.tabLayout.addTab(binding.tabLayout.newTab().setText("PUBLISH"))

        binding.tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                when (tab.position) {
                    0 -> {
                        binding.gatewaysContent.visibility = View.VISIBLE
                        binding.publishContent.visibility = View.GONE
                    }
                    1 -> {
                        binding.gatewaysContent.visibility = View.GONE
                        binding.publishContent.visibility = View.VISIBLE
                    }
                }
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })
    }

    private fun loadGatewayHealth() {
        binding.btnRefreshGateways.isEnabled = false
        binding.tvStatOnline.text = "—"
        binding.tvStatOffline.text = "—"
        binding.tvStatTotal.text = "—"
        binding.gatewayCardsContainer.removeAllViews()

        val backendUrl = Prefs.getBackendUrl(this)
        val adminKey = Prefs.getAdminApiKey(this)

        lifecycleScope.launch {
            val gateways = withContext(Dispatchers.IO) {
                BackendClient.fetchGatewayHealth(backendUrl, adminKey)
            }
            binding.btnRefreshGateways.isEnabled = true
            val online = gateways.count { it.online }
            val offline = gateways.size - online
            binding.tvStatOnline.text = online.toString()
            binding.tvStatOffline.text = offline.toString()
            binding.tvStatTotal.text = gateways.size.toString()
            gateways.forEach { gw -> addGatewayCard(gw) }
        }
    }

    private fun addGatewayCard(gw: BackendClient.GatewayStatus) {
        val view = LayoutInflater.from(this).inflate(R.layout.item_gateway_card, null)

        // Name shows operator label; ID shows the gateway key
        val parts = gw.id.split("_")
        val operatorName = gw.operatorName.ifBlank { parts.firstOrNull() ?: gw.id }
        view.findViewById<TextView>(R.id.tvGatewayName).text = operatorName
        view.findViewById<TextView>(R.id.tvGatewayId).text = gw.id

        val statusColor = ContextCompat.getColor(this, if (gw.online) R.color.success else R.color.danger)
        val statusDimColor = ContextCompat.getColor(this, if (gw.online) R.color.success_dim else R.color.danger_dim)
        val tintList = android.content.res.ColorStateList.valueOf(statusColor)
        val dimTintList = android.content.res.ColorStateList.valueOf(statusDimColor)

        // Status badge
        val tvStatus = view.findViewById<TextView>(R.id.tvGatewayOnline)
        tvStatus.text = if (gw.online) "ONLINE" else "OFFLINE"
        tvStatus.setTextColor(statusColor)
        tvStatus.backgroundTintList = dimTintList

        // Left stripe
        view.findViewById<View>(R.id.statusStripe).setBackgroundColor(statusColor)

        // Operator initial circle
        val initial = operatorName.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
        view.findViewById<TextView>(R.id.tvOperatorInitial).text = initial
        view.findViewById<TextView>(R.id.tvOperatorInitial).setTextColor(statusColor)
        view.findViewById<View>(R.id.operatorCircleBg).backgroundTintList = dimTintList

        val tvPhone = view.findViewById<TextView>(R.id.tvPhoneNumber)
        if (gw.phoneNumber.isNotBlank()) {
            tvPhone.text = gw.phoneNumber
            tvPhone.visibility = View.VISIBLE
        } else {
            tvPhone.visibility = View.GONE
        }

        view.findViewById<TextView>(R.id.tvLastSeen).text = "Last seen: ${formatRelative(gw.lastSeenAt)}"

        view.findViewById<TextView>(R.id.tvSentCount).text = "—"
        view.findViewById<TextView>(R.id.tvReceivedCount).text = "—"

        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).also { it.bottomMargin = (10 * resources.displayMetrics.density).toInt() }
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
                    val apkBytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: return@withContext Result.failure<String>(Exception("Cannot read file"))

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
            binding.btnPublishUpdate.text = "Select APK and Publish"

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
