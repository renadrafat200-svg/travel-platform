import PDFDocument from 'pdfkit';
import type { AttachedBookingView } from './itinerary-extras.service';
import type { ItinerariesService } from './itineraries.service';
import type { ItineraryItemsService } from './itinerary-items.service';

type Detail = Awaited<ReturnType<ItinerariesService['toDetail']>>;
type Summary = Awaited<ReturnType<ItineraryItemsService['summarize']>>;

export interface ItineraryPdfData {
  detail: Detail;
  summary: Summary | null;
  authorName: string;
  bookings: AttachedBookingView[];
  generatedAt: Date;
}

const CATEGORY_LABELS: Record<string, string> = {
  food: 'Food',
  accommodation: 'Accommodation',
  in_city_transport: 'In-city transport',
  activities: 'Activities',
  intercity_transport: 'Intercity transport',
};

const money = (n: number | null | undefined, currency: string) =>
  n === null || n === undefined ? '-' : `${n.toFixed(2)} ${currency}`;

/** ITN-28 (optional): the whole itinerary as a printable PDF */
export function buildItineraryPdf(data: ItineraryPdfData): Promise<Buffer> {
  const { detail: d, summary, bookings } = data;
  const currency = d.budget.currency;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: d.title, Author: data.authorName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rule = () => {
      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#bbbbbb').stroke();
      doc.moveDown(0.4);
    };
    const heading = (text: string) => {
      doc.moveDown(0.6);
      doc.fillColor('black').fontSize(14).text(text);
      doc.fontSize(10);
    };

    // ---- Title block ----
    doc.fontSize(22).text(d.title);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#444')
      .text(`By ${data.authorName}${d.clonedFrom ? `  ·  based on "${d.clonedFrom.title}" by ${d.clonedFrom.authorName}` : ''}`)
      .text(`${d.startDate} to ${d.endDate}  ·  ${d.dayCount} day${d.dayCount === 1 ? '' : 's'}  ·  Countries: ${d.countries.join(', ')}`)
      .text(`Visibility: ${d.visibility}`)
      .text(
        `Estimated budget: ${money(d.budget.total, currency)}` +
          (d.budget.rateDate ? `  (exchange rates of ${d.budget.rateDate})` : ''),
      );
    doc.fillColor('black');

    // ---- City groups ----
    if (d.groups.length) {
      heading('Route');
      for (const g of d.groups) {
        doc.text(
          `Days ${g.firstDay}${g.lastDay !== g.firstDay ? `-${g.lastDay}` : ''}: ${g.cityName}` +
            `  (${g.dayCount} day${g.dayCount === 1 ? '' : 's'}, ${g.startDate} to ${g.endDate})` +
            `  subtotal ${money(g.subtotal, currency)}`,
        );
      }
    }

    // ---- Days ----
    heading('Day by day');
    if (!d.days.length) doc.text('No days planned yet.');
    for (const day of d.days) {
      rule();
      doc.fontSize(12).text(`Day ${day.dayNumber}  ·  ${day.date}  ·  ${day.cityName}`, { continued: false });
      doc.fontSize(10);
      if (day.notes) doc.fillColor('#444').text(day.notes).fillColor('black');
      for (const a of day.activities) {
        const cost = a.cost !== null && a.currency ? `  ·  ${a.cost.toFixed(2)} ${a.currency}` : '';
        doc.text(`• ${a.time ? `${a.time}  ` : ''}${a.name}${cost}`, { indent: 10 });
        if (a.description) doc.fillColor('#555').text(a.description, { indent: 22 }).fillColor('black');
      }
      for (const b of day.budgets) {
        doc.text(
          `Budget: ${CATEGORY_LABELS[b.category] ?? b.category} ${b.amount.toFixed(2)} ${b.currency}${b.note ? ` (${b.note})` : ''}`,
          { indent: 10 },
        );
      }
      for (const t of d.transportCosts.filter((x) => x.dayNumber === day.dayNumber)) {
        doc.text(
          `Transport: ${t.mode} ${t.fromCity} to ${t.toCity}  ${t.amount.toFixed(2)} ${t.currency}${t.note ? ` (${t.note})` : ''}`,
          { indent: 10 },
        );
      }
      for (const bk of bookings.filter((b) => b.booking && b.dayNumbers.includes(day.dayNumber))) {
        doc.text(`Booking ${bk.booking!.reference}: ${bk.booking!.title} (${bk.booking!.status})`, { indent: 10 });
      }
      doc.text(`Day total: ${money(day.total, currency)}`, { indent: 10 });
    }

    // ---- Budget summary ----
    if (summary) {
      heading(`Budget summary (${summary.currency})`);
      for (const [cat, amount] of Object.entries(summary.byCategory)) {
        doc.text(`${CATEGORY_LABELS[cat] ?? cat}: ${money(amount as number, summary.currency)}`);
      }
      doc.moveDown(0.2).fontSize(11).text(`Total: ${money(summary.total, summary.currency)}`).fontSize(10);
      if (summary.rateDate) doc.fillColor('#666').text(`Converted with the exchange rates of ${summary.rateDate}.`).fillColor('black');
    }

    // ---- Attached bookings (owner only) ----
    if (bookings.length) {
      heading('My bookings');
      for (const b of bookings) {
        if (!b.booking) {
          doc.text(`${b.bookingType} booking (no longer available)`);
          continue;
        }
        doc.text(
          `${b.bookingType === 'flight' ? 'Flight' : 'Hotel'} ${b.booking.reference}: ${b.booking.title}, ` +
            `${b.booking.startDate}${b.booking.endDate !== b.booking.startDate ? ` to ${b.booking.endDate}` : ''}, ` +
            `${b.booking.totalAmount.toFixed(2)} ${b.booking.currency}, ${b.booking.status}`,
        );
      }
    }

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor('#888').text(`Generated ${data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    doc.end();
  });
}
