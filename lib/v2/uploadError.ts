export class UploadError extends Error {
  constructor(message: string, public status = 422) { super(message); this.name = "UploadError"; }
}
