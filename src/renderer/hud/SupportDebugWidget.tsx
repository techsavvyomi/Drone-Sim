import { useSimStore } from '../state/simStore';

export function SupportDebugWidget({ compact = false }: { compact?: boolean }) {
  const support = useSimStore((s) => s.support);
  if (!support || !Array.isArray(support.supported)) return null;

  const [fr, fl, br, bl] = support.supported;
  const isStable = !!support.isStable;
  const state = support.contactState || 'AIRBORNE';
  const count = support.supportedCount ?? 0;

  const stateColor =
    state === 'SUPPORTED'
      ? '#4ade80'
      : state === 'PARTIALLY_SUPPORTED' || state === 'UNSTABLE'
      ? '#fbbf24'
      : state === 'FALLING' || state === 'CRASHED'
      ? '#ef4444'
      : '#38bdf8';

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.85)',
        border: `1px solid ${isStable ? 'rgba(74, 222, 128, 0.4)' : 'rgba(251, 191, 36, 0.4)'}`,
        backdropFilter: 'blur(8px)',
        borderRadius: '8px',
        padding: compact ? '8px 12px' : '10px 14px',
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e2e8f0',
        pointerEvents: 'none',
        userSelect: 'none',
        minWidth: '170px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
        <span style={{ fontWeight: 'bold', color: '#94a3b8' }}>PHYSICAL SUPPORT</span>
        <span style={{ fontWeight: 'bold', color: stateColor }}>{state}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0' }}>
        {/* Front row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100px' }}>
          <span style={{ color: fl ? '#4ade80' : '#64748b' }}>FL {fl ? '●' : '○'}</span>
          <span style={{ color: '#475569' }}>───────</span>
          <span style={{ color: fr ? '#4ade80' : '#64748b' }}>{fr ? '●' : '○'} FR</span>
        </div>

        {/* Middle CoM row */}
        <div style={{ margin: '2px 0', color: '#f59e0b', fontSize: '10px' }}>
          │  <span style={{ color: '#f8fafc', fontWeight: 'bold' }}>× CoM</span>  │
        </div>

        {/* Back row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100px' }}>
          <span style={{ color: bl ? '#4ade80' : '#64748b' }}>BL {bl ? '●' : '○'}</span>
          <span style={{ color: '#475569' }}>───────</span>
          <span style={{ color: br ? '#4ade80' : '#64748b' }}>{br ? '●' : '○'} BR</span>
        </div>
      </div>

      <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#cbd5e1' }}>
        <span>CONTACT: <b style={{ color: '#f8fafc' }}>{count}/4</b></span>
        <span>STABILITY: <b style={{ color: isStable ? '#4ade80' : '#ef4444' }}>{isStable ? 'STABLE' : 'UNSTABLE'}</b></span>
      </div>
    </div>
  );
}
