package com.smsgateway

import android.content.Intent
import android.graphics.Color
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import com.smsgateway.databinding.ActivityAdminBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AdminActivity : AppCompatActivity() {
    private lateinit var binding: ActivityAdminBinding
    private var currentTab = 0

    private val pickApk = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) uploadApk(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAdminBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        setupTabs()
        setupRefreshButtons()

        // Auto-refresh every 30 s while in foreground
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (true) {
                    loadAll()
                    delay(30_000)
                }
            }
        }

        binding.btnPublishUpdate.setOnClickListener {
            pickApk.launch(arrayOf("application/vnd.android.package-archive"))
        }
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────

    private fun setupTabs() {
        listOf("OVERVIEW", "GATEWAYS", "REQUESTS", "AUDIT", "PUBLISH").forEach {
            binding.tabLayout.addTab(binding.tabLayout.newTab().setText(it))
        }

        val panes = listOf(
            binding.overviewContent,
            binding.gatewaysContent,
            binding.requestsContent,
            binding.auditContent,
            binding.publishContent
        )

        binding.tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                currentTab = tab.position
                panes.forEachIndexed { i, v -> v.visibility = if (i == tab.position) View.VISIBLE else View.GONE }
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })
    }

    private fun setupRefreshButtons() {
        binding.btnRefreshOverview.setOnClickListener { lifecycleScope.launch { loadAll() } }
        binding.btnRefreshGateways.setOnClickListener { lifecycleScope.launch { loadGatewayHealth() } }
        binding.btnRefreshRequests.setOnClickListener { lifecycleScope.launch { loadDashboard() } }
        binding.btnRefreshAudit.setOnClickListener { lifecycleScope.launch { loadDashboard() } }
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private suspend fun loadAll() {
        loadDashboard()
        loadGatewayHealth()
    }

    private suspend fun loadDashboard() {
        val url = Prefs.getBackendUrl(this)
        val key = Prefs.getAdminApiKey(this)

        val snapshot = withContext(Dispatchers.IO) { BackendClient.fetchDashboard(url, key) }

        val ts = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        if (snapshot == null) {
            binding.backendHealthDot.backgroundTintList =
                android.content.res.ColorStateList.valueOf(getColor(R.color.danger))
            binding.tvBackendHealthStatus.text = "Backend unreachable"
            binding.tvBackendHealthStatus.setTextColor(getColor(R.color.danger))
            binding.tvLastRefreshed.text = "Failed $ts"
            return
        }

        binding.backendHealthDot.backgroundTintList =
            android.content.res.ColorStateList.valueOf(getColor(R.color.success))
        binding.tvBackendHealthStatus.text = "Backend connected"
        binding.tvBackendHealthStatus.setTextColor(getColor(R.color.success))
        binding.tvBackendHealthUrl.text = url.substringAfter("//")
        binding.tvLastRefreshed.text = "Updated $ts"

        renderOverviewStats(snapshot)
        renderRecentActivity(snapshot.auditLogs.take(5))
        renderRequests(snapshot.requests)
        renderAudit(snapshot.auditLogs)
    }

    private suspend fun loadGatewayHealth() {
        val url = Prefs.getBackendUrl(this)
        val key = Prefs.getAdminApiKey(this)

        val gateways = withContext(Dispatchers.IO) { BackendClient.fetchGatewayHealth(url, key) }
        val online = gateways.count { it.online }
        binding.tvStatOnline.text = online.toString()
        binding.tvStatOffline.text = (gateways.size - online).toString()
        binding.tvStatTotal.text = gateways.size.toString()
        binding.gatewayCardsContainer.removeAllViews()
        gateways.forEach { addGatewayCard(it) }
    }

    // ── Overview rendering ────────────────────────────────────────────────────

    private fun renderOverviewStats(snap: BackendClient.DashboardSnapshot) {
        val active = snap.requests.count { it.status in setOf("QUEUED", "WAITING_OPERATOR_REPLY", "PENDING_RETRY") }
        val today = snap.requests.count { it.createdAt.startsWith(todayPrefix()) }
        val completed = snap.requests.count { it.status == "COMPLETED" }
        val failed = snap.requests.count { it.status in setOf("TIMED_OUT", "FAILED", "REJECTED") }

        binding.tvOvActive.text = active.toString()
        binding.tvOvToday.text = today.toString()
        binding.tvOvCompleted.text = completed.toString()
        binding.tvOvFailed.text = failed.toString()
        binding.tvOvSmsSent.text = snap.outboxCount.toString()
        binding.tvOvSmsReceived.text = snap.inboxCount.toString()
    }

    private fun renderRecentActivity(entries: List<BackendClient.AuditEntry>) {
        binding.recentActivityContainer.removeAllViews()
        if (entries.isEmpty()) {
            val empty = TextView(this).apply {
                text = "No recent activity"
                textSize = 13f
                setTextColor(getColor(R.color.text_secondary))
                setPadding(0, 16, 0, 16)
            }
            binding.recentActivityContainer.addView(empty)
            return
        }
        entries.forEach { entry -> binding.recentActivityContainer.addView(buildAuditView(entry)) }
    }

    // ── Requests rendering ────────────────────────────────────────────────────

    private fun renderRequests(requests: List<BackendClient.RequestSummary>) {
        val label = if (requests.isEmpty()) "REQUESTS" else "REQUESTS  (${requests.size})"
        binding.tvRequestsCount.text = label

        binding.requestCardsContainer.removeAllViews()
        if (requests.isEmpty()) {
            binding.requestCardsContainer.addView(emptyCard("No requests yet"))
            return
        }
        val dp8 = (8 * resources.displayMetrics.density).toInt()
        requests.forEach { req ->
            val view = LayoutInflater.from(this).inflate(R.layout.item_request_card, null)

            val (stripeColor, statusBg, statusText) = statusAppearance(req.status)
            view.findViewById<View>(R.id.reqStatusStripe).setBackgroundColor(stripeColor)

            val tvType = view.findViewById<TextView>(R.id.tvReqType)
            tvType.text = req.requestType.ifBlank { "REQUEST" }
            tvType.setTextColor(getColor(R.color.accent))
            tvType.setBackgroundColor(getColor(R.color.accent_muted))

            val tvStatus = view.findViewById<TextView>(R.id.tvReqStatus)
            tvStatus.text = req.status
            tvStatus.setTextColor(statusText)
            tvStatus.setBackgroundColor(statusBg)

            view.findViewById<TextView>(R.id.tvReqTime).text = formatRelative(req.createdAt)
            view.findViewById<TextView>(R.id.tvReqTarget).text =
                req.target.ifBlank { req.requestId.take(12) }
            view.findViewById<TextView>(R.id.tvReqRequester).text =
                req.requesterName.ifBlank { "Unknown" }

            val dispatches = req.dispatches.joinToString("  ") { d ->
                val icon = when {
                    d.sentStatus.contains("SENT") || d.sentStatus == "COMPLETED" -> "✓"
                    d.sentStatus.contains("FAIL") || d.sentStatus.contains("ERROR") -> "✗"
                    else -> "…"
                }
                "${d.operator.take(2).uppercase()}$icon"
            }
            view.findViewById<TextView>(R.id.tvReqDispatches).text = dispatches

            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.bottomMargin = dp8 }
            binding.requestCardsContainer.addView(view, params)
        }
    }

    // ── Audit rendering ───────────────────────────────────────────────────────

    private fun renderAudit(entries: List<BackendClient.AuditEntry>) {
        binding.auditEntriesContainer.removeAllViews()
        if (entries.isEmpty()) {
            binding.auditEntriesContainer.addView(emptyCard("No audit entries"))
            return
        }
        entries.forEach { entry -> binding.auditEntriesContainer.addView(buildAuditView(entry)) }
    }

    private fun buildAuditView(entry: BackendClient.AuditEntry): View {
        val view = LayoutInflater.from(this).inflate(R.layout.item_audit_entry, null)

        val tvActor = view.findViewById<TextView>(R.id.tvAuditActor)
        val isWatchdog = entry.actor.lowercase() == "watchdog"
        tvActor.text = if (isWatchdog) "⚠️ WATCHDOG" else entry.actor.uppercase()
        val (actorFg, actorBg) = when (entry.actor.lowercase()) {
            "admin"     -> getColor(R.color.accent)        to getColor(R.color.accent_muted)
            "system"    -> getColor(R.color.warning)       to Color.parseColor("#332800")
            "watchdog"  -> getColor(R.color.danger)        to Color.parseColor("#330000")
            else        -> getColor(R.color.text_secondary) to getColor(R.color.bg_card_elevated)
        }
        tvActor.setTextColor(actorFg)
        tvActor.setBackgroundColor(actorBg)

        view.findViewById<TextView>(R.id.tvAuditAction).text = entry.action
        view.findViewById<TextView>(R.id.tvAuditTime).text = formatRelative(entry.timestamp)

        val tvReqId = view.findViewById<TextView>(R.id.tvAuditRequestId)
        if (isWatchdog && entry.details.isNotBlank() && entry.details != "{}") {
            // Show the recipient + snippet from details JSON if available
            val detailText = try {
                val j = org.json.JSONObject(entry.details)
                val recipient = j.optString("gatewayId", "") + " → " + entry.requestId
                val snippet = j.optString("snippet", "")
                if (snippet.isNotBlank()) "$recipient | \"$snippet\"" else recipient
            } catch (_: Exception) { entry.details.take(60) }
            tvReqId.text = detailText
            tvReqId.visibility = View.VISIBLE
        } else if (entry.requestId.isNotBlank() && entry.requestId != "null") {
            tvReqId.text = entry.requestId.take(16)
            tvReqId.visibility = View.VISIBLE
        } else {
            tvReqId.visibility = View.GONE
        }
        return view
    }

    // ── Gateway cards ─────────────────────────────────────────────────────────

    private fun addGatewayCard(gw: BackendClient.GatewayStatus) {
        val view = LayoutInflater.from(this).inflate(R.layout.item_gateway_card, null)

        val parts = gw.id.split("_")
        val operatorName = gw.operatorName.ifBlank { parts.firstOrNull() ?: gw.id }
        view.findViewById<TextView>(R.id.tvGatewayName).text = operatorName
        view.findViewById<TextView>(R.id.tvGatewayId).text = gw.id

        val statusColor = ContextCompat.getColor(this, if (gw.online) R.color.success else R.color.danger)
        val statusDimColor = ContextCompat.getColor(this, if (gw.online) R.color.success_dim else R.color.danger_dim)
        val tintList = android.content.res.ColorStateList.valueOf(statusColor)
        val dimTintList = android.content.res.ColorStateList.valueOf(statusDimColor)

        val tvStatus = view.findViewById<TextView>(R.id.tvGatewayOnline)
        tvStatus.text = if (gw.online) "ONLINE" else "OFFLINE"
        tvStatus.setTextColor(statusColor)
        tvStatus.backgroundTintList = dimTintList
        view.findViewById<View>(R.id.statusStripe).setBackgroundColor(statusColor)

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

    // ── APK publish ───────────────────────────────────────────────────────────

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
            }.onFailure { err ->
                Snackbar.make(binding.root, "Upload failed: ${err.message}", Snackbar.LENGTH_LONG).show()
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun statusAppearance(status: String): Triple<Int, Int, Int> {
        return when (status) {
            "WAITING_OPERATOR_REPLY" -> Triple(
                getColor(R.color.accent),
                Color.parseColor("#0D2233"),
                getColor(R.color.accent)
            )
            "QUEUED", "PENDING_RETRY" -> Triple(
                getColor(R.color.warning),
                Color.parseColor("#332800"),
                getColor(R.color.warning)
            )
            "COMPLETED" -> Triple(
                getColor(R.color.success),
                Color.parseColor("#0D2200"),
                getColor(R.color.success)
            )
            "TIMED_OUT", "FAILED" -> Triple(
                getColor(R.color.danger),
                Color.parseColor("#330D0D"),
                getColor(R.color.danger)
            )
            "REJECTED" -> Triple(
                getColor(R.color.text_muted),
                getColor(R.color.bg_card_elevated),
                getColor(R.color.text_muted)
            )
            else -> Triple(
                getColor(R.color.text_secondary),
                getColor(R.color.bg_card_elevated),
                getColor(R.color.text_secondary)
            )
        }
    }

    private fun emptyCard(text: String): View {
        return TextView(this).apply {
            this.text = text
            textSize = 13f
            setTextColor(getColor(R.color.text_secondary))
            setPadding(8, 32, 8, 32)
        }
    }

    private fun todayPrefix(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

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

    // ── Menu ──────────────────────────────────────────────────────────────────

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

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
