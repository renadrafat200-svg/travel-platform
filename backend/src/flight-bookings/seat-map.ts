import { CabinClass } from '../flights/schemas/flight.schema';

/** FLT-28 (optional): every row has seats A to F */
export const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Front of the plane first */
const CABIN_ORDER: CabinClass[] = [
    CabinClass.FIRST,
    CabinClass.BUSINESS,
    CabinClass.PREMIUM_ECONOMY,
    CabinClass.ECONOMY,
];

/**
 * The seat labels of each cabin. Cabins are laid out front to back (first, business,
 * premium economy, economy); each uses ceil(totalSeats / 6) rows, and the last row of a
 * cabin may be partly filled. Example: business 8 seats -> 1A-1F, 2A-2B; economy then starts at row 3.
 */
export function seatMap(cabins: { cabinClass: CabinClass; totalSeats: number }[]): Map<CabinClass, string[]> {
    const map = new Map<CabinClass, string[]>();
    let row = 1;
    for (const cabinClass of CABIN_ORDER) {
        const cabin = cabins.find((c) => c.cabinClass === cabinClass);
        if (!cabin) continue;
        const seats: string[] = [];
        for (let i = 0; i < cabin.totalSeats; i++) {
            seats.push(`${row + Math.floor(i / SEAT_LETTERS.length)}${SEAT_LETTERS[i % SEAT_LETTERS.length]}`);
        }
        map.set(cabinClass, seats);
        row += Math.ceil(cabin.totalSeats / SEAT_LETTERS.length);
    }
    return map;
}
