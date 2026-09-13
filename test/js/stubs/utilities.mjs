// Stub for discourse/lib/utilities. Same character set as the Handlebars
// escapeExpression Discourse re-exports, so escaping tests are meaningful.
const CHARS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "`": "&#x60;",
  "=": "&#x3D;",
};

export function escapeExpression(string) {
  if (string === null || string === undefined) {
    return "";
  }
  return String(string).replace(/[&<>"'`=]/g, (c) => CHARS[c]);
}
