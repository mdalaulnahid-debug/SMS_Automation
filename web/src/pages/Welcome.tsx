import { SiteHeader } from "@/components/site/SiteHeader";
import { Hero } from "@/components/site/Hero";
import { HowItWorks } from "@/components/site/HowItWorks";
import { Trust } from "@/components/site/Trust";
import { SiteFooter } from "@/components/site/SiteFooter";

export function Welcome() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <Trust />
      </main>
      <SiteFooter />
    </div>
  );
}
