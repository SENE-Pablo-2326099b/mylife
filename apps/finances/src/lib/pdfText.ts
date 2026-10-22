/**
 * Texte d'un PDF, page par page, extrait dans le navigateur (pdf.js) : le fichier ne quitte
 * jamais l'appareil. pdf.js n'est chargé qu'à la première utilisation (≈ 1 Mo, mis en cache).
 */
export async function pdfPages(file: Blob): Promise<string[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join(''));
    }
    return pages;
  } finally {
    void doc.destroy();
  }
}
