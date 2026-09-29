import { lazy, Suspense, useEffect, useState } from 'react';

const DesignPreview = lazy(() =>
  import('./DesignPreview').then((m) => ({ default: m.DesignPreview })),
);

/** Ctrl+Shift+D toggles the design-system sheet. Mounted only when
 *  `import.meta.env.DEV` (main.tsx), so a packaged build has neither the key
 *  nor the sheet. */
export function DevPreviewGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <DesignPreview onClose={() => setOpen(false)} />
    </Suspense>
  );
}
