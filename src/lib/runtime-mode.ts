export class DatabaseUnavailableError extends Error {
  constructor(message = "The helpdesk database is unavailable. Please try again or contact your administrator.", options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

/** Demo state is process-local and must never impersonate durable production data. */
export function assertDemoModeAllowed() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new DatabaseUnavailableError("The helpdesk database is not configured. Production cannot use demo data.");
  }
}
