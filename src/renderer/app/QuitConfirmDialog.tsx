interface QuitConfirmDialogProps {
  onCancel: () => void;
  onConfirm?: () => void;
}

export function QuitConfirmDialog({ onCancel, onConfirm }: QuitConfirmDialogProps) {
  const handleQuit = () => {
    if (onConfirm) {
      onConfirm();
    } else {
      void window.api.quit();
    }
  };

  return (
    <div className="quit-dialog__scrim" role="presentation">
      <div
        className="quit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quit confirmation"
      >
        <p className="quit-dialog__question">Are you sure you want to quit?</p>
        <div className="quit-dialog__actions">
          <button
            type="button"
            className="quit-dialog__btn quit-dialog__btn--yes"
            onClick={handleQuit}
          >
            Yes
          </button>
          <button
            type="button"
            className="quit-dialog__btn quit-dialog__btn--no"
            onClick={onCancel}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
