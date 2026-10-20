// Invoices: after a job (completed, or closed after the paid visit) the customer can download a proper invoice PDF.
// It is numbered once, in order (HFI/2026-27/000123), and never renumbered. Download goes through a short-lived
// signed link (the app opens it in the phone's browser, which can save or share the PDF); HQ downloads it from the
// portal. The PDF uses Housefi's font (Anek Latin, with the ₹ sign).
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { digestsEqual, Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { UUID } from '../bookings/booking-core';
import { approvedQuotes } from '../bookings/quote-view';

// pdfkit is CommonJS; required here so the API's TypeScript settings need no interop flag.
const PDFDocument = createRequire(__filename)('pdfkit') as typeof import('pdfkit');

const FONTS = join(__dirname, '..', '..', '..', 'assets', 'fonts');
const LINK_MS = 15 * 60_000;
const INVOICED: readonly string[] = ['COMPLETED', 'CLOSED_NO_REPAIR'];

export interface InvoiceLine {
  readonly label: string;
  readonly detail: string;
  readonly qty: number;
  readonly unit: number;
  readonly amount: number;
}

export interface InvoiceData {
  readonly number: string;
  readonly issuedAt: number;
  readonly seller: { readonly name: string; readonly address: string; readonly gstin: string | null };
  readonly customer: { readonly name: string; readonly address: string };
  readonly booking: { readonly code: string; readonly service: string; readonly technician: string; readonly technicianId: string; readonly doneAt: number | null };
  readonly lines: readonly InvoiceLine[];
  readonly subtotal: number;
  readonly discount: { readonly code: string; readonly amount: number } | null;
  readonly total: number;
  readonly payments: readonly { readonly what: string; readonly method: string; readonly ref: string | null; readonly at: number | null; readonly amount: number }[];
  readonly paid: number;
  readonly warrantyUntil: number | null;
}

const rupees = (paise: bigint) => Math.round(Number(paise)) / 100;
const money = (r: number) => `₹${r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** "2026-27": April to March (India's financial year), in India time. */
export function financialYear(ms: number): string {
  const ist = new Date(ms + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly hashing: Hashing,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** A download link for the customer's own invoiced booking: the path to add to the API's base, valid 15 minutes. */
  async link(customerId: string, bookingId: string): Promise<{ path: string; expiresAt: number }> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, customerId }, select: { id: true, status: true } });
    if (!b) throw new AppError('NOT_FOUND');
    if (!INVOICED.includes(b.status)) throw new AppError('CONFLICT', {}, 'the invoice is ready once the job is done');
    await this.ensure(b.id);
    const expiresAt = this.clock.now() + LINK_MS;
    const sig = Buffer.from(this.hashing.invoiceLink(b.id, expiresAt)).toString('base64url');
    return { path: `/invoices/${b.id}.${expiresAt}.${sig}`, expiresAt };
  }

  /** The PDF behind a signed link (NOT_FOUND for anything wrong or expired: nothing to learn from guessing). */
  async pdfForLink(token: string): Promise<{ pdf: Buffer; filename: string }> {
    const m = /^([0-9a-f-]{36})\.(\d{10,16})\.([A-Za-z0-9_-]{20,})$/.exec(token);
    if (!m) throw new AppError('NOT_FOUND');
    const [, id, exp, sig] = m as unknown as [string, string, string, string];
    const expiresAt = Number(exp);
    const expected = this.hashing.invoiceLink(id, expiresAt);
    if (expiresAt < this.clock.now() || !digestsEqual(new Uint8Array(Buffer.from(sig, 'base64url')), expected)) throw new AppError('NOT_FOUND');
    return this.pdf(id);
  }

  /** The PDF for any invoiced booking (Housefi HQ). */
  async pdf(bookingId: string): Promise<{ pdf: Buffer; filename: string }> {
    const data = await this.data(bookingId);
    return { pdf: await render(data), filename: `Housefi-invoice-${data.number.replace(/\//g, '-')}.pdf` };
  }

  /** Everything printed on the invoice (also used by tests and the portal). */
  async data(bookingId: string): Promise<InvoiceData> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const invoice = await this.ensure(bookingId);
    const b = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        service: true,
        customer: { select: { nameEnc: true } },
        technician: { select: { techCode: true, user: { select: { nameEnc: true } } } },
        quotes: { include: { lines: { orderBy: { sort: 'asc' } } } },
        payments: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { at: 'desc' } },
      },
    });
    const name = async (enc: Uint8Array | null | undefined) => (enc ? await this.cipher.decrypt('users.name', enc) : '');
    let address = '';
    if (b.addressSnapshotEnc.length) {
      const a = JSON.parse(await this.cipher.decrypt('bookings.address', b.addressSnapshotEnc)) as { house?: string; street?: string; landmark?: string; city?: string; pincode?: string };
      address = [a.house, a.street, a.landmark, `${a.city ?? ''} ${a.pincode ?? ''}`.trim()].filter((x) => x && x.trim()).join(', ');
    }
    const visit = b.payments.filter((p) => p.kind === 'VISIT' && (p.state === 'PAID' || p.state === 'REFUNDED')).at(-1);
    const final = b.payments.filter((p) => p.kind === 'FINAL' && p.state === 'PAID').at(-1);
    const lines: InvoiceLine[] = [];
    if (visit) {
      const waived = visit.provider === 'WAIVED';
      lines.push({ label: 'Visit and inspection fee', detail: waived ? 'Paid by Housefi' : '', qty: 1, unit: rupees(visit.amountPaise), amount: waived ? 0 : rupees(visit.amountPaise) });
    }
    if (b.status === 'COMPLETED') {
      for (const q of approvedQuotes(b.quotes)) {
        for (const l of q.lines) {
          lines.push({ label: l.name, detail: `${q.which === 'EXTRA' ? 'Extra work · ' : ''}${l.kind === 'LABOUR' ? 'Labour' : 'Materials'}`, qty: l.qty, unit: rupees(l.unitPaise), amount: rupees(l.unitPaise * BigInt(l.qty)) });
        }
      }
    }
    const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const discount = final && final.discountPaise > 0n ? { code: final.couponCode ?? 'COUPON', amount: rupees(final.discountPaise) } : null;
    const total = Math.round((subtotal - (discount?.amount ?? 0)) * 100) / 100;
    const method = (m: string | null, provider: string | null) => (provider === 'WAIVED' ? 'Waived' : m === 'UPI' ? 'UPI' : m === 'CARD' ? 'Card' : m === 'NETBANKING' ? 'Net banking' : m === 'CASH' ? 'Cash' : provider === 'SIMULATED' ? 'Demo' : 'Online');
    const payments = [
      ...(visit && visit.provider !== 'WAIVED' ? [{ what: 'Visit fee', method: method(visit.method, visit.provider), ref: visit.providerPaymentId, at: visit.settledAt?.getTime() ?? null, amount: rupees(visit.amountPaise) }] : []),
      ...(final ? [{ what: 'Repair bill', method: method(final.method, final.provider), ref: final.providerPaymentId, at: final.settledAt?.getTime() ?? null, amount: rupees(final.amountPaise) }] : []),
    ];
    const doneAt = b.events.find((e) => e.status === b.status)?.at.getTime() ?? null;
    return {
      number: invoice.number,
      issuedAt: invoice.issuedAt.getTime(),
      seller: { name: this.config.INVOICE_SELLER_NAME, address: this.config.INVOICE_SELLER_ADDRESS, gstin: this.config.INVOICE_GSTIN ?? null },
      customer: { name: (await name(b.customer.nameEnc)) || 'Customer', address },
      booking: { code: b.code, service: b.service.nameEn, technician: await name(b.technician?.user.nameEnc), technicianId: b.technician?.techCode ?? '', doneAt },
      lines,
      subtotal,
      discount,
      total,
      payments,
      paid: Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      warrantyUntil: b.status === 'COMPLETED' && doneAt ? doneAt + 15 * 86_400_000 : null,
    };
  }

  /** The booking's invoice row, made the first time (number from the next sequence value, in this financial year). */
  private async ensure(bookingId: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { bookingId } });
    if (existing) return existing;
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
    if (!b) throw new AppError('NOT_FOUND');
    if (!INVOICED.includes(b.status)) throw new AppError('CONFLICT', {}, 'the invoice is ready once the job is done');
    const now = new Date(this.clock.now());
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.invoice.create({ data: { bookingId, number: `pending-${bookingId}`, issuedAt: now } });
        return tx.invoice.update({ where: { id: row.id }, data: { number: `HFI/${financialYear(now.getTime())}/${String(row.seq).padStart(6, '0')}` } });
      });
    } catch (e) {
      // Two downloads at once: the other one numbered it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.prisma.invoice.findUniqueOrThrow({ where: { bookingId } });
      throw e;
    }
  }
}

