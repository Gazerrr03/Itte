import { MaterialIcon } from "@/components/material-icon";

type TopNavProps = {
  onOpenMenu: () => void;
  onOpenSettings: () => void;
  onEndSession: () => void;
  sessionEnded: boolean;
};

export function TopNav({ onOpenMenu, onOpenSettings, onEndSession, sessionEnded }: TopNavProps) {
  return (
    <nav className="pointer-events-none fixed top-0 z-50 w-full">
      <div className="pointer-events-auto mx-auto flex w-full max-w-screen-2xl items-center justify-between px-8 py-6">
        <div className="flex items-center gap-6">
          <button
            className="cursor-pointer text-primary/40 transition-colors hover:text-primary"
            onClick={onOpenMenu}
            title="Open sessions"
            type="button"
          >
            <MaterialIcon name="menu" />
          </button>
          <span className="select-none text-xl font-medium tracking-tight text-primary/40 italic">Itte</span>
        </div>

        <div className="flex items-center gap-4">
          <button
            className="rounded-full border border-outline/20 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-outline/80 uppercase transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={sessionEnded}
            onClick={onEndSession}
            type="button"
          >
            End
          </button>

          <button
            className="cursor-pointer scale-90 text-primary/30 transition-colors hover:text-primary"
            onClick={onOpenSettings}
            title="Settings"
            type="button"
          >
            <MaterialIcon name="tune" />
          </button>
        </div>
      </div>
    </nav>
  );
}
