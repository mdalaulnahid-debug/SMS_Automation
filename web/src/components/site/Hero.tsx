import { useEffect, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

// Motion technique (particle drift + animated grid-line draw-in) adapted
// from a Magic MCP (21st.dev) "Hero Minimalism" component — kept in-flow
// (not fixed/full-viewport) so the rest of the landing page can scroll
// below it, and restyled to this project's real teal/navy palette via the
// ported CSS variables in index.css instead of the original's hardcoded
// greyscale.
export function Hero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement!;
    const setSize = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    setSize();

    type Particle = {
      x: number;
      y: number;
      speed: number;
      opacity: number;
      fadeStart: number;
      fadingOut: boolean;
    };

    let particles: Particle[] = [];
    let raf = 0;

    const count = () => Math.floor((canvas.width * canvas.height) / 9000);

    const reset = (p: Particle) => {
      p.x = Math.random() * canvas.width;
      p.y = Math.random() * canvas.height;
      p.speed = Math.random() / 5 + 0.1;
      p.opacity = 0.6;
      p.fadeStart = Date.now() + Math.random() * 600 + 100;
      p.fadingOut = false;
    };

    const make = (): Particle => {
      const p = { x: 0, y: 0, speed: 0, opacity: 0, fadeStart: 0, fadingOut: false };
      reset(p);
      return p;
    };

    const init = () => {
      particles = Array.from({ length: count() }, make);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.y -= p.speed;
        if (p.y < 0) reset(p);
        if (!p.fadingOut && Date.now() > p.fadeStart) p.fadingOut = true;
        if (p.fadingOut) {
          p.opacity -= 0.008;
          if (p.opacity <= 0) reset(p);
        }
        ctx.fillStyle = `rgba(110, 123, 255, ${p.opacity})`;
        ctx.fillRect(p.x, p.y, 0.6, Math.random() * 2 + 1);
      });
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      setSize();
      init();
    };

    window.addEventListener("resize", onResize);
    init();
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="relative isolate flex min-h-[92vh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen opacity-70"
        aria-hidden="true"
      />

      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <span className="hline absolute inset-x-0 top-1/5 h-px origin-center scale-x-0 bg-border [animation:draw-x_800ms_cubic-bezier(.22,.61,.36,1)_150ms_forwards]" />
        <span className="hline absolute inset-x-0 top-1/2 h-px origin-center scale-x-0 bg-border [animation:draw-x_800ms_cubic-bezier(.22,.61,.36,1)_280ms_forwards]" />
        <span className="hline absolute inset-x-0 top-4/5 h-px origin-center scale-x-0 bg-border [animation:draw-x_800ms_cubic-bezier(.22,.61,.36,1)_410ms_forwards]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-5">
        <span className="inline-flex items-center gap-2 text-xs font-extrabold tracking-[0.16em] text-primary uppercase">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Bangladesh Police &middot; LIC Barishal
        </span>

        <h1 className="max-w-3xl text-4xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-6xl">
          A lawful, auditable bridge for operator subscriber lookups
        </h1>

        <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
          Authorized officers request subscriber location and identity information from
          mobile operators through Telegram. Every request is logged, reviewed, and tied
          to the requesting officer.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://t.me/sms_automation_bd_bot"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ size: "lg" }), "h-11 px-6 text-sm")}
          >
            Message the bot on Telegram
          </a>
        </div>
        {user && (
          <p className="text-[13px] text-muted-foreground">
            Signed in as <span className="font-semibold text-foreground">{user.name}</span>
          </p>
        )}
      </div>
    </section>
  );
}
