/**
 * Development orchestrator: starts the router and the three specialist agents
 * as separate processes. Requires .env (copy .env.example) for live ENS + LLM.
 *
 * SECURITY: this script only spawns processes; it never handles secrets itself.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const PROCESSES: ReadonlyArray<{ readonly name: string; readonly script: string }> = [
  { name: 'router', script: 'src/server/main.ts' },
  { name: 'contract-agent', script: 'agents/contract-agent.ts' },
  { name: 'brand-agent', script: 'agents/brand-agent.ts' },
  { name: 'invoice-agent', script: 'agents/invoice-agent.ts' },
];

const children: ChildProcess[] = [];

for (const proc of PROCESSES) {
  const child = spawn('npx', ['tsx', '--env-file-if-exists=.env', proc.script], {
    stdio: 'inherit',
    env: process.env,
  });
  children.push(child);
  console.info(`[dev] started ${proc.name} (${proc.script}) pid=${child.pid}`);
}

const shutdown = (): void => {
  console.info('[dev] shutting down all processes...');
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
