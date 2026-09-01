interface OperationBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export function OperationBanner({ message, onDismiss }: OperationBannerProps) {
  if (!message) return null;

  return (
    <div className="operation-banner" role="alert">
      <div className="operation-banner__title">
        Backend operation failed
        <button className="btn btn--ghost btn--small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <div className="operation-banner__msg">{message}</div>
    </div>
  );
}
