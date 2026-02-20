
import XLSX from 'xlsx';
import fs from 'fs';

const files = [
    { name: 'M303', path: 'C:/Users/benja/Downloads/DR303e26v101.xlsx' },
    { name: 'M130', path: 'C:/Users/benja/Downloads/DR130e15v12.xls' },
    { name: 'M111', path: 'C:/Users/benja/Downloads/dr111e16v18.xls' }
];

files.forEach(f => {
    try {
        const workbook = XLSX.readFile(f.path);
        let allText = `ESPECIFICACIONES ${f.name}\n\n`;

        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            allText += `\n--- HOJA: ${sheetName} ---\n`;

            data.forEach(row => {
                const cleanRow = row.map(cell => String(cell || '').replace(/\r?\n/g, ' ')).join(' | ');
                if (cleanRow.trim().length > 0) {
                    allText += cleanRow + '\n';
                }
            });
        });

        fs.writeFileSync(`./${f.name}_spec.txt`, allText);
        console.log(`Guardado ${f.name}_spec.txt`);
    } catch (e) {
        console.error(`Error procesando ${f.name}: ${e.message}`);
    }
});
