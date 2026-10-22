import { requireOptionalNativeModule } from 'expo';

/** Shapes exactly as the Swift records cross the bridge. */
export type NativeRegion = { lat: number; lng: number; latDelta: number; lngDelta: number };
export type NativePoint = { lat: number; lng: number };
export type NativeCompletion = { id: string; title: string; subtitle: string };
export type NativeCompletionBatch = {
  queryId: number;
  results: NativeCompletion[];
  superseded: boolean;
};
export type NativePlace = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string | null;
};
export type NativeWalk = { seconds: number; meters: number; coords: [number, number][] };

export type TransitMapsNative = {
  complete(queryId: number, query: string, region: NativeRegion): Promise<NativeCompletionBatch>;
  resolve(id: string): Promise<NativePlace>;
  walk(from: NativePoint, to: NativePoint): Promise<NativeWalk>;
  lookAround(lat: number, lng: number, w: number, h: number): Promise<string | null>;
  snapshot(region: NativeRegion, w: number, h: number, dark: boolean): Promise<string>;
  clearCache(): Promise<void>;
};

/** Null on Android and web, where the module isn't built. */
export default requireOptionalNativeModule<TransitMapsNative>('TransitMaps');
