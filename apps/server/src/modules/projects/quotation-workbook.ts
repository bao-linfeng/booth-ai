import ExcelJS from 'exceljs';
import { DEFAULT_MESSAGE_LOCALE, type MessageLocale } from '../selection/messages/index.js';
import { projectError } from './domain.js';
import type { SavedQuotation } from './quotation.js';
import { quotationWorkbookMessages } from './quotation-workbook-messages.js';

/** 后台导出用默认语言；报价邮件附件传客户语言 */
export async function quotationWorkbook(
  project: { projectNo: string; schemeCode: string | null; contact: { name: string; email?: string; phone?: string }; company?: string },
  quotation: SavedQuotation,
  locale: MessageLocale = DEFAULT_MESSAGE_LOCALE,
): Promise<Buffer> {
  if (quotation.completeness !== 'ready') throw projectError('QUOTATION_INCOMPLETE');
  const m = quotationWorkbookMessages[locale] ?? quotationWorkbookMessages[DEFAULT_MESSAGE_LOCALE];
  const c = m.columns;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(m.sheet, { views: [{ rightToLeft: locale === 'ar' }] });
  for (const row of [
    [m.quotationNo, quotation.quotationNo],
    [m.revision, String(quotation.revision)],
    [m.projectNo, project.projectNo],
    [m.schemeCode, project.schemeCode ?? ''],
    [m.company, project.company ?? ''],
    [m.contact, project.contact.name],
    [m.email, project.contact.email ?? ''],
    [m.phone, project.contact.phone ?? ''],
    [m.currency, quotation.currency],
    [m.priceBasis, m.priceBases[quotation.priceBasis]],
    [m.validUntil, quotation.validUntil],
    [m.validityTimeZone, quotation.validityTimeZone],
    [m.rounding, m.roundingValue.replace('{scale}', String(quotation.currencyScale))],
    [],
    [c.kind, c.name, c.model, c.specification, c.quantity, c.pricingUnit, c.unitPrice, c.lineAmount, c.erpCode, c.notes],
  ])
    sheet.addRow(row);
  for (const item of quotation.items)
    sheet.addRow([
      m.kinds[item.kind] ?? item.kind,
      item.name,
      item.model ?? '',
      item.specificationMm ?? '',
      item.quantity,
      item.pricingUnit,
      item.unitPrice,
      item.lineAmount,
      item.erpCode ?? '',
      item.notes ?? '',
    ]);
  sheet.addRow([m.total, quotation.totalAmount]);
  sheet.addRow([m.inclusions, quotation.inclusions]);
  sheet.addRow([m.exclusions, quotation.exclusions]);
  sheet.addRow([m.terms, quotation.terms]);
  sheet.eachRow(row =>
    row.eachCell(cell => {
      cell.numFmt = '@';
      cell.alignment = { vertical: 'top', wrapText: true };
    }),
  );
  sheet.columns.forEach((column, index) => {
    column.width = index === 1 ? 38 : index === 3 ? 28 : 18;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
