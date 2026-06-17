package com.smsgateway

import android.app.Activity
import android.content.Intent
import com.google.android.material.bottomnavigation.BottomNavigationView

/**
 * Mirrors the web app's Home/Logs/Settings bottom nav (see docs/design-system.md).
 * Each destination is its own existing Activity — selecting a tab navigates between
 * them with FLAG_ACTIVITY_REORDER_TO_FRONT so it behaves like switching tabs, not
 * pushing a new screen onto the back stack.
 */
enum class NavDestination { HOME, LOGS, SETTINGS }

object BottomNavHelper {
    fun setup(activity: Activity, nav: BottomNavigationView, current: NavDestination) {
        // Use the view's own selection setter, not MenuItem.isChecked directly — the latter
        // doesn't update BottomNavigationView's internal selected-id tracking, which then gets
        // restored over our chosen tab when the activity recreates (e.g. on a theme change).
        nav.selectedItemId = idFor(current)

        nav.setOnItemSelectedListener { item ->
            val target = when (item.itemId) {
                R.id.nav_home -> MainActivity::class.java.takeIf { current != NavDestination.HOME }
                R.id.nav_logs -> LogActivity::class.java.takeIf { current != NavDestination.LOGS }
                R.id.nav_settings -> SettingsActivity::class.java.takeIf { current != NavDestination.SETTINGS }
                else -> null
            }
            if (target != null) {
                activity.startActivity(
                    Intent(activity, target).addFlags(
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                )
                activity.overridePendingTransition(0, 0)
            }
            true
        }
    }

    private fun idFor(destination: NavDestination): Int = when (destination) {
        NavDestination.HOME -> R.id.nav_home
        NavDestination.LOGS -> R.id.nav_logs
        NavDestination.SETTINGS -> R.id.nav_settings
    }
}
