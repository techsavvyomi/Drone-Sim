import { HUD_WIDGETS } from '@shared/types';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { Icon, Keycap } from '../ds';
import { KEY_GROUPS, hudCount } from './cockpitFacts';

// The HUD panel (H), Phase 6: a column on the left that pushes the cockpit over,
// so the live HUD beside it is the preview. One row per widget with where it
// sits and a ✓ ON / ○ OFF switch, Reset to default, and the key list that used
// to be the H controls panel. The same switches live in Settings → Interface.

export function HudPanel() {
  const hud = useSettingsStore((s) => s.settings.hud);
  const setHud = useSettingsStore((s) => s.setHud);
  const resetHud = useSettingsStore((s) => s.resetHud);
  const { on, total } = hudCount(hud);

  return (
    <aside className="hpanel" data-register="cockpit" aria-label="HUD widgets">
      <header className="tdock__head">
        <span className="ck-label">
          HUD widgets · {on} of {total} on
        </span>
        <button
          type="button"
          className="tdock__close"
          onClick={() => useUiStore.getState().toggleHudPanel()}
        >
          <Keycap>H</Keycap>
          <span className="ck-label">Close</span>
        </button>
      </header>
      <div className="tdock__body">
        <ul className="hpanel__list">
          {HUD_WIDGETS.map((w) => {
            const isOn = hud[w.key];
            return (
              <li key={w.key}>
                <span className="hpanel__name">
                  <b>{w.label}</b>
                  <small>{w.where}</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  aria-label={w.label}
                  className={`hpanel__switch${isOn ? ' is-on' : ''}`}
                  onClick={() => setHud(w.key, !isOn)}
                >
                  <Icon name={isOn ? 'check' : 'ring'} />
                  {isOn ? 'On' : 'Off'}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="tdock__note">
          Changes show on the live HUD beside this panel. The panel pushes the HUD over, so
          nothing is covered.
        </p>
        <button type="button" className="tdock-wide" onClick={resetHud}>
          Reset to default
        </button>

        {KEY_GROUPS.map((g) => (
          <section key={g.title} className="tdock__sec">
            <h3 className="ck-label">Keys · {g.title}</h3>
            <ul className="hpanel__keys">
              {g.rows.map(([k, what]) => (
                <li key={k}>
                  <Keycap>{k}</Keycap>
                  <span>{what}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
