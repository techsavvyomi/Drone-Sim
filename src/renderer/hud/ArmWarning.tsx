import { useFlightStore } from '../state/flightStore';

export function ArmWarning() {
  const visible = useFlightStore((s) => s.armThrottleHigh);
  if (!visible) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'absolute',
        top: 150,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        borderRadius: 999,
        padding: '10px 18px',
        background: 'var(--ink-900)',
        color: 'var(--txt-hi)',
        border: '1px solid var(--line)',
        fontWeight: 700,
        fontSize: 'clamp(12px, 1.3vw, 15px)',
        textAlign: 'center',
        maxWidth: 'calc(100% - 32px)',
        width: 'max-content',
        pointerEvents: 'none',
      }}
    >
      THROTTLE HIGH. LOWER TO ARM
    </div>
  );
}
