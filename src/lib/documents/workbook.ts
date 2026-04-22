import ExcelJS from "exceljs";

export async function buildWorkbookBuffer(
  sheets: Array<{ name: string; rows: object[]; columnLabels?: Record<string, string> }>,
) {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sanitizeSheetName(sheet.name));
    const columns = Array.from(
      new Set(sheet.rows.flatMap((row) => Object.keys(row))),
    );

    worksheet.columns = columns.map((column) => ({
      header: sheet.columnLabels?.[column] ?? column,
      key: column,
      width: 22,
    }));

    for (const row of sheet.rows) {
      worksheet.addRow(row as Record<string, unknown>);
    }

    worksheet.getRow(1).font = { bold: true };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function sanitizeSheetName(name: string) {
  return name.slice(0, 31).replace(/[\\/*?:[\]]/g, "_");
}
