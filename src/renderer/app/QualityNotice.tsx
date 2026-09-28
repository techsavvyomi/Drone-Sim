import { useEffect } from 'react';
import { useQualityNotice } from '../scene/AutoQuality';

// The one line that says the graphics were lowered on the pilot's behalf, and
// where to change it back. Shown for a few seconds over whatever is on screen.

const SHOW_MS = 6000;

export function QualityNotice() {
  const lowered = useQualityNotice((s) => s.lowered);

  useEffect(() => {
    if (!lowered) return;
    const t = setTimeout(() => useQualityNotice.setState({ lowered: null }), SHOW_MS);
    return () => clearTimeout(t);
  }, [lowered]);

  if (!lowered) return null;
  return (
    <div className="quality-notice" role="status" aria-live="polite">
      Graphics set to <b>{lowered}</b> for a smoother flight. Change it in Settings, Video.
    </div>
  );
}
