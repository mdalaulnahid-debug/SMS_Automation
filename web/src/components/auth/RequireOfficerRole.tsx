import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { resolveHomeRoute, useAuth } from "@/lib/auth";

// The rich landing/portal experience is officer-only — admin and
// super_admin land in the console instead (resolveHomeRoute), same
// boundary the vanilla app draws server-side in GET / (guardPage).
export function RequireOfficerRole({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (user && user.role !== "officer") {
    return <Navigate to={resolveHomeRoute(user)} replace />;
  }
  return <>{children}</>;
}
