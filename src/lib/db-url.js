"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var db_url_exports = {};
__export(db_url_exports, {
  checkPoolerWarning: () => checkPoolerWarning,
  resolveMigrationUrl: () => resolveMigrationUrl
});
module.exports = __toCommonJS(db_url_exports);
function resolveMigrationUrl(env) {
  const warnings = [];
  if (env.DATABASE_DIRECT_URL) {
    return { url: env.DATABASE_DIRECT_URL, warnings };
  }
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL or DATABASE_DIRECT_URL is required \u2014 ensure the database is provisioned"
    );
  }
  if (isPoolerUrl(env.DATABASE_URL)) {
    warnings.push(
      "DATABASE_DIRECT_URL is not set and DATABASE_URL appears to be a pooled connection. Schema migrations may fail through PgBouncer in transaction mode. Set DATABASE_DIRECT_URL to the direct (non-pooler) Neon connection string."
    );
  } else {
    warnings.push(
      "DATABASE_DIRECT_URL is not set \u2014 falling back to DATABASE_URL. For reliability, set DATABASE_DIRECT_URL to the direct Neon connection string."
    );
  }
  return { url: env.DATABASE_URL, warnings };
}
function checkPoolerWarning(env) {
  if (!env.DATABASE_URL) return null;
  if (env.DATABASE_DIRECT_URL) return null;
  if (!isPoolerUrl(env.DATABASE_URL)) return null;
  return 'DATABASE_URL appears to be a pooled connection (contains "-pooler.") but DATABASE_DIRECT_URL is not set. Schema migrations (db:push, db:migrate) may fail through PgBouncer. Set DATABASE_DIRECT_URL to the direct Neon connection string.';
}
function isPoolerUrl(url) {
  return url.includes("-pooler.") || url.includes("pgbouncer");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkPoolerWarning,
  resolveMigrationUrl
});
