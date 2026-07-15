import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// Client-side UX routing only — the server-side session check on /api/*
// stays the real enforcement boundary, this just avoids flashing gated
// content before that check would have rejected the request.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ returnTo: location.pathname }} replace />;
  }
  return <>{children}</>;
}
