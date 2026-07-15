export type WorkerEnv = Cloudflare.Env;

export type UploadAuthEnv = Pick<
  WorkerEnv,
  "PUBLISHER_HMAC_SECRET" | "PUBLISHER_KEY_ID"
>;
