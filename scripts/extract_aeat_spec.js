
import XLSX from 'xlsx';
import path from 'path';

const files = [
    { name: 'Modelo 303', path: 'C:/Users/benja/Downloads/DR303e26v101.xlsx' },
    { name: 'Modelo 130', path: 'C:/Users/benja/Downloads/DR130e15v12.xls' },
    { name: 'Modelo 111', path: 'C:/Users/benja/Downloads/dr111e16v18.xls' }
];

files.forEach(f => {
    console.log(`\n\n====================================================`);
    console.log(`ANALIZANDO: ${f.name} (${path.basename(f.path)})`);
    console.log(`====================================================`);
    try {
        const workbook = XLSX.readFile(f.path);
        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            let capturing = false;
            let capturedRows = 0;

            console.log(`\n--- Hoja: ${sheetName} ---`);

            data.forEach((row, idx) => {
                const rowStr = row.join(' | ').toUpperCase();

                // Si encontramos una fila que parece cabecera de tabla de especificaciones
                if (rowStr.includes('POSICIÓN') && (rowStr.includes('LONGITUD') || rowStr.includes('NATURALEZA') || rowStr.includes('DESCRIPCIÓN'))) {
                    console.log(`\n[TABLA ENCONTRADA EN FILA ${idx}]: ${rowStr}`);
                    capturing = true;
                    capturedRows = 0;
                }

                if (capturing) {
                    // Si la fila tiene datos (el primer campo suele ser la posición decimal)
                    if (row.length > 1 && (typeof row[0] === 'number' || !isNaN(parseInt(row[0])))) {
                        console.log(`${idx}: ${row.join(' | ')}`);
                        capturedRows++;
                    } else if (capturedRows > 0) {
                        // Si ya hemos capturado datos y encontramos una fila vacía o sin números, paramos
                        // capturing = false; 
                    }

                    // Limite de seguridad por hoja
                    if (capturedRows > 200) capturing = false;
                }
            });
        });
    } catch (e) {
        console.error(`Error leyendo ${f.path}:`, e.message);
    }
});
