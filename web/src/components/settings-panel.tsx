import { WebSetting } from "@/types/chat";

type SettingsPanelProps = {
  open: boolean;
  setting: WebSetting;
  onClose: () => void;
  onChange: (next: WebSetting) => void;
};

export function SettingsPanel({ open, setting, onClose, onChange }: SettingsPanelProps) {
  return (
    <>
      <button
        aria-label="Close settings panel"
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        type="button"
      />

      <aside
        className={`fixed inset-y-0 right-0 z-50 w-84 max-w-[92vw] border-l border-outline/10 bg-[#f9f9f9]/95 p-5 backdrop-blur-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-[0.22em] text-outline/70 uppercase">Settings</h2>
          <button className="text-xs tracking-wide text-outline/80 uppercase" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="space-y-6">
          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Proactive /daily</span>
            <button
              className={`rounded-full border px-4 py-2 text-xs tracking-wider uppercase transition ${
                setting.proactiveDailyEnabled
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-outline/25 text-outline/90 hover:bg-primary/5"
              }`}
              onClick={() => onChange({ ...setting, proactiveDailyEnabled: !setting.proactiveDailyEnabled })}
              type="button"
            >
              {setting.proactiveDailyEnabled ? "On (3-5 random/day)" : "Off"}
            </button>
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Read Aloud</span>
            <button
              className={`rounded-full border px-4 py-2 text-xs tracking-wider uppercase transition ${
                setting.ttsEnabled
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-outline/25 text-outline/90 hover:bg-primary/5"
              }`}
              onClick={() => onChange({ ...setting, ttsEnabled: !setting.ttsEnabled })}
              type="button"
            >
              {setting.ttsEnabled ? "On" : "Off"}
            </button>
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Auto Read Latest Assistant</span>
            <button
              className={`rounded-full border px-4 py-2 text-xs tracking-wider uppercase transition ${
                setting.autoReadAssistant
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-outline/25 text-outline/90 hover:bg-primary/5"
              }`}
              disabled={!setting.ttsEnabled}
              onClick={() => onChange({ ...setting, autoReadAssistant: !setting.autoReadAssistant })}
              type="button"
            >
              {setting.autoReadAssistant ? "On" : "Off"}
            </button>
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">TTS Engine</span>
            <div className="flex gap-2">
              <button
                className={`rounded-full border px-4 py-2 text-xs tracking-wider uppercase transition ${
                  setting.ttsEngine === "browser"
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-outline/25 text-outline/90 hover:bg-primary/5"
                }`}
                onClick={() => onChange({ ...setting, ttsEngine: "browser" })}
                type="button"
              >
                Browser
              </button>
              <button
                className="rounded-full border border-outline/15 px-4 py-2 text-xs tracking-wider uppercase text-outline/45"
                disabled
                title="Cloud TTS is reserved for next milestone."
                type="button"
              >
                Cloud (Soon)
              </button>
            </div>
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Voice Key (Optional)</span>
            <input
              className="w-full rounded-xl border border-outline/20 bg-white px-3 py-2 text-sm text-primary outline-none transition focus:border-primary/35 disabled:opacity-50"
              disabled={!setting.ttsEnabled}
              onChange={(event) => onChange({ ...setting, ttsVoice: event.target.value || null })}
              placeholder="Browser voice name for future mapping"
              value={setting.ttsVoice ?? ""}
            />
          </label>

          <label className="block space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Speech Rate</span>
              <span className="text-xs text-outline/70">{setting.ttsRate.toFixed(2)}x</span>
            </div>
            <input
              className="w-full accent-[color:var(--primary)]"
              disabled={!setting.ttsEnabled}
              max={2}
              min={0.5}
              onChange={(event) => onChange({ ...setting, ttsRate: Number(event.target.value) })}
              step={0.05}
              type="range"
              value={setting.ttsRate}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Streaming</span>
            <button
              className={`rounded-full border px-4 py-2 text-xs tracking-wider uppercase transition ${
                setting.streaming
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-outline/25 text-outline/90 hover:bg-primary/5"
              }`}
              onClick={() => onChange({ ...setting, streaming: !setting.streaming })}
              type="button"
            >
              {setting.streaming ? "On" : "Off"}
            </button>
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] tracking-[0.18em] text-outline/70 uppercase">Model Override</span>
            <input
              className="w-full rounded-xl border border-outline/20 bg-white px-3 py-2 text-sm text-primary outline-none transition focus:border-primary/35"
              onChange={(event) => onChange({ ...setting, model: event.target.value || null })}
              placeholder="Use server ITTE_MODEL if empty"
              value={setting.model ?? ""}
            />
          </label>
        </div>
      </aside>
    </>
  );
}
