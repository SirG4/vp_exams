import ExcelJS from 'exceljs';

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Exam Portal';
  workbook.description = 'Template for one institution/date/session exam batch';

  const sheet = workbook.addWorksheet('Exam Batch');
  const headers = ['institution', 'date', 'session', 'roomNumber', 'roomLabel', 'imageFilename'];
  sheet.addRow(headers);

  sheet.addRow(['VP', '2026-11-17', 'morning', 'V002', 'Block V · Room V002', 'V002.JPG']);
  sheet.getRow(1).font = { bold: true, color: { type: 'rgb', argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { type: 'rgb', argb: 'FF1F2937' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = 'A1:F1';

  headers.forEach((header, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = [16, 14, 14, 18, 38, 28][index];
  });

  const institution = sheet.getColumn(1);
  institution.dataValidation = { type: 'list', allowBlank: false, formulae: ['"VIT,VP,VSIT"'] };

  const date = sheet.getColumn(2);
  date.numFmt = '@';
  date.dataValidation = { type: 'custom', allowBlank: false, formula1: '=AND(LEN(B2)=10,MID(B2,5,1)=\"-\",MID(B2,8,1)=\"-\")' };

  const session = sheet.getColumn(3);
  session.dataValidation = { type: 'list', allowBlank: false, formulae: ['"morning,afternoon"'] };

  await workbook.xlsx.writeFile('public/templates/exam-batch-template.xlsx');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
