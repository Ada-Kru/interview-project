export enum LocationGeodataStatus {
  MATCHED = 'MATCHED',
  NOT_FOUND = 'NOT_FOUND',
  PENDING = 'PENDING',
  ERROR = 'ERROR',
}

export interface Location {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  geodataStatus?: LocationGeodataStatus;
};

export interface LocationCreateData {
  name: string;
  city: string;
  state: string;
  country: string;
};

export interface LocationUpdateData {
  name?: string;
  city?: string;
  state?: string;
  country?: string;
};

