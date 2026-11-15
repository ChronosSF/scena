// Handles no page may take: scena.example/<handle> would otherwise be a route of the app, a
// word that lets a page pass for the service itself, or a name that breaks software. The
// migrations write this list into the handles_reserved table each time they run (migrate.ts),
// and the package refuses a handle that is in either.
//
// Lowercase, one word per entry. Some cannot be a handle anyway ("_" breaks the handle rule);
// they are here because the plan lists them, and the table keeps them for whatever else reads
// it. Removing a word from this list does not free it in a database that already has it:
// delete its row as well.

/** The web app's routes, today's and the ones the plan names (sign-in, billing, publishing). */
const ROUTES = [
  "_", "about", "account", "accounts", "admin", "analytics", "api", "app", "assets", "auth",
  "billing", "callback", "checkout", "create", "dashboard", "discover", "domain", "domains",
  "download", "downloads", "edit", "editor", "embed", "explore", "files", "fonts", "help",
  "images", "img", "login", "logout", "media", "new", "oauth", "og", "plans", "portal",
  "preview", "pricing", "publish", "register", "report", "scene", "scenes", "search", "settings",
  "share", "sign-in", "sign-out", "sign-up", "signin", "signout", "signup", "sso", "static",
  "stats", "studio", "subscribe", "templates", "upgrade", "uploads", "verify", "webhook", "webhooks",
];

/** Pages a product site has, and the files browsers and crawlers ask for by name. */
const SITE = [
  "abuse", "accessibility", "blog", "careers", "contact", "cookies", "copyright", "dmca", "docs",
  "faq", "favicon", "feed", "guidelines", "home", "index", "jobs", "legal", "manifest", "news",
  "policies", "policy", "press", "privacy", "robots", "rss", "safety", "security", "sitemap",
  "status", "support", "terms", "trust",
];

/** The service's own names, and the people who would speak for it. */
const BRAND = [
  "administrator", "getscena", "hello", "hostmaster", "info", "marketing", "mod", "moderator",
  "no-reply", "noreply", "official", "owner", "postmaster", "root", "sales", "scena", "scena-app",
  "scena-hq", "scenaapp", "scenahq", "staff", "sysadmin", "system", "team", "webmaster",
];

/** Host names, should a handle ever become a subdomain, and environments. */
const HOSTS = [
  "beta", "cdn", "demo", "dev", "dns", "email", "ftp", "localhost", "mail", "mx", "ns1", "ns2",
  "smtp", "staging", "test", "www",
];

/** Words that software reads as something other than a name. */
const VALUES = ["false", "nan", "nil", "none", "null", "true", "undefined"];

/**
 * OFFENSIVE TERMS: deliberately empty in this public repository.
 *
 * The plan reserves offensive terms too. Where that list comes from (a maintained list, a
 * moderation service, words chosen by hand), and whether it is kept in this repository at
 * all, is the founder's decision, and it has not been made. Until then, a word added to the
 * handles_reserved table in the database is refused like the words above, so a list kept
 * outside the repository needs no change to the code.
 */
const OFFENSIVE: readonly string[] = [];

export const RESERVED_HANDLES: readonly string[] = [...ROUTES, ...SITE, ...BRAND, ...HOSTS, ...VALUES, ...OFFENSIVE];
