/**
 * Dreame Cloud authentication and communication module.
 * Implements login, device discovery, and MQTT communication with Dreame cloud.
 *
 * @file dreameCloud.ts
 * @license Apache-2.0
 */

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import type { MqttClient } from 'mqtt';
import { AnsiLogger } from 'matterbridge/logger';

import {
  type AuthResult,
  type CloudSession,
  type DreameDevice,
  type DeviceStatus,
  type DreameCountry,
  type RoomInfo,
  DreameState,
  DreameStatus,
  DreameFanSpeed,
  DreameWaterFlow,
  DreameErrorCode,
} from './types.js';
import {
  getDreameApiUrl,
  getDreameUserAgent,
  getDreameTenantId,
  DREAME_AUTH_HEADER,
  DREAME_AUTH_ENDPOINT,
  DREAME_PASSWORD_SALT,
  DREAME_CLIENT_ID,
  DREAME_DEVICE_LIST_ENDPOINT,
  DREAME_SEND_COMMAND_ENDPOINT,
  DREAME_GET_DEVICE_DATA_ENDPOINT,
  MIOT_PROPERTIES,
  MIOT_ACTIONS,
  MIOT_ACTION_PARAMS,
  DREAME_STATUS_VALUES,
  isSupportedModel,
} from './constants.js';

// Buffer time before token expiry to trigger refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

