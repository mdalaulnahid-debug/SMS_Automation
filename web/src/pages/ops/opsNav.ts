import { Radar, Activity, Info, Phone, HelpCircle } from "lucide-react";
import type { NavItem } from "@/components/layout/AppShell";

// Ported from public/index.html's .ops-sidebar items. The server-side
// /api/ops/* endpoints are admin-only (security-hardening v1 §4) and the
// officer role can no longer obtain a web session at all (userAuth.startLogin
// blocks it), so in practice only admin/super_admin ever reach this shell —
// the visible() gate here is defense in depth, not the real boundary.
export const opsNav: NavItem[] = [
  { to: "/ops", label: "Home", icon: Radar, visible: ({ isAdmin }) => isAdmin },
  { to: "/ops/activity", label: "Activity", icon: Activity, visible: ({ isAdmin }) => isAdmin },
  { to: "/ops/about", label: "About", icon: Info, visible: ({ isAdmin }) => isAdmin },
  { to: "/ops/contact", label: "Contact", icon: Phone, visible: ({ isAdmin }) => isAdmin },
  { to: "/ops/help", label: "Help", icon: HelpCircle, visible: ({ isAdmin }) => isAdmin },
];
