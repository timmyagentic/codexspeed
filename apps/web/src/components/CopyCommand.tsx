import { useRef, useState } from "react";

type CopyCommandProps = {
  command: string;
  label: string;
};

export function CopyCommand({ command, label }: CopyCommandProps) {
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("Copied.");
    } catch {
      commandRef.current?.focus();
      commandRef.current?.select();
      setStatus("Command selected. Copy it from the field.");
    }
  }

  return (
    <div className="copy-command">
      <label>
        <span>{label}</span>
        <textarea
          ref={commandRef}
          value={command}
          readOnly
          rows={2}
          spellCheck={false}
          aria-label={`${label} command`}
        />
      </label>
      <button type="button" onClick={() => void copy()}>
        Copy command
      </button>
      <span className="copy-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
