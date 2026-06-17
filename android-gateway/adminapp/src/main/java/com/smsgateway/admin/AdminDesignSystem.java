package com.smsgateway.admin;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class AdminDesignSystem {
    private AdminDesignSystem() {}

    public static final class Palette {
        public static final int BG_PANEL = Color.parseColor("#11161D");
        public static final int BG_PANEL_ALT = Color.parseColor("#151B22");
        public static final int BG_SOFT = Color.parseColor("#0F141B");
        public static final int BG_INCIDENT = Color.parseColor("#271316");
        public static final int BG_CHIP = Color.parseColor("#0C1218");
        public static final int BORDER = Color.parseColor("#2B3743");
        public static final int BORDER_ACTIVE = Color.parseColor("#87C7F8");
        public static final int TEXT_PRIMARY = Color.parseColor("#DCE7F2");
        public static final int TEXT_SECONDARY = Color.parseColor("#9DA9B5");
        public static final int TEXT_DIM = Color.parseColor("#74808C");
        public static final int PRIMARY = Color.parseColor("#9ED3FF");
        public static final int SUCCESS = Color.parseColor("#79D9AE");
        public static final int WARNING = Color.parseColor("#E1C19B");
        public static final int DANGER = Color.parseColor("#E29A97");
    }

    public static GradientDrawable moduleBackground(boolean active) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Palette.BG_PANEL);
        drawable.setCornerRadius(18f);
        drawable.setStroke(1, active ? Palette.BORDER_ACTIVE : Palette.BORDER);
        return drawable;
    }

    public static GradientDrawable rowBackground(boolean critical) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(critical ? Palette.BG_INCIDENT : Palette.BG_PANEL_ALT);
        drawable.setCornerRadius(16f);
        drawable.setStroke(1, critical ? Palette.DANGER : Palette.BORDER);
        return drawable;
    }

    public static GradientDrawable chipBackground(int strokeColor) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Palette.BG_CHIP);
        drawable.setCornerRadius(4f);
        drawable.setStroke(1, strokeColor);
        return drawable;
    }

    public static TextView label(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Palette.TEXT_DIM);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        return view;
    }

    public static TextView value(Context context, String text, int color, float sizeSp, boolean bold) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(color);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT_BOLD);
        }
        return view;
    }

    public static View systemStatusRow(Context context, String label, String value) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, 14, 0, 0);

        TextView labelView = label(context, label.toUpperCase());
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.38f);
        labelView.setLayoutParams(labelParams);
        row.addView(labelView);

        TextView valueView = value(context, value, Palette.TEXT_PRIMARY, 13f, false);
        LinearLayout.LayoutParams valueParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.62f);
        valueView.setLayoutParams(valueParams);
        row.addView(valueView);
        return row;
    }

    public static TextView statusChip(Context context, String text, int accentColor) {
        TextView chip = new TextView(context);
        chip.setText(text);
        chip.setTextColor(accentColor);
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        chip.setTypeface(Typeface.DEFAULT_BOLD);
        chip.setGravity(Gravity.CENTER);
        chip.setPadding(12, 6, 12, 6);
        chip.setBackground(chipBackground(accentColor));
        return chip;
    }
}
