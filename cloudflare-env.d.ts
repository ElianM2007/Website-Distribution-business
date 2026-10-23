declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OWNER_EMAIL?: string;
    OWNER_SETUP_TOKEN?: string;
  }
}
