import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Modal } from './Modal';

/** Optional details, opened explicitly rather than crowding a settings row. */
export function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        icon="info"
        className="settings__info"
        aria-label={`Information about ${title.toLowerCase()}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`About ${title.toLowerCase()}`}
        onClick={() => setOpen(true)}
        children={null}
      />
      {open &&
        createPortal(
          <div data-register="classroom">
            <Modal title={title} safe={{ label: 'Close', onClick: () => setOpen(false) }}>
              {children}
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}
