// Where a person goes once they are signed in: back to where they started. The address arrives
// from outside (the sign-in page's query, a form, the link in an email), so it is never followed
// as it is: it is looked up in this list, by equality, and anything else is the studio. No text
// is parsed, and no address on another host, or a path this list does not name, can come out.

export const RETURN_PATHS = ["/studio", "/admin"] as const;

export type ReturnPath = (typeof RETURN_PATHS)[number];

export const DEFAULT_RETURN: ReturnPath = "/studio";

/** The path to send a person back to, given whatever came in. */
export function returnPath(value: unknown): ReturnPath {
  return RETURN_PATHS.find((path) => path === value) ?? DEFAULT_RETURN;
}

/** The first value of a query parameter that may have been given more than once. */
export const firstOf = (value: string | string[] | undefined | null): string | undefined =>
  Array.isArray(value) ? value[0] : value ?? undefined;
