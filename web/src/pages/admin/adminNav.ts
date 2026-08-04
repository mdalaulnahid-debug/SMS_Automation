import { LayoutDashboard, ShieldCheck, TriangleAlert, FileWarning, ScrollText, Smartphone, Users } from "lucide-react";
import type { NavItem } from "@/components/layout/AppShell";

// Ported from public/admin.html's .admin-sidebar items. "Tools" is
// intentionally NOT ported here -- it's already covered by the Settings
// dashboard (web/src/pages/settings/*) from the earlier migration phase, so
// this sidebar links there instead of duplicating those forms. Team is
// super-admin only, matching admin.js's isSuperAdminUnlocked() gate.
export const adminNav: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, visible: ({ isAdmin }) => isAdmin },
  { to: "/admin/approvals", label: "Approvals Queue", icon: ShieldCheck, visible: ({ isAdmin }) => isAdmin },
  { to: "/admin/unmatched", label: "Unmatched SMS", icon: TriangleAlert, visible: ({ isAdmin }) => isAdmin },
  { to: "/admin/rejected", label: "Rejected Messages", icon: FileWarning, visible: ({ isAdmin }) => isAdmin },
  { to: "/admin/audit", label: "Audit", icon: ScrollText, visible: ({ isAdmin }) => isAdmin },
  { to: "/admin/phone-inbox", label: "Phone Inbox", icon: Smartphone, visible: ({ isAdmin }) => isAdmin },
  { to: "/admin/team", label: "Team", icon: Users, visible: ({ isSuperAdmin }) => isSuperAdmin },
];
