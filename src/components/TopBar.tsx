import { BatteryCharging } from 'lucide-react';
import type { ActiveTab } from '../types/alert';
import { PWAInstallButton } from './PWAInstallButton';

interface TopBarProps {
  activeTab: ActiveTab;
  batterySaver: boolean;
  onSelectTab: (tab: ActiveTab) => void;
  onToggleBatterySaver: () => void;
  onOpenReportModal: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'feed', label: 'Live Alerts' },
  { id: 'evacuation', label: 'Evacuation Centers' },
  { id: 'safety', label: 'SOS & Check-In' },
  { id: 'hotlines', label: 'Hotlines' },
  { id: 'moderator', label: 'Responder Console' },
];

export function TopBar({
  activeTab,
  batterySaver,
  onSelectTab,
  onToggleBatterySaver,
  onOpenReportModal,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('feed')}
          className="font-display cursor-pointer whitespace-nowrap shrink-0 text-left text-lg font-bold tracking-tight text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
        >
          Bayanihan Alert Hub
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center gap-5 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`cursor-pointer whitespace-nowrap shrink-0 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900 ${
                  isActive
                    ? 'text-slate-900 underline decoration-2 underline-offset-8'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Install PWA + Battery Saver toggle + Primary emergency action */}
        <div className="flex shrink-0 items-center gap-2">
          <PWAInstallButton />
          <button
            type="button"
            onClick={onToggleBatterySaver}
            aria-pressed={batterySaver}
            title="Switch to low-power dark mode and pause heavy map tiles during brownouts"
            className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
              batterySaver
                ? 'border-emerald-500 bg-emerald-950/80 text-emerald-300'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <BatteryCharging className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">
              {batterySaver ? 'Battery Saver On' : 'Battery Saver'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenReportModal}
            className="cursor-pointer whitespace-nowrap shrink-0 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            Report Hazard
          </button>
        </div>
      </div>

      {/* Compact mobile & tablet navigation row */}
      <nav
        aria-label="Mobile navigation"
        className="flex lg:hidden items-center justify-between gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2 text-xs font-medium"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`cursor-pointer whitespace-nowrap shrink-0 rounded-md px-2.5 py-2 transition-colors ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
