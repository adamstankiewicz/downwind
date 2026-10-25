import type { AircraftProfile } from '../data/aircraft';

export function RadioPractice({ onExit }: { aircraft: AircraftProfile; onExit: () => void }) {
  return <button type="button" className="btn quiet" onClick={onExit}>Back to course</button>;
}
