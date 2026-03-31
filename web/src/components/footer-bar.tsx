export function FooterBar() {
  return (
    <footer className="pointer-events-none fixed bottom-6 w-full">
      <div className="pointer-events-auto mx-auto flex max-w-screen-2xl items-center justify-between px-8 opacity-20 transition-opacity duration-700 hover:opacity-100">
        <span className="text-[9px] font-medium uppercase tracking-[0.3em] text-outline">
          Gentle Path System
        </span>

        <div className="flex gap-6">
          <a className="text-[9px] uppercase tracking-[0.2em] text-outline transition-colors hover:text-primary" href="#">
            Philosophy
          </a>
          <a className="text-[9px] uppercase tracking-[0.2em] text-outline transition-colors hover:text-primary" href="#">
            Privacy
          </a>
        </div>
      </div>
    </footer>
  );
}
