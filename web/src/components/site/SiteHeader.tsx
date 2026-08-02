import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

export function SiteHeader() {
  const { user, isAdmin, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur-xl">
      <Link to="/welcome" className="flex items-center gap-2.5">
        <img src="/assets/police-insignia.svg" alt="Bangladesh Police" className="size-8" />
        <div className="text-left">
          <div className="text-sm font-extrabold tracking-tight">SMS Automation</div>
          <div className="text-[11px] text-muted-foreground">LIC Barishal</div>
        </div>
      </Link>

      {user ? (
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/settings"
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-9 px-4 text-[13px]")}
            >
              Admin Console
            </Link>
          )}
          <span className="hidden text-[13px] text-muted-foreground sm:inline">{user.name}</span>
          <button
            type="button"
            onClick={logout}
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-9 px-4 text-[13px]")}
          >
            Sign out
          </button>
        </div>
      ) : (
        <Link to="/login" className={cn(buttonVariants({ size: "sm" }), "h-9 px-4 text-[13px]")}>
          Sign in
        </Link>
      )}
    </header>
  );
}
