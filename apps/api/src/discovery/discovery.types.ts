export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DiscoveryQuery {
  country: string;
  state: string | null;
  city: string;
  postalCode: string | null;
  radiusMeters: number;
  niche: string;
  keyword: string | null;
  maximumResults: number;
}

export interface DiscoveredBusiness {
  googlePlaceId: string;
  externalProviderId: string;
  name: string;
  primaryCategory: string | null;
  categories: string[];
  phone: string | null;
  websiteUrl: string | null;
  address: string;
  latitude: number;
  longitude: number;
  googleMapsUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string;
  rawData: { [key: string]: JsonValue };
}

export interface DiscoveryProvider {
  search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]>;
}
