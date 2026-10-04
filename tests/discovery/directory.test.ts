/**
 * ENS directory record parsing (challenge CHECK 3 architecture).
 */
import { describe, expect, it } from 'vitest';

import { DirectoryRecordError, readDirectoryRecord } from '../../src/ens/directory.js';
import { FakeEnsGateway, TEST_DIRECTORY_NAME } from '../helpers.js';

describe('readDirectoryRecord', () => {
  it('reads the machine-readable agent list from the directory text record', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectory(['invoice-agent.test.eth', 'brand-agent.test.eth']);

    const record = await readDirectoryRecord(gateway, TEST_DIRECTORY_NAME);
    expect(record.version).toBe(1);
    expect(record.agents).toEqual(['invoice-agent.test.eth', 'brand-agent.test.eth']);
  });

  it('throws when the directory record is missing', async () => {
    const gateway = new FakeEnsGateway();
    await expect(readDirectoryRecord(gateway, TEST_DIRECTORY_NAME)).rejects.toThrow(
      DirectoryRecordError,
    );
  });

  it('throws when the directory record is not valid JSON', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectoryRaw('contract-agent.test.eth, brand-agent.test.eth');

    await expect(readDirectoryRecord(gateway, TEST_DIRECTORY_NAME)).rejects.toThrow(
      DirectoryRecordError,
    );
  });

  it('throws when the directory record fails schema validation', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectoryRaw(JSON.stringify({ version: 2, agents: ['x.test.eth'] }));

    await expect(readDirectoryRecord(gateway, TEST_DIRECTORY_NAME)).rejects.toThrow(
      DirectoryRecordError,
    );
  });

  it('throws when agents is not an array of strings', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectoryRaw(JSON.stringify({ version: 1, agents: [42] }));

    await expect(readDirectoryRecord(gateway, TEST_DIRECTORY_NAME)).rejects.toThrow(
      DirectoryRecordError,
    );
  });
});
