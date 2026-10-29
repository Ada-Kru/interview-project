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
