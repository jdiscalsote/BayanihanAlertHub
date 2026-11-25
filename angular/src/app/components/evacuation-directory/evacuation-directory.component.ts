import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EvacuationStatus } from '../../models/alert.models';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-evacuation-directory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h1 class="text-lg font-bold text-slate-900">Evacuation Centers</h1>
          <p class="text-xs text-slate-600">Cached offline for low-signal access.</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <select
            [ngModel]="selectedMunicipality()"
            (ngModelChange)="selectedMunicipality.set($event)"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="All">All Municipalities</option>
            @for (muni of availableMunicipalities(); track muni) {
              <option [value]="muni">{{ muni }}</option>
            }
          </select>

          <div class="flex gap-1 rounded-lg bg-slate-100 p-1">
            @for (st of statuses; track st) {
              <button
                type="button"
                (click)="statusFilter.set(st)"
                class="rounded-md px-3 py-1.5 text-xs font-medium"
                [class.bg-white]="statusFilter() === st"
              >
                {{ st }}
              </button>
            }
          </div>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        @for (center of filteredCenters(); track center.id) {
          <article class="rounded-lg border border-slate-200 bg-white p-5">
            <div class="flex items-center justify-between text-xs text-slate-600">
              <span class="font-semibold text-slate-900">{{ center.status }} · {{ center.barangay }} · {{ center.city }}</span>
              <span class="font-mono tabular-nums">{{ center.current_occupancy }} / {{ center.max_capacity }}</span>
            </div>
            <h2 class="mt-2 text-base font-semibold text-slate-900">{{ center.name }}</h2>
            <p class="mt-1 text-xs text-slate-600">{{ center.address }}</p>
            <p class="mt-2 text-xs text-slate-700">{{ center.notes }}</p>
            <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
              <span class="font-mono text-slate-600">{{ center.contact_info }}</span>
              <a
                [href]="'https://www.google.com/maps/search/?api=1&query=' + center.latitude + ',' + center.longitude"
                target="_blank"
                rel="noopener noreferrer"
                class="font-semibold text-slate-900 underline"
              >
                Google Maps
              </a>
            </div>
          </article>
        }
      </div>
    </section>
  `,
})
export class EvacuationDirectoryComponent {
  private readonly supabase = inject(SupabaseService);
  readonly statusFilter = signal<'All' | EvacuationStatus>('All');
  readonly selectedMunicipality = signal<string>('All');
  readonly statuses: Array<'All' | EvacuationStatus> = ['All', 'Open', 'Near Full', 'Full', 'Closed'];

  readonly availableMunicipalities = computed(() =>
    Array.from(new Set(this.supabase.centers().map((c) => c.city).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    )
  );

  readonly filteredCenters = computed(() => {
    const f = this.statusFilter();
    const muni = this.selectedMunicipality();
    return this.supabase
      .centers()
      .filter((c) => (muni === 'All' || c.city === muni) && (f === 'All' || c.status === f));
  });
}
