import { SessionListItem } from "@/types/chat";

type SessionSidebarProps = {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  open: boolean;
  onClose: () => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
};

function prettyTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString();
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  open,
  onClose,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <>
      <button
        aria-label="Close session menu"
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        type="button"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-84 max-w-[92vw] border-r border-outline/10 bg-[#f9f9f9]/95 p-4 backdrop-blur-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-[0.22em] text-outline/70 uppercase">Sessions</h2>
          <button
            className="rounded-full border border-outline/20 px-3 py-1 text-xs tracking-wider text-primary/70 uppercase transition hover:bg-primary/5"
            onClick={onCreateSession}
            type="button"
          >
            New
          </button>
        </div>

        <div className="hide-scrollbar flex h-[calc(100%-3.25rem)] flex-col gap-2 overflow-y-auto pr-1">
          {sessions.map((session) => {
            const selected = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={`rounded-2xl border p-3 transition ${
                  selected ? "border-primary/20 bg-primary/8" : "border-transparent bg-white/50 hover:border-outline/20"
                }`}
              >
                <button
                  className="mb-2 w-full text-left"
                  onClick={() => onSelectSession(session.id)}
                  type="button"
                >
                  <div className="truncate text-sm font-semibold text-primary">{session.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-outline/80">
                    {session.lastPreview || "No messages yet."}
                  </div>
                  <div className="mt-2 text-[10px] tracking-wide text-outline/60">{prettyTime(session.updatedAt)}</div>
                </button>

                <div className="flex gap-2">
                  <button
                    className="rounded-full border border-outline/20 px-2 py-1 text-[10px] tracking-wider text-outline/80 uppercase hover:bg-primary/5"
                    onClick={() => onRenameSession(session.id)}
                    type="button"
                  >
                    Rename
                  </button>
                  <button
                    className="rounded-full border border-red-300/60 px-2 py-1 text-[10px] tracking-wider text-red-600 uppercase hover:bg-red-50"
                    onClick={() => onDeleteSession(session.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
