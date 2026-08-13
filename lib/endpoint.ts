/**
 * Endpoint URL normalisation.
 *
 * Lives in lib/ rather than in the page so both the page and its test can
 * import it without pulling a client component into the test environment.
 */

/** Compute the effective API endpoint from user input and the "Add /v1" setting. */
export function getEffectiveEndpoint(endpoint: string, appendV1: boolean): string {
  let clean = endpoint.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (appendV1 && !/\/v1$/i.test(clean)) {
    clean = `${clean}/v1`;
  }
  return clean;
}
