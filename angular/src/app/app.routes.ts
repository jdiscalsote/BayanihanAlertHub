import { Routes } from '@angular/router';
import { EvacuationDirectoryComponent } from './components/evacuation-directory/evacuation-directory.component';
import { HotlinesBarComponent } from './components/hotlines-bar/hotlines-bar.component';
import { LiveFeedComponent } from './components/live-feed/live-feed.component';
import { ModeratorConsoleComponent } from './components/moderator-console/moderator-console.component';

export const routes: Routes = [
  { path: '', component: LiveFeedComponent },
  { path: 'evacuation', component: EvacuationDirectoryComponent },
  { path: 'hotlines', component: HotlinesBarComponent },
  { path: 'moderator', component: ModeratorConsoleComponent },
  { path: '**', redirectTo: '' },
];
