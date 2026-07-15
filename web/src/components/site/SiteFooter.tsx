export function SiteFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-8 text-[12.5px] text-muted-foreground">
      <div>&copy; LIC Barishal &middot; Bangladesh Police</div>
      <div className="flex flex-wrap gap-4.5">
        <a href="tel:+8801320151103" className="hover:text-primary">01320-151103</a>
        <a href="mailto:support@opsbarishal.com" className="hover:text-primary">support@opsbarishal.com</a>
        <a href="https://t.me/sms_automation_bd_bot" target="_blank" rel="noopener noreferrer" className="hover:text-primary">
          Telegram
        </a>
        <a href="/login.html" className="hover:text-primary">Sign in</a>
      </div>
    </footer>
  );
}
