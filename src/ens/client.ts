/**
 * ENS gateway — the seam between the router and the ENS protocol (Sepolia).
 *
 * The live implementation resolves text records through viem using the chain's
 * ENS Universal Resolver. Tests inject a fake gateway; the application
 * discovery path always uses live ENS data (a local JSON file is never used as
 * a source of agent records).
 */
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

import { EnsLookupError } from './lookup-error.js';

/**
 * Minimal read-only ENS access required by the router.
 * Returns null when the name resolves but the record is unset; throws
 * {@link EnsLookupError} when the name/record cannot be resolved at all.
 */
export interface EnsGateway {
  getTextRecord(ensName: string, recordKey: string): Promise<string | null>;
}

export interface ViemEnsGatewayOptions {
  /** Sepolia JSON-RPC endpoint. */
  readonly rpcUrl: string;
  /** Optional override for the ENS Universal Resolver address (viem has a Sepolia default). */
  readonly universalResolverAddress?: `0x${string}`;
}

/** Create the live ENS gateway backed by viem against Sepolia. */
export function createViemEnsGateway(options: ViemEnsGatewayOptions): EnsGateway {
  const client = createPublicClient({
    chain: sepolia,
    transport: http(options.rpcUrl),
  });

  return {
    async getTextRecord(ensName: string, recordKey: string): Promise<string | null> {
      try {
        const normalizedName = normalize(ensName);
        return await client.getEnsText({
          name: normalizedName,
          key: recordKey,
          ...(options.universalResolverAddress !== undefined
            ? { universalResolverAddress: options.universalResolverAddress }
            : {}),
        });
      } catch (cause) {
        // SECURITY: the underlying viem error can embed the RPC transport URL
        // (which may contain a provider project id). Wrap it so logs only ever
        // see our own safe message; the raw cause stays attached for debugging.
        throw new EnsLookupError(ensName, recordKey, { cause });
      }
    },
  };
}
