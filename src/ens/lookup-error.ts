/**
 * Typed error raised when an ENS name/record cannot be read.
 *
 * SECURITY: the message deliberately excludes the underlying transport error,
 * which may embed the RPC endpoint URL (potential provider credentials).
 * The raw cause is attached for programmatic inspection only.
 */
export class EnsLookupError extends Error {
  public override readonly name = 'EnsLookupError';

  public constructor(
    public readonly ensName: string,
    public readonly recordKey: string,
    options?: { cause?: unknown },
  ) {
    super(`ENS lookup failed for "${ensName}" (record "${recordKey}")`, options);
  }
}
