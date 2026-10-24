import { useState } from 'react';
import { Today, NoAirport } from './ui/Today';
import { Airplane } from './ui/Airplane';
import { Review } from './ui/Review';
import { Readiness } from './ui/Readiness';
import { Settings } from './ui/Settings';
import { Onboarding } from './ui/Onboarding';
import { Icons, Mark } from './ui/common';
import { useAircraft, useAirport, useLoading, useOnboarding, usePilot, useTheme } from './ui/state';

type Screen = 'today' | 'airplane' | 'review' | 'readiness' | 'settings';

const NAV: { id: Screen; label: string; icon: React.ReactNode }[] = [
  { id: 'today', label: 'Today', icon: Icons.today },
  { id: 'airplane', label: 'Airplane', icon: Icons.airplane },
  { id: 'review', label: 'Review', icon: Icons.review },
  { id: 'readiness', label: 'Readiness', icon: Icons.readiness },
  { id: 'settings', label: 'Settings', icon: Icons.settings },
];

export function App() {
  const [screen, setScreen] = useState<Screen>('today');
  const [aircraft, setAircraft] = useAircraft();
  const [loading, setLoading] = useLoading();
  const [pilot, setPilot] = usePilot();
  const [airport, setAirport] = useAirport();
  const [onboarding, setOnboarding] = useOnboarding();
  const [theme, setTheme] = useTheme();
  // Bumped after a review reset so Review and Readiness re-read storage.
  const [epoch, setEpoch] = useState(0);

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };

  if (!onboarding.complete) {
    return (
      <Onboarding
        state={onboarding}
        setState={setOnboarding}
        airport={airport}
        setAirport={setAirport}
        aircraft={aircraft}
        setAircraft={setAircraft}
        pilot={pilot}
        setPilot={setPilot}
        onDone={() => go('today')}
      />
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Mark />
          <span>Downwind</span>
          <small>Ground school</small>
        </div>
        <nav className="nav" aria-label="Screens">
          {NAV.map((n) => (
            <button key={n.id} type="button" aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {aircraft.tailNumber && <b>{aircraft.tailNumber}</b>}
          {aircraft.tailNumber && airport ? ' at ' : ''}
          {airport?.icao}
        </div>
      </header>

      <main className="page">
        {screen === 'today' && (airport
          ? <Today airport={airport} aircraft={aircraft} loading={loading} pilot={pilot} goAirplane={() => go('airplane')} />
          : <NoAirport onSetup={() => setOnboarding({ complete: false, step: 1 })} />)}
        {screen === 'airplane' && <Airplane aircraft={aircraft} setAircraft={setAircraft} loading={loading} setLoading={setLoading} />}
        {screen === 'review' && <Review key={epoch} />}
        {screen === 'readiness' && <Readiness key={epoch} goReview={() => go('review')} />}
        {screen === 'settings' && (
          <Settings airport={airport} pilot={pilot} setPilot={setPilot} theme={theme} setTheme={setTheme} onReviewReset={() => setEpoch((e) => e + 1)} onRerunSetup={() => setOnboarding({ complete: false, step: 0 })} />
        )}
      </main>

      <footer className="about">
        <span>Training aid. Not for navigation. Not a substitute for an official briefing or a CFI.</span>
        <span>Downwind, phase 0</span>
      </footer>
    </div>
  );
}
