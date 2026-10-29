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

export enum LocationCoordinatesStatus {
  MATCHED = 'MATCHED',
  NOT_FOUND = 'NOT_FOUND',
  PENDING = 'PENDING',
}

