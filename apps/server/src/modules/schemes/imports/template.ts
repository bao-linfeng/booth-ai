import ExcelJS from 'exceljs';
import type pg from 'pg';
import { importDictionaries } from './validation.js';
import { importColumns, maxImportRows } from './workbook.js';

const fixedOptions: Partial<Record<(typeof importColumns)[number]['key'], string[]>> = {
  openingCount: ['1面', '2面', '3面', '4面', '岛式'],
  verificationStatus: ['待核验', '已核验', '核验失败'],
};

const singleChoiceKeys = new Set<string>(['openingCount', 'productSystemId', 'styleId', 'budgetTierId']);

function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 生成与当前解析规则一致的导入模板：数据表头、启用字典项（下拉选项）及逐列填写说明。 */
export async function buildImportTemplate(pool: pg.Pool): Promise<Buffer> {
  const items = await pool.query<{ dictionaryCode: string; label: string }>(`
    SELECT d.code AS "dictionaryCode", i.item_label AS label
    FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
    WHERE d.code = ANY($1::text[]) AND d.enabled AND i.enabled
    ORDER BY i.sort_order, i.item_label`, [Object.values(importDictionaries)]);
  const options = importColumns.flatMap(column => {
    const dictionary = (importDictionaries as Record<string, string>)[column.key];
    const values = dictionary ? items.rows.filter(item => item.dictionaryCode === dictionary).map(item => item.label) : fixedOptions[column.key];
    return values ? [{ column, values }] : [];
  });

  const workbook = new ExcelJS.Workbook();
  const data = workbook.addWorksheet('方案打标', { views: [{ state: 'frozen', ySplit: 1 }] });
  data.addRow(importColumns.map(column => column.header)).font = { bold: true };
  importColumns.forEach((_column, index) => { data.getColumn(index + 1).width = index === 0 ? 6 : 14; });

  const optionSheet = workbook.addWorksheet('下拉选项');
  options.forEach(({ column, values }, index) => {
    const sheetColumn = optionSheet.getColumn(index + 1);
    sheetColumn.values = [column.header, ...values];
    sheetColumn.width = 16;
    if (!singleChoiceKeys.has(column.key) || values.length === 0) return;
    // 多选列允许逗号分隔，不能用单值下拉约束，只对单选列设置下拉
    const dataIndex = importColumns.indexOf(column);
    const validation: ExcelJS.DataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: [`'下拉选项'!$${columnLetter(index)}$2:$${columnLetter(index)}$${values.length + 1}`],
    };
    for (let row = 2; row <= maxImportRows + 1; row += 1) data.getCell(row, dataIndex + 1).dataValidation = validation;
  });
  optionSheet.getRow(1).font = { bold: true };

  const notes = workbook.addWorksheet('填写说明');
  notes.addRow(['列', '字段名', '填写说明']).font = { bold: true };
  importColumns.forEach((column, index) => notes.addRow([columnLetter(index), column.header, column.note]));
  notes.addRow([]);
  notes.addRow(['', '通用', `第 1 行为表头，请勿修改或调整列顺序；可复制“方案打标”工作表分多个数据表填写，名称含“说明”“选项”的工作表不导入；单次最多 ${maxImportRows} 行。`]);
  [6, 16, 80].forEach((width, index) => { notes.getColumn(index + 1).width = width; });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
