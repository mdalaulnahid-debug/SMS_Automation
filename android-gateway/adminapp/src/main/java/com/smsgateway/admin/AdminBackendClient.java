package com.smsgateway.admin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class AdminBackendClient {
    private AdminBackendClient() {}

    public static JSONObject getJson(String baseUrl, String path, String apiKey) throws Exception {
        return readResponse(open(baseUrl, path, apiKey, "GET"));
    }

    // Real write actions against the same endpoints the web admin console and Android Gateway
    // App's Control Center use (/api/reply-drafts/:id/approve, /api/requests/:id/reject|retry,
    // /api/manual-match) — not a separate /api/admin/* write API, since one doesn't exist yet.
    public static JSONObject postJson(String baseUrl, String path, String apiKey, JSONObject body) throws Exception {
        HttpURLConnection connection = open(baseUrl, path, apiKey, "POST");
        connection.setRequestProperty("content-type", "application/json");
        connection.setDoOutput(true);
        byte[] payload = (body == null ? new JSONObject() : body).toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(payload);
        }
        return readResponse(connection);
    }

    private static HttpURLConnection open(String baseUrl, String path, String apiKey, String method) throws Exception {
        String normalized = baseUrl.trim();
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        HttpURLConnection connection = (HttpURLConnection) new URL(normalized + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(12000);
        if (apiKey != null && !apiKey.isBlank()) {
            connection.setRequestProperty("x-api-key", apiKey);
        }
        return connection;
    }

    private static JSONObject readResponse(HttpURLConnection connection) throws Exception {
        int code = connection.getResponseCode();
        BufferedReader reader = new BufferedReader(new InputStreamReader(
            code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream(),
            StandardCharsets.UTF_8
        ));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            builder.append(line);
        }
        reader.close();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("HTTP " + code + ": " + builder);
        }
        return new JSONObject(builder.toString());
    }

    public static String summarizeAlerts(JSONObject alerts) {
        int pending = alerts.optInt("pendingApprovals", 0);
        int failed = alerts.optInt("failedRequests", 0);
        int unmatched = alerts.optInt("unmatchedSms", 0);
        int offline = alerts.optInt("offlineGateways", 0);
        return pending + " pending | " + failed + " failed | " + unmatched + " unmatched | " + offline + " offline";
    }

    public static String flattenDispatches(JSONArray dispatches) {
        if (dispatches == null || dispatches.length() == 0) return "No dispatches";
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < dispatches.length(); i++) {
            JSONObject item = dispatches.optJSONObject(i);
            if (item == null) continue;
            if (builder.length() > 0) builder.append("   ");
            builder.append(item.optString("operator", "?"))
                .append(": ")
                .append(item.optString("status", item.optString("sentStatus", "UNKNOWN")));
        }
        return builder.toString();
    }
}
