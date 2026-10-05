import { Injectable } from '@angular/core';
import type { jsPDF } from 'jspdf';
import { PaymentHistoryEntry } from '../models/payment-history.model';

export type PaymentReceipt = PaymentHistoryEntry & { clientPhone?: string };

@Injectable({ providedIn: 'root' })
export class PaymentReceiptService {
  private async createPdf(receipt: PaymentReceipt): Promise<jsPDF> {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const left = 20;
    const right = 190;
    let y = 24;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text('COMOSAN PREST', left, y);
    y += 9;
    pdf.setFontSize(15);
    pdf.text('COMPROBANTE DE PAGO', left, y);
    y += 10;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Recibo: CP-${receipt.id.toUpperCase()}`, left, y);
    y += 6;
    pdf.text(`Fecha: ${receipt.collectedAt.toLocaleString('es-DO')}`, left, y);
    y += 12;
    pdf.setDrawColor(180);
    pdf.line(left, y, right, y);
    y += 10;

    const lines: [string, string][] = [
      ['Cliente', receipt.clientName],
      ['Telefono', receipt.clientPhone || 'No registrado'],
      ['Prestamo', receipt.loanId],
      ['Movimiento', this.paymentTypeLabel(receipt)],
      ['Metodo de pago', this.paymentMethodLabel(receipt.paymentMethod, receipt.type)],
      ['Registrado por', `${receipt.collectedBy} (${receipt.collectorRole === 'cashier' ? 'Cajero' : 'Administrador'})`]
    ];
    if (receipt.installmentNumber !== undefined) lines.push(['Cuota', String(receipt.installmentNumber)]);
    if (receipt.loanAmount !== undefined) lines.push(['Monto original del prestamo', this.formatAmount(receipt.loanAmount)]);
    if (receipt.installmentAmount !== undefined) lines.push(['Monto de la cuota', this.formatAmount(receipt.installmentAmount)]);
    if (receipt.balanceRemaining !== undefined) {
      lines.push(['Saldo pendiente de la cuota/capital', this.formatAmount(receipt.balanceRemaining)]);
    }

    for (const [label, value] of lines) {
      pdf.setFont('helvetica', 'bold');
      pdf.text(label, left, y);
      pdf.setFont('helvetica', 'normal');
      const wrapped = pdf.splitTextToSize(value, 92);
      pdf.text(wrapped, 82, y);
      y += Math.max(7, wrapped.length * 5);
    }

    y += 3;
    pdf.line(left, y, right, y);
    y += 11;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text(`TOTAL RECIBIDO: ${this.formatAmount(receipt.amount)}`, left, y);
    y += 13;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Comprobante informativo de pago. No es una factura fiscal.', left, y);
    pdf.text(`Referencia: ${receipt.id}`, left, y + 6);

    return pdf;
  }

  async download(receipt: PaymentReceipt): Promise<void> {
    const pdf = await this.createPdf(receipt);
    pdf.save(this.fileName(receipt));
  }

  async share(receipt: PaymentReceipt): Promise<boolean> {
    const pdf = await this.createPdf(receipt);
    const file = new File([pdf.output('blob')], this.fileName(receipt), { type: 'application/pdf' });
    const text = this.whatsappText(receipt);

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({
        files: [file],
        title: `Comprobante CP-${receipt.id.toUpperCase()}`,
        text
      });
      return true;
    }

    await this.download(receipt);
    const phone = this.whatsappPhone(receipt.clientPhone);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return false;
  }

  private fileName(receipt: PaymentReceipt): string {
    return `comprobante-CP-${receipt.id}.pdf`;
  }

  private paymentTypeLabel(receipt: PaymentReceipt): string {
    if (receipt.type === 'capital') return 'Abono a capital';
    if (receipt.type === 'reversal') return 'Anulacion de cobro';
    return 'Pago de cuota';
  }

  private paymentMethodLabel(method: PaymentReceipt['paymentMethod'], type: PaymentReceipt['type']): string {
    if (type === 'reversal') return 'No aplica';
    return {
      cash: 'Efectivo',
      transfer: 'Transferencia',
      card: 'Tarjeta',
      other: 'Otro'
    }[method || 'cash'];
  }

  private whatsappText(receipt: PaymentReceipt): string {
    return [
      'COMOSAN PREST - Comprobante de pago',
      `Recibo: CP-${receipt.id.toUpperCase()}`,
      `Cliente: ${receipt.clientName}`,
      `Prestamo: ${receipt.loanId}`,
      receipt.installmentNumber !== undefined ? `Cuota: ${receipt.installmentNumber}` : '',
      `Monto recibido: ${this.formatAmount(receipt.amount)}`,
      `Metodo de pago: ${this.paymentMethodLabel(receipt.paymentMethod, receipt.type)}`,
      `Fecha: ${receipt.collectedAt.toLocaleString('es-DO')}`,
      `Registrado por: ${receipt.collectedBy}`
    ].filter(Boolean).join('\n');
  }

  private whatsappPhone(phone?: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10 && /^(809|829|849)/.test(digits)) return `1${digits}`;
    return digits;
  }

  private formatAmount(amount: number): string {
    return `$${amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
