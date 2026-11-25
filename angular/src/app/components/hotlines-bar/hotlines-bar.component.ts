import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { EmergencyHotline } from '../../models/alert.models';

@Component({
  selector: 'app-hotlines-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="grid gap-4 md:grid-cols-3">
      @for (hl of hotlines; track hl.id) {
        <article class="rounded-lg border border-slate-200 bg-white p-4">
          <p class="text-xs text-slate-500">{{ hl.coverage }}</p>
          <h2 class="mt-1 text-base font-semibold text-slate-900">{{ hl.agency }}</h2>
          <p class="mt-1 font-mono text-xl font-bold tabular-nums text-red-700">{{ hl.number }}</p>
          <p class="mt-1 text-xs text-slate-600">{{ hl.description }}</p>
          <a
            [href]="'tel:' + hl.number.replace(/[^0-9+]/g, '')"
            class="mt-3 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Call {{ hl.number }}
          </a>
        </article>
      }
    </section>
  `,
})
export class HotlinesBarComponent {
  readonly hotlines: EmergencyHotline[] = [
    { id: '911', agency: 'National Emergency Hotline', number: '911', coverage: 'Nationwide 24/7', description: 'Police, fire, and emergency medical dispatch.' },
    { id: '122', agency: 'Quezon City DRRMO Helpline', number: '122', coverage: 'Quezon City 24/7', description: 'Local flood rescue and evacuation dispatch.' },
    { id: '143', agency: 'Philippine Red Cross', number: '143', coverage: 'Nationwide 24/7', description: 'Water rescue, ambulance, and relief operations.' },
    { id: 'ndrrmc', agency: 'NDRRMC Operations Center', number: '(02) 8911-5061', coverage: 'National Ops', description: 'National disaster coordination and bulletins.' },
    { id: 'mmda', agency: 'MMDA Flood & Traffic', number: '136', coverage: 'Metro Manila', description: 'Road flood passability and Metrobase rescue.' },
    { id: 'pagasa', agency: 'DOST-PAGASA Weather', number: '(02) 8284-0800', coverage: 'Metro Manila', description: 'Rainfall warnings and tropical cyclone signals.' },
  ];
}
