import { User, Send, Users, QrCode, FlaskConical, Rocket } from "lucide-react";
import type { NavItem } from "@/components/layout/AppShell";

// The 6 categories this Settings dashboard was split into, replacing the
// flat 7-forms-in-one-grid "Tools" section (public/admin.html:534-643).
// Each maps 1:1 to a real domain identified in the inventory pass — see
// the plan file for the full reasoning.
export const settingsNav: NavItem[] = [
  { to: "/settings/profile", label: "Profile", icon: User },
  { to: "/settings/telegram", label: "Telegram Bridge", icon: Send, visible: ({ isAdmin }) => isAdmin },
  { to: "/settings/registry", label: "Personnel Registry", icon: Users, visible: ({ isAdmin }) => isAdmin },
  { to: "/settings/provisioning", label: "Provisioning", icon: QrCode, visible: ({ isAdmin }) => isAdmin },
  { to: "/settings/developer", label: "Developer Tools", icon: FlaskConical, visible: ({ isAdmin }) => isAdmin },
  { to: "/settings/release", label: "Release", icon: Rocket, visible: ({ isAdmin }) => isAdmin },
];