// Status codes that should trigger a retry
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class DreameCloudProtocol {
  private log: AnsiLogger;
  private session: CloudSession | null = null;
  private mqttClients: Map<string, MqttClient> = new Map();
  private messageId = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map();
  private deviceStatusCallbacks: Map<string, (status: DeviceStatus) => void> = new Map();
  private deviceOwnerIds: Map<string, string> = new Map(); // Map device ID to owner/master UID
  private deviceModels: Map<string, string> = new Map(); // Map device ID to model
  private loginCredentials: { username: string; password: string; country: DreameCountry } | null = null;
  private isRefreshing = false;

  constructor(log: AnsiLogger) {
    this.log = log;
  }

  /**
   * Check if token needs refresh and refresh if necessary.
   * Returns true if session is valid (either already valid or successfully refreshed).
   */
  private async ensureValidToken(): Promise<boolean> {
    if (!this.session) {
      return false;
    }

    // Check if token is about to expire
    const now = Date.now();
    const expiresAt = this.session.expiresAt;

    if (now < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      // Token is still valid
      return true;
    }

    // Token needs refresh
    this.log.info('Token is expiring soon, refreshing...');
    return this.refreshToken();
  }

  /**
   * Refresh the authentication token.
   * Uses refresh_token if available, otherwise re-authenticates with credentials.
   */
  private async refreshToken(): Promise<boolean> {
    // Prevent concurrent refresh attempts
    if (this.isRefreshing) {
      this.log.debug('Token refresh already in progress, waiting...');
      // Wait for ongoing refresh to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.session !== null;
    }

    this.isRefreshing = true;

    try {
      // Try using refresh token first (not implemented in Dreame API, but kept for future)
      // For now, re-authenticate with stored credentials
      if (this.loginCredentials) {
        this.log.info('Re-authenticating with stored credentials...');
        const result = await this.login(
          this.loginCredentials.username,
          this.loginCredentials.password,
          this.loginCredentials.country,
        );
        return result.success;
      }

      this.log.error('No credentials available for token refresh');
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Login to Dreame Cloud with credentials.
   * Uses OAuth2 password grant with Basic auth header.
   *
   * @param username
   * @param password
   * @param country
   */
  async login(username: string, password: string, country: DreameCountry): Promise<AuthResult> {
    this.log.info(`Logging in to Dreame Cloud (${country})...`);

    try {
      const baseUrl = getDreameApiUrl(country);
      const userAgent = getDreameUserAgent();
      const tenantId = getDreameTenantId();

      // Hash password with MD5 (password + salt)
      const passwordHash = createHash('md5')
        .update(password + DREAME_PASSWORD_SALT)
        .digest('hex');

      // Build login request body (OAuth2 password grant)
      // Format: platform=IOS&scope=all&grant_type=password&username=xxx&password=xxx&type=account
      const loginBody = `platform=IOS&scope=all&grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(passwordHash)}&type=account`;

      this.log.debug(`Login URL: ${baseUrl}${DREAME_AUTH_ENDPOINT}`);

      // Build headers
      const headers: Record<string, string> = {
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': 'en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': userAgent,
        'Authorization': DREAME_AUTH_HEADER,
        'Tenant-Id': tenantId,
      };

      // Add Dreame-Rlc header for CN region
      if (country === 'cn') {
        headers['Dreame-Rlc'] = DREAME_CLIENT_ID;
      }

      const response = await fetch(`${baseUrl}${DREAME_AUTH_ENDPOINT}`, {
        method: 'POST',
        headers,
        body: loginBody,
      });

      if (!response.ok) {
        const text = await response.text();
        this.log.error(`Login failed: ${response.status} ${text}`);
        return { success: false, error: `Login failed: ${response.status} - ${text}` };
      }

      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        region?: string;
        tenant_id?: string;
        uid?: string; // User ID for MQTT
        key?: string; // Client key for MQTT (method 1)
        user_token?: string; // Client key for MQTT (method 2)
        t?: string; // Possibly another token
        u?: string; // Possibly another token
        code?: number;
        msg?: string;
      };

      if (!data.access_token) {
        return { success: false, error: data.msg || 'No access token received' };
      }

      // Store session - uid and key are needed for MQTT authentication
      const mqttKey = data.access_token;
      this.session = {
        token: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        userId: data.uid || data.tenant_id || '', // Prefer uid for MQTT
        country,
        mqttKey,
      };

      this.log.info(`Got MQTT credentials: uid=${this.session.userId}, key length=${mqttKey?.length || 0}`);

      // Store credentials for token refresh (only on initial login, not during refresh)
      if (!this.isRefreshing) {
        this.loginCredentials = { username, password, country };
      }

      this.log.info('Login successful');
      return {
        success: true,
        token: this.session.token,
        refreshToken: this.session.refreshToken,
        expiresAt: this.session.expiresAt,
        userId: this.session.userId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`Login error: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Make authenticated API call.
   *
   * @param endpoint
   * @param method
   * @param body
   */
  private async apiCall<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T | null> {
    if (!this.session) {
      this.log.error('No active session');
      return null;
    }

    // Ensure token is valid before making API call
    const tokenValid = await this.ensureValidToken();
    if (!tokenValid) {
      this.log.error('Failed to ensure valid token');
      return null;
    }

    const baseUrl = getDreameApiUrl(this.session.country);
    const userAgent = getDreameUserAgent();
    const tenantId = getDreameTenantId();
    const url = `${baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Accept-Language': 'en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'Authorization': DREAME_AUTH_HEADER, // Basic auth required for all API calls
      'Tenant-Id': tenantId,
      'Dreame-Auth': this.session.token,
    };

    // CN region needs additional header
    if (this.session.country === 'cn') {
      headers['Dreame-Rlc'] = DREAME_CLIENT_ID;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    // Retry with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: baseDelay * 2^(attempt-1) with jitter
          const delay = Math.min(RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1), RETRY_CONFIG.maxDelayMs);
          const jitter = delay * 0.2 * Math.random(); // Add up to 20% jitter
          this.log.debug(`Retry attempt ${attempt}/${RETRY_CONFIG.maxRetries} after ${Math.round(delay + jitter)}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        }

        const response = await fetch(url, options);

        // Check if we should retry based on status code
        if (!response.ok) {
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < RETRY_CONFIG.maxRetries) {
            lastError = new Error(`HTTP ${response.status}`);
            this.log.warn(`API call got ${response.status}, will retry...`);
            continue;
          }
          const text = await response.text();
          this.log.error(`API call failed: ${response.status} - ${text}`);
          return null;
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Network errors are retryable
        if (attempt < RETRY_CONFIG.maxRetries) {
          this.log.warn(`API call error (attempt ${attempt + 1}): ${lastError.message}`);
          continue;
        }
      }
    }

    this.log.error(`API call failed after ${RETRY_CONFIG.maxRetries + 1} attempts: ${lastError?.message}`);
    return null;
  }

  /**
   * Get list of devices from cloud.
   */
  async getDevices(): Promise<DreameDevice[]> {
    interface DeviceRecord {
      did: string;
      model: string;
      mac: string;
      localIp?: string;
      localip?: string; // API may use lowercase
      online: boolean;
      masterUid?: string;
      bindDomain?: string;
      property?: string;
      customName?: string;
      deviceInfo?: {
        displayName?: string;
      };
    }

    interface DeviceListResponse {
      code: number;
      data?: {
        page?: {
          records?: DeviceRecord[];
        };
      };
    }

    // Call device list endpoint with pagination
    const response = await this.apiCall<DeviceListResponse>(DREAME_DEVICE_LIST_ENDPOINT, 'POST', {
      page: 1,
      pageSize: 100,
    });

    if (!response?.data?.page?.records) {
      this.log.debug('No devices found in response');
      this.log.debug(`Response: ${JSON.stringify(response)}`);
      return [];
    }

    this.log.info(`API returned ${response.data.page.records.length} device(s)`);

    // Filter to only supported vacuum models (or all vacuum models if model starts with 'dreame.vacuum')
    const devices = response.data.page.records
      .filter((d) => d.model?.startsWith('dreame.vacuum') || isSupportedModel(d.model))
      .map((d) => {
        const deviceName = d.customName || d.deviceInfo?.displayName || `Dreame ${d.model}`;

        // Store the owner/master UID for cloud storage lookups
        if (d.masterUid) {
          this.deviceOwnerIds.set(d.did, d.masterUid);
        }

        // Store the device model for API calls
        this.deviceModels.set(d.did, d.model);

        return {
          did: d.did,
          name: deviceName,
          model: d.model,
          mac: d.mac,
          localIp: d.localIp || d.localip, // Handle both cases
          online: d.online,
          ownerId: d.masterUid || '',
          bindDomain: d.bindDomain,
          property: d.property,
        };
      });

    this.log.info(`Found ${devices.length} Dreame vacuum(s)`);
    return devices;
  }

  /**
   * Get device properties via cloud command API.
   * Uses the sendCommand endpoint since the iotstatus endpoint may return 404.
   *
   * @param did
   */
  async getDeviceProperties(did: string): Promise<DeviceStatus | null> {
    const props = [
      // Core status properties
      { siid: MIOT_PROPERTIES.batteryLevel.siid, piid: MIOT_PROPERTIES.batteryLevel.piid },
      { siid: MIOT_PROPERTIES.chargingState.siid, piid: MIOT_PROPERTIES.chargingState.piid },
      { siid: MIOT_PROPERTIES.deviceFault.siid, piid: MIOT_PROPERTIES.deviceFault.piid },
      { siid: MIOT_PROPERTIES.deviceStatus.siid, piid: MIOT_PROPERTIES.deviceStatus.piid },
      { siid: MIOT_PROPERTIES.operatingMode.siid, piid: MIOT_PROPERTIES.operatingMode.piid },
      { siid: MIOT_PROPERTIES.suctionLevel.siid, piid: MIOT_PROPERTIES.suctionLevel.piid },
      { siid: MIOT_PROPERTIES.waterFlow.siid, piid: MIOT_PROPERTIES.waterFlow.piid },
      { siid: MIOT_PROPERTIES.waterBoxMode.siid, piid: MIOT_PROPERTIES.waterBoxMode.piid },
      // Accessory status (water tank, mop pad)
      { siid: MIOT_PROPERTIES.waterTankInstalled.siid, piid: MIOT_PROPERTIES.waterTankInstalled.piid },
      { siid: MIOT_PROPERTIES.mopPadInstalled.siid, piid: MIOT_PROPERTIES.mopPadInstalled.piid },
      // Dock/base station status
      { siid: MIOT_PROPERTIES.dustCollectionStatus.siid, piid: MIOT_PROPERTIES.dustCollectionStatus.piid },
      { siid: MIOT_PROPERTIES.cleanWaterTankStatus.siid, piid: MIOT_PROPERTIES.cleanWaterTankStatus.piid },
      { siid: MIOT_PROPERTIES.dirtyWaterTankStatus.siid, piid: MIOT_PROPERTIES.dirtyWaterTankStatus.piid },
    ];

    try {
      // Use cloud command API with get_properties method
      const response = await this.sendCloudCommand(did, 'get_properties', props);

      // Response can be: array directly, or object with {id, result: array}
      let results: Array<{ siid: number; piid: number; value?: unknown; code?: number }>;

      if (Array.isArray(response)) {
        results = response;
      } else if (response && typeof response === 'object' && 'result' in response) {
        const wrapped = response as { result: unknown[] };
        if (Array.isArray(wrapped.result)) {
          results = wrapped.result as typeof results;
        } else {
          this.log.debug(`No valid result array in response: ${JSON.stringify(response)}`);
          return null;
        }
      } else {
        return null;
      }

      const getValue = (siid: number, piid: number): unknown => {
        const prop = results.find((p) => p.siid === siid && p.piid === piid && p.code === 0);
        return prop?.value;
      };

      // Parse accessory status (1 = installed, 0 = not installed)
      const waterTankRaw = getValue(MIOT_PROPERTIES.waterTankInstalled.siid, MIOT_PROPERTIES.waterTankInstalled.piid);
      const mopPadRaw = getValue(MIOT_PROPERTIES.mopPadInstalled.siid, MIOT_PROPERTIES.mopPadInstalled.piid);

      const status: DeviceStatus = {
        state: (getValue(MIOT_PROPERTIES.operatingMode.siid, MIOT_PROPERTIES.operatingMode.piid) as DreameState) ?? DreameState.Unknown,
        status: (getValue(MIOT_PROPERTIES.deviceStatus.siid, MIOT_PROPERTIES.deviceStatus.piid) as DreameStatus) ?? DreameStatus.Unknown,
        battery: (getValue(MIOT_PROPERTIES.batteryLevel.siid, MIOT_PROPERTIES.batteryLevel.piid) as number) ?? 0,
        fanSpeed: (getValue(MIOT_PROPERTIES.suctionLevel.siid, MIOT_PROPERTIES.suctionLevel.piid) as DreameFanSpeed) ?? DreameFanSpeed.Standard,
        waterFlow: (getValue(MIOT_PROPERTIES.waterFlow.siid, MIOT_PROPERTIES.waterFlow.piid) as DreameWaterFlow) ?? DreameWaterFlow.Medium,
        errorCode: (getValue(MIOT_PROPERTIES.deviceFault.siid, MIOT_PROPERTIES.deviceFault.piid) as DreameErrorCode) ?? DreameErrorCode.None,
        // Accessory status (convert to boolean, may be undefined if not supported)
        waterTankInstalled: waterTankRaw !== undefined ? waterTankRaw === 1 : undefined,
        mopPadInstalled: mopPadRaw !== undefined ? mopPadRaw === 1 : undefined,
        // Dock/base station status (model-dependent, may be undefined)
        dustCollectionStatus: getValue(MIOT_PROPERTIES.dustCollectionStatus.siid, MIOT_PROPERTIES.dustCollectionStatus.piid) as number | undefined,
        cleanWaterTankStatus: getValue(MIOT_PROPERTIES.cleanWaterTankStatus.siid, MIOT_PROPERTIES.cleanWaterTankStatus.piid) as number | undefined,
        dirtyWaterTankStatus: getValue(MIOT_PROPERTIES.dirtyWaterTankStatus.siid, MIOT_PROPERTIES.dirtyWaterTankStatus.piid) as number | undefined,
      };

      // Log core status with optional accessory info
      const accessoryInfo = [];
      if (status.waterTankInstalled !== undefined) accessoryInfo.push(`waterTank=${status.waterTankInstalled}`);
      if (status.mopPadInstalled !== undefined) accessoryInfo.push(`mopPad=${status.mopPadInstalled}`);
      const accessoryStr = accessoryInfo.length > 0 ? `, ${accessoryInfo.join(', ')}` : '';
      this.log.info(`Device status: state=${status.state}, status=${status.status}, battery=${status.battery}%${accessoryStr}`);

      // Cache the status for MQTT partial updates to merge with
      this.cachedStatus.set(did, status);

      return status;
    } catch (error) {
      this.log.error(`Failed to get device properties: ${error}`);
      return null;
    }
  }

  /**
   * Get room/map info for a device.
   * Room data comes from MQTT when the device is active.
   * Returns cached rooms if available, otherwise empty array.
   *
   * @param did
   */
  async getRoomInfo(did: string): Promise<RoomInfo[]> {
    // Check for cached rooms from MQTT updates
    const cachedRooms = this.cachedRooms.get(did);
    if (cachedRooms && cachedRooms.length > 0) {
      this.log.info(`Using ${cachedRooms.length} cached rooms from MQTT for ${did}`);
      return cachedRooms;
    }

    // Room data comes via MQTT when device is active
    // Manual room configuration is handled by the platform
    this.log.debug('No cached room data available - rooms will be received via MQTT when device is active');
    return [];
  }

  /**
   * Parse room/segment info from map data.
   * Dreame map format: base64 + zlib → binary with JSON at end → rism field → base64 + zlib → binary with seg_inf
   *
   * @param mapData
   */
  private parseRoomsFromMapData(mapData: unknown): RoomInfo[] {
    try {
      let parsed: Record<string, unknown> | null = null;

      if (typeof mapData === 'string') {
        // Try to parse as JSON first
        try {
          parsed = JSON.parse(mapData);
        } catch {
          // Try base64 + zlib decode
          try {
            const decoded = Buffer.from(mapData, 'base64');
            if (decoded[0] === 0x78) {
              // Zlib compressed - decompress and find JSON at end
              const decompressed = inflateSync(decoded);

              // Search for JSON with rism field at end of binary
              if (decompressed.length > 1000) {
                const searchStart = Math.max(0, decompressed.length - 50000);
                const endSection = decompressed.subarray(searchStart).toString('latin1');

                const rismIndex = endSection.indexOf('"rism"');
                if (rismIndex !== -1) {
                  // Find outermost JSON containing rism
                  for (let searchBack = rismIndex; searchBack >= 0; searchBack--) {
                    if (endSection[searchBack] !== '{') continue;

                    let braceCount = 0;
                    let braceEnd = -1;
                    for (let i = searchBack; i < endSection.length; i++) {
                      if (endSection[i] === '{') braceCount++;
                      if (endSection[i] === '}') braceCount--;
                      if (braceCount === 0) {
                        braceEnd = i;
                        break;
                      }
                    }

                    if (braceEnd > searchBack) {
                      const jsonStr = endSection.substring(searchBack, braceEnd + 1);
                      if (jsonStr.includes('"rism"') && jsonStr.length < 50000) {
                        try {
                          parsed = JSON.parse(jsonStr);
                          break;
                        } catch {
                          // Continue searching
                        }
                      }
                    }
                  }
                }
              }
            } else {
              parsed = JSON.parse(decoded.toString('utf-8'));
            }
          } catch {
            return [];
          }
        }
      } else if (typeof mapData === 'object' && mapData !== null) {
        parsed = mapData as Record<string, unknown>;
      }

      if (!parsed) return [];

      // Check for seg_inf directly
      if (parsed.seg_inf) {
        return this.parseSegInf(parsed.seg_inf as Record<string, unknown>);
      }

      // Check rism field (room info saved map)
      const rism = parsed.rism;
      if (rism && typeof rism === 'string' && rism.length > 0) {
        try {
          const standardBase64 = rism.replace(/-/g, '+').replace(/_/g, '/');
          const rismDecoded = Buffer.from(standardBase64, 'base64');

          if (rismDecoded[0] === 0x78) {
            const rismDecompressed = inflateSync(rismDecoded);
            const rismStr = rismDecompressed.toString('utf-8');

            // Try JSON parse first
            try {
              const rismParsed = JSON.parse(rismStr);
              if (rismParsed.seg_inf) {
                return this.parseSegInf(rismParsed.seg_inf as Record<string, unknown>);
              }
            } catch {
              // Binary with JSON at end - find seg_inf directly
              const segInfIndex = rismStr.indexOf('"seg_inf"');
              if (segInfIndex !== -1) {
                const segInfStart = rismStr.indexOf('{', segInfIndex);
                if (segInfStart !== -1) {
                  let braceCount = 0;
                  let segInfEnd = -1;
                  for (let i = segInfStart; i < rismStr.length; i++) {
                    if (rismStr[i] === '{') braceCount++;
                    if (rismStr[i] === '}') braceCount--;
                    if (braceCount === 0) {
                      segInfEnd = i;
                      break;
                    }
                  }

                  if (segInfEnd > segInfStart) {
                    const segInfStr = rismStr.substring(segInfStart, segInfEnd + 1);
                    const segInfParsed = JSON.parse(segInfStr) as Record<string, unknown>;
                    return this.parseSegInf(segInfParsed);
                  }
                }
              }
            }
          }
        } catch {
          // Failed to decode rism
        }
      }

      return [];
    } catch (error) {
      this.log.error(`Failed to parse room data: ${error}`);
      return [];
    }
  }

  // Dreame room type IDs to human-readable names
  private static readonly ROOM_TYPE_NAMES: Record<number, string> = {
    0: 'Room',
    1: 'Living Room',
    2: 'Primary Bedroom',
    3: 'Study',
    4: 'Kitchen',
    5: 'Dining Hall',
    6: 'Bathroom',
    7: 'Balcony',
    8: 'Corridor',
    9: 'Utility Room',
    10: 'Closet',
    11: 'Meeting Room',
    12: 'Office',
    13: 'Fitness Area',
    14: 'Recreation Area',
    15: 'Secondary Bedroom',
  };

  /**
   * Parse seg_inf object into RoomInfo array.
   * Room names are base64-encoded in the 'name' field.
   *
   * @param segInf
   */
  private parseSegInf(segInf: Record<string, unknown>): RoomInfo[] {
    const rooms: RoomInfo[] = [];
    const keys = Object.keys(segInf);

    // Track room type counts for generating unique names like "Bedroom 2"
    const typeCounters: Record<number, number> = {};

    for (const segIdStr of keys) {
      const segId = parseInt(segIdStr, 10);
      if (isNaN(segId)) continue;

      const segData = segInf[segIdStr] as Record<string, unknown>;
      const roomType = typeof segData?.type === 'number' ? segData.type : 0;

      let roomName: string | null = null;

      // Try to decode the name field (base64-encoded custom name)
      if (segData?.name && typeof segData.name === 'string' && segData.name.length > 0) {
        try {
          const decoded = Buffer.from(segData.name, 'base64').toString('utf-8');
          if (decoded && decoded.trim().length > 0) {
            roomName = decoded;
          }
        } catch {
          if (segData.name.trim().length > 0) {
            roomName = segData.name;
          }
        }
      }

      // If no custom name, use room type to generate a meaningful name
      if (!roomName) {
        const typeName = DreameCloudProtocol.ROOM_TYPE_NAMES[roomType] || 'Room';
        typeCounters[roomType] = (typeCounters[roomType] || 0) + 1;

        // Add number suffix if this is not the first room of this type
        if (typeCounters[roomType] > 1) {
          roomName = `${typeName} ${typeCounters[roomType]}`;
        } else {
          roomName = typeName;
        }
      }

      rooms.push({
        id: segId,
        name: roomName,
        floorId: roomType,
      });
    }

    if (rooms.length > 0) {
      this.log.info(`Extracted ${rooms.length} rooms: ${rooms.map((r) => r.name).join(', ')}`);
    }

    return rooms;
  }

  /**
   * Try to fetch map data proactively on startup.
   * Uses the known cloud storage path pattern: ali_dreame/{ownerUid}/{did}/{mapNumber}
   * Returns true if rooms were found.
   *
   * @param did
   */
  async tryFetchMapOnStartup(did: string): Promise<boolean> {
    const ownerId = this.deviceOwnerIds.get(did);
    if (!ownerId) {
      this.log.debug('No owner ID stored, cannot try proactive map fetch');
      return false;
    }

    // Try common map paths (map 1 is usually the current/primary map)
    const mapPaths = [`ali_dreame/${ownerId}/${did}/1`, `ali_dreame/${ownerId}/${did}/0`, `ali_dreame/${ownerId}/${did}/2`];

    for (const path of mapPaths) {
      this.log.info(`Proactively trying to fetch map from: ${path}`);
      await this.fetchMapFromCloudStorage(did, path);

      // Check if we got rooms
      const rooms = this.cachedRooms.get(did);
      if (rooms && rooms.length > 0) {
        this.log.info(`Successfully fetched ${rooms.length} rooms from ${path}`);
        return true;
      }
    }

    this.log.debug('Proactive map fetch did not find any rooms');
    return false;
  }

  /**
   * Fetch map data from cloud storage using the object path.
   * Called when MQTT notifies us of a new map at siid=6 piid=3.
   * Tries multiple approaches: device data API, then file download.
   *
   * @param did
   * @param objectPath
   */
  private async fetchMapFromCloudStorage(did: string, objectPath: string): Promise<void> {
    try {
      this.log.info(`Fetching map data from cloud storage: ${objectPath}`);

      // Method 1: Try getDeviceData endpoint with specific map keys
      const mapKeys = [`${objectPath}/map`, `${objectPath}/seg_inf`, `${objectPath}`];

      interface DeviceDataResponse {
        code: number;
        msg?: string;
        data?: Record<string, string>;
      }

      for (const key of mapKeys) {
        const response = await this.apiCall<DeviceDataResponse>(DREAME_GET_DEVICE_DATA_ENDPOINT, 'POST', {
          did,
          model: [key],
        });

        if (response?.code === 0 && response.data) {
          for (const [, value] of Object.entries(response.data)) {
            if (value && typeof value === 'string' && value.length > 50) {
              // Check if this value might contain segment info
              if (value.includes('seg_inf') || value.includes('"name"')) {
                const rooms = this.parseRoomsFromMapData(value);
                if (rooms.length > 0) {
                  this.log.info(`Found ${rooms.length} rooms from cloud storage: ${rooms.map((r) => r.name).join(', ')}`);
                  this.cachedRooms.set(did, rooms);
                  const roomCallback = this.roomUpdateCallbacks.get(did);
                  if (roomCallback) {
                    roomCallback(rooms);
                  }
                  return;
                }
              }
            }
          }
        }
      }

      // Method 2: Try file download endpoint
      const deviceModel = this.deviceModels.get(did);
      if (!deviceModel) {
        this.log.debug('No device model stored, cannot fetch from cloud storage');
        return;
      }

      interface FileUrlResponse {
        code: number;
        msg?: string;
        data?: string | Record<string, string>; // Can be URL string or map of key -> URL
      }

      // Helper to download and parse map from URL
      const tryDownloadMap = async (url: string, source: string): Promise<boolean> => {
        try {
          const mapResponse = await fetch(url);
          if (mapResponse.ok) {
            const mapText = await mapResponse.text();

            // Try parsing directly (may already be base64-encoded)
            let rooms = this.parseRoomsFromMapData(mapText);
            if (rooms.length > 0) {
              this.log.info(`Found ${rooms.length} rooms from ${source}: ${rooms.map((r) => r.name).join(', ')}`);
              this.cachedRooms.set(did, rooms);
              const roomCallback = this.roomUpdateCallbacks.get(did);
              if (roomCallback) {
                roomCallback(rooms);
              }
              return true;
            }

            // If that failed and it looks like binary, try base64-encoding it
            if (mapText.charCodeAt(0) < 32 || mapText.charCodeAt(0) > 126) {
              const mapBuffer = await (await fetch(url)).arrayBuffer();
              rooms = this.parseRoomsFromMapData(Buffer.from(mapBuffer).toString('base64'));
              if (rooms.length > 0) {
                this.log.info(`Found ${rooms.length} rooms from ${source}: ${rooms.map((r) => r.name).join(', ')}`);
                this.cachedRooms.set(did, rooms);
                const roomCallback = this.roomUpdateCallbacks.get(did);
                if (roomCallback) {
                  roomCallback(rooms);
                }
                return true;
              }
            }
          }
        } catch {
          // Failed to download map
        }
        return false;
      };

      const ossResponse = await this.apiCall<FileUrlResponse>('/dreame-user-iot/iotfile/getOss1dDownloadUrl', 'POST', {
        did,
        filename: objectPath,
        model: deviceModel,
      });

      if (ossResponse?.code === 0 && ossResponse.data) {
        // Handle both string URL and object with URLs
        if (typeof ossResponse.data === 'string' && ossResponse.data.startsWith('http')) {
          if (await tryDownloadMap(ossResponse.data, 'OSS')) return;
        } else if (typeof ossResponse.data === 'object') {
          for (const [key, url] of Object.entries(ossResponse.data)) {
            if (url && typeof url === 'string' && url.startsWith('http')) {
              if (await tryDownloadMap(url, `OSS[${key}]`)) return;
            }
          }
        }
      }

      // Try regular getDownloadUrl as fallback
      const fileResponse = await this.apiCall<FileUrlResponse>('/dreame-user-iot/iotfile/getDownloadUrl', 'POST', {
        did,
        filename: objectPath,
        model: deviceModel,
      });

      if (fileResponse?.code === 0 && fileResponse.data) {
        // Handle both string URL and object with URLs
        if (typeof fileResponse.data === 'string' && fileResponse.data.startsWith('http')) {
          if (await tryDownloadMap(fileResponse.data, 'Download')) return;
        } else if (typeof fileResponse.data === 'object') {
          for (const [key, url] of Object.entries(fileResponse.data)) {
            if (url && typeof url === 'string' && url.startsWith('http')) {
              if (await tryDownloadMap(url, `Download[${key}]`)) return;
            }
          }
        }
      }

      this.log.debug('No room data found in cloud storage');
    } catch (error) {
      this.log.debug(`Failed to fetch map from cloud storage: ${error}`);
    }
  }

  /**
   * Connect to device via MQTT for real-time communication.
   *
   * @param device
   */
  async connectMqtt(device: DreameDevice): Promise<boolean> {
    if (!this.session || !device.bindDomain) {
      this.log.warn(`Cannot connect MQTT: no session=${!!this.session} or bindDomain=${device.bindDomain}`);
      return false;
    }

    const { userId: uid, mqttKey: accessToken, token } = this.session;
    if (!uid || !accessToken) {
      this.log.warn(`Cannot connect MQTT: missing uid=${!!uid} or access_token=${!!accessToken}`);
      return false;
    }

    // Parse bindDomain (format: host:port)
    const [host, portStr] = device.bindDomain.split(':');
    const port = parseInt(portStr, 10) || 8883; // Default to 8883 for TLS

    // Generate client ID: p_{uid}_{randomId}_{host}
    const randomId = Math.random().toString(36).substring(2, 15);
    const clientId = `p_${uid}_${randomId}_${host}`;

    this.log.info(`Connecting MQTT to ${host}:${port}`);

    try {
      // Dynamic import of mqtt module
      const mqtt = await import('mqtt');

      // Try connecting with access_token as password (most common OAuth pattern)
      const client = mqtt.connect({
        host,
        port,
        protocol: 'mqtts', // TLS
        username: uid,
        password: accessToken,
        clientId,
        rejectUnauthorized: false, // Required for Dreame's self-signed certificates
        connectTimeout: 15000,
        keepalive: 60,
        clean: true,
        reconnectPeriod: 5000,
      });

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.log.warn('MQTT connection timeout after 20s');
          client.end(true);
          resolve(false);
        }, 20000);

        client.on('connect', () => {
          clearTimeout(timeout);
          this.log.info(`MQTT connected for ${device.name}`);
          this.mqttClients.set(device.did, client);

          // Subscribe to device status topics
          const country = this.session?.country || 'eu';
          const topics = [`/status/${device.did}/${uid}/${device.model}/${country}/`, `/status/${device.did}/#`, `+/${device.did}/#`];

          for (const topic of topics) {
            client.subscribe(topic, { qos: 0 });
          }

          // Request map data after connection
          this.requestMapDataViaMqtt(device.did, client);

          resolve(true);
        });

        client.on('error', (err) => {
          clearTimeout(timeout);
          this.log.warn(`MQTT error: ${err.message}`);
          // Log more details for debugging auth issues
          if (err.message.includes('Not authorized') || err.message.includes('Connection refused')) {
            this.log.debug(`Auth may have failed. uid=${uid}, token preview=${token.substring(0, 20)}...`);
          }
          resolve(false);
        });

        client.on('offline', () => {
          this.log.debug('MQTT client went offline');
        });

        client.on('reconnect', () => {
          this.log.debug('MQTT client reconnecting...');
        });

        client.on('message', (topic, payload) => {
          this.handleMqttMessage(device.did, topic, payload.toString());
        });

        client.on('close', () => {
          this.log.debug(`MQTT connection closed for ${device.name}`);
          this.mqttClients.delete(device.did);
        });
      });
    } catch (error) {
      this.log.error(`MQTT connection failed: ${error}`);
      return false;
    }
  }

  /**
   * Request map data from device via MQTT.
   * Sends get_properties request for MAP_DATA, MAP_LIST, and FRAME_INFO.
   *
   * @param did
   * @param client
   */
  private requestMapDataViaMqtt(did: string, client: MqttClient): void {
    const id = ++this.messageId;
    const uid = this.session?.userId || '';

    // Request map properties via MQTT RPC
    const message = {
      id,
      method: 'get_properties',
      params: [
        { siid: 6, piid: 1 }, // MAP_DATA
        { siid: 6, piid: 2 }, // FRAME_INFO
        { siid: 6, piid: 8 }, // MAP_LIST
        { siid: 99, piid: 98 }, // Full map data with room info (newer devices)
      ],
    };

    // Topic format for sending commands: /command/{did}/{uid}/{model}/{country}/
    // But we might not know the exact model, so use a simpler format
    const commandTopic = `device/${did}/command`;
    const altCommandTopic = `/command/${did}/${uid}/`;

    // Try both topic formats
    client.publish(commandTopic, JSON.stringify(message), { qos: 0 });
    client.publish(altCommandTopic, JSON.stringify(message), { qos: 0 });

    // Also try requesting map via action (request_map wakes device)
    const actionMessage = {
      id: ++this.messageId,
      method: 'action',
      params: {
        siid: 6, // Map service
        aiid: 1, // request_map action
        in: [],
      },
    };

    setTimeout(() => {
      client.publish(commandTopic, JSON.stringify(actionMessage), { qos: 0 });
    }, 2000);
  }

  /**
   * Handle incoming MQTT messages.
   *
   * @param did
   * @param _topic - MQTT topic (unused, kept for callback signature)
   * @param payload
   */
  private handleMqttMessage(did: string, _topic: string, payload: string): void {
    try {
      const data = JSON.parse(payload) as Record<string, unknown>;

      // Handle response to pending requests
      if (data.id !== undefined && typeof data.id === 'number') {
        const pending = this.pendingRequests.get(data.id);
        if (pending) {
          this.pendingRequests.delete(data.id);
          if (data.error) {
            pending.reject(new Error(String(data.error)));
          } else {
            pending.resolve(data.result);
          }
        }
      }

      // Dreame wraps the actual message in a "data" field
      // Structure: {"id":X,"did":Y,"data":{"id":X,"method":"properties_changed","params":[...]}}
      const innerData = (data.data as Record<string, unknown>) || data;
      const params = innerData.params as unknown[] | undefined;

      // Handle params array (status updates and property changes)
      if (params && Array.isArray(params)) {
        const props = params as Array<{ siid?: number; piid?: number; value?: unknown }>;

        // Parse device status (only if relevant properties are present)
        const status = this.parseStatusFromMqtt(did, params);
        if (status) {
          const callback = this.deviceStatusCallbacks.get(did);
          if (callback) {
            callback(status);
          }
        }

        // Check for map data in MQTT message (siid=6 or siid=99)
        const mapDataProps = props.filter((p) => (p.siid === 6 && (p.piid === 1 || p.piid === 2 || p.piid === 8)) || (p.siid === 99 && p.piid === 98));
        for (const prop of mapDataProps) {
          if (prop.value) {
            const rooms = this.parseRoomsFromMapData(prop.value);
            if (rooms.length > 0) {
              this.log.info(`Parsed ${rooms.length} rooms from MQTT: ${rooms.map((r) => r.name).join(', ')}`);
              this.cachedRooms.set(did, rooms);
              const roomCallback = this.roomUpdateCallbacks.get(did);
              if (roomCallback) {
                roomCallback(rooms);
              }
            }
          }
        }

        // Check for map storage path notification (siid: 6, piid: 3)
        // Value is a cloud storage path like "ali_dreame/OU338468/2045332002/1"
        const mapPathProp = props.find((p) => p.siid === 6 && p.piid === 3);
        if (mapPathProp?.value && typeof mapPathProp.value === 'string') {
          this.log.info(`Received map storage path: ${mapPathProp.value}`);
          // Fetch map data from cloud storage in background
          this.fetchMapFromCloudStorage(did, mapPathProp.value).catch((err) => {
            this.log.debug(`Failed to fetch map from cloud storage: ${err}`);
          });
        }
      }

      // Handle result field (response to get_properties)
      if (data.result && Array.isArray(data.result)) {
        this.log.debug(`MQTT result array with ${data.result.length} items`);
        const results = data.result as Array<{ siid?: number; piid?: number; value?: unknown; code?: number }>;

        for (const result of results) {
          if (result.siid === 6 && result.value && result.code === 0) {
            this.log.info(`Got map property from MQTT result: siid=6 piid=${result.piid}`);
            const rooms = this.parseRoomsFromMapData(result.value);
            if (rooms.length > 0) {
              this.log.info(`Parsed ${rooms.length} rooms from MQTT result: ${rooms.map((r) => r.name).join(', ')}`);
              this.cachedRooms.set(did, rooms);
              const roomCallback = this.roomUpdateCallbacks.get(did);
              if (roomCallback) {
                roomCallback(rooms);
              }
            }
          }
        }
      }
    } catch (e) {
      this.log.debug(`Failed to parse MQTT message: ${e}`);
      this.log.debug(`Raw payload: ${payload.substring(0, 200)}`);
    }
  }

  // Callback for room updates received via MQTT
  private roomUpdateCallbacks: Map<string, (rooms: RoomInfo[]) => void> = new Map();

  /**
   * Register callback for room updates from MQTT.
   *
   * @param did
   * @param callback
   */
  onRoomUpdate(did: string, callback: (rooms: RoomInfo[]) => void): void {
    this.roomUpdateCallbacks.set(did, callback);
  }

  // Cache for rooms received via MQTT
  private cachedRooms: Map<string, RoomInfo[]> = new Map();

  // Cache for last known device status (to merge partial MQTT updates)
  private cachedStatus: Map<string, DeviceStatus> = new Map();

  /**
   * Get cached rooms from MQTT updates.
   *
   * @param did
   */
  getCachedRooms(did: string): RoomInfo[] {
    return this.cachedRooms.get(did) || [];
  }

  /**
   * Parse device status from MQTT params.
   * Merges partial updates with cached status to avoid losing values.
   * Only returns status if state OR status properties are present (to avoid flickering).
   *
   * @param did
   * @param params
   */
  private parseStatusFromMqtt(did: string, params: unknown[]): DeviceStatus | null {
    try {
      const props = params as Array<{ siid: number; piid: number; value: unknown }>;

      // Primary state props - these directly indicate vacuum state
      const primaryStateProps = [
        { siid: MIOT_PROPERTIES.deviceStatus.siid, piid: MIOT_PROPERTIES.deviceStatus.piid }, // siid=4 piid=1
        { siid: MIOT_PROPERTIES.operatingMode.siid, piid: MIOT_PROPERTIES.operatingMode.piid }, // siid=2 piid=1
      ];

      // Secondary props that indicate state changes (e.g., fan speed changes during cleaning)
      const secondaryStateProps = [
        { siid: MIOT_PROPERTIES.suctionLevel.siid, piid: MIOT_PROPERTIES.suctionLevel.piid }, // siid=4 piid=4
      ];

      const hasPrimaryStateProps = props.some((p) => primaryStateProps.some((r) => r.siid === p.siid && r.piid === p.piid));
      const hasSecondaryStateProps = props.some((p) => secondaryStateProps.some((r) => r.siid === p.siid && r.piid === p.piid));

      // If we only have secondary props (like fan speed change) but no primary state props,
      // trigger an immediate poll to get fresh state values since the vacuum likely changed state
      if (hasSecondaryStateProps && !hasPrimaryStateProps) {
        this.log.info(`Detected suctionLevel change without state update - triggering status poll for ${did}`);
        // Trigger poll in background (don't await to avoid blocking MQTT processing)
        this.getDeviceProperties(did)
          .then((freshStatus) => {
            if (freshStatus) {
              this.log.info(`Poll returned fresh status: state=${freshStatus.state}, status=${freshStatus.status}`);
              const callback = this.deviceStatusCallbacks.get(did);
              if (callback) {
                callback(freshStatus);
              }
            }
          })
          .catch((e) => this.log.debug(`Status poll failed: ${e}`));
        return null; // Don't return stale cached values - wait for poll result
      }

      if (!hasPrimaryStateProps && !hasSecondaryStateProps) {
        // Still update battery in cache if present, but don't trigger status callback
        const batteryProp = props.find((p) => p.siid === MIOT_PROPERTIES.batteryLevel.siid && p.piid === MIOT_PROPERTIES.batteryLevel.piid);
        if (batteryProp && typeof batteryProp.value === 'number') {
          const cached = this.cachedStatus.get(did);
          if (cached) {
            cached.battery = batteryProp.value;
            this.cachedStatus.set(did, cached);
            this.log.debug(`Updated cached battery to ${batteryProp.value}% (no state change)`);
          }
        }
        return null; // Don't trigger full status update without state/status
      }

      const getValue = (siid: number, piid: number): unknown => {
        const prop = props.find((p) => p.siid === siid && p.piid === piid);
        return prop?.value;
      };

      // Get cached status or use defaults
      const cached = this.cachedStatus.get(did) || {
        state: DreameState.Unknown,
        status: DreameStatus.Unknown,
        battery: 0,
        fanSpeed: DreameFanSpeed.Standard,
        waterFlow: DreameWaterFlow.Medium,
        errorCode: DreameErrorCode.None,
      };

      // Merge with cached values - only update if value is present in message
      const newStatus: DeviceStatus = {
        state: (getValue(MIOT_PROPERTIES.operatingMode.siid, MIOT_PROPERTIES.operatingMode.piid) as DreameState) ?? cached.state,
        status: (getValue(MIOT_PROPERTIES.deviceStatus.siid, MIOT_PROPERTIES.deviceStatus.piid) as DreameStatus) ?? cached.status,
        battery: (getValue(MIOT_PROPERTIES.batteryLevel.siid, MIOT_PROPERTIES.batteryLevel.piid) as number) ?? cached.battery,
        fanSpeed: (getValue(MIOT_PROPERTIES.suctionLevel.siid, MIOT_PROPERTIES.suctionLevel.piid) as DreameFanSpeed) ?? cached.fanSpeed,
        waterFlow: (getValue(MIOT_PROPERTIES.waterFlow.siid, MIOT_PROPERTIES.waterFlow.piid) as DreameWaterFlow) ?? cached.waterFlow,
        errorCode: (getValue(MIOT_PROPERTIES.deviceFault.siid, MIOT_PROPERTIES.deviceFault.piid) as DreameErrorCode) ?? cached.errorCode,
      };

      // Update cache
      this.cachedStatus.set(did, newStatus);

      // Log state/status values for debugging state mapping issues
      this.log.debug(`Device ${did} raw values: state=${newStatus.state}, status=${newStatus.status}`);

      return newStatus;
    } catch {
      return null;
    }
  }

  /**
   * Send command to device.
   * Always uses cloud API since Dreame MQTT is receive-only for clients.
   * MQTT is only used for receiving status updates, not sending commands.
   *
   * @param did
   * @param method
   * @param params
   */
  async sendCommand(did: string, method: string, params: unknown[] = []): Promise<unknown> {
    // Always use cloud API - Dreame MQTT broker is receive-only for clients
    // Commands must go through the cloud API which relays to the device
    return this.sendCloudCommand(did, method, params);
  }

  /**
   * Send command via cloud API (fallback when MQTT not available).
   * Uses the Dreame Cloud API format with wrapped data field.
   *
   * @param did
   * @param method
   * @param params
   */
  private async sendCloudCommand(did: string, method: string, params: unknown[]): Promise<unknown> {
    interface ActionResponse {
      code: number;
      data?: unknown;
      msg?: string;
    }

    const id = ++this.messageId;

    // Format params based on method type
    let formattedParams: unknown;
    if (method === 'action' && Array.isArray(params) && params.length >= 2) {
      // MIOT action format: { did, siid, aiid, in }
      formattedParams = {
        did,
        siid: params[0],
        aiid: params[1],
        in: params[2] || [],
      };
    } else if (method === 'set_properties' && Array.isArray(params)) {
      // MIOT set_properties format: array of { did, siid, piid, value }
      formattedParams = params.map((p) => {
        const prop = p as { siid: number; piid: number; value: unknown };
        return { did, siid: prop.siid, piid: prop.piid, value: prop.value };
      });
    } else {
      formattedParams = params;
    }

    // Dreame cloud API format: command wrapped in "data" field
    const requestBody = {
      did,
      id,
      data: {
        did,
        id,
        method,
        params: formattedParams,
      },
    };

    this.log.info(`Sending cloud command: ${method}`);
    this.log.debug(`Request body: ${JSON.stringify(requestBody)}`);

    const response = await this.apiCall<ActionResponse>(DREAME_SEND_COMMAND_ENDPOINT, 'POST', requestBody);

    this.log.info(`Cloud command ${method} response: code=${response?.code}, msg=${response?.msg}, data=${JSON.stringify(response?.data)}`);

    if (response?.code !== 0) {
      this.log.error(`Cloud command ${method} failed: code=${response?.code}, msg=${response?.msg}`);
    }

    return response?.data;
  }

  /**
   * Register callback for device status updates.
   *
   * @param did
   * @param callback
   */
  onDeviceStatus(did: string, callback: (status: DeviceStatus) => void): void {
    this.deviceStatusCallbacks.set(did, callback);
  }

  /**
   * Poll device status to confirm command was executed successfully.
   * Checks if the device reached the expected state within the timeout.
   *
   * @param did - Device ID
   * @param expectedStates - Array of acceptable DreameState values
   * @param expectedStatuses - Array of acceptable DreameStatus values (optional)
   * @param maxAttempts - Maximum poll attempts (default 5)
   * @param pollIntervalMs - Interval between polls in ms (default 2000)
   */
  private async confirmCommandSuccess(
    did: string,
    expectedStates: DreameState[],
    expectedStatuses?: DreameStatus[],
    maxAttempts: number = 5,
    pollIntervalMs: number = 2000,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const status = await this.getDeviceProperties(did);
      if (!status) {
        this.log.debug(`Confirmation poll ${attempt}/${maxAttempts}: failed to get status`);
        continue;
      }

      const stateMatch = expectedStates.includes(status.state);
      const statusMatch = !expectedStatuses || expectedStatuses.includes(status.status);

      if (stateMatch && statusMatch) {
        this.log.info(`Command confirmed: state=${status.state}, status=${status.status}`);
        return true;
      }

      this.log.debug(`Confirmation poll ${attempt}/${maxAttempts}: state=${status.state}, status=${status.status} (expected states: ${expectedStates.join(',')})`);
    }

    this.log.warn(`Command confirmation failed after ${maxAttempts} attempts`);
    return false;
  }

  /**
   * Start vacuum cleaning.
   *
   * @param did - Device ID
   * @param confirm - Whether to poll and confirm command success
   */
  async startCleaning(did: string, confirm: boolean = false): Promise<boolean> {
    try {
      await this.sendCommand(did, 'action', [MIOT_ACTIONS.startClean.siid, MIOT_ACTIONS.startClean.aiid, []]);

      if (confirm) {
        return this.confirmCommandSuccess(did, [DreameState.Cleaning, DreameState.Mopping, DreameState.ZonedCleaning, DreameState.ManualCleaning]);
      }
      return true;
    } catch (error) {
      this.log.error(`Failed to start cleaning: ${error}`);
      return false;
    }
  }

  /**
   * Stop vacuum cleaning.
   *
   * @param did - Device ID
   * @param confirm - Whether to poll and confirm command success
   */
  async stopCleaning(did: string, confirm: boolean = false): Promise<boolean> {
    try {
      await this.sendCommand(did, 'action', [MIOT_ACTIONS.stopClean.siid, MIOT_ACTIONS.stopClean.aiid, []]);

      if (confirm) {
        return this.confirmCommandSuccess(did, [DreameState.Idle, DreameState.Paused, DreameState.Dormant]);
      }
      return true;
    } catch (error) {
      this.log.error(`Failed to stop cleaning: ${error}`);
      return false;
    }
  }

  /**
   * Pause vacuum cleaning.
   *
   * @param did - Device ID
   * @param confirm - Whether to poll and confirm command success
   */
  async pauseCleaning(did: string, confirm: boolean = false): Promise<boolean> {
    try {
      await this.sendCommand(did, 'action', [MIOT_ACTIONS.pauseClean.siid, MIOT_ACTIONS.pauseClean.aiid, []]);

      if (confirm) {
        return this.confirmCommandSuccess(did, [DreameState.Paused], [DreameStatus.Paused]);
      }
      return true;
    } catch (error) {
      this.log.error(`Failed to pause cleaning: ${error}`);
      return false;
    }
  }

  /**
   * Resume vacuum cleaning.
   *
   * @param did - Device ID
   * @param confirm - Whether to poll and confirm command success
   */
  async resumeCleaning(did: string, confirm: boolean = false): Promise<boolean> {
    try {
      await this.sendCommand(did, 'action', [MIOT_ACTIONS.startClean.siid, MIOT_ACTIONS.startClean.aiid, []]);

      if (confirm) {
        return this.confirmCommandSuccess(did, [DreameState.Cleaning, DreameState.Mopping, DreameState.ZonedCleaning, DreameState.ManualCleaning]);
      }
      return true;
    } catch (error) {
      this.log.error(`Failed to resume cleaning: ${error}`);
      return false;
    }
  }

  /**
   * Return vacuum to charging dock.
   *
   * @param did - Device ID
   * @param confirm - Whether to poll and confirm command success
   */
  async goHome(did: string, confirm: boolean = false): Promise<boolean> {
    try {
      await this.sendCommand(did, 'action', [MIOT_ACTIONS.charge.siid, MIOT_ACTIONS.charge.aiid, []]);

      if (confirm) {
        return this.confirmCommandSuccess(did, [DreameState.Returning, DreameState.GoCharging, DreameState.Charging, DreameState.Idle], [DreameStatus.BackHome, DreameStatus.Charging, DreameStatus.Standby]);
      }
      return true;
    } catch (error) {
      this.log.error(`Failed to send vacuum home: ${error}`);
      return false;
    }
  }

  /**
   * Locate the vacuum (play sound).
   *
   * @param did
   */
  async locate(did: string): Promise<boolean> {
    try {
      await this.sendCommand(did, 'action', [MIOT_ACTIONS.locate.siid, MIOT_ACTIONS.locate.aiid, []]);
      return true;
    } catch (error) {
      this.log.error(`Failed to locate vacuum: ${error}`);
      return false;
    }
  }

  /**
   * Clean specific rooms/segments.
   *
   * @param did
   * @param roomIds
   * @param repeat - Number of cleaning passes (default 1)
   * @param cleaningMode - 0=vacuum only, 1=mop only, 2=vacuum+mop (default 0)
   */
  async cleanRooms(did: string, roomIds: number[], repeat: number = 1, cleaningMode: number = 0): Promise<boolean> {
    try {
      this.log.info(`Setting cleaning mode to ${cleaningMode} (0=vacuum, 1=mop, 2=vacuum+mop)`);
      await this.sendCommand(did, 'set_properties', [
        {
          siid: MIOT_PROPERTIES.waterBoxMode.siid,
          piid: MIOT_PROPERTIES.waterBoxMode.piid,
          value: cleaningMode,
        },
      ]);

      // Segment format: [segment_id, repeat, fan, water, order]
      const waterLevel = cleaningMode === 0 ? 0 : 2;
      const segmentData = JSON.stringify({
        selects: roomIds.map((id, index) => [id, repeat, 2, waterLevel, index + 1]),
      });

      this.log.info(`Starting segment clean for rooms: ${roomIds.join(', ')} (mode=${cleaningMode}, water=${waterLevel})`);
      this.log.debug(`Segment data: ${segmentData}`);

      const payload = [
        { piid: MIOT_ACTION_PARAMS.status, value: DREAME_STATUS_VALUES.segmentCleaning },
        { piid: MIOT_ACTION_PARAMS.cleaningProperties, value: segmentData },
      ];

      await this.sendCommand(did, 'action', [MIOT_ACTIONS.startCustom.siid, MIOT_ACTIONS.startCustom.aiid, payload]);
      return true;
    } catch (error) {
      this.log.error(`Failed to clean rooms: ${error}`);
      return false;
    }
  }

  /**
   * Disconnect from all devices and cleanup.
   */
  async disconnect(): Promise<void> {
    for (const [did, client] of this.mqttClients) {
      this.log.info(`Disconnecting from ${did}`);
      client.end();
    }
    this.mqttClients.clear();
    this.pendingRequests.clear();
    this.deviceStatusCallbacks.clear();
    this.cachedStatus.clear();
    this.cachedRooms.clear();
    this.deviceModels.clear();
    this.deviceOwnerIds.clear();
    this.session = null;
  }
}
