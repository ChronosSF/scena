// The shape of the token hash in a sign-in email's link, for the confirm page's form in the
// browser and the action it posts to on the server: one pattern, so that the two cannot come to
// disagree about what a link carries. Hexadecimal today, and never more than this.

export const TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;
