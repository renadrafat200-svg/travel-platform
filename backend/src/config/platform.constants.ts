/**
 * PAY-04: the whole platform uses ONE currency for every flight and hotel price.
 * Change it here only; every module that stores or shows a booking price imports it.
 * (Itinerary budgets can still be entered in other currencies and are converted, ITN-18.)
 */
export const PLATFORM_CURRENCY = 'USD';
