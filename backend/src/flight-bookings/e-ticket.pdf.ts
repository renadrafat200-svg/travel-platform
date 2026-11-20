import PDFDocument from 'pdfkit';

interface FlightPoint {
    airport?: string;
    airportName?: string;
    localTime?: string;
    utcOffset?: string;
}

/** The data shown on an e-ticket (same as the JSON version of GET /api/flight-bookings/:id/e-ticket) */
export interface ETicketData {
    reference: string;
    status: string;
    issuedAt?: Date;
    totalPaid: number;
    currency: string;
    flights: {
        flightNumber: string;
        airline?: { name?: string; iataCode?: string } | null;
        cabinClass: string;
        flightStatus?: string;
        departure?: FlightPoint | null;
        arrival?: FlightPoint | null;
        durationMinutes?: number;
        passengers: {
            name: string;
            passportNumber: string | null;
            type: string;
            seat?: string | null;
            ticketNumber?: string;
            extraBags: number;
        }[];
    }[];
}

const where = (p?: ETicketData['flights'][number]['departure']) => {
    if (!p) return '-';
    const place = p.airportName ? `${p.airport} ${p.airportName}` : (p.airport ?? '-');
    const time = p.localTime ? `  ${p.localTime.replace('T', ' ')} local${p.utcOffset ? ` (${p.utcOffset})` : ''}` : '';
    return place + time;
};

/** FLT-23: builds the e-ticket as a PDF file */
export function buildETicketPdf(t: ETicketData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `E-ticket ${t.reference}` } });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(22).text('Electronic Ticket', { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor('#444')
            .text(`Booking reference: ${t.reference}`)
            .text(`Status: ${t.status}`)
            .text(`Issued: ${t.issuedAt ? t.issuedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '-'}`)
            .text(`Total paid: ${t.totalPaid.toFixed(2)} ${t.currency}`);
        doc.fillColor('black');

        t.flights.forEach((f, i) => {
            doc.moveDown(1);
            doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').stroke();
            doc.moveDown(0.5);
            const label = t.flights.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : 'Flight';
            const airline = f.airline?.name ? `${f.airline.name} ` : '';
            doc.fontSize(15).text(`${label}: ${airline}${f.flightNumber}`);
            doc.fontSize(11)
                .text(`From: ${where(f.departure)}`)
                .text(`To:   ${where(f.arrival)}`)
                .text(
                    `Cabin: ${f.cabinClass}` +
                        (f.durationMinutes ? `   Duration: ${Math.floor(f.durationMinutes / 60)}h ${f.durationMinutes % 60}m` : '') +
                        (f.flightStatus ? `   Flight status: ${f.flightStatus}` : ''),
                );
            doc.moveDown(0.5);
            doc.fontSize(12).text('Passengers');
            doc.fontSize(10);
            for (const p of f.passengers) {
                doc.text(
                    `${p.name} (${p.type})   Passport/ID: ${p.passportNumber ?? '-'}   ` +
                        `Seat: ${p.seat ?? '-'}   Ticket: ${p.ticketNumber ?? '-'}   Extra bags: ${p.extraBags}`,
                );
            }
        });

        doc.moveDown(2);
        doc.fontSize(9).fillColor('#666').text(
            'Times are local to each airport and reflect the latest schedule. Bring the passport or ID listed above to check in.',
        );
        doc.end();
    });
}
