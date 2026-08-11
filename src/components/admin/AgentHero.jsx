// src/components/admin/AgentHero.jsx
// Full-bleed cinematic hero for a personified AI staff member — the same
// treatment Ace got on the Fix Song tab, shared so every named agent
// (Cruz — Meta Ads Coach, Nova — SEO Coach, …) looks and behaves the same.
// The agent is ALWAYS alive: an idle "at your command" loop while standing
// by and a working loop while their pipeline is actually doing something.
// Assets live in /public/agents as `${base}-hero-idle.mp4`,
// `${base}-hero-working.mp4` and `${base}-hero.png` (poster), generated on
// Kie (nano-banana portrait → nano-banana-edit 16:9 → seedance-2 loops with
// the hero frame pinned as first AND last frame so they loop seamlessly).
import React from 'react';
import { RefreshCw } from 'lucide-react';

const ACCENTS = {
  indigo: { label: 'text-indigo-300/90', border: 'border-indigo-500/25', shadow: 'shadow-indigo-950/40' },
  teal: { label: 'text-teal-300/90', border: 'border-teal-500/25', shadow: 'shadow-teal-950/40' },
  amber: { label: 'text-amber-300/90', border: 'border-amber-500/25', shadow: 'shadow-amber-950/40' },
};

export default function AgentHero({
  base,                      // asset base path, e.g. '/agents/cruz'
  name,                      // 'Cruz'
  role,                      // 'Your Meta Ads Coach'
  busy = false,              // switches to the working loop + amber pulse
  statusLine = '',           // one-liner under the name
  accent = 'indigo',
  objectPosition = '72% center', // keeps the character in frame when cropped
  onReload,                  // optional: shows a reload button top-right
  children,                  // optional bottom row (toggles, hints)
}) {
  const a = ACCENTS[accent] || ACCENTS.indigo;
  return (
    <div className={`mb-5 rounded-2xl border ${a.border} overflow-hidden relative shadow-2xl ${a.shadow}`}>
      <video
        key={busy ? 'working' : 'idle'}
        src={busy ? `${base}-hero-working.mp4` : `${base}-hero-idle.mp4`}
        poster={`${base}-hero.png`}
        autoPlay
        loop
        muted
        playsInline
        className="w-full h-56 sm:h-72 lg:h-80 xl:h-96 object-cover"
        style={{ objectPosition }}
      />
      {/* Readability gradients — strongest over the dark left half and bottom. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" aria-hidden="true" />

      {onReload && (
        <button
          onClick={onReload}
          title="Reload"
          className="absolute top-3 right-3 p-2 rounded-full bg-black/30 text-gray-200 hover:bg-black/50 backdrop-blur-sm transition"
        >
          <RefreshCw size={15} />
        </button>
      )}

      <div className="absolute inset-0 flex flex-col justify-between p-5 sm:p-7 pointer-events-none">
        <div>
          <p className={`text-[10px] sm:text-xs uppercase tracking-[0.25em] ${a.label} font-semibold mb-1 drop-shadow`}>{role}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-4xl sm:text-5xl font-bold text-white drop-shadow-lg tracking-tight">{name}</h2>
            <span
              className={`w-3 h-3 rounded-full mt-2 ${busy ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`}
              title={busy ? 'Working' : 'On duty'}
            />
          </div>
          {statusLine && (
            <p className="text-sm sm:text-base text-gray-100 mt-2 max-w-md drop-shadow">{statusLine}</p>
          )}
          {/* Activity pulse while working — same EQ treatment as Ace's banner. */}
          {busy && (
            <div className="flex items-end gap-1 h-7 mt-2" aria-hidden="true">
              {[55, 95, 40, 80, 60].map((h, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-amber-400/90 animate-pulse"
                  style={{ height: `${h}%`, animationDelay: `${i * 140}ms`, animationDuration: '850ms' }}
                />
              ))}
            </div>
          )}
        </div>
        {children && <div className="flex items-center gap-2 flex-wrap pointer-events-auto">{children}</div>}
      </div>
    </div>
  );
}
