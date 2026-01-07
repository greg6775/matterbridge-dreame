import path from 'node:path';

import { vi, describe, beforeEach, afterAll } from 'vitest';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { MatterbridgeEndpoint, PlatformConfig, PlatformMatterbridge, SystemInformation } from 'matterbridge';
import { VendorId } from 'matterbridge/matter';

import { TemplatePlatform } from '../src/module.ts';

const mockLog = {
  fatal: vi.fn((message: string, ...parameters: any[]) => {}),
  error: vi.fn((message: string, ...parameters: any[]) => {}),
  warn: vi.fn((message: string, ...parameters: any[]) => {}),
  notice: vi.fn((message: string, ...parameters: any[]) => {}),
  info: vi.fn((message: string, ...parameters: any[]) => {}),
  debug: vi.fn((message: string, ...parameters: any[]) => {}),
} as unknown as AnsiLogger;

const mockMatterbridge: PlatformMatterbridge = {
  systemInformation: {
    ipv4Address: '192.168.1.1',
    ipv6Address: 'fd78:cbf8:4939:746:a96:8277:346f:416e',
    osRelease: 'x.y.z',
    nodeVersion: '22.10.0',
  } as unknown as SystemInformation,
  rootDirectory: path.join('jest', 'TemplatePlugin'),
  homeDirectory: path.join('jest', 'TemplatePlugin'),
  matterbridgeDirectory: path.join('jest', 'TemplatePlugin', '.matterbridge'),
  matterbridgePluginDirectory: path.join('jest', 'TemplatePlugin', 'Matterbridge'),
  matterbridgeCertDirectory: path.join('jest', 'TemplatePlugin', '.mattercert'),
  globalModulesDirectory: path.join('jest', 'TemplatePlugin', 'node_modules'),
  matterbridgeVersion: '3.3.0',
  matterbridgeLatestVersion: '3.3.0',
  matterbridgeDevVersion: '3.3.0',
  bridgeMode: 'bridge',
  restartMode: '',
  aggregatorVendorId: VendorId(0xfff1),
  aggregatorVendorName: 'Matterbridge',
  aggregatorProductId: 0x8000,
  aggregatorProductName: 'Matterbridge aggregator',
  // Mocked methods
  registerVirtualDevice: vi.fn(async (name: string, type: 'light' | 'outlet' | 'switch' | 'mounted_switch', callback: () => Promise<void>) => {}),
  addBridgedEndpoint: vi.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {}),
  removeBridgedEndpoint: vi.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {}),
  removeAllBridgedEndpoints: vi.fn(async (pluginName: string) => {}),
} as unknown as PlatformMatterbridge;

const mockConfig: PlatformConfig = {
  name: 'matterbridge-plugin-template',
  type: 'DynamicPlatform',
  version: '1.0.0',
  debug: false,
  unregisterOnShutdown: false,
};

const loggerLogSpy = vi.spyOn(AnsiLogger.prototype, 'log').mockImplementation((level: string, message: string, ...parameters: any[]) => {});

describe('Matterbridge Plugin Template', () => {
  let instance: TemplatePlatform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if matterbridge is not the required version', async () => {
    // @ts-expect-error Ignore readonly for testing purposes
    mockMatterbridge.matterbridgeVersion = '2.0.0'; // Simulate an older version
    expect(() => new TemplatePlatform(mockMatterbridge, mockLog, mockConfig)).toThrow(
      'This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from 2.0.0 to the latest version in the frontend.',
    );
    // @ts-expect-error Ignore readonly for testing purposes
    mockMatterbridge.matterbridgeVersion = '3.4.0';
  });

  it('should create an instance of the platform', async () => {
    instance = (await import('../src/module.ts')).default(mockMatterbridge, mockLog, mockConfig) as TemplatePlatform;
    // @ts-expect-error Accessing private method for testing purposes
    instance.setMatterNode(
      // @ts-expect-error Accessing private method for testing purposes
      mockMatterbridge.addBridgedEndpoint,
      // @ts-expect-error Accessing private method for testing purposes
      mockMatterbridge.removeBridgedEndpoint,
      // @ts-expect-error Accessing private method for testing purposes
      mockMatterbridge.removeAllBridgedEndpoints,
      // @ts-expect-error Accessing private method for testing purposes
      mockMatterbridge.registerVirtualDevice,
    );
    expect(instance).toBeInstanceOf(TemplatePlatform);
    expect(instance.matterbridge).toBe(mockMatterbridge);
    expect(instance.log).toBe(mockLog);
    expect(instance.config).toBe(mockConfig);
    expect(instance.matterbridge.matterbridgeVersion).toBe('3.4.0');
    expect(mockLog.info).toHaveBeenCalledWith('Initializing Platform...');
  });

  it('should start', async () => {
    await instance.onStart('Jest');
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason: Jest');
    await instance.onStart();
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason: none');
  });

  it('should call the command handlers', async () => {
    for (const device of instance.getDevices()) {
      if (device.hasClusterServer('onOff')) {
        await device.executeCommandHandler('on');
        await device.executeCommandHandler('off');
      }
    }
    expect(mockLog.info).toHaveBeenCalledWith('Command on called on cluster undefined'); // Is undefined here cause the endpoint in not active
    expect(mockLog.info).toHaveBeenCalledWith('Command off called on cluster undefined'); // Is undefined here cause the endpoint in not active
  });

  it('should configure', async () => {
    await instance.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Configuring device:'));
  });

  it('should change logger level', async () => {
    await instance.onChangeLoggerLevel(LogLevel.DEBUG);
    expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
  });

  it('should shutdown', async () => {
    await instance.onShutdown('Jest');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: Jest');

    // Mock the unregisterOnShutdown behavior
    mockConfig.unregisterOnShutdown = true;
    await instance.onShutdown();
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    // @ts-expect-error Accessing private method for testing purposes
    expect(mockMatterbridge.removeAllBridgedEndpoints).toHaveBeenCalled();
    mockConfig.unregisterOnShutdown = false;
  });
});
