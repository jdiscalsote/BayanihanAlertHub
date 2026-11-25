export type HazardCategory =
  | 'Flooded Roads'
  | 'Power/Comms'
  | 'Evacuation Update'
  | 'Relief/Rescue Needed';

export type HazardSeverity = 'Low' | 'Moderate' | 'Severe' | 'Critical';

export type FloodLevel =
  | 'Not Applicable'
  | 'Ankle-deep'
  | 'Knee-deep'
  | 'Waist-deep'
  | 'Chest-deep+';

export type ReportStatus = 'active' | 'resolved' | 'dismissed';

export type EvacuationStatus = 'Open' | 'Near Full' | 'Full' | 'Closed';

export type AdvisorySeverity = 'Advisory' | 'Warning' | 'Critical';

export type ActiveTab = 'feed' | 'evacuation' | 'hotlines' | 'moderator';

export type FeedFilter = 'All' | HazardCategory | 'Verified Only';

export interface PsgcRegion {
  code: string;
  name: string;
  regionName: string;
}

export interface PsgcMunicipality {
  code: string;
  name: string;
  regionCode: string;
  isCity: boolean;
}

export interface PsgcBarangay {
  code: string;
  name: string;
}

export interface HazardReport {
  id: string;
  category: HazardCategory;
  severity: HazardSeverity;
  region?: string;
  municipality?: string;
  barangay: string;
  street_or_landmark: string;
  description: string;
  flood_level: FloodLevel;
  contact_optional?: string | null;
  is_verified: boolean;
  status: ReportStatus;
  confirmations_count: number;
  created_at: string;
  verified_at?: string | null;
  verified_by?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Client-only flag when saved locally awaiting connectivity */
  queued_offline?: boolean;
}

export interface ReportDraft {
  category: HazardCategory;
  severity: HazardSeverity;
  region: string;
  municipality: string;
  barangay: string;
  street_or_landmark: string;
  description: string;
  flood_level: FloodLevel;
  contact_optional?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface EvacuationCenter {
  id: string;
  name: string;
  region?: string;
  barangay: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  status: EvacuationStatus;
  current_occupancy: number;
  max_capacity: number;
  notes: string;
  contact_info: string;
  updated_at: string;
}

export interface NewEvacuationCenterDraft {
  name: string;
  region: string;
  city: string;
  barangay: string;
  address: string;
  latitude: number;
  longitude: number;
  status: EvacuationStatus;
  current_occupancy: number;
  max_capacity: number;
  notes: string;
  contact_info: string;
}

export interface Advisory {
  id: string;
  title: string;
  message: string;
  severity: AdvisorySeverity;
  region?: string;
  municipality?: string;
  barangay: string;
  is_active: boolean;
  created_at: string;
  created_by?: string | null;
}

export interface ModeratorProfile {
  id: string;
  full_name: string;
  role: 'moderator' | 'admin';
  barangay_assigned: string;
  municipality_assigned?: string;
  email?: string;
}

export interface EmergencyHotline {
  id: string;
  agency: string;
  shortLabel: string;
  number: string;
  coverage: string;
  description: string;
}

export interface GroundedSourceLink {
  title: string;
  url: string;
}

export interface OfficialBulletinResult {
  locationLabel: string;
  summary: string;
  sources: GroundedSourceLink[];
  fetchedAt: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  sources?: GroundedSourceLink[];
  needsEmergencyHotlines?: boolean;
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  streetOrLandmark: string;
  barangay: string;
  municipality: string;
  region: string;
}

export interface NearbySafePlace {
  id: string;
  name: string;
  address: string;
  category: 'hospital' | 'barangay_hall';
  latitude: number;
  longitude: number;
}

