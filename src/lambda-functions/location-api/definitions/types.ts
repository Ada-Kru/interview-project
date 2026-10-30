export enum LocationCoordinatesStatus {
  MATCHED = 'MATCHED',
  NOT_FOUND = 'NOT_FOUND',
  PENDING = 'PENDING',
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
  status?: LocationCoordinatesStatus;
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

