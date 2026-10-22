declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    STAFF_USER_IDS?: string;
    STAFF_EMAILS?: string;
  }
}
