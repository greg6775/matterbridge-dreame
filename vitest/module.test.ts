import path from 'node:path';

import { vi, describe, beforeEach, afterAll, it, expect } from 'vitest';
import { AnsiLogger } from 'matterbridge/logger';
import { MatterbridgeEndpoint, PlatformConfig, PlatformMatterbridge, SystemInformation } from 'matterbridge';
import { VendorId } from 'matterbridge/matter';

import { DreamePlatform } from '../src/module.ts';

const mockLog = {
  fatal: vi.fn((_message: string, ..._parameters: unknown[]) => {}),
  error: vi.fn((_message: string, ..._parameters: unknown[]) => {}),
  warn: vi.fn((_message: string, ..._parameters: unknown[]) => {}),
  notice: vi.fn((_message: string, ..._parameters: unknown[]) => {}),
  info: vi.fn((_message: string, ..._parameters: unknown[]) => {}),
  debug: vi.fn((_message: string, ..._parameters: unknown[]) => {}),
} as unknown as AnsiLogger;

const mockMatterbridge: PlatformMatterbridge = {
  systemInformation: {
    ipv4Address: '192.168.1.1',
    ipv6Address: 'fd78:cbf8:4939:746:a96:8277:346f:416e',
    osRelease: 'x.y.z',
    nodeVersion: '22.10.0',
  } as unknown as SystemInformation,
  rootDirectory: path.join('vitest', 'DreamePlugin'),
  homeDirectory: path.join('vitest', 'DreamePlugin'),
  matterbridgeDirectory: path.join('vitest', 'DreamePlugin', '.matterbridge'),
  matterbridgePluginDirectory: path.join('vitest', 'DreamePlugin', 'Matterbridge'),
  matterbridgeCertDirectory: path.join('vitest', 'DreamePlugin', '.mattercert'),
  globalModulesDirectory: path.join('vitest', 'DreamePlugin', 'node_modules'),
  matterbridgeVersion: '3.4.0',
  matterbridgeLatestVersion: '3.4.0',
  matterbridgeDevVersion: '3.4.0',
  bridgeMode: 'bridge',
  restartMode: '',
  aggregatorVendorId: VendorId(0xfff1),
  aggregatorVendorName: 'Matterbridge',
  aggregatorProductId: 0x8000,
  aggregatorProductName: 'Matterbridge aggregator',
  // Mocked methods
  registerVirtualDevice: vi.fn(async (_name: string, _type: 'light' | 'outlet' | 'switch' | 'mounted_switch', _callback: () => Promise<void>) => {}),
  addBridgedEndpoint: vi.fn(async (_pluginName: string, _device: MatterbridgeEndpoint) => {}),
  removeBridgedEndpoint: vi.fn(async (_pluginName: string, _device: MatterbridgeEndpoint) => {}),
  removeAllBridgedEndpoints: vi.fn(async (_pluginName: string) => {}),
} as unknown as PlatformMatterbridge;

const mockConfig: PlatformConfig = {
  name: 'matterbridge-dreame',
  type: 'DynamicPlatform',
  version: '0.1.0',
  debug: false,
  unregisterOnShutdown: false,
  username: 'test@example.com',
  password: 'testpassword',
  country: 'eu',
  refreshInterval: 120,
};

vi.spyOn(AnsiLogger.prototype, 'log').mockImplementation((_level: string, _message: string, ..._parameters: unknown[]) => {});

describe('Matterbridge Dreame Plugin', () => {
  let instance: DreamePlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error Ignore readonly for testing purposes
    mockMatterbridge.matterbridgeVersion = '3.4.0';
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should create an instance of the platform', async () => {
    instance = (await import('../src/module.ts')).default(mockMatterbridge, mockLog, mockConfig) as DreamePlatform;
    expect(instance).toBeInstanceOf(DreamePlatform);
    expect(instance.matterbridge).toBe(mockMatterbridge);
    expect(instance.log).toBe(mockLog);
    expect(instance.config).toBe(mockConfig);
    expect(instance.matterbridge.matterbridgeVersion).toBe('3.4.0');
  });

  it('should throw an error if matterbridge is not the required version', () => {
    // @ts-expect-error Ignore readonly for testing purposes
    mockMatterbridge.matterbridgeVersion = '2.0.0';
    expect(() => new DreamePlatform(mockMatterbridge, mockLog, mockConfig)).toThrow(
      'This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from 2.0.0 to the latest version.',
    );
  });
});
