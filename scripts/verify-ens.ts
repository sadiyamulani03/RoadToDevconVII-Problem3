/**
 * LIVE ENS verification (read-only) — `npm run verify:ens`.
 *
 * Verifies, directly from Sepolia via the project's ACTUAL ENS read path
 * (createViemEnsGateway + discoverAgents — the same path the router uses):
 *
 *   1. the directory name resolves and has a valid "agents.directory" record;
 *   2. the record lists real specialist ENS names;
 *   3. every specialist name resolves with all required agent.* text records;
 *   4. ids / capabilities / endpoints are correct and endpoints are HTTPS
 *      (or the explicit localhost development exception);
 *   5. live discovery of ALL agents succeeds end-to-end.
 *
 * Requires SEPOLIA_RPC_URL and ENS_DIRECTORY_NAME (from .env). Read-only:
 * no private key is needed and no transaction is sent. Exits non-zero when
 * any verification step fails.
 */
import { loadRouterConfig } from '../src/config.js';
import { createViemEnsGateway } from '../src/ens/client.js';
import { readDirectoryRecord, DIRECTORY_RECORD_KEY } from '../src/ens/directory.js';
import { resolveDiscoveredAgent } from '../src/ens/records.js';
import { discoverAgents } from '../src/router/discovery.js';
import { AGENT_RECORD_KEYS } from '../src/agents/types.js';

interface StepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly detail?: string;
}

async function main(): Promise<void> {
  const config = loadRouterConfig(process.env);
  const directoryName = config.ens.directoryName;
  const gateway = createViemEnsGateway({
    rpcUrl: config.ens.rpcUrl,
    ...(config.ens.universalResolverAddress !== null
      ? { universalResolverAddress: config.ens.universalResolverAddress }
      : {}),
  });

  const steps: StepResult[] = [];
  const fail = (step: string, detail: string): never => {
    steps.push({ step, ok: false, detail });
    console.error(JSON.stringify({ status: 'FAIL', directoryName, steps }, null, 2));
    process.exit(1);
  };

  console.info(JSON.stringify({ step: 'start', network: 'sepolia', directoryName }));

  // 1. Directory record resolves and is valid (read via the router's own path).
  let agentNames: string[] = [];
  try {
    const directory = await readDirectoryRecord(gateway, directoryName);
    agentNames = directory.agents;
    steps.push({ step: 'directory_record', ok: true, detail: `${agentNames.length} agent name(s)` });
  } catch (cause) {
    fail('directory_record', cause instanceof Error ? cause.message : String(cause));
  }
  console.info(JSON.stringify({ step: 'directory_record', agentNames }));

  // 2. Every specialist name resolves with all required text records.
  const endpointOptions = { allowInsecureLocalhost: config.allowLocalhostEndpoints };
  for (const name of agentNames) {
    try {
      const agent = await resolveDiscoveredAgent(gateway, name, endpointOptions);
      const rawChecks: Array<[string, () => boolean]> = [
        ['agent.id', () => agent.id.length > 0],
        ['agent.name', () => agent.displayName.length > 0],
        ['agent.description', () => agent.description.length > 0],
        ['agent.capabilities', () => agent.capabilities.length > 0],
        ['agent.endpoint', () => agent.endpoint.length > 0],
        ['agent.version', () => agent.version.length > 0],
      ];
      const failedField = rawChecks.find(([, check]) => !check());
      if (failedField !== undefined) {
        fail(`agent_records:${name}`, `empty required field: ${failedField[0]}`);
      }
      if (agent.endpointUrl.protocol !== 'https:' && !config.allowLocalhostEndpoints) {
        fail(`agent_records:${name}`, `endpoint is not HTTPS: ${agent.endpoint}`);
      }
      steps.push({
        step: `agent_records:${name}`,
        ok: true,
        detail: `id=${agent.id} endpoint=${agent.endpoint} endpointProtocol=${agent.endpointUrl.protocol}`,
      });
      console.info(JSON.stringify({ step: 'agent_records', ensName: name, id: agent.id, endpoint: agent.endpoint, endpointProtocol: agent.endpointUrl.protocol, capabilities: agent.capabilities }));
    } catch (cause) {
      fail(`agent_records:${name}`, cause instanceof Error ? cause.message : String(cause));
    }
  }

  // 3. Full live discovery (the exact path the router runs per request).
  try {
    const discovery = await discoverAgents(gateway, directoryName, {
      allowInsecureLocalhost: config.allowLocalhostEndpoints,
      logger: { warn: (scope, message) => console.warn(JSON.stringify({ scope, message })) },
    });
    if (discovery.agents.length === 0) {
      fail('live_discovery', 'discovered zero valid agents from live ENS');
    }
    steps.push({
      step: 'live_discovery',
      ok: true,
      detail: `${discovery.agents.length} agent(s) discovered: ${discovery.agents.map((agent) => agent.id).join(', ')}`,
    });
    console.info(JSON.stringify({
      step: 'live_discovery',
      directoryName: discovery.directoryName,
      discoveredAgentIds: discovery.agents.map((agent) => agent.id),
      skipped: discovery.skipped,
    }));
  } catch (cause) {
    fail('live_discovery', cause instanceof Error ? cause.message : String(cause));
  }

  console.info(JSON.stringify({ status: 'PASS', network: 'sepolia', directoryName, steps: steps.length }, null, 2));
  console.info('LIVE ENS VERIFICATION PASSED — all records resolved from Sepolia and live discovery succeeded.');
}

main().catch((cause: unknown) => {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      step: 'fatal',
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  );
  process.exit(1);
});
