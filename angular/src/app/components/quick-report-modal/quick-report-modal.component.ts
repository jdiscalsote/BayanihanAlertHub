import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FloodLevel,
  HazardCategory,
  HazardSeverity,
  PsgcBarangay,
  PsgcMunicipality,
  PsgcRegion,
} from '../../models/alert.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { FALLBACK_REGIONS, PsgcService } from '../../services/psgc.service';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-quick-report-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
        <div class="flex items-start justify-between border-b border-slate-200 pb-3">
          <div>
            <h2 class="text-lg font-bold text-slate-900">Submit Quick Hazard Report</h2>
            <p class="text-xs text-slate-600">No login required. Saved offline automatically if signal drops.</p>
          </div>
          <button type="button" (click)="close.emit()" class="text-sm text-slate-500">Close</button>
        </div>

        @if (errorMsg()) {
          <p class="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {{ errorMsg() }}
          </p>
        }

        <form (ngSubmit)="submit()" class="mt-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <select [(ngModel)]="category" name="category" class="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="Flooded Roads">Flooded Roads</option>
              <option value="Power/Comms">Power/Comms</option>
              <option value="Evacuation Update">Evacuation Update</option>
              <option value="Relief/Rescue Needed">Relief/Rescue Needed</option>
            </select>
            <select [(ngModel)]="severity" name="severity" class="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="Low">Low</option>
              <option value="Moderate">Moderate</option>
              <option value="Severe">Severe</option>
              <option value="Critical">Critical</option>
            </select>
          </div>

          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-slate-700">Region → City / Municipality → Barangay</span>
            <button
              type="button"
              (click)="manualFallback.set(!manualFallback())"
              class="text-slate-600 underline"
            >
              {{ manualFallback() ? 'Use PSGC Dropdowns' : 'Type manually' }}
            </button>
          </div>

          @if (manualFallback()) {
            <div class="grid gap-2 sm:grid-cols-3">
              <input [(ngModel)]="region" name="regionManual" required placeholder="Region" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input [(ngModel)]="municipality" name="muniManual" required placeholder="City / Municipality" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input [(ngModel)]="barangay" name="brgyManual" required placeholder="Barangay" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          } @else {
            <div class="grid gap-2 sm:grid-cols-3">
              <select
                [ngModel]="selectedRegionCode()"
                (ngModelChange)="onRegionChange($event)"
                name="psgcRegion"
                class="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                @for (r of regions(); track r.code) {
                  <option [value]="r.code">{{ r.regionName ? r.regionName + ' — ' + r.name : r.name }}</option>
                }
              </select>

              @if (municipalities().length > 0) {
                <select
                  [ngModel]="selectedMuniCode()"
                  (ngModelChange)="onMunicipalityChange($event)"
                  name="psgcMuni"
                  class="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  @for (m of municipalities(); track m.code) {
                    <option [value]="m.code">{{ m.name }}</option>
                  }
                </select>
              } @else {
                <input [(ngModel)]="municipality" name="muniInput" required placeholder="City / Municipality" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              }

              @if (barangays().length > 0) {
                <select
                  [(ngModel)]="barangay"
                  name="psgcBrgy"
                  class="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  @for (b of barangays(); track b.code) {
                    <option [value]="'Brgy. ' + b.name">Brgy. {{ b.name }}</option>
                  }
                </select>
              } @else {
                <input [(ngModel)]="barangay" name="brgyInput" required placeholder="Barangay" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              }
            </div>
          }

          <select [(ngModel)]="floodLevel" name="floodLevel" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="Not Applicable">Not Applicable</option>
            <option value="Ankle-deep">Ankle-deep</option>
            <option value="Knee-deep">Knee-deep</option>
            <option value="Waist-deep">Waist-deep</option>
            <option value="Chest-deep+">Chest-deep+</option>
          </select>

          <input [(ngModel)]="streetOrLandmark" name="streetOrLandmark" required placeholder="Street / Exact Landmark" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <textarea [(ngModel)]="description" name="description" required rows="3" placeholder="Situation & passability notes..." class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"></textarea>
          <input [(ngModel)]="contactOptional" name="contactOptional" placeholder="Optional Callback Number (only for rescue)" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" (click)="close.emit()" class="rounded-md border border-slate-300 px-4 py-2 text-xs font-medium">Cancel</button>
            <button type="submit" [disabled]="submitting()" class="rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white">
              {{ offline.isOffline() ? 'Queue Offline' : 'Submit Report' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class QuickReportModalComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly psgc = inject(PsgcService);
  readonly offline = inject(OfflineSyncService);

  readonly close = output<void>();
  readonly submitted = output<{ queued: boolean }>();

  readonly regions = signal<PsgcRegion[]>(FALLBACK_REGIONS);
  readonly municipalities = signal<PsgcMunicipality[]>([]);
  readonly barangays = signal<PsgcBarangay[]>([]);
  readonly selectedRegionCode = signal('130000000');
  readonly selectedMuniCode = signal('137404000');
  readonly manualFallback = signal(false);

  category: HazardCategory = 'Flooded Roads';
  severity: HazardSeverity = 'Moderate';
  region = 'NCR';
  municipality = 'Quezon City';
  barangay = 'Brgy. Tatalon';
  floodLevel: FloodLevel = 'Knee-deep';
  streetOrLandmark = '';
  description = '';
  contactOptional = '';

  readonly errorMsg = signal<string | null>(null);
  readonly submitting = signal(false);

  async ngOnInit(): Promise<void> {
    const regs = await this.psgc.fetchRegions();
    this.regions.set(regs);
    await this.loadMunicipalities('130000000', '137404000');
  }

  async onRegionChange(code: string): Promise<void> {
    this.selectedRegionCode.set(code);
    const reg = this.regions().find((r) => r.code === code);
    this.region = reg?.name || this.region;
    await this.loadMunicipalities(code);
  }

  async onMunicipalityChange(code: string): Promise<void> {
    this.selectedMuniCode.set(code);
    const muni = this.municipalities().find((m) => m.code === code);
    this.municipality = muni?.name || '';
    await this.loadBarangays(code);
  }

  private async loadMunicipalities(regionCode: string, preferredMuniCode?: string): Promise<void> {
    const munis = await this.psgc.fetchMunicipalitiesByRegion(regionCode);
    this.municipalities.set(munis);
    const target =
      (preferredMuniCode && munis.find((m) => m.code === preferredMuniCode)) ||
      munis[0];
    if (target) {
      this.selectedMuniCode.set(target.code);
      this.municipality = target.name;
      await this.loadBarangays(target.code);
    } else {
      this.selectedMuniCode.set('');
      this.barangays.set([]);
    }
  }

  private async loadBarangays(muniCode: string): Promise<void> {
    const brgys = await this.psgc.fetchBarangaysByMunicipality(muniCode);
    this.barangays.set(brgys);
    const currentClean = this.barangay.replace(/^Brgy\.\s*/i, '').toLowerCase();
    const match = brgys.find((b) => b.name.toLowerCase() === currentClean);
    if (!match && brgys.length > 0) {
      this.barangay = `Brgy. ${brgys[0].name}`;
    }
  }

  async submit(): Promise<void> {
    const cooldown = this.offline.getCooldownSeconds();
    if (cooldown > 0) {
      this.errorMsg.set(`Please wait ${cooldown}s before submitting again.`);
      return;
    }
    if (!this.municipality.trim() || !this.barangay.trim()) {
      this.errorMsg.set('Please select or enter both city/municipality and barangay.');
      return;
    }
    if (this.streetOrLandmark.trim().length < 3 || this.description.trim().length < 6) {
      this.errorMsg.set('Please complete street/landmark and description.');
      return;
    }

    this.submitting.set(true);
    try {
      const res = await this.supabase.submitReport({
        category: this.category,
        severity: this.severity,
        region: this.region,
        municipality: this.municipality,
        barangay: this.barangay,
        street_or_landmark: this.streetOrLandmark,
        flood_level: this.floodLevel,
        description: this.description,
        contact_optional: this.contactOptional || undefined,
      });
      this.offline.recordSubmission();
      this.submitted.emit(res);
      this.close.emit();
    } finally {
      this.submitting.set(false);
    }
  }
}
