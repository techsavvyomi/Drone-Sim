import { useSimStore } from '../state/simStore';

// Bottom status strip: live frame rate. The app name and version live in
// Settings → About, so they are not repeated here.
export function StatusBar() {
  const fps = useSimStore((s) => s.fps);

  return (
    <footer className="statusbar">
      <span className="statusbar-right">
        <span className="dim">fps:</span> {fps}
      </span>
    </footer>
  );
}
