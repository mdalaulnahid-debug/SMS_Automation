package com.smsgateway.admin;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
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
    private EditText etBackendUrl;
    private EditText etAdminApiKey;
    private TextView tvConnectionState;
    private TextView tvOverviewSummary;
    private TextView tvOverviewKpis;
    private TextView tvOverviewEscalations;
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

        etBackendUrl = findViewById(R.id.etBackendUrl);
        etAdminApiKey = findViewById(R.id.etAdminApiKey);
        tvConnectionState = findViewById(R.id.tvConnectionState);
        tvOverviewSummary = findViewById(R.id.tvOverviewSummary);
        tvOverviewKpis = findViewById(R.id.tvOverviewKpis);
        tvOverviewEscalations = findViewById(R.id.tvOverviewEscalations);
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

        findViewById(R.id.tabOverview).setOnClickListener(v -> showPanel(0));
        findViewById(R.id.tabApprovals).setOnClickListener(v -> showPanel(1));
        findViewById(R.id.tabGateways).setOnClickListener(v -> showPanel(2));
        findViewById(R.id.tabIncidents).setOnClickListener(v -> showPanel(3));
        findViewById(R.id.tabAudit).setOnClickListener(v -> showPanel(4));

        showPanel(0);
        refreshLiveData();
    }

    private void refreshLiveData() {
        final String baseUrl = etBackendUrl.getText().toString().trim();
        final String apiKey = etAdminApiKey.getText().toString().trim();
        if (baseUrl.isEmpty() || apiKey.isEmpty()) {
            tvConnectionState.setText("Backend URL and admin key required");
            tvConnectionState.setTextColor(Color.parseColor("#FFBF5F"));
            return;
        }
        tvConnectionState.setText("Refreshing live backend data…");
        tvConnectionState.setTextColor(Color.parseColor("#B2C0D9"));

        new Thread(() -> {
            try {
                JSONObject overview = AdminBackendClient.getJson(baseUrl, "/api/admin/overview", apiKey);
                JSONObject requests = AdminBackendClient.getJson(baseUrl, "/api/admin/requests", apiKey);
                JSONObject replies = AdminBackendClient.getJson(baseUrl, "/api/admin/replies", apiKey);
                JSONObject unmatched = AdminBackendClient.getJson(baseUrl, "/api/admin/unmatched", apiKey);
                JSONObject audit = AdminBackendClient.getJson(baseUrl, "/api/admin/audit", apiKey);

                runOnUiThread(() -> {
                    tvConnectionState.setText("Connected · live data loaded");
                    tvConnectionState.setTextColor(Color.parseColor("#56D88B"));
                    renderOverview(overview);
                    renderApprovals(requests.optJSONArray("requests"), replies.optJSONArray("replyDrafts"));
                    renderGateways(overview.optJSONArray("gatewayHealth"));
                    renderIncidents(overview.optJSONArray("activity"), overview.optJSONObject("alerts"));
                    renderAudit(audit.optJSONArray("auditLogs"));
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    tvConnectionState.setText("Refresh failed: " + error.getMessage());
                    tvConnectionState.setTextColor(Color.parseColor("#FF6D7F"));
                });
            }
        }).start();
    }

    private void renderOverview(JSONObject overview) {
        JSONObject alerts = overview.optJSONObject("alerts");
        JSONObject stats = overview.optJSONObject("stats");
        tvOverviewSummary.setText(alerts == null
            ? "No alert summary available."
            : "Alert posture: " + AdminBackendClient.summarizeAlerts(alerts));
        tvOverviewKpis.setText(stats == null
            ? "No KPI data available."
            : "Active: " + stats.optInt("activeRequests", 0)
                + "\nPending approvals: " + stats.optInt("pendingApprovals", 0)
                + "\nFailed / timed out: " + stats.optInt("failedOrTimedOut", 0)
                + "\nUnmatched inbound: " + stats.optInt("unmatchedInbound", 0)
                + "\nOnline gateways: " + stats.optInt("onlineGateways", 0));

        JSONArray activity = overview.optJSONArray("activity");
        StringBuilder escalations = new StringBuilder("Latest escalations:\n");
        if (activity != null) {
            for (int i = 0; i < Math.min(activity.length(), 5); i++) {
                JSONObject event = activity.optJSONObject(i);
                if (event == null) continue;
                escalations.append("• ")
                    .append(event.optString("title", "Event"))
                    .append(" — ")
                    .append(event.optString("summary", ""))
                    .append("\n");
            }
        }
        tvOverviewEscalations.setText(escalations.toString().trim());
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
            layoutApprovalsList.addView(infoCard("No requests available."));
            return;
        }
        boolean any = false;
        for (int i = 0; i < requests.length(); i++) {
            JSONObject request = requests.optJSONObject(i);
            if (request == null) continue;
            if (!"NEEDS_MANUAL_REVIEW".equals(request.optString("status"))) continue;
            any = true;
            String body = request.optString("requestType") + " " + request.optString("payload")
                + "\nRequester: " + request.optString("requesterName")
                + "\nDispatches: " + AdminBackendClient.flattenDispatches(request.optJSONArray("dispatches"))
                + "\nDraft ready: " + (draftable.contains(request.optString("requestId")) ? "yes" : "no");
            layoutApprovalsList.addView(infoCard(request.optString("requestId"), body));
        }
        if (!any) layoutApprovalsList.addView(infoCard("No pending approvals."));
    }

    private void renderGateways(JSONArray gateways) {
        layoutGatewaysList.removeAllViews();
        if (gateways == null || gateways.length() == 0) {
            layoutGatewaysList.addView(infoCard("No gateway health data."));
            return;
        }
        for (int i = 0; i < gateways.length(); i++) {
            JSONObject gateway = gateways.optJSONObject(i);
            if (gateway == null) continue;
            String body = gateway.optString("id")
                + "\nState: " + (gateway.optBoolean("online") ? "ONLINE" : gateway.optString("status"))
                + "\nURL: " + gateway.optString("gatewayUrl", "(not registered)")
                + "\nLast seen: " + gateway.optString("lastSeenAt", "unknown");
            layoutGatewaysList.addView(infoCard(gateway.optString("operatorName"), body));
        }
    }

    private void renderIncidents(JSONArray events, JSONObject alerts) {
        layoutIncidentsList.removeAllViews();
        if (alerts != null) {
            layoutIncidentsList.addView(infoCard("Alert Totals", AdminBackendClient.summarizeAlerts(alerts)));
        }
        if (events == null || events.length() == 0) {
            layoutIncidentsList.addView(infoCard("No incident activity available."));
            return;
        }
        for (int i = 0; i < Math.min(events.length(), 12); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            String body = event.optString("summary", "")
                + "\nSeverity: " + event.optString("severity", "info")
                + "\nGateway: " + event.optString("gatewayId", "—")
                + "\nWhen: " + event.optString("occurredAt", "—");
            layoutIncidentsList.addView(infoCard(event.optString("title"), body));
        }
    }

    private void renderAudit(JSONArray logs) {
        layoutAuditList.removeAllViews();
        if (logs == null || logs.length() == 0) {
            layoutAuditList.addView(infoCard("No audit records available."));
            return;
        }
        for (int i = Math.max(0, logs.length() - 20); i < logs.length(); i++) {
            JSONObject log = logs.optJSONObject(i);
            if (log == null) continue;
            String body = "Actor: " + log.optString("actor", "system")
                + "\nRequest: " + log.optString("requestId", "—")
                + "\nTime: " + log.optString("timestamp", "—")
                + "\nDetails: " + log.optJSONObject("details");
            layoutAuditList.addView(infoCard(log.optString("action", "Audit Event"), body));
        }
    }

    private View infoCard(String title) {
        return infoCard(title, "");
    }

    private View infoCard(String title, String body) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(16, 16, 16, 16);
        card.setBackgroundColor(Color.parseColor("#14253D"));

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.bottomMargin = 12;
        card.setLayoutParams(params);

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.parseColor("#EBF3FF"));
        titleView.setTextSize(15f);
        titleView.setGravity(Gravity.START);
        titleView.setTypeface(titleView.getTypeface(), android.graphics.Typeface.BOLD);
        card.addView(titleView);

        if (!body.isEmpty()) {
            TextView bodyView = new TextView(this);
            bodyView.setText(body);
            bodyView.setTextColor(Color.parseColor("#B2C0D9"));
            bodyView.setTextSize(13f);
            bodyView.setPadding(0, 10, 0, 0);
            card.addView(bodyView);
        }
        return card;
    }

    private void showPanel(int index) {
        panelOverview.setVisibility(index == 0 ? View.VISIBLE : View.GONE);
        panelApprovals.setVisibility(index == 1 ? View.VISIBLE : View.GONE);
        panelGateways.setVisibility(index == 2 ? View.VISIBLE : View.GONE);
        panelIncidents.setVisibility(index == 3 ? View.VISIBLE : View.GONE);
        panelAudit.setVisibility(index == 4 ? View.VISIBLE : View.GONE);

        setTabSelected(R.id.tabOverview, index == 0);
        setTabSelected(R.id.tabApprovals, index == 1);
        setTabSelected(R.id.tabGateways, index == 2);
        setTabSelected(R.id.tabIncidents, index == 3);
        setTabSelected(R.id.tabAudit, index == 4);
    }

    private void setTabSelected(int viewId, boolean selected) {
        TextView tab = findViewById(viewId);
        tab.setAlpha(selected ? 1f : 0.6f);
    }
}
