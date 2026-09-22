import type { MetadataRoute } from "next";

// Personlig oversikt, ikke en publikumsside. Hver visning av "/" og
// "/stocks/*" gjør oppslag mot Supabase og Reddit, så crawling ville brent
// rategrenser uten nytte. Fjern denne filen hvis siden skal indekseres.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
