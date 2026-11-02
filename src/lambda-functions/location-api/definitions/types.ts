export enum LocationGeodataStatus {
  MATCHED = 'MATCHED',
  NOT_FOUND = 'NOT_FOUND',
  PENDING = 'PENDING',
  ERROR = 'ERROR',
}

export interface Location {
  [key: string]: string | number | null | undefined;

  id: number;
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

