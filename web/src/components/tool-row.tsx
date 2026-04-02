import { MaterialIcon } from "@/components/material-icon";
import { ToolAction } from "@/types/chat";

type ToolRowProps = {
  tools: ToolAction[];
  onToolClick: (key: ToolAction["key"]) => void;
};

export function ToolRow({ tools, onToolClick }: ToolRowProps) {
  return (
    <div className="zen-tools mt-10 flex flex-wrap justify-center gap-8 opacity-40 transition-opacity hover:opacity-100">
      {tools.map((tool) => (
        <button
          key={tool.key}
          className="group flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-outline/50 transition-all hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!tool.enabled}
          onClick={() => onToolClick(tool.key)}
          type="button"
        >
          <MaterialIcon className="text-base" name={tool.icon} />
          {tool.label}
        </button>
      ))}
    </div>
  );
}
