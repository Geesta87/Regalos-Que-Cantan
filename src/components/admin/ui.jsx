// src/components/admin/ui.jsx
// Shared admin design-system primitives. One accent (indigo), neutral surfaces,
// status colors only for meaning (green = good, amber = attention, red = bad).
// Keeps the admin tabs visually consistent so they stop drifting apart.
import React from 'react';

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl ${className}`} {...rest}>
      {children}
    </div>
  );
}

const BADGE_TONES = {
  gray: 'bg-gray-100 text-gray-600',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-600',
  accent: 'bg-indigo-100 text-indigo-700',
};
export function Badge({ tone = 'gray', children, className = '' }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${BADGE_TONES[tone] || BADGE_TONES.gray} ${className}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, tone }) {
  const valueColor = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : 'text-gray-900';
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 ${valueColor}`}>{value}</p>
    </div>
  );
}

export function SectionLabel({ children, className = '' }) {
  return <p className={`text-[11px] font-semibold uppercase tracking-wide text-gray-400 ${className}`}>{children}</p>;
}

// Button class strings (apply as className). Single accent = indigo; primary = near-black.
export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50 transition-colors',
  accent: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors',
  success: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors',
  ghost: 'inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors',
  iconGhost: 'inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors',
};
