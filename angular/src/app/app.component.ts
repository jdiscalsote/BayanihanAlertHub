import { CommonModule } from '@angular/common';
import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { QuickReportModalComponent } from './components/quick-report-modal/quick-report-modal.component';
import { OfflineSyncService } from './services/offline-sync.service';
import { SupabaseService } from './services/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, QuickReportModalComponent],
  template: `
    <div class="min-h-screen bg-slate-50 text-slate-900">
      <header class="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <a routerLink="/" class="whitespace-nowrap shrink-0 text-lg font-bold text-slate-900">
            Bayanihan Alert Hub
          </a>

          <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a routerLink="/" routerLinkActive="text-slate-900 underline underline-offset-8" [routerLinkActiveOptions]="{ exact: true }">Live Alerts</a>
            <a routerLink="/evacuation" routerLinkActive="text-slate-900 underline underline-offset-8">Evacuation Centers</a>
            <a routerLink="/hotlines" routerLinkActive="text-slate-900 underline underline-offset-8">Hotlines</a>
            <a routerLink="/moderator" routerLinkActive="text-slate-900 underline underline-offset-8">Responder Console</a>
          </nav>

          <button
            type="button"
            (click)="showReportModal.set(true)"
            class="whitespace-nowrap shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Report Hazard
          </button>
        </div>
      </header>

      @if (supabase.advisories().length > 0) {
        <section class="border-b border-slate-800 bg-slate-900 px-4 py-3 text-white sm:px-6">
          <div class="mx-auto max-w-6xl">
            <p class="text-xs font-semibold text-amber-300">
              {{ supabase.advisories()[0].severity }} Official Advisory · {{ supabase.advisories()[0].barangay }}
            </p>
            <h2 class="mt-0.5 text-sm font-bold">{{ supabase.advisories()[0].title }}</h2>
            <p class="mt-0.5 text-xs text-slate-300">{{ supabase.advisories()[0].message }}</p>
          </div>
        </section>
      }

      <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <router-outlet />
      </main>

      @if (showReportModal()) {
        <app-quick-report-modal
          (close)="showReportModal.set(false)"
          (submitted)="showReportModal.set(false)"
        />
      }
    </div>
  `,
})
export class AppComponent implements OnInit {
  readonly supabase = inject(SupabaseService);
  private readonly offline = inject(OfflineSyncService);
  readonly showReportModal = signal(false);

  constructor() {
    effect(() => {
      if (!this.offline.isOffline() && this.offline.pendingQueue().length > 0) {
        void this.supabase.syncPendingQueue();
      }
    });
  }

  ngOnInit(): void {
    void this.supabase.initialize();
  }
}
