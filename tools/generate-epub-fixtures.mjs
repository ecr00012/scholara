import { EPub } from 'epub-gen-memory';
import { writeFileSync } from 'node:fs';

async function makeEpub({ withCover, name }) {
  const opts = {
    title: 'Sample Book',
    author: 'Sample Author',
    ...(withCover ? { cover: 'https://placehold.co/600x900/cdd/000.png' } : {}),
  };
  const content = Array.from({ length: 6 }, (_, i) => ({
    title: `Chapter ${i + 1}`,
    content: `<p>${'Lorem ipsum dolor sit amet. '.repeat(40)}</p>`,
  }));
  const buf = await new EPub(opts, content).genEpub();
  writeFileSync(`tests/fixtures/${name}`, buf);
}
await makeEpub({ withCover: true,  name: 'sample.epub' });
await makeEpub({ withCover: false, name: 'sample-no-cover.epub' });
