import ExcelJS from 'exceljs';
import { projectError } from './domain.js';
import type { SavedQuotation } from './quotation.js';

export async function quotationWorkbook(project: { projectNo: string; schemeCode: string | null; contact: { name: string; email?: string; phone?: string }; company?: string }, quotation: SavedQuotation): Promise<Buffer> {
  if (quotation.completeness!=='ready') throw projectError('QUOTATION_INCOMPLETE');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('报价单');
  for (const row of [
    ['报价编号',quotation.quotationNo],['修订',String(quotation.revision)],['项目编号',project.projectNo],['方案编号',project.schemeCode ?? ''],
    ['客户',project.company ?? ''],['联系人',project.contact.name],['邮箱',project.contact.email ?? ''],['电话',project.contact.phone ?? ''],
    ['币种',quotation.currency],['税费口径',{included:'含税',excluded:'不含税',not_applicable:'不适用'}[quotation.priceBasis]],
    ['有效期',quotation.validUntil],['有效期时区',quotation.validityTimeZone],['舍入',`HALF_UP / ${quotation.currencyScale} 位`],
    [],['类别','名称','型号','规格/mm','数量','计价单位','单价','行金额','ERP编码','备注'],
  ]) sheet.addRow(row);
  for (const item of quotation.items) sheet.addRow([item.kind,item.name,item.model ?? '',item.specificationMm ?? '',item.quantity,item.pricingUnit,item.unitPrice,item.lineAmount,item.erpCode ?? '',item.notes ?? '']);
  sheet.addRow(['合计',quotation.totalAmount]);
  sheet.addRow(['包含范围',quotation.inclusions]); sheet.addRow(['不包含范围',quotation.exclusions]); sheet.addRow(['客户条款',quotation.terms]);
  sheet.eachRow(row=>row.eachCell(cell=>{cell.numFmt='@';cell.alignment={vertical:'top',wrapText:true};}));
  sheet.columns.forEach((column,index)=>{column.width=index===1?38:index===3?28:18;});
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
