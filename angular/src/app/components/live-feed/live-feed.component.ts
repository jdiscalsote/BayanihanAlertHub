import { CommonModule } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HazardCategory } from '../../models/alert.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { SupabaseService } from '../../services/supabase.service';

type FeedFilter = 'All' | HazardCategory | 'Verified Only';

@Component({
  selector: 'app-live-feed',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="space-y-4">
      <div class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-1 flex-col gap-2 sm:flex-row">
          <input
            type="search"
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            placeholder="Search municipality, barangay, street, or landmark..."
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none sm:max-w-md"
          />
          <select
            [ngModel]="selectedMunicipality()"
            (ngModelChange)="selectedMunicipality.set($event)"
            class="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="All">All Municipalities</option>
            @for (muni of availableMunicipalities(); track muni) {
              <option [value]="muni">{{ muni }}</option>
            }
          </select>
        </div>

        <div class="flex items-center gap-2">
          @if (offline.pendingQueue().length > 0) {
            <button
              type="button"
              (click)="supabase.syncPendingQueue()"
              [disabled]="offline.isOffline() || supabase.isSyncing()"
              class="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Sync Queue ({{ offline.pendingQueue().length }})
            </button>
          }
          <button
            type="button"
            (click)="supabase.refreshAll()"
            [disabled]="offline.isOffline()"
            class="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        @for (option of filters; track option) {
          <button
            type="button"
            (click)="activeFilter.set(option)"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            [class.bg-white]="activeFilter() === option"
            [class.text-slate-900]="activeFilter() === option"
            [class.text-slate-600]="activeFilter() !== option"
          >
            {{ option }}
          </button>
        }
      </div>

      @for (report of filteredReports(); track report.id) {
        <article class="rounded-lg border border-slate-200 bg-white p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div>
              <span class="font-semibold text-slate-900">{{ report.severity }}</span>
              <span class="mx-1.5">·</span>
              <span>{{ report.category }}</span>
              <span class="mx-1.5">·</span>
              <span>{{ report.barangay }}{{ report.municipality ? ', ' + report.municipality : '' }}</span>
            </div>
            <span class="font-mono tabular-nums text-slate-500">
              {{ report.created_at | date: 'shortTime' }}
            </span>
          </div>

          <h3 class="mt-1.5 text-base font-semibold text-slate-900">
            {{ report.street_or_landmark }}
          </h3>
          <p class="mt-1 text-sm text-slate-700">{{ report.description }}</p>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span class="font-medium" [class.text-emerald-700]="report.is_verified" [class.text-amber-700]="report.queued_offline">
              @if (report.queued_offline) {
                Queued Offline · Will auto-sync
              } @else if (report.is_verified) {
                Verified by Barangay/Responder
              } @else {
                Unverified Community Report
              }
            </span>

            @if (!report.queued_offline && report.status === 'active') {
              <button
                type="button"
                (click)="supabase.confirmReport(report.id)"
                [disabled]="offline.confirmedIds().has(report.id)"
                class="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                Mark Still Active ({{ report.confirmations_count }})
              </button>
            }
          </div>
        </article>
      } @empty {
        <div class="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <p class="text-sm font-semibold text-slate-900">No alerts match your filter.</p>
          <button
            type="button"
            (click)="openReport.emit()"
            class="mt-3 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Submit Quick Report
          </button>
        </div>
      }
    </section>
  `,
})
export class LiveFeedComponent {
  readonly supabase = inject(SupabaseService);
  readonly offline = inject(OfflineSyncService);
  readonly openReport = output<void>();

  readonly activeFilter = signal<FeedFilter>('All');
  readonly selectedMunicipality = signal<string>('All');
  readonly searchQuery = signal('');

  readonly availableMunicipalities = computed(() => {
    const names = new Set<string>([
      ...this.supabase.reports().map((r) => r.municipality || 'Quezon City'),
      ...this.offline.pendingQueue().map((r) => r.municipality || 'Quezon City'),
      ...this.supabase.centers().map((c) => c.city),
    ]);
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  });

  readonly filters: FeedFilter[] = [
    'All',
    'Flooded Roads',
    'Power/Comms',
    'Evacuation Update',
    'Relief/Rescue Needed',
    'Verified Only',
  ];

  readonly filteredReports = computed(() => {
    const combined = [...this.offline.pendingQueue(), ...this.supabase.reports()];
    const f = this.activeFilter();
    const muni = this.selectedMunicipality();
    const q = this.searchQuery().trim().toLowerCase();

    return combined.filter((item) => {
      const itemMuni = item.municipality || 'Quezon City';
      if (muni !== 'All' && itemMuni !== muni) return false;
      if (f === 'Verified Only' && !item.is_verified) return false;
      if (f !== 'All' && f !== 'Verified Only' && item.category !== f) return false;
      if (!q) return true;
      return (
        item.barangay.toLowerCase().includes(q) ||
        itemMuni.toLowerCase().includes(q) ||
        (item.region || '').toLowerCase().includes(q) ||
        item.street_or_landmark.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });
  });
}
