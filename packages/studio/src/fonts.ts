// The stylesheets for the studio's typefaces. They come from Google Fonts until the faces are
// self-hosted (issue 23). An app that mounts the studio links the first one in its document and
// calls showMoreFaces() (more-faces.ts) once the studio is on screen. Constants only: a
// server or a build script reads these without a DOM.

/** The studio's own face, and the default face of a page. Linked by the document, ahead of first paint. */
export const FIRST_FACES_HREF = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Shantell+Sans:wght@400;600;800&display=swap";

/** The other curated faces. Only the Typeface cards preview them, so they must not hold up first paint. */
export const MORE_FACES_HREF = "https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Patrick+Hand&family=Kalam:wght@400;700&family=Fredoka:wght@400;600;700&family=Instrument+Serif&display=swap";
