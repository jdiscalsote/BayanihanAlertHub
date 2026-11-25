import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AdvisorySeverity,
  EvacuationStatus,
  PsgcBarangay,
  PsgcMunicipality,
  PsgcRegion,
} from '../../models/alert.models';
import { FALLBACK_REGIONS, PsgcService } from '../../services/psgc.service';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-moderator-console',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (!supabase.moderator()) {
      <form (ngSubmit)="login()" class="mx-auto max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <h1 class="text-lg font-bold text-slate-900">Barangay Moderator Login</h1>
        @if (authError()) {
          <p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{{ authError() }}</p>
        }
        <input [(ngModel)]="email" name="email" type="email" required placeholder="Responder email" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input [(ngModel)]="password" name="password" type="password" required placeholder="Password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Sign In
        </button>
      </form>
    } @else {
      <section class="space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <p class="text-xs font-medium text-emerald-700">{{ supabase.moderator()?.barangay_assigned }}</p>
            <h1 class="text-lg font-bold text-slate-900">{{ supabase.moderator()?.full_name }}</h1>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            @if (isMunicipalityLocked()) {
              <span class="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800">
                Jurisdiction: {{ effectiveMunicipality() }}
              </span>
            } @else {
              <select
                [ngModel]="effectiveMunicipality()"
                (ngModelChange)="managedMunicipality.set($event)"
                class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
              >
                <option value="All">All Municipalities</option>
                @for (muni of availableMunicipalities(); track muni) {
                  <option [value]="muni">{{ muni }}</option>
                }
              </select>
            }
            <button type="button" (click)="supabase.signOutModerator()" class="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold">
              Sign Out
            </button>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h2 class="text-sm font-semibold text-slate-900">Community Reports Triage ({{ scopedReports().length }})</h2>
          @for (rep of scopedReports(); track rep.id) {
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
              <div>
                <p class="font-semibold text-slate-900">{{ rep.barangay }}{{ rep.municipality ? ', ' + rep.municipality : '' }} — {{ rep.street_or_landmark }}</p>
                <p class="text-slate-600">{{ rep.description }}</p>
              </div>
              <div class="flex gap-2">
                @if (!rep.is_verified) {
                  <button type="button" (click)="supabase.moderateReport(rep.id, { is_verified: true })" class="rounded bg-emerald-700 px-2.5 py-1 text-white">Verify</button>
                }
                <button type="button" (click)="supabase.moderateReport(rep.id, { status: 'resolved' })" class="rounded border border-slate-300 px-2.5 py-1">Resolve</button>
                <button type="button" (click)="supabase.moderateReport(rep.id, { status: 'dismissed' })" class="rounded border border-red-200 px-2.5 py-1 text-red-700">Dismiss</button>
              </div>
            </div>
          }
        </div>

        <div class="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-900">Evacuation Centers Capacity ({{ scopedCenters().length }})</h2>
            <button type="button" (click)="showAddCenter.set(!showAddCenter())" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
              {{ showAddCenter() ? 'Close Form' : 'Add Evacuation Center' }}
            </button>
          </div>

          @if (showAddCenter()) {
            <form (ngSubmit)="createShelter()" class="space-y-2 border-t border-slate-100 pt-3 text-xs">
              <div class="grid gap-2 sm:grid-cols-3">
                <select [ngModel]="centerRegionCode()" (ngModelChange)="onCenterRegionChange($event)" name="cReg" class="rounded-md border border-slate-300 px-2.5 py-1.5">
                  @for (r of regions(); track r.code) {
                    <option [value]="r.code">{{ r.name }}</option>
                  }
                </select>
                <select [ngModel]="centerMuniCode()" (ngModelChange)="onCenterMuniChange($event)" name="cMuni" class="rounded-md border border-slate-300 px-2.5 py-1.5">
                  @for (m of centerMunis(); track m.code) {
                    <option [value]="m.code">{{ m.name }}</option>
                  }
                </select>
                <select [(ngModel)]="newCenterBrgy" name="cBrgy" class="rounded-md border border-slate-300 px-2.5 py-1.5">
                  @for (b of centerBrgys(); track b.code) {
                    <option [value]="'Brgy. ' + b.name">Brgy. {{ b.name }}</option>
                  }
                </select>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <input [(ngModel)]="newCenterName" name="cName" required placeholder="Shelter name" class="rounded-md border border-slate-300 px-2.5 py-1.5" />
                <input [(ngModel)]="newCenterAddress" name="cAddr" required placeholder="Street address" class="rounded-md border border-slate-300 px-2.5 py-1.5" />
              </div>
              <div class="grid gap-2 sm:grid-cols-3">
                <input type="number" min="1" [(ngModel)]="newCenterMaxCap" name="cMax" required placeholder="Max capacity" class="rounded-md border border-slate-300 px-2.5 py-1.5 font-mono" />
                <input [(ngModel)]="newCenterContact" name="cContact" placeholder="Contact info" class="rounded-md border border-slate-300 px-2.5 py-1.5" />
                <input [(ngModel)]="newCenterNotes" name="cNotes" placeholder="Notes" class="rounded-md border border-slate-300 px-2.5 py-1.5" />
              </div>
              <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 font-semibold text-white">Save Evacuation Center</button>
            </form>
          }

          @for (center of scopedCenters(); track center.id) {
            <div class="border-t border-slate-100 pt-3 text-xs space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-semibold text-slate-900">{{ center.name }} ({{ center.barangay }}, {{ center.city }})</p>
                  <p class="font-mono text-slate-600">{{ center.status }} · {{ center.current_occupancy }} / {{ center.max_capacity }}</p>
                </div>
                <button
                  type="button"
                  (click)="startEditShelter(center.id, center.status, center.current_occupancy, center.notes)"
                  class="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-800"
                >
                  Update Status &amp; Headcount
                </button>
              </div>

              @if (editingCenterId() === center.id) {
                <form (ngSubmit)="saveShelter(center.id)" class="grid gap-2 pt-2 sm:grid-cols-3">
                  @if (shelterError()) {
                    <p class="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-800 sm:col-span-3">
                      {{ shelterError() }}
                    </p>
                  }
                  <select [(ngModel)]="draftStatus" name="draftStatus" class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs">
                    <option value="Open">Open</option>
                    <option value="Near Full">Near Full</option>
                    <option value="Full">Full</option>
                    <option value="Closed">Closed</option>
                  </select>
                  <input type="number" min="0" [(ngModel)]="draftOccupancy" name="draftOccupancy" class="rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs" />
                  <input type="text" [(ngModel)]="draftNotes" name="draftNotes" placeholder="Notes" class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs sm:col-span-3" />
                  <div class="flex gap-2 sm:col-span-3">
                    <button type="submit" [disabled]="savingShelter()" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                      {{ savingShelter() ? 'Saving...' : 'Save Shelter Update' }}
                    </button>
                    <button type="button" (click)="editingCenterId.set(null)" class="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                      Cancel
                    </button>
                  </div>
                </form>
              }
            </div>
          }
        </div>

        <form (ngSubmit)="postAdvisory()" class="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 class="text-sm font-semibold text-slate-900">Publish Official Advisory</h2>
          <input [(ngModel)]="advTitle" name="advTitle" required placeholder="Advisory title" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <div class="grid gap-3 sm:grid-cols-3">
            <select [(ngModel)]="advSeverity" name="advSeverity" class="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="Advisory">Advisory</option>
              <option value="Warning">Warning</option>
              <option value="Critical">Critical</option>
            </select>
            <input [(ngModel)]="advMunicipality" name="advMunicipality" placeholder="Municipality (or All Municipalities)" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input [(ngModel)]="advBarangay" name="advBarangay" placeholder="Barangay or Citywide" class="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <textarea [(ngModel)]="advMessage" name="advMessage" required rows="3" placeholder="Advisory message..." class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"></textarea>
          <button type="submit" class="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Publish Advisory</button>
        </form>
      </section>
    }
  `,
})
export class ModeratorConsoleComponent implements OnInit {
  readonly supabase = inject(SupabaseService);
  private readonly psgc = inject(PsgcService);

  readonly managedMunicipality = signal<string>('All');
  readonly showAddCenter = signal(false);
  readonly regions = signal<PsgcRegion[]>(FALLBACK_REGIONS);
  readonly centerMunis = signal<PsgcMunicipality[]>([]);
  readonly centerBrgys = signal<PsgcBarangay[]>([]);
  readonly centerRegionCode = signal('130000000');
  readonly centerMuniCode = signal('137404000');

  email = '';
  password = '';
  advTitle = '';
  advSeverity: AdvisorySeverity = 'Warning';
  advMunicipality = 'Quezon City';
  advBarangay = 'Citywide';
  advMessage = '';

  newCenterRegion = 'NCR';
  newCenterMuni = 'Quezon City';
  newCenterBrgy = 'Brgy. Bagong Silangan';
  newCenterName = '';
  newCenterAddress = '';
  newCenterMaxCap = 250;
  newCenterContact = '';
  newCenterNotes = '';

  readonly editingCenterId = signal<string | null>(null);
  draftStatus: EvacuationStatus = 'Open';
  draftOccupancy = 0;
  draftNotes = '';

  readonly authError = signal<string | null>(null);
  readonly shelterError = signal<string | null>(null);
  readonly savingShelter = signal(false);

  readonly assignedMunicipality = computed(() => {
    const m = this.supabase.moderator()?.municipality_assigned?.trim();
    return m && m !== 'All Municipalities' ? m : null;
  });

  readonly isMunicipalityLocked = computed(() => {
    const mod = this.supabase.moderator();
    return Boolean(mod && mod.role !== 'admin' && this.assignedMunicipality());
  });

  readonly effectiveMunicipality = computed(() => {
    if (this.isMunicipalityLocked()) {
      return this.assignedMunicipality() as string;
    }
    return this.managedMunicipality() ?? this.assignedMunicipality() ?? 'All';
  });

  readonly availableMunicipalities = computed(() => {
    const assigned = this.assignedMunicipality();
    const names = new Set<string>([
      ...(assigned ? [assigned] : []),
      ...this.supabase.reports().map((r) => r.municipality || 'Quezon City'),
      ...this.supabase.centers().map((c) => c.city),
    ]);
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  });

  readonly scopedReports = computed(() => {
    const m = this.effectiveMunicipality();
    return m === 'All'
      ? this.supabase.reports()
      : this.supabase.reports().filter(
          (r) => (r.municipality || 'Quezon City').toLowerCase() === m.toLowerCase()
        );
  });

  readonly scopedCenters = computed(() => {
    const m = this.effectiveMunicipality();
    return m === 'All'
      ? this.supabase.centers()
      : this.supabase.centers().filter((c) => c.city.toLowerCase() === m.toLowerCase());
  });

  async ngOnInit(): Promise<void> {
    this.regions.set(await this.psgc.fetchRegions());
    await this.onCenterRegionChange('130000000');
  }

  async onCenterRegionChange(code: string): Promise<void> {
    this.centerRegionCode.set(code);
    this.newCenterRegion = this.regions().find((r) => r.code === code)?.name || 'NCR';
    const munis = await this.psgc.fetchMunicipalitiesByRegion(code);
    this.centerMunis.set(munis);
    if (munis.length > 0) {
      await this.onCenterMuniChange(munis[0].code);
    }
  }

  async onCenterMuniChange(code: string): Promise<void> {
    this.centerMuniCode.set(code);
    this.newCenterMuni = this.centerMunis().find((m) => m.code === code)?.name || '';
    const brgys = await this.psgc.fetchBarangaysByMunicipality(code);
    this.centerBrgys.set(brgys);
    if (brgys.length > 0) {
      this.newCenterBrgy = `Brgy. ${brgys[0].name}`;
    }
  }

  async createShelter(): Promise<void> {
    const city = this.isMunicipalityLocked()
      ? this.effectiveMunicipality()
      : this.newCenterMuni;
    await this.supabase.createCenter({
      name: this.newCenterName,
      region: this.newCenterRegion,
      city,
      barangay: this.newCenterBrgy,
      address: this.newCenterAddress,
      latitude: 14.5995,
      longitude: 120.9842,
      status: 'Open',
      current_occupancy: 0,
      max_capacity: Math.max(1, Number(this.newCenterMaxCap) || 250),
      notes: this.newCenterNotes,
      contact_info: this.newCenterContact || 'Local DRRMO',
    });
    this.newCenterName = '';
    this.newCenterAddress = '';
    this.showAddCenter.set(false);
  }

  async login(): Promise<void> {
    this.authError.set(null);
    try {
      await this.supabase.signInModerator(this.email, this.password);
    } catch (err) {
      this.authError.set(err instanceof Error ? err.message : 'Login failed.');
    }
  }

  startEditShelter(id: string, status: EvacuationStatus, occupancy: number, notes: string): void {
    this.shelterError.set(null);
    this.editingCenterId.set(id);
    this.draftStatus = status;
    this.draftOccupancy = occupancy;
    this.draftNotes = notes;
  }

  async saveShelter(id: string): Promise<void> {
    this.shelterError.set(null);
    this.savingShelter.set(true);
    try {
      await this.supabase.updateCenter(id, {
        status: this.draftStatus,
        current_occupancy: Math.max(0, Math.round(Number(this.draftOccupancy) || 0)),
        notes: this.draftNotes,
      });
      this.editingCenterId.set(null);
    } catch (err) {
      this.shelterError.set(err instanceof Error ? err.message : 'Unable to save shelter update.');
    } finally {
      this.savingShelter.set(false);
    }
  }

  async postAdvisory(): Promise<void> {
    const municipality = this.isMunicipalityLocked()
      ? this.effectiveMunicipality()
      : this.advMunicipality;
    await this.supabase.publishAdvisory({
      title: this.advTitle,
      severity: this.advSeverity,
      municipality,
      barangay: this.advBarangay,
      message: this.advMessage,
    });
    this.advTitle = '';
    this.advMessage = '';
  }
}