/** The invoice as an A4 PDF. */
export function render(d: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${d.number}`, Author: d.seller.name, Subject: `Booking ${d.booking.code}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', join(FONTS, 'AnekLatin_400Regular.ttf'));
    doc.registerFont('b', join(FONTS, 'AnekLatin_700Bold.ttf'));
    const W = doc.page.width - 96;
    const L = 48;
    const blue = '#0A3CF5';
    const ink = '#0F1A33';
    const muted = '#5C6782';
    const line = '#E3E8F2';

    // Header band.
    doc.rect(0, 0, doc.page.width, 110).fill(blue);
    doc.fillColor('#FFFFFF').font('b').fontSize(26).text(d.seller.name, L, 34);
    doc.font('r').fontSize(10).fillColor('#DBE5FF').text('Home services · housefi.tech', L, 66);
    doc.font('b').fontSize(20).fillColor('#FFFFFF').text(d.seller.gstin ? 'TAX INVOICE' : 'INVOICE', L, 36, { width: W, align: 'right' });
    doc.font('r').fontSize(10).fillColor('#DBE5FF').text(d.number, L, 62, { width: W, align: 'right' });
    doc.text(`Issued ${date(d.issuedAt)}`, L, 76, { width: W, align: 'right' });

    // From / to.
    let y = 136;
    const col = (title: string, body: string[], x: number, w: number) => {
      doc.font('b').fontSize(9).fillColor(muted).text(title.toUpperCase(), x, y, { width: w, characterSpacing: 1 });
      doc.font('r').fontSize(11).fillColor(ink).text(body.filter(Boolean).join('\n'), x, y + 16, { width: w, lineGap: 2 });
    };
    col('From', [d.seller.name, d.seller.address, d.seller.gstin ? `GSTIN ${d.seller.gstin}` : 'Not registered under GST'], L, W / 2 - 12);
    col('Bill to', [d.customer.name, d.customer.address], L + W / 2 + 12, W / 2 - 12);
    y += 96;

    // Booking facts.
    doc.roundedRect(L, y, W, 54, 8).fill('#F4F6FB');
    const fact = (label: string, value: string, x: number) => {
      doc.font('r').fontSize(8.5).fillColor(muted).text(label.toUpperCase(), x, y + 11, { characterSpacing: 0.8 });
      doc.font('b').fontSize(11).fillColor(ink).text(value || '–', x, y + 25, { width: W / 4 - 12 });
    };
    fact('Booking', d.booking.code, L + 14);
    fact('Service', d.booking.service, L + 14 + W / 4);
    fact('Technician', d.booking.technician ? `${d.booking.technician}${d.booking.technicianId ? ` · ${d.booking.technicianId}` : ''}` : '–', L + 14 + W / 2);
    fact('Done on', d.booking.doneAt ? date(d.booking.doneAt) : '–', L + 14 + (3 * W) / 4);
    y += 76;

    // Lines.
    const cols = [L, L + W * 0.52, L + W * 0.64, L + W * 0.8];
    doc.font('b').fontSize(9).fillColor(muted);
    doc.text('DESCRIPTION', cols[0], y).text('QTY', cols[1], y, { width: W * 0.1, align: 'right' }).text('RATE', cols[2], y, { width: W * 0.14, align: 'right' }).text('AMOUNT', cols[3], y, { width: W * 0.2, align: 'right' });
    y += 16;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(line).lineWidth(1).stroke();
    y += 8;
    for (const l of d.lines) {
      doc.font('r').fontSize(11).fillColor(ink).text(l.label, cols[0], y, { width: W * 0.5 });
      const h = doc.heightOfString(l.label, { width: W * 0.5 });
      if (l.detail) doc.fontSize(9).fillColor(muted).text(l.detail, cols[0], y + h + 1, { width: W * 0.5 });
      doc.fontSize(11).fillColor(ink).text(String(l.qty), cols[1], y, { width: W * 0.1, align: 'right' }).text(money(l.unit), cols[2], y, { width: W * 0.14, align: 'right' }).text(money(l.amount), cols[3], y, { width: W * 0.2, align: 'right' });
      y += h + (l.detail ? 16 : 8) + 6;
      doc.moveTo(L, y - 4).lineTo(L + W, y - 4).strokeColor(line).lineWidth(0.5).stroke();
    }

    // Totals.
    y += 6;
    const total = (label: string, value: string, bold = false, color = ink) => {
      doc.font(bold ? 'b' : 'r').fontSize(bold ? 13 : 11).fillColor(color).text(label, L + W * 0.5, y, { width: W * 0.28, align: 'right' }).text(value, cols[3], y, { width: W * 0.2, align: 'right' });
      y += bold ? 22 : 18;
    };
    total('Subtotal', money(d.subtotal));
    if (d.discount) total(`Coupon ${d.discount.code}`, `– ${money(d.discount.amount)}`, false, '#11924F');
    doc.moveTo(L + W * 0.5, y).lineTo(L + W, y).strokeColor(ink).lineWidth(1).stroke();
    y += 8;
    total('Total', money(d.total), true);
    total('Paid', money(d.paid), false, '#11924F');
    y += 10;

    // Payments.
    if (d.payments.length) {
      doc.font('b').fontSize(9).fillColor(muted).text('PAYMENTS', L, y, { characterSpacing: 1 });
      y += 16;
      for (const p of d.payments) {
        doc.font('r').fontSize(10).fillColor(ink).text(`${p.what} · ${p.method}${p.ref ? ` · ref ${p.ref}` : ''}${p.at ? ` · ${date(p.at)}` : ''}`, L, y, { width: W * 0.75 });
        doc.text(money(p.amount), cols[3], y, { width: W * 0.2, align: 'right' });
        y += 16;
      }
    }

    // Warranty and footer.
    if (d.warrantyUntil) {
      y += 12;
      doc.roundedRect(L, y, W, 40, 8).fill('#EAF8F0');
      doc.font('b').fontSize(10.5).fillColor('#0D6B3A').text(`Repair warranty until ${date(d.warrantyUntil)}`, L + 14, y + 8);
      doc.font('r').fontSize(9.5).text('Same problem back? Open the booking in the Housefi app and tap "Not fixed? Free revisit".', L + 14, y + 22, { width: W - 28 });
    }
    doc.font('r').fontSize(8.5).fillColor(muted).text(
      `This is a computer-generated invoice and needs no signature. Questions: Help in the Housefi app. ${d.seller.gstin ? '' : 'Prices include all charges; no GST is charged.'}`,
      L, doc.page.height - 70, { width: W, align: 'center' },
    );
    doc.end();
  });
}
