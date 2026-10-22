import type { SFSymbol } from 'expo-symbols';

/**
 * SF Symbol for an Apple place category (`MKPointOfInterestCategory` raw
 * value, from `resolve()`). Pure, so it runs under `tsx --test`.
 */
export const CATEGORY_SYMBOLS: Readonly<Record<string, SFSymbol>> = {
  MKPOICategoryRestaurant: 'fork.knife',
  MKPOICategoryCafe: 'cup.and.saucer.fill',
  MKPOICategoryHospital: 'cross.case.fill',
  MKPOICategorySchool: 'graduationcap.fill',
  MKPOICategoryUniversity: 'graduationcap.fill',
  MKPOICategoryStore: 'bag.fill',
  MKPOICategoryFoodMarket: 'cart.fill',
  MKPOICategoryPublicTransport: 'tram.fill',
  MKPOICategoryAirport: 'airplane',
  MKPOICategoryHotel: 'bed.double.fill',
  MKPOICategoryPark: 'tree.fill',
  MKPOICategoryNationalPark: 'tree.fill',
  MKPOICategoryMuseum: 'building.columns.fill',
  MKPOICategoryParking: 'parkingsign',
  MKPOICategoryGasStation: 'fuelpump.fill',
  MKPOICategoryFitnessCenter: 'dumbbell.fill',
  MKPOICategoryLibrary: 'books.vertical.fill',
  MKPOICategoryMovieTheater: 'film.fill',
  MKPOICategoryPharmacy: 'pills.fill',
  MKPOICategoryNightlife: 'wineglass.fill',
  MKPOICategoryStadium: 'sportscourt.fill',
};

/** An address (no category) is a plain pin. */
export const ADDRESS_SYMBOL: SFSymbol = 'mappin';
/** A category without its own glyph. */
export const PLACE_SYMBOL: SFSymbol = 'mappin.circle.fill';

export function placeSymbol(category: string | null): SFSymbol {
  if (category == null) return ADDRESS_SYMBOL;
  return CATEGORY_SYMBOLS[category] ?? PLACE_SYMBOL;
}
