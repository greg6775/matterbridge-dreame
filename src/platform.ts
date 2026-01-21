/**
 * Matterbridge platform for Dreame vacuum cleaners.
 * Extends MatterbridgeDynamicPlatform to provide Matter 1.4 RVC support.
 *
 * @file platform.ts
 * @license Apache-2.0
 */

import { Matterbridge, MatterbridgeDynamicPlatform, PlatformConfig } from 'matterbridge';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { DreameCloudProtocol } from './dreameCloud.js';
import { discoverAndRegisterDevices, type DreameVacuumDevice } from './dreame.js';
import type { DreameConfig, DreameCountry, DreameDevice, DeviceStatus, RoomInfo } from './types.js';
import { DreameState } from './types.js';

// Storage keys for persistence
const STORAGE_KEYS = {
  rooms: (did: string) => `rooms_${did}`,
} as const;

// Adaptive polling configuration
const POLLING_INTERVALS = {
  // Active states: cleaning, returning, etc. - poll more frequently
  active: 15, // seconds
  // Idle states: docked, charging, sleeping - poll less frequently
  idle: 120, // seconds (use configured refreshInterval as default)
} as const;

// States considered "active" for adaptive polling
const ACTIVE_STATES = new Set([
  DreameState.Cleaning,
  DreameState.Mopping,
  DreameState.GoCharging,
  DreameState.Returning,
  DreameState.Washing,
  DreameState.Drying,
  DreameState.Defecating,
  DreameState.Building,
  DreameState.ManualCleaning,
  DreameState.ZonedCleaning,
  DreameState.SpotCleaning,
  DreameState.FastMapping,
  DreameState.SecondCleaning,
  DreameState.StationCleaning,
  DreameState.Emptying,
  DreameState.ReturningAutoEmpty,
  DreameState.CleaningAutoEmpty,
]);

export class DreamePlatform extends MatterbridgeDynamicPlatform {
  private cloud: DreameCloudProtocol;
  private devices: Map<string, DreameVacuumDevice> = new Map();
  private cloudDevices: Map<string, DreameDevice> = new Map(); // Store original cloud device data
  private statusInterval: NodeJS.Timeout | null = null;
  private devicePollingTimers: Map<string, NodeJS.Timeout> = new Map(); // Per-device adaptive polling timers
  private refreshInterval: number;
  private lastDeviceState: Map<string, DreameState> = new Map(); // Track state for adaptive polling

  constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    // Verify Matterbridge version
    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.4.0')) {
      throw new Error(`This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version.`);
    }

    // Initialize cloud protocol
    this.cloud = new DreameCloudProtocol(log);

    // Get refresh interval from config (default 120 seconds)
    this.refreshInterval = (config.refreshInterval as number) ?? 120;
    if (this.refreshInterval < 30) {
      this.refreshInterval = 30;
      this.log.warn('Refresh interval too low, setting to 30 seconds');
    }

    this.log.info('Dreame Platform initialized');
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`onStart called with reason: ${reason ?? 'none'}`);

    // Wait for platform to be ready
    await this.ready;

    // Validate configuration
    const config = this.config as unknown as DreameConfig;
    if (!config.username || !config.password) {
      this.log.error('Missing username or password in configuration');
      return;
    }

    if (!config.country) {
      this.log.error('Missing country/region in configuration');
      return;
    }

    // Login to Dreame Cloud
    const loginResult = await this.cloud.login(config.username, config.password, config.country as DreameCountry);

    if (!loginResult.success) {
      this.log.error(`Failed to login to Dreame Cloud: ${loginResult.error}`);
      return;
    }

    // Discover and register devices
    await this.discoverDevices();
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info('onConfigure called');

    // Start status polling
    this.startStatusPolling();

    // Configure each device
    for (const [did, device] of this.devices) {
      this.log.info(`Configuring device: ${device.name} (${did})`);

      // Get the original cloud device data (includes bindDomain)
      const cloudDevice = this.cloudDevices.get(did);
      if (cloudDevice) {
        // Try to connect MQTT for real-time updates (uses uid/key from login)
        const mqttConnected = await this.cloud.connectMqtt(cloudDevice);
        if (mqttConnected) {
          this.log.info(`MQTT connected for ${device.name}`);
        } else {
          this.log.info(`Using cloud polling for ${device.name}`);
        }
      }

      // Register status callback for updates (MQTT or cloud polling)
      this.cloud.onDeviceStatus(did, (status: DeviceStatus) => {
        this.handleDeviceStatus(did, status);
      });

      // Register room update callback (for when rooms are received via MQTT)
      this.cloud.onRoomUpdate(did, (rooms: RoomInfo[]) => {
        this.log.info(`Received ${rooms.length} rooms via MQTT for ${device.name}`);
        device.updateRooms(rooms);
        // Persist rooms to storage for future startups
        this.saveCachedRooms(did, rooms).catch((err) => this.log.debug(`Failed to save rooms: ${err}`));
      });
    }
  }

  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    await super.onShutdown(reason);
    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);

    // Stop status polling
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    // Stop all device polling timers
    for (const [did, timer] of this.devicePollingTimers) {
      clearTimeout(timer);
      this.log.debug(`Stopped polling timer for ${did}`);
    }
    this.devicePollingTimers.clear();
    this.lastDeviceState.clear();

    // Disconnect from cloud
    await this.cloud.disconnect();

    // Unregister devices if configured
    if (this.config.unregisterOnShutdown === true) {
      await this.unregisterAllDevices();
    }
  }

  /**
   * Load cached rooms from persistent storage.
   */
  private async loadCachedRooms(did: string): Promise<RoomInfo[]> {
    try {
      if (!this.context) {
        return [];
      }
      const key = STORAGE_KEYS.rooms(did);
      const cached = await this.context.get<RoomInfo[]>(key);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        this.log.info(`Loaded ${cached.length} cached rooms from storage for ${did}`);
        return cached;
      }
    } catch (error) {
      this.log.debug(`Failed to load cached rooms: ${error}`);
    }
    return [];
  }

  /**
   * Save rooms to persistent storage.
   */
  private async saveCachedRooms(did: string, rooms: RoomInfo[]): Promise<void> {
    try {
      if (!this.context || rooms.length === 0) {
        return;
      }
      const key = STORAGE_KEYS.rooms(did);
      await this.context.set(key, rooms);
      this.log.info(`Saved ${rooms.length} rooms to storage for ${did}`);
    } catch (error) {
      this.log.debug(`Failed to save cached rooms: ${error}`);
    }
  }

  /**
   * Discover Dreame vacuums and register them as Matter devices.
   */
  private async discoverDevices(): Promise<void> {
    this.log.info('Discovering Dreame vacuums...');

    // Get devices from cloud
    const cloudDevices = await this.cloud.getDevices();
    if (cloudDevices.length === 0) {
      this.log.warn('No Dreame vacuums found');
      return;
    }

    // Register each device
    for (const cloudDevice of cloudDevices) {
      try {
        this.log.info(`Found vacuum: ${cloudDevice.name} (${cloudDevice.model})`);

        // Get room info for ServiceArea cluster
        // Priority: 1. MQTT cache, 2. Cloud storage, 3. Persistent storage, 4. Manual config
        let rooms = await this.cloud.getRoomInfo(cloudDevice.did);

        // If no cached rooms from MQTT, try proactive cloud storage fetch
        if (rooms.length === 0) {
          this.log.info(`No cached rooms, trying proactive cloud storage fetch for ${cloudDevice.name}...`);
          const fetchedRooms = await this.cloud.tryFetchMapOnStartup(cloudDevice.did);
          if (fetchedRooms) {
            rooms = this.cloud.getCachedRooms(cloudDevice.did);
          }
        }

        // If still no rooms, try loading from persistent storage
        if (rooms.length === 0) {
          this.log.info(`Trying to load rooms from persistent storage for ${cloudDevice.name}...`);
          rooms = await this.loadCachedRooms(cloudDevice.did);
        }

        if (rooms.length === 0) {
          this.log.warn(`No rooms found for ${cloudDevice.name}. Device may be sleeping.`);
          this.log.warn('Tip: Start a cleaning cycle to wake the device and fetch room data.');
        } else {
          // Save rooms to persistent storage for future use
          await this.saveCachedRooms(cloudDevice.did, rooms);
        }

        this.log.info(`Found ${rooms.length} rooms for ${cloudDevice.name}`);

        // Get initial device status
        const status = await this.cloud.getDeviceProperties(cloudDevice.did);

        // Create and register Matter device
        const device = await discoverAndRegisterDevices(this, this.cloud, cloudDevice, rooms, status);

        if (device) {
          this.devices.set(cloudDevice.did, device);
          this.cloudDevices.set(cloudDevice.did, cloudDevice); // Store original cloud device data
        }
      } catch (error) {
        this.log.error(`Failed to register device ${cloudDevice.name}: ${error}`);
      }
    }

    this.log.info(`Registered ${this.devices.size} Dreame vacuum(s)`);
  }

  /**
   * Start periodic status polling with adaptive intervals.
   * Each device gets its own polling timer that adjusts based on state.
   */
  private startStatusPolling(): void {
    if (this.statusInterval) {
      return;
    }

    this.log.info('Starting adaptive status polling');

    // Start polling for each device
    for (const [did] of this.devices) {
      this.scheduleDevicePoll(did, POLLING_INTERVALS.idle);
    }

    // Also keep a fallback interval to ensure all devices are polled periodically
    this.statusInterval = setInterval(async () => {
      for (const [did] of this.devices) {
        // Only poll if no device-specific timer is active (safety net)
        if (!this.devicePollingTimers.has(did)) {
          this.scheduleDevicePoll(did, POLLING_INTERVALS.idle);
        }
      }
    }, this.refreshInterval * 1000);
  }

  /**
   * Schedule a single poll for a device with the given interval.
   * After polling, reschedules based on the device's current state.
   */
  private scheduleDevicePoll(did: string, intervalSeconds: number): void {
    // Clear any existing timer for this device
    const existingTimer = this.devicePollingTimers.get(did);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.devicePollingTimers.delete(did);

      try {
        const status = await this.cloud.getDeviceProperties(did);
        if (status) {
          this.handleDeviceStatus(did, status);

          // Determine next poll interval based on state
          const isActive = ACTIVE_STATES.has(status.state);
          const nextInterval = isActive ? POLLING_INTERVALS.active : Math.max(this.refreshInterval, POLLING_INTERVALS.idle);

          // Log interval changes
          const lastState = this.lastDeviceState.get(did);
          if (lastState !== undefined && ACTIVE_STATES.has(lastState) !== isActive) {
            this.log.info(`Device ${did} state changed: polling interval now ${nextInterval}s (${isActive ? 'active' : 'idle'})`);
          }

          this.lastDeviceState.set(did, status.state);
          this.scheduleDevicePoll(did, nextInterval);
        } else {
          // On failure, retry with idle interval
          this.scheduleDevicePoll(did, Math.max(this.refreshInterval, POLLING_INTERVALS.idle));
        }
      } catch (error) {
        this.log.error(`Failed to get status for ${did}: ${error}`);
        // On error, retry with idle interval
        this.scheduleDevicePoll(did, Math.max(this.refreshInterval, POLLING_INTERVALS.idle));
      }
    }, intervalSeconds * 1000);

    this.devicePollingTimers.set(did, timer);
  }

  /**
   * Handle device status updates.
   *
   * @param did
   * @param status
   */
  private handleDeviceStatus(did: string, status: DeviceStatus): void {
    const device = this.devices.get(did);
    if (!device) {
      return;
    }

    this.log.debug(`Status update for ${device.name}: state=${status.state}, status=${status.status}, battery=${status.battery}%`);

    // Update Matter device attributes
    device.updateStatus(status);
  }
}
