import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

async function makePdf({ pages, author, lineLengths, name }) {
  const doc = await PDFDocument.create();
  if (author !== null) doc.setAuthor(author);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    for (let row = 0; row < (lineLengths[i] ?? 30); row++) {
      p.drawText(`Page ${i + 1} line ${row + 1} lorem ipsum dolor sit amet.`,
        { x: 50, y: 750 - row * 16, size: 11, font });
    }
  }
  writeFileSync(`tests/fixtures/${name}`, await doc.save());
}
await makePdf({ pages: 8, author: 'Sample Author', lineLengths: [], name: 'sample.pdf' });
await makePdf({ pages: 8, author: null,            lineLengths: [], name: 'sample-no-author.pdf' });
await makePdf({ pages: 2, author: 'Sample Author',
  lineLengths: [40, 40], name: 'cross-page.pdf' });
