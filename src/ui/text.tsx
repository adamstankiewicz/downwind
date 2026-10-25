// Copy strings from the course model may contain **bold** spans. This renders
// them as <strong> without touching innerHTML.

import type { ReactNode } from 'react';

export function Rich({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  const nodes: ReactNode[] = parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
  );
  return className ? <span className={className}>{nodes}</span> : <>{nodes}</>;
}
