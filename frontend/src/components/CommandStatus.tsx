interface CommandStatusProps {
  pending: string | null;
  success: string | null;
  onDismissSuccess: () => void;
}

export function CommandStatus({ pending, success, onDismissSuccess }: CommandStatusProps) {
  if (!pending && !success) return null;

  return (
    <div
      className={`command-status ${pending ? "command-status--pending" : "command-status--success"}`}
      role="status"
      aria-live="polite"
    >
      <span className={pending ? "command-status__spinner" : "command-status__check"} aria-hidden="true">
        {pending ? "" : "✓"}
      </span>
      <span>{pending ?? success}</span>
      {!pending && (
        <button className="btn btn--ghost btn--small" onClick={onDismissSuccess} aria-label="Dismiss success message">
          ×
        </button>
      )}
    </div>
  );
}
