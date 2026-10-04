/**
 * Publish specialist agent metadata to ENS (Sepolia) and update the directory
 * record. OPTIONAL for routing — the router only ever READS ENS.
 *
 * SECURITY: requires SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY from the
 * environment (.env, which is gitignored). Credentials are NEVER committed.
 * Never run with a production key.
 *
 * What it does:
 *   1. For each agent in the publishing config (scripts/agents.config.ts):
 *        - setSubnodeRecord(directoryNode, label, owner, resolver) — creates or
 *          updates the agent subname (e.g. contract-agent.<directory>);
 *        - setText for every agent.* record on the agent node.
 *   2. Updates the directory name's "agents.directory" text record with the
 *      machine-readable list of agent ENS names.
 *
 * The directory name itself must be owned by the deployer and have a resolver
 * set (one-time step: app.ens.domains / app.ens.dev -> name -> Add resolver,
 * or set ENS_RESOLVER_ADDRESS). Adding a FOURTH agent = add an entry to
 * scripts/agents.config.ts and re-run this script. No router code changes.
 *
 * Usage: npm run publish:agents [-- --dry-run]
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { labelhash, namehash, normalize } from 'viem/ens';

import { buildAgentPublishConfig } from './agents.config.js';
import { readOptionalEnv, readRequiredEnv } from '../src/security/secrets.js';

/**
 * Sepolia ENS registry (ENSv1 legacy deployment; canonical ENS registry
 * address, same as mainnet). Overridable via ENS_REGISTRY_ADDRESS for other
 * deployments (e.g. ENSv2 registries).
 */
const DEFAULT_ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

/**
 * Default Sepolia Public Resolver (ENSv1 legacy deployment), used when the
 * directory name has no resolver yet.
 */
const DEFAULT_ENS_RESOLVER_ADDRESS = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';

const ENS_REGISTRY_ABI = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setSubnodeRecord(bytes32 parentNode, bytes32 label, address owner, address resolver, uint64 ttl)',
]);

const RESOLVER_ABI = parseAbi([
  'function setText(bytes32 node, string key, string value)',
]);

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  const rpcUrl = readRequiredEnv('SEPOLIA_RPC_URL');
  const privateKeyRaw = readRequiredEnv('DEPLOYER_PRIVATE_KEY');
  const directoryName = normalize(readRequiredEnv('ENS_DIRECTORY_NAME'));
  const registryAddress = (readOptionalEnv('ENS_REGISTRY_ADDRESS') ?? DEFAULT_ENS_REGISTRY_ADDRESS) as `0x${string}`;

  // SECURITY: the private key is used only for signing (wallet client) and is
  // never logged or written anywhere.
  const privateKey = privateKeyRaw.startsWith('0x')
    ? (privateKeyRaw as `0x${string}`)
    : (`0x${privateKeyRaw}` as `0x${string}`);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const config = buildAgentPublishConfig(directoryName);
  const directoryNode = namehash(directoryName);

  const run = async (): Promise<void> => {
    console.info(
      JSON.stringify({
        step: 'start',
        directoryName,
        deployer: account.address,
        registry: registryAddress,
        dryRun,
      }),
    );

    // Resolve (or default) the resolver used for text records.
    let resolverAddress: `0x${string}`;
    const configuredResolver = readOptionalEnv('ENS_RESOLVER_ADDRESS');
    if (configuredResolver !== undefined) {
      resolverAddress = configuredResolver as `0x${string}`;
    } else {
      const existing = await publicClient.readContract({
        address: registryAddress,
        abi: ENS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [directoryNode],
      });
      resolverAddress =
        existing !== '0x0000000000000000000000000000000000000000'
          ? existing
          : (DEFAULT_ENS_RESOLVER_ADDRESS as `0x${string}`);
    }
    console.info(JSON.stringify({ step: 'resolver', resolverAddress }));

    const publishedNames: string[] = [];

    for (const agent of config.agents) {
      const label = normalize(agent.label);
      const agentNode = namehash(agent.ensName);

      // Create or update the agent subname under the directory name.
      if (!dryRun) {
        const tx = await walletClient.writeContract({
          address: registryAddress,
          abi: ENS_REGISTRY_ABI,
          functionName: 'setSubnodeRecord',
          args: [directoryNode, labelhash(label), account.address, resolverAddress, 0n],
        });
        console.info(
          JSON.stringify({ step: 'setSubnodeRecord', ensName: agent.ensName, txHash: tx }),
        );
      } else {
        console.info(
          JSON.stringify({ step: 'setSubnodeRecord(dry-run)', ensName: agent.ensName }),
        );
      }

      // Publish every agent.* text record on the agent node.
      for (const [key, value] of Object.entries(agent.records)) {
        if (!dryRun) {
          const tx = await walletClient.writeContract({
            address: resolverAddress,
            abi: RESOLVER_ABI,
            functionName: 'setText',
            args: [agentNode, key, value],
          });
          console.info(JSON.stringify({ step: 'setText', ensName: agent.ensName, key, txHash: tx }));
        } else {
          console.info(
            JSON.stringify({ step: 'setText(dry-run)', ensName: agent.ensName, key, value }),
          );
        }
      }

      publishedNames.push(agent.ensName);
    }

    // Update the directory record: the machine-readable list of agent ENS names.
    const directoryValue = JSON.stringify({ version: 1, agents: publishedNames });
    if (!dryRun) {
      const tx = await walletClient.writeContract({
        address: resolverAddress,
        abi: RESOLVER_ABI,
        functionName: 'setText',
        args: [directoryNode, 'agents.directory', directoryValue],
      });
      console.info(JSON.stringify({ step: 'setDirectory', key: 'agents.directory', txHash: tx }));
    } else {
      console.info(
        JSON.stringify({ step: 'setDirectory(dry-run)', key: 'agents.directory', value: directoryValue }),
      );
    }

    console.info(JSON.stringify({ step: 'done', publishedNames, directoryValue }));
  };

  run().catch((cause: unknown) => {
    console.error(
      JSON.stringify({
        step: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    console.error(
      'If setSubnodeRecord reverted, the deployer may not own the directory name, or the',
      'name may live in a different ENS deployment (e.g. ENSv2 via app.ens.dev). Set',
      'ENS_REGISTRY_ADDRESS / ENS_RESOLVER_ADDRESS accordingly, or manage the records',
      'through the ENS App UI. See docs/ADD_FOURTH_AGENT.md.',
    );
    process.exit(1);
  });
}

main();
