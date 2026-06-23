package com.smsgateway.admin;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class AdminMainActivity extends Activity {
    private static final String PREFS = "sms_admin_app";
    private static final String KEY_URL = "backend_url";
    private static final String KEY_API = "admin_api_key";

    private View panelOverview;
    private View panelApprovals;
    private View panelGateways;
    private View panelIncidents;
    private View panelAudit;
    private View panelSettings;
    private EditText etBackendUrl;
    private EditText etAdminApiKey;
    private TextView tvTopStatus;
    private TextView btnHeaderSettings;
    private TextView tvHeaderSubtitle;
    private TextView tvConnectionState;
    private TextView tvOverviewSummary;
    private TextView tvOverviewPostureNote;
    private TextView tvOverviewKpis;
    private TextView tvKpiActive;
    private TextView tvKpiActiveLabel;
    private TextView tvKpiPending;
    private TextView tvKpiFailed;
    private TextView tvKpiUnmatched;
    private TextView tvKpiGateways;
    private TextView tvSettingsSummary;
    private EditText etTelegramGroupChatId;
    private EditText etShortcodeGp;
    private EditText etShortcodeRobi;
    private EditText etShortcodeBanglalink;
    private TextView tvOperationalSettingsResult;
    private LinearLayout layoutAuthorizedUsers;
    private EditText etAuthUserId;
    private EditText etAuthUserName;
    private LinearLayout layoutOverviewFleet;
    private LinearLayout layoutOverviewEscalations;
    private LinearLayout layoutApprovalsList;
    private LinearLayout layoutGatewaysList;
    private LinearLayout layoutIncidentsList;
    private LinearLayout layoutAuditList;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_admin_main);

        panelOverview = findViewById(R.id.panelOverview);
        panelApprovals = findViewById(R.id.panelApprovals);
        panelGateways = findViewById(R.id.panelGateways);
        panelIncidents = findViewById(R.id.panelIncidents);
        panelAudit = findViewById(R.id.panelAudit);
        panelSettings = findViewById(R.id.panelSettings);

        etBackendUrl = findViewById(R.id.etBackendUrl);
        etAdminApiKey = findViewById(R.id.etAdminApiKey);
        tvTopStatus = findViewById(R.id.tvTopStatus);
        btnHeaderSettings = findViewById(R.id.btnHeaderSettings);
        tvHeaderSubtitle = findViewById(R.id.tvHeaderSubtitle);
        tvConnectionState = findViewById(R.id.tvConnectionState);
        tvOverviewSummary = findViewById(R.id.tvOverviewSummary);
        tvOverviewPostureNote = findViewById(R.id.tvOverviewPostureNote);
        tvOverviewKpis = findViewById(R.id.tvOverviewKpis);
        tvKpiActive = findViewById(R.id.tvKpiActive);
        tvKpiActiveLabel = findViewById(R.id.tvKpiActiveLabel);
        tvKpiPending = findViewById(R.id.tvKpiPending);
        tvKpiFailed = findViewById(R.id.tvKpiFailed);
        tvKpiUnmatched = findViewById(R.id.tvKpiUnmatched);
        tvKpiGateways = findViewById(R.id.tvKpiGateways);
        tvSettingsSummary = findViewById(R.id.tvSettingsSummary);
        etTelegramGroupChatId = findViewById(R.id.etTelegramGroupChatId);
        etShortcodeGp = findViewById(R.id.etShortcodeGp);
        etShortcodeRobi = findViewById(R.id.etShortcodeRobi);
        etShortcodeBanglalink = findViewById(R.id.etShortcodeBanglalink);
        tvOperationalSettingsResult = findViewById(R.id.tvOperationalSettingsResult);
        layoutAuthorizedUsers = findViewById(R.id.layoutAuthorizedUsers);
        etAuthUserId = findViewById(R.id.etAuthUserId);
        etAuthUserName = findViewById(R.id.etAuthUserName);
        layoutOverviewFleet = findViewById(R.id.layoutOverviewFleet);
        layoutOverviewEscalations = findViewById(R.id.layoutOverviewEscalations);
        layoutApprovalsList = findViewById(R.id.layoutApprovalsList);
        layoutGatewaysList = findViewById(R.id.layoutGatewaysList);
        layoutIncidentsList = findViewById(R.id.layoutIncidentsList);
        layoutAuditList = findViewById(R.id.layoutAuditList);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        etBackendUrl.setText(prefs.getString(KEY_URL, ""));
        etAdminApiKey.setText(prefs.getString(KEY_API, ""));

        ((Button) findViewById(R.id.btnSaveConnection)).setOnClickListener(v -> {
            prefs.edit()
                .putString(KEY_URL, etBackendUrl.getText().toString().trim())
                .putString(KEY_API, etAdminApiKey.getText().toString().trim())
                .apply();
            Toast.makeText(this, "Connection saved", Toast.LENGTH_SHORT).show();
        });
        ((Button) findViewById(R.id.btnRefreshData)).setOnClickListener(v -> refreshLiveData());

        ((Button) findViewById(R.id.btnSaveTelegramGroup)).setOnClickListener(v ->
            saveTelegramGroupChatId(etTelegramGroupChatId.getText().toString().trim()));
        ((Button) findViewById(R.id.btnSaveShortcodeGp)).setOnClickListener(v ->
            saveOperatorShortcode("GP", etShortcodeGp.getText().toString().trim()));
        ((Button) findViewById(R.id.btnSaveShortcodeRobi)).setOnClickListener(v ->
            saveOperatorShortcode("ROBI", etShortcodeRobi.getText().toString().trim()));
        ((Button) findViewById(R.id.btnSaveShortcodeBanglalink)).setOnClickListener(v ->
            saveOperatorShortcode("BANGLALINK", etShortcodeBanglalink.getText().toString().trim()));
        ((Button) findViewById(R.id.btnAddAuthorizedUser)).setOnClickListener(v ->
            addAuthorizedUser(etAuthUserId.getText().toString().trim(), etAuthUserName.getText().toString().trim()));

        findViewById(R.id.tabOverview).setOnClickListener(v -> showPanel(0));
        findViewById(R.id.tabApprovals).setOnClickListener(v -> showPanel(1));
        findViewById(R.id.tabGateways).setOnClickListener(v -> showPanel(2));
        findViewById(R.id.tabIncidents).setOnClickListener(v -> showPanel(3));
        findViewById(R.id.tabAudit).setOnClickListener(v -> showPanel(4));
        btnHeaderSettings.setOnClickListener(v -> showPanel(5));

        showPanel(0);
        refreshLiveData();
    }

    private void refreshLiveData() {
        final String baseUrl = etBackendUrl.getText().toString().trim();
        final String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            tvConnectionState.setText("Backend URL and admin key required");
            tvConnectionState.setTextColor(Color.parseColor("#FFBF5F"));
            tvOverviewSummary.setText("Configuration required before live supervision can start.");
            tvOverviewPostureNote.setText("Open Settings, add the backend authority URL and admin key, then refresh.");
            tvTopStatus.setText("LINK REQUIRED");
            tvHeaderSubtitle.setText("Open Settings and add the backend authority link.");
            tvSettingsSummary.setText("Missing connection details. Add the backend URL and admin key, save, then refresh.");
            return;
        }
        tvConnectionState.setText("Refreshing live backend data...");
        tvConnectionState.setTextColor(Color.parseColor("#B2C0D9"));
        tvOverviewPostureNote.setText("Polling overview, queue, gateways, incidents, and audit feeds from the backend.");
        tvTopStatus.setText("SYNCING");
        tvHeaderSubtitle.setText("Checking command posture, approvals, gateways, incidents, and audit state.");
        tvSettingsSummary.setText("Refreshing live data from " + baseUrl);

        new Thread(() -> {
            try {
                JSONObject overview = AdminBackendClient.getJson(baseUrl, "/api/admin/overview", apiKey);
                JSONObject requests = AdminBackendClient.getJson(baseUrl, "/api/admin/requests", apiKey);
                JSONObject replies = AdminBackendClient.getJson(baseUrl, "/api/admin/replies", apiKey);
                JSONObject unmatched = AdminBackendClient.getJson(baseUrl, "/api/admin/unmatched", apiKey);
                JSONObject audit = AdminBackendClient.getJson(baseUrl, "/api/admin/audit", apiKey);

                runOnUiThread(() -> {
                    tvConnectionState.setText("Connected | live data loaded");
                    tvConnectionState.setTextColor(Color.parseColor("#56D88B"));
                    tvTopStatus.setText("LIVE");
                    tvHeaderSubtitle.setText("Connected to backend authority.");
                    tvSettingsSummary.setText("Connected to " + baseUrl + "\nAdmin key accepted by backend authority.");
                    renderOverview(overview);
                    renderApprovals(requests.optJSONArray("requests"), replies.optJSONArray("replyDrafts"));
                    renderGateways(overview.optJSONArray("gatewayHealth"));
                    renderIncidents(overview.optJSONArray("activity"), overview.optJSONObject("alerts"));
                    renderAudit(audit.optJSONArray("auditLogs"));
                    loadOperationalSettings();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    tvConnectionState.setText("Refresh failed: " + error.getMessage());
                    tvConnectionState.setTextColor(Color.parseColor("#FF6D7F"));
                    tvOverviewSummary.setText("Backend connection fault");
                    tvOverviewPostureNote.setText("Check the saved server address, API key, TLS reachability, and backend health.");
                    tvTopStatus.setText("FAULT");
                    tvHeaderSubtitle.setText("Connection failed. Inspect settings and backend reachability.");
                    tvSettingsSummary.setText("Refresh failed.\n" + error.getMessage());
                });
            }
        }).start();
    }

    private void renderOverview(JSONObject overview) {
        JSONObject alerts = overview.optJSONObject("alerts");
        JSONObject stats = overview.optJSONObject("stats");
        tvOverviewSummary.setText(alerts == null
            ? "No alert summary available."
            : "Alert posture | " + AdminBackendClient.summarizeAlerts(alerts));

        int active = stats == null ? 0 : stats.optInt("activeRequests", 0);
        int pending = stats == null ? 0 : stats.optInt("pendingApprovals", 0);
        int failed = stats == null ? 0 : stats.optInt("failedOrTimedOut", 0);
        int unmatched = stats == null ? 0 : stats.optInt("unmatchedInbound", 0);
        int gateways = stats == null ? 0 : stats.optInt("onlineGateways", 0);
        tvKpiActive.setText(String.valueOf(active));
        tvKpiActiveLabel.setText(active > 0 ? "COMMAND LOAD / ACTIVE FLOW" : "COMMAND LOAD / IDLE");
        tvKpiPending.setText("PENDING " + pending);
        tvKpiFailed.setText("FAILED " + failed);
        tvKpiUnmatched.setText("UNMATCHED " + unmatched);
        tvKpiGateways.setText("ONLINE GW " + gateways);
        tvOverviewPostureNote.setText(buildOverviewPosture(active, pending, failed, unmatched, gateways));
        tvOverviewKpis.setText(
            "Queue pressure | " + active + " active | " + pending + " pending approvals"
                + "\nExceptions | " + failed + " failed or timed out | " + unmatched + " unmatched inbound"
                + "\nFleet posture | " + gateways + " online gateways reporting into the backend"
        );

        JSONArray gatewayHealth = overview.optJSONArray("gatewayHealth");
        renderOverviewFleet(gatewayHealth);

        JSONArray activity = overview.optJSONArray("activity");
        renderOverviewEscalations(activity);
    }

    private void renderApprovals(JSONArray requests, JSONArray replies) {
        layoutApprovalsList.removeAllViews();
        List<String> draftable = new ArrayList<>();
        if (replies != null) {
            for (int i = 0; i < replies.length(); i++) {
                JSONObject reply = replies.optJSONObject(i);
                if (reply != null) {
                    draftable.add(reply.optString("requestId", ""));
                }
            }
        }
        if (requests == null || requests.length() == 0) {
            layoutApprovalsList.addView(infoCard("CLEAR", "No requests available.", "No requests were returned by the backend."));
            return;
        }
        boolean any = false;
        for (int i = 0; i < requests.length(); i++) {
            JSONObject request = requests.optJSONObject(i);
            if (request == null) continue;
            if (!"NEEDS_MANUAL_REVIEW".equals(request.optString("status"))) continue;
            any = true;
            layoutApprovalsList.addView(buildApprovalRow(
                request.optString("requestId"),
                request.optString("requestType") + " " + request.optString("payload"),
                request.optString("requesterName"),
                AdminBackendClient.flattenDispatches(request.optJSONArray("dispatches")),
                draftable.contains(request.optString("requestId"))
            ));
        }
        if (!any) {
            layoutApprovalsList.addView(infoCard("CLEAR", "No pending approvals.", "The review queue is empty right now."));
        }
    }

    private void renderGateways(JSONArray gateways) {
        layoutGatewaysList.removeAllViews();
        if (gateways == null || gateways.length() == 0) {
            layoutGatewaysList.addView(infoCard("FLEET", "No gateway health data.", "No gateways reported health data."));
            return;
        }
        for (int i = 0; i < gateways.length(); i++) {
            JSONObject gateway = gateways.optJSONObject(i);
            if (gateway == null) continue;
            layoutGatewaysList.addView(buildSystemStatusRow(
                gateway.optBoolean("online") ? "ONLINE" : "OFFLINE",
                gateway.optString("operatorName"),
                gateway.optString("id"),
                gateway.optString("gatewayUrl", "(not registered)"),
                gateway.optString("lastSeenAt", "unknown")
            ));
        }
    }

    private void renderIncidents(JSONArray events, JSONObject alerts) {
        layoutIncidentsList.removeAllViews();
        if (alerts != null) {
            layoutIncidentsList.addView(infoCard("ALERTS", "Alert Totals", AdminBackendClient.summarizeAlerts(alerts)));
        }
        if (events == null || events.length() == 0) {
            layoutIncidentsList.addView(infoCard("CALM", "No incident activity available.", "No active incident feed rows are available."));
            return;
        }
        for (int i = 0; i < Math.min(events.length(), 12); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            layoutIncidentsList.addView(buildIncidentRow(
                event.optString("severity", "INFO").toUpperCase(),
                event.optString("title"),
                event.optString("summary", ""),
                event.optString("gatewayId", "-"),
                event.optString("occurredAt", "-")
            ));
        }
    }

    private void renderAudit(JSONArray logs) {
        layoutAuditList.removeAllViews();
        if (logs == null || logs.length() == 0) {
            layoutAuditList.addView(infoCard("AUDIT", "No audit records available.", "No mobile audit rows were returned."));
            return;
        }
        for (int i = Math.max(0, logs.length() - 20); i < logs.length(); i++) {
            JSONObject log = logs.optJSONObject(i);
            if (log == null) continue;
            StringBuilder body = new StringBuilder("Actor: ").append(log.optString("actor", "system"));
            if (!log.isNull("requestId") && !log.optString("requestId", "").isEmpty()) {
                body.append("\nRequest: ").append(log.optString("requestId"));
            }
            body.append("\nTime: ").append(formatRelative(log.optString("timestamp", "")));
            String summary = summarizeAuditDetails(log.isNull("details") ? null : log.optJSONObject("details"));
            if (!summary.isEmpty()) {
                body.append("\n").append(summary);
            }
            layoutAuditList.addView(infoCard("LEDGER", log.optString("action", "Audit Event"), body.toString()));
        }
    }

    // Picks the few fields a supervisor actually reads instead of dumping the raw JSON blob —
    // full details still live in the web admin console's audit export.
    private String summarizeAuditDetails(JSONObject details) {
        if (details == null) return "";
        String[] preferredKeys = {"messageBody", "snippet", "gatewayId", "recipient", "senderNumber"};
        List<String> parts = new ArrayList<>();
        for (String key : preferredKeys) {
            String value = details.optString(key, "");
            if (value.isEmpty()) continue;
            if (value.length() > 80) value = value.substring(0, 80) + "…";
            parts.add(key + ": " + value);
        }
        return String.join("\n", parts);
    }

    private String formatRelative(String iso) {
        if (iso == null || iso.isEmpty()) return "-";
        try {
            long then = java.time.Instant.parse(iso).toEpochMilli();
            long diffMs = System.currentTimeMillis() - then;
            if (diffMs < 0) return "just now";
            long seconds = diffMs / 1000;
            if (seconds < 60) return seconds + "s ago";
            long minutes = seconds / 60;
            if (minutes < 60) return minutes + "m ago";
            long hours = minutes / 60;
            if (hours < 24) return hours + "h ago";
            return (hours / 24) + "d ago";
        } catch (Exception e) {
            return iso;
        }
    }

    private View infoCard(String eyebrow, String title, String body) {
        LinearLayout card = baseCard(false);

        if (!eyebrow.isEmpty()) {
            TextView eyebrowView = new TextView(this);
            eyebrowView.setText(eyebrow);
            eyebrowView.setTextColor(colorForEyebrow(eyebrow));
            eyebrowView.setTextSize(10f);
            eyebrowView.setTypeface(eyebrowView.getTypeface(), android.graphics.Typeface.BOLD);
            card.addView(eyebrowView);
        }

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.parseColor("#EBF3FF"));
        titleView.setTextSize(17f);
        titleView.setGravity(Gravity.START);
        titleView.setTypeface(titleView.getTypeface(), android.graphics.Typeface.BOLD);
        if (!eyebrow.isEmpty()) {
            titleView.setPadding(0, 8, 0, 0);
        }
        card.addView(titleView);

        if (!body.isEmpty()) {
            TextView bodyView = new TextView(this);
            bodyView.setText(body);
            bodyView.setTextColor(Color.parseColor("#B2C0D9"));
            bodyView.setTextSize(13f);
            bodyView.setLineSpacing(0f, 1.2f);
            bodyView.setPadding(0, 12, 0, 0);
            card.addView(bodyView);
        }
        return card;
    }

    private View buildApprovalRow(String requestId, String payload, String requester, String dispatches, boolean draftReady) {
        LinearLayout card = baseCard(false);
        card.addView(buildHeaderRow("REVIEW", requestId, draftReady ? "DRAFT READY" : "AWAITING DRAFT"));
        card.addView(buildTitle(payload));
        card.addView(buildBodyLine("Requester", requester));
        card.addView(buildBodyLine("Dispatches", dispatches));

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setGravity(Gravity.END);
        footer.setPadding(0, 16, 0, 0);

        // Real write actions — same endpoints the web admin console and the Gateway App's
        // Control Center use. This list is already filtered to NEEDS_MANUAL_REVIEW requests
        // (see renderApprovals), so reject/retry are always valid here.
        if (draftReady) {
            footer.addView(buildActionChip("APPROVE", "#56D88B", () ->
                performAction("/api/reply-drafts/" + requestId + "/approve", null, "Reply approved")));
        }
        footer.addView(buildActionChip("RETRY", "#3DD7FF", () ->
            performAction("/api/requests/" + requestId + "/retry", null, "Request re-queued")));
        footer.addView(buildActionChip("REJECT", "#FF6D7F", () ->
            performAction("/api/requests/" + requestId + "/reject", new JSONObject(), "Request rejected")));

        card.addView(footer);
        return card;
    }

    // Clickable variant of buildStatusChip — same visual, wired to a background POST.
    private TextView buildActionChip(String label, String colorHex, Runnable onClick) {
        TextView chip = buildStatusChip(label, colorHex);
        chip.setClickable(true);
        chip.setFocusable(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.leftMargin = (int) (8 * getResources().getDisplayMetrics().density);
        chip.setLayoutParams(params);
        chip.setOnClickListener(v -> onClick.run());
        return chip;
    }

    private void performAction(String path, JSONObject body, String successMessage) {
        String baseUrl = etBackendUrl.getText().toString().trim();
        String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            Toast.makeText(this, "Configure backend URL and admin key in Settings first.", Toast.LENGTH_LONG).show();
            return;
        }
        new Thread(() -> {
            try {
                AdminBackendClient.postJson(baseUrl, path, apiKey, body);
                runOnUiThread(() -> {
                    Toast.makeText(this, successMessage, Toast.LENGTH_SHORT).show();
                    refreshLiveData();
                });
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "Action failed: " + error.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    // Pulls the current Telegram group chat id and operator hotline numbers so the Settings
    // panel reflects what the backend actually has, not stale local field values. Loaded once
    // a refresh succeeds rather than on its own timer — these change rarely and shouldn't
    // clobber an in-progress edit.
    private void loadOperationalSettings() {
        String baseUrl = etBackendUrl.getText().toString().trim();
        String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) return;
        new Thread(() -> {
            try {
                JSONObject settings = AdminBackendClient.getJson(baseUrl, "/api/admin/settings", apiKey);
                JSONObject operators = settings.optJSONObject("operators");
                JSONArray authorizedUsers = settings.optJSONArray("authorizedUsers");
                runOnUiThread(() -> {
                    etTelegramGroupChatId.setText(settings.optString("telegramGroupChatId", ""));
                    if (operators != null) {
                        etShortcodeGp.setText(optShortcode(operators, "GP"));
                        etShortcodeRobi.setText(optShortcode(operators, "ROBI"));
                        etShortcodeBanglalink.setText(optShortcode(operators, "BANGLALINK"));
                    }
                    renderAuthorizedUsers(authorizedUsers);
                });
            } catch (Exception error) {
                // Best-effort — the rest of the Settings panel (backend link) still works.
            }
        }).start();
    }

    private String optShortcode(JSONObject operators, String operator) {
        JSONObject entry = operators.optJSONObject(operator);
        return entry == null ? "" : entry.optString("shortcode", "");
    }

    private void saveTelegramGroupChatId(String groupChatId) {
        String baseUrl = etBackendUrl.getText().toString().trim();
        String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            Toast.makeText(this, "Configure backend URL and admin key first.", Toast.LENGTH_LONG).show();
            return;
        }
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("groupChatId", groupChatId);
                JSONObject result = AdminBackendClient.postJson(baseUrl, "/api/admin/settings/telegram-group", apiKey, body);
                runOnUiThread(() -> showOperationalSettingsResult(
                    "Saved. " + result.optString("note", ""), false));
            } catch (Exception error) {
                runOnUiThread(() -> showOperationalSettingsResult(error.getMessage(), true));
            }
        }).start();
    }

    private void saveOperatorShortcode(String operator, String shortcode) {
        String baseUrl = etBackendUrl.getText().toString().trim();
        String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            Toast.makeText(this, "Configure backend URL and admin key first.", Toast.LENGTH_LONG).show();
            return;
        }
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("operator", operator).put("shortcode", shortcode);
                JSONObject result = AdminBackendClient.postJson(baseUrl, "/api/admin/settings/operator-contact", apiKey, body);
                runOnUiThread(() -> showOperationalSettingsResult(
                    "Saved " + result.optString("operator", operator) + " hotline number — applied immediately.", false));
            } catch (Exception error) {
                runOnUiThread(() -> showOperationalSettingsResult(error.getMessage(), true));
            }
        }).start();
    }

    private void showOperationalSettingsResult(String message, boolean isError) {
        tvOperationalSettingsResult.setVisibility(View.VISIBLE);
        tvOperationalSettingsResult.setText(message);
        tvOperationalSettingsResult.setTextColor(Color.parseColor(isError ? "#FF6D7F" : "#56D88B"));
    }

    private void renderAuthorizedUsers(JSONArray users) {
        layoutAuthorizedUsers.removeAllViews();
        if (users == null || users.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText("No authorized users yet — private DMs are closed to everyone until added here.");
            empty.setTextColor(Color.parseColor("#7F91AF"));
            empty.setTextSize(11);
            layoutAuthorizedUsers.addView(empty);
            return;
        }
        for (int i = 0; i < users.length(); i++) {
            JSONObject user = users.optJSONObject(i);
            if (user == null) continue;
            String telegramUserId = user.optString("telegramUserId");
            String name = user.optString("name");

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rowParams.topMargin = (int) (6 * getResources().getDisplayMetrics().density);
            row.setLayoutParams(rowParams);

            TextView label = new TextView(this);
            label.setText(telegramUserId + " — " + name);
            label.setTextColor(Color.parseColor("#DCE7F2"));
            label.setTextSize(12);
            LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            label.setLayoutParams(labelParams);
            row.addView(label);

            Button removeButton = new Button(this);
            removeButton.setText("Remove");
            removeButton.setTextSize(11);
            removeButton.setOnClickListener(v -> removeAuthorizedUser(telegramUserId));
            row.addView(removeButton);

            layoutAuthorizedUsers.addView(row);
        }
    }

    private void addAuthorizedUser(String telegramUserId, String name) {
        String baseUrl = etBackendUrl.getText().toString().trim();
        String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            Toast.makeText(this, "Configure backend URL and admin key first.", Toast.LENGTH_LONG).show();
            return;
        }
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("telegramUserId", telegramUserId).put("name", name);
                JSONObject result = AdminBackendClient.postJson(baseUrl, "/api/admin/settings/authorized-users", apiKey, body);
                runOnUiThread(() -> {
                    showOperationalSettingsResult(
                        "Added " + result.optString("name", name) + ". " + result.optString("note", ""), false);
                    etAuthUserId.setText("");
                    etAuthUserName.setText("");
                    loadOperationalSettings();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showOperationalSettingsResult(error.getMessage(), true));
            }
        }).start();
    }

    private void removeAuthorizedUser(String telegramUserId) {
        String baseUrl = etBackendUrl.getText().toString().trim();
        String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            Toast.makeText(this, "Configure backend URL and admin key first.", Toast.LENGTH_LONG).show();
            return;
        }
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("telegramUserId", telegramUserId);
                AdminBackendClient.postJson(baseUrl, "/api/admin/settings/authorized-users/remove", apiKey, body);
                runOnUiThread(() -> {
                    showOperationalSettingsResult(
                        "Removed " + telegramUserId + ". Restart the Telegram bridge for this to take effect.", false);
                    loadOperationalSettings();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showOperationalSettingsResult(error.getMessage(), true));
            }
        }).start();
    }

    private View buildIncidentRow(String severity, String title, String summary, String gatewayId, String occurredAt) {
        LinearLayout card = baseCard("CRITICAL".equals(severity) || "ERROR".equals(severity));
        card.addView(buildHeaderRow(severity, title, occurredAt));
        TextView summaryView = buildTitle(summary.isEmpty() ? title : summary);
        summaryView.setTextSize(16f);
        card.addView(summaryView);
        card.addView(buildBodyLine("Gateway", gatewayId));
        card.addView(buildBodyLine("Severity", severity));
        return card;
    }

    private View buildSystemStatusRow(String status, String title, String systemId, String endpoint, String lastSeen) {
        LinearLayout card = baseCard(false);
        card.addView(buildHeaderRow(status, title, systemId));
        card.addView(buildSystemMetricRow("Endpoint", endpoint));
        card.addView(buildSystemMetricRow("Last Seen", lastSeen));
        return card;
    }

    private void renderOverviewFleet(JSONArray gateways) {
        layoutOverviewFleet.removeAllViews();
        if (gateways == null || gateways.length() == 0) {
            layoutOverviewFleet.addView(infoCard("FLEET", "No live gateways reported", "Gateway heartbeat and operator identity will appear here when devices check in."));
            return;
        }
        for (int i = 0; i < Math.min(gateways.length(), 4); i++) {
            JSONObject gateway = gateways.optJSONObject(i);
            if (gateway == null) continue;
            layoutOverviewFleet.addView(buildSystemStatusRow(
                gateway.optBoolean("online") ? "ONLINE" : "OFFLINE",
                gateway.optString("operatorName", "Gateway"),
                gateway.optString("id", "-"),
                gateway.optString("gatewayUrl", "(not registered)"),
                gateway.optString("lastSeenAt", "unknown")
            ));
        }
    }

    private void renderOverviewEscalations(JSONArray activity) {
        layoutOverviewEscalations.removeAllViews();
        if (activity == null || activity.length() == 0) {
            layoutOverviewEscalations.addView(infoCard("CALM", "No recent escalations", "Recent failures, dispatch issues, and unmatched spikes will appear here."));
            return;
        }
        for (int i = 0; i < Math.min(activity.length(), 5); i++) {
            JSONObject event = activity.optJSONObject(i);
            if (event == null) continue;
            layoutOverviewEscalations.addView(buildIncidentRow(
                event.optString("severity", "INFO").toUpperCase(),
                event.optString("title", "Event"),
                event.optString("summary", ""),
                event.optString("gatewayId", "-"),
                event.optString("occurredAt", "-")
            ));
        }
    }

    private String buildOverviewPosture(int active, int pending, int failed, int unmatched, int gateways) {
        if (failed > 0 || unmatched > 0) {
            return "Exception posture elevated. Review failures and unmatched inbound items first.";
        }
        if (pending > 0) {
            return "Supervisor review is waiting. Clear pending approvals to keep dispatch flow moving.";
        }
        if (active > 0) {
            return "System is processing live work. Monitor fleet heartbeat and recent incident rows.";
        }
        if (gateways > 0) {
            return "Fleet is online and standing by. No immediate exceptions reported.";
        }
        return "No gateways are currently reporting. Check fleet connectivity and backend registration.";
    }

    private LinearLayout baseCard(boolean critical) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(16, 12, 16, 12);
        card.setBackground(AdminDesignSystem.rowBackground(critical));

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.bottomMargin = 10;
        card.setLayoutParams(params);
        return card;
    }

    private View buildHeaderRow(String status, String title, String meta) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        row.addView(buildStatusChip(status, colorHexForEyebrow(status)));

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(AdminDesignSystem.Palette.PRIMARY);
        titleView.setTextSize(14f);
        titleView.setTypeface(titleView.getTypeface(), android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        titleParams.leftMargin = 12;
        titleView.setLayoutParams(titleParams);
        row.addView(titleView);

        TextView metaView = new TextView(this);
        metaView.setText(meta);
        metaView.setTextColor(AdminDesignSystem.Palette.TEXT_DIM);
        metaView.setTextSize(11f);
        row.addView(metaView);
        return row;
    }

    private TextView buildTitle(String text) {
        TextView titleView = new TextView(this);
        titleView.setText(text);
        titleView.setTextColor(AdminDesignSystem.Palette.TEXT_PRIMARY);
        titleView.setTextSize(17f);
        titleView.setTypeface(titleView.getTypeface(), android.graphics.Typeface.BOLD);
        titleView.setPadding(0, 12, 0, 0);
        return titleView;
    }

    private View buildBodyLine(String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, 10, 0, 0);

        TextView labelView = AdminDesignSystem.label(this, label.toUpperCase());
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.34f);
        labelView.setLayoutParams(labelParams);
        row.addView(labelView);

        TextView valueView = AdminDesignSystem.value(this, value, AdminDesignSystem.Palette.TEXT_SECONDARY, 13f, false);
        LinearLayout.LayoutParams valueParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.66f);
        valueView.setLayoutParams(valueParams);
        row.addView(valueView);
        return row;
    }

    private View buildSystemMetricRow(String label, String value) {
        return AdminDesignSystem.systemStatusRow(this, label, value);
    }

    private TextView buildStatusChip(String text, String colorHex) {
        return AdminDesignSystem.statusChip(this, text, Color.parseColor(colorHex));
    }

    private int colorForEyebrow(String eyebrow) {
        return Color.parseColor(colorHexForEyebrow(eyebrow));
    }

    private String colorHexForEyebrow(String eyebrow) {
        if ("ONLINE".equals(eyebrow) || "CLEAR".equals(eyebrow) || "CALM".equals(eyebrow)) {
            return "#56D88B";
        }
        if ("REVIEW".equals(eyebrow) || "ALERTS".equals(eyebrow)) {
            return "#FFBF5F";
        }
        if ("OFFLINE".equals(eyebrow) || "CRITICAL".equals(eyebrow) || "ERROR".equals(eyebrow)) {
            return "#FF6D7F";
        }
        return "#3DD7FF";
    }

    private void showPanel(int index) {
        panelOverview.setVisibility(index == 0 ? View.VISIBLE : View.GONE);
        panelApprovals.setVisibility(index == 1 ? View.VISIBLE : View.GONE);
        panelGateways.setVisibility(index == 2 ? View.VISIBLE : View.GONE);
        panelIncidents.setVisibility(index == 3 ? View.VISIBLE : View.GONE);
        panelAudit.setVisibility(index == 4 ? View.VISIBLE : View.GONE);
        panelSettings.setVisibility(index == 5 ? View.VISIBLE : View.GONE);

        setTabSelected(R.id.tabOverview, index == 0);
        setTabSelected(R.id.tabApprovals, index == 1);
        setTabSelected(R.id.tabGateways, index == 2);
        setTabSelected(R.id.tabIncidents, index == 3);
        setTabSelected(R.id.tabAudit, index == 4);
        btnHeaderSettings.setText(index == 5 ? "BACK TO OPS" : "SETTINGS");
        btnHeaderSettings.setBackgroundResource(index == 5 ? R.drawable.admin_bg_tab_active : R.drawable.admin_bg_tab_idle);
        if (index == 5) {
            btnHeaderSettings.setOnClickListener(v -> showPanel(0));
        } else {
            btnHeaderSettings.setOnClickListener(v -> showPanel(5));
        }
    }

    private void setTabSelected(int viewId, boolean selected) {
        View tab = findViewById(viewId);
        tab.setAlpha(selected ? 1f : 0.78f);
        tab.setBackgroundResource(selected ? R.drawable.admin_bg_tab_active : R.drawable.admin_bg_tab_idle);

        int textColor = Color.parseColor(selected ? "#EBF3FF" : "#B2C0D9");
        int iconId = 0;
        int labelId = 0;
        if (viewId == R.id.tabOverview) {
            iconId = R.id.iconOverview;
            labelId = R.id.labelOverview;
        } else if (viewId == R.id.tabApprovals) {
            iconId = R.id.iconApprovals;
            labelId = R.id.labelApprovals;
        } else if (viewId == R.id.tabGateways) {
            iconId = R.id.iconGateways;
            labelId = R.id.labelGateways;
        } else if (viewId == R.id.tabIncidents) {
            iconId = R.id.iconIncidents;
            labelId = R.id.labelIncidents;
        } else if (viewId == R.id.tabAudit) {
            iconId = R.id.iconAudit;
            labelId = R.id.labelAudit;
        }

        if (iconId != 0) {
            ImageView icon = findViewById(iconId);
            icon.setColorFilter(textColor);
        }
        if (labelId != 0) {
            TextView label = findViewById(labelId);
            label.setTextColor(textColor);
        }
    }
}
