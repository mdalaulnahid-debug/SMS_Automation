import { NavLink, Outlet } from "react-router-dom";
import { Moon, Sun, LogOut, type LucideIcon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only rendered when this returns true — mirrors admin.html's role-gated sidebar items (e.g. Team, Provisioning). */
  visible?: (ctx: { isAdmin: boolean; isSuperAdmin: boolean }) => boolean;
  badge?: number;
};

// Generalized from public/admin.html's .admin-sidebar / .sidebar-item /
// .admin-section pattern (confirmed at admin.html:295-306) — one real
// shell shared by every section-based page instead of a hand-rolled
// layout per surface.
export function AppShell({
  navItems,
  brandTitle = "SMS Automation",
  brandSubtitle = "LIC Barishal",
}: {
  navItems: NavItem[];
  brandTitle?: string;
  brandSubtitle?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const { isAdmin, isSuperAdmin, logout } = useAuth();

  const visibleItems = navItems.filter((item) => !item.visible || item.visible({ isAdmin, isSuperAdmin }));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40 px-3 py-4">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <img src="/assets/police-insignia.svg" alt="Bangladesh Police" className="size-7" />
          <div>
            <div className="text-[13px] font-extrabold tracking-tight">{brandTitle}</div>
            <div className="text-[10.5px] text-muted-foreground">{brandSubtitle}</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {visibleItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <span className="flex items-center gap-2.5">
                <Icon className="size-4" />
                {label}
              </span>
              {typeof badge === "number" && badge > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-2 px-2 pt-4">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
