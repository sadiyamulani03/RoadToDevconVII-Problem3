/**
 * AGENT PUBLISHING CONFIGURATION — used ONLY by scripts/publish-agents.ts.
 *
 * SECURITY / ARCHITECTURE (challenge CHECK 3): this file is NOT router source.
 * The router (src/**, served by src/server) NEVER imports this file and never
 * contains an agent list — it discovers agents at runtime from the ENS
 * directory record. This configuration exists solely so a human (or CI job
 * with secrets) can publish/update agent metadata on ENS.
 *
 * To add a FOURTH agent: add an entry here, run `npm run publish:agents`, and
 * the router picks it up automatically — no router source-code change. See
 * docs/ADD_FOURTH_AGENT.md.
 *
 * Endpoints: local development uses http://localhost:<port> (the router's
 * explicit localhost exception). For production, deploy each agent publicly
 * and set `endpoint` to its public HTTPS URL — production ENS records must
 * use HTTPS.
 */
export interface AgentPublishEntry {
  /** ENS label under the directory name, e.g. "contract-agent". */
  readonly label: string;
  /** Full ENS name that will be published (label + "." + directory name). */
  readonly ensName: string;
  /** Text records (agent.id, agent.name, agent.description, ...). */
  readonly records: Readonly<Record<string, string>>;
}

export interface AgentPublishConfig {
  readonly directoryName: string;
  readonly agents: readonly AgentPublishEntry[];
}

/** Build the publishing configuration for the three specialists. */
export function buildAgentPublishConfig(directoryName: string): AgentPublishConfig {
  const sub = (label: string): string => `${label}.${directoryName}`;

  return {
    directoryName,
    agents: [
      {
        label: 'contract-agent',
        ensName: sub('contract-agent'),
        records: {
          'agent.id': 'contract-specialist',
          'agent.name': 'Contract Specialist',
          'agent.description':
            'Answers questions about contracts, contract clauses, and legal-document explanations (termination, liability, indemnification, confidentiality, payment terms, governing law, force majeure, IP, warranties, dispute resolution).',
          'agent.capabilities': 'contracts,clauses,legal,compliance',
          'agent.endpoint': 'http://localhost:8791',
          'agent.input':
            'A natural-language question about a contract or a specific clause.',
          'agent.version': '1.0.0',
        },
      },
      {
        label: 'brand-agent',
        ensName: sub('brand-agent'),
        records: {
          'agent.id': 'brand-specialist',
          'agent.name': 'Brand Copy Agent',
          'agent.description':
            'Writes marketing copy, taglines, product descriptions, and brand messaging with a premium, concise voice.',
          'agent.capabilities': 'branding,copywriting,taglines,marketing',
          'agent.endpoint': 'http://localhost:8792',
          'agent.input':
            'A natural-language request for marketing copy, a tagline, or a product description.',
          'agent.version': '1.0.0',
        },
      },
      {
        label: 'invoice-agent',
        ensName: sub('invoice-agent'),
        records: {
          'agent.id': 'invoice-specialist',
          'agent.name': 'Invoice Assistant',
          'agent.description':
            'Answers questions about invoices, overdue invoices, payment status, amounts, and billing. Knows the current invoice ledger.',
          'agent.capabilities': 'invoices,billing,payments,overdue',
          'agent.endpoint': 'http://localhost:8793',
          'agent.input':
            'A natural-language question about invoices, payments, or billing.',
          'agent.version': '1.0.0',
        },
      },
    ],
  };
}
