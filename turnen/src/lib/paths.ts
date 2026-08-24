// Für rohe <a href>-Links auf App-Routen (z.B. Druckansichten, die bewusst
// außerhalb von React Router in einem neuen Tab geöffnet werden statt über
// <Link>/navigate()). Die reguläre React-Router-Navigation braucht das
// nicht - dort übernimmt `basename` auf <BrowserRouter> das Gleiche
// automatisch. BASE_URL ist "/" lokal, "/turnen-light/" im Produktions-Build
// (siehe vite.config.ts / .env.production).
export function appPath(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
