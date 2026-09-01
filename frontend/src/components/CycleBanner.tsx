import type { CycleError } from "../types";

interface CycleBannerProps {
  error: CycleError | null;
  onDismiss: () => void;
}

export function CycleBanner({ error, onDismiss }: CycleBannerProps) {
  if (!error) return null;

  return (
    <div className="cycle-banner" role="alert">
      <div className="cycle-banner__title">
        Rule rejected — circular dependency
        <button className="btn btn--ghost btn--small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <div className="cycle-banner__path">{error.path.join("  →  ")}</div>
      <div className="cycle-banner__msg">
        The existing rule graph was not modified. "{error.rejected_rule.name}" was not activated.
      </div>
    </div>
  );
}
