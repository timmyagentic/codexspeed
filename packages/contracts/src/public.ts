import { RunUploadSchema, type RunUpload } from "./run.js";

// Uploaded runs are already the complete sanitized public document.
export const PublicRunSchema = RunUploadSchema;
export type PublicRun = RunUpload;
