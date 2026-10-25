import { useMemo, useState } from 'react';
import { CourseHome } from './ui/CourseHome';
import { LessonPlayer } from './ui/LessonPlayer';
import { DailyFlight } from './ui/DailyFlight';
import { Tools, type Tool } from './ui/Tools';
import { Logbook } from './ui/Logbook';
import { Settings } from './ui/Settings';
import { Onboarding } from './ui/Onboarding';
import { Icons, Mark } from './ui/common';
import { useAircraft, useAirport, useCourse, useLoading, useLogbook, useOnboarding, usePilot, useTheme } from './ui/state';
import { lessonById } from './course/modules';
import { lessonContext } from './course/practice';
import type { Lesson } from './course/types';
import { RefProvider } from './refs/RefViewer';

type Rail = 'course' | 'tools' | 'logbook' | 'pilot';
type Screen = { rail: Rail; view?: 'lesson' | 'daily'; lessonId?: string };

const RAILS: { id: Rail; label: string; icon: React.ReactNode }[] = [
  { id: 'course', label: 'Course', icon: Icons.course },
  { id: 'tools', label: 'Tools', icon: Icons.tools },
  { id: 'logbook', label: 'Logbook', icon: Icons.logbook },
  { id: 'pilot', label: 'Pilot', icon: Icons.pilot },
];

export function App() {
  const [screen, setScreen] = useState<Screen>({ rail: 'course' });
  const [tool, setTool] = useState<Tool>('airplane');
  const [aircraft, setAircraft] = useAircraft();
  const [loading, setLoading] = useLoading();
  const [pilot, setPilot] = usePilot();
  const [airport, setAirport] = useAirport();
  const [onboarding, setOnboarding] = useOnboarding();
  const [theme, setTheme] = useTheme();
  const [progress, setProgress] = useCourse();
  const [log, setLog] = useLogbook();
  // Bumped after a review reset so Review and Readiness re-read storage.
  const [epoch, setEpoch] = useState(0);
  // A new lesson context per lesson start, so the practice weather is built for now.
  const [ctxKey, setCtxKey] = useState(0);
  const ctx = useMemo(
    () => ({ ...lessonContext(airport, aircraft, pilot.minimums), lastFlightReview: pilot.lastFlightReview }),
    [airport, aircraft, pilot.minimums, pilot.lastFlightReview, ctxKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };
  const startLesson = (l: Lesson) => {
    setCtxKey((k) => k + 1);
    go({ rail: 'course', view: 'lesson', lessonId: l.id });
  };
  const openTool = (t: Tool) => {
    setTool(t);
    go({ rail: 'tools' });
  };
  const rerunSetup = (step: number) => setOnboarding({ complete: false, step });

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
        onDone={() => go({ rail: 'course' })}
      />
    );
  }

  const lesson = screen.view === 'lesson' && screen.lessonId ? lessonById(screen.lessonId) : undefined;

  return (
    <RefProvider>
      <div className="shell">
        <nav className="rail" aria-label="Screens">
          <div className="brand" aria-hidden="true"><Mark /><span>Downwind</span></div>
          {RAILS.map((n) => (
            <button key={n.id} type="button" aria-current={screen.rail === n.id ? 'page' : undefined} onClick={() => go({ rail: n.id })}>
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
          <div className="rail-foot" aria-hidden="true">{airport?.icao ?? ''}</div>
        </nav>

        <main className="page">
          {screen.rail === 'course' && lesson && (
            <LessonPlayer
              key={`${lesson.id}-${ctxKey}`}
              lesson={lesson}
              ctx={ctx}
              progress={progress}
              setProgress={setProgress}
              onExit={() => go({ rail: 'course' })}
              onNext={startLesson}
            />
          )}
          {screen.rail === 'course' && screen.view === 'daily' && airport && (
            <DailyFlight
              airport={airport}
              aircraft={aircraft}
              loading={loading}
              pilot={pilot}
              progress={progress}
              log={log}
              setLog={setLog}
              goAirplane={() => openTool('airplane')}
              goLogbook={() => go({ rail: 'logbook' })}
              onExit={() => go({ rail: 'course' })}
            />
          )}
          {screen.rail === 'course' && !lesson && (screen.view !== 'daily' || !airport) && (
            <CourseHome
              progress={progress}
              airport={airport}
              hasAircraft={aircraft.id !== 'custom' || aircraft.emptyWeightLb > 0}
              onStart={startLesson}
              onDaily={() => go({ rail: 'course', view: 'daily' })}
              onSetup={() => rerunSetup(1)}
            />
          )}
          {screen.rail === 'tools' && (
            <Tools tool={tool} setTool={setTool} airport={airport} aircraft={aircraft} setAircraft={setAircraft} loading={loading} setLoading={setLoading} epoch={epoch} onSetup={() => rerunSetup(1)} />
          )}
          {screen.rail === 'logbook' && <Logbook progress={progress} log={log} epoch={epoch} goReview={() => openTool('review')} goCourse={() => go({ rail: 'course' })} />}
          {screen.rail === 'pilot' && (
            <Settings
              airport={airport}
              pilot={pilot}
              setPilot={setPilot}
              theme={theme}
              setTheme={setTheme}
              onReviewReset={() => setEpoch((e) => e + 1)}
              onCourseReset={() => { setProgress({}); setLog([]); }}
              onRerunSetup={() => rerunSetup(0)}
            />
          )}
          <footer className="about">
            <span>Training aid, not for navigation. Not a substitute for an official briefing or a CFI.</span>
            <span>Downwind</span>
          </footer>
        </main>
      </div>
    </RefProvider>
  );
}
