/**
 * Dreame vacuum device implementation with Matter 1.4 RVC clusters.
 *
 * @file dreame.ts
 * @license Apache-2.0
 */

import { RoboticVacuumCleaner } from 'matterbridge/devices';

import type { DreamePlatform } from './platform.js';
import type { DreameCloudProtocol } from './dreameCloud.js';
import type { DreameDevice, DeviceStatus, RoomInfo } from './types.js';
import { DreameState, DreameStatus, DreameFanSpeed } from './types.js';
import { getOperationalStateFromDreame, getOperationalErrorFromDreame } from './constants.js';

const BatChargeState = {
  Unknown: 0,
  IsCharging: 1,
  IsAtFullCharge: 2,
  IsNotCharging: 3,
} as const;

export interface DreameVacuumDevice {
  did: string;
  name: string;
  model: string;
  device: RoboticVacuumCleaner;
  updateStatus: (status: DeviceStatus) => void;
  updateRooms: (rooms: RoomInfo[]) => void;
}

// RVC Mode Tag constants
const RvcRunModeTag = {
  Idle: 16384,
  Cleaning: 16385,
  Mapping: 16386,
} as const;

const RvcCleanModeTag = {
  DeepClean: 16384,
  Vacuum: 16385,
  Mop: 16386,
  QuietMode: 2,
  Max: 7,
} as const;

// RVC Operational State values (Matter 1.4)
const RvcOperationalStateValue = {
  Stopped: 0x00,
  Running: 0x01,
  Paused: 0x02,
  Error: 0x03,
  SeekingCharger: 0x40,
  Charging: 0x41,
  Docked: 0x42,
} as const;

const ServiceAreaType = {
  Room: 0,
} as const;

const RVC_RUN_MODES = [
  { label: 'Idle', mode: 0, modeTags: [{ value: RvcRunModeTag.Idle }] },
  { label: 'Cleaning', mode: 1, modeTags: [{ value: RvcRunModeTag.Cleaning }] },
  { label: 'Mapping', mode: 2, modeTags: [{ value: RvcRunModeTag.Mapping }] },
];

const RVC_CLEAN_MODES = [
  { label: 'Vacuum', mode: 0, modeTags: [{ value: RvcCleanModeTag.Vacuum }] },
  { label: 'Vacuum & Mop', mode: 1, modeTags: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }] },
  { label: 'Mop Only', mode: 2, modeTags: [{ value: RvcCleanModeTag.Mop }] },
  { label: 'Quiet', mode: 3, modeTags: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.QuietMode }] },
  { label: 'Standard', mode: 4, modeTags: [{ value: RvcCleanModeTag.Vacuum }] },
  { label: 'Strong', mode: 5, modeTags: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Max }] },
  { label: 'Turbo', mode: 6, modeTags: [{ value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Max }] },
  { label: 'Vacuum Then Mop', mode: 7, modeTags: [{ value: RvcCleanModeTag.DeepClean }, { value: RvcCleanModeTag.Vacuum }, { value: RvcCleanModeTag.Mop }] },
];

// operationalStateLabel must NOT be set for standard states (0-127) per Matter spec
const RVC_OPERATIONAL_STATES = [
  { operationalStateId: RvcOperationalStateValue.Stopped },
  { operationalStateId: RvcOperationalStateValue.Running },
  { operationalStateId: RvcOperationalStateValue.Paused },
  { operationalStateId: RvcOperationalStateValue.Error },
  { operationalStateId: RvcOperationalStateValue.SeekingCharger },
  { operationalStateId: RvcOperationalStateValue.Charging },
  { operationalStateId: RvcOperationalStateValue.Docked },
];

/**
 * Discover and register Dreame vacuum as Matter RVC device.
 *
 * @param platform
 * @param cloud
 * @param device
 * @param rooms
 * @param initialStatus
 */
export async function discoverAndRegisterDevices(
  platform: DreamePlatform,
  cloud: DreameCloudProtocol,
  device: DreameDevice,
  rooms: RoomInfo[],
  initialStatus: DeviceStatus | null,
): Promise<DreameVacuumDevice | null> {
  const { log } = platform;

  log.info(`Creating Matter RVC device for ${device.name} (${device.model})`);

  // Generate service areas from rooms
  // Note: mapId must be null when supportedMaps is empty (Matter spec requirement)
  const supportedAreas =
    rooms.length > 0
      ? rooms.map((room) => ({
          areaId: room.id,
          mapId: null, // Must be null when supportedMaps is empty
          areaInfo: {
            locationInfo: {
              locationName: room.name,
              floorNumber: room.floorId ?? null,
              areaType: ServiceAreaType.Room,
            },
            landmarkInfo: null,
          },
        }))
      : [
          // Default area if no rooms available
          {
            areaId: 1,
            mapId: null,
            areaInfo: {
              locationInfo: {
                locationName: 'Home',
                floorNumber: null,
                areaType: ServiceAreaType.Room,
              },
              landmarkInfo: null,
            },
          },
        ];

  // Determine initial operational state
  const initialOperationalState = initialStatus ? getOperationalStateFromDreame(initialStatus.state, initialStatus.status) : RvcOperationalStateValue.Docked;

  // Determine initial run mode from status (must match logic in updateStatus)
  // Definitive dock statuses override any stale state values
  const definitiveDockedStatuses = [DreameStatus.Charging, DreameStatus.ChargingComplete, DreameStatus.Sleeping, DreameStatus.Standby, DreameStatus.Idle];
  let initialRunMode = 0; // Idle
  if (initialStatus && !definitiveDockedStatuses.includes(initialStatus.status)) {
    const activeCleaningStates = [
      DreameState.Cleaning,
      DreameState.Mopping,
      DreameState.ManualCleaning,
      DreameState.ZonedCleaning,
      DreameState.SpotCleaning,
      DreameState.CruiseRunning,
    ];
    const activeCleaningStatuses = [
      DreameStatus.Sweeping,
      DreameStatus.Mopping,
      DreameStatus.SweepingAndMopping,
      DreameStatus.SegmentCleaning,
      DreameStatus.ZoneCleaning,
      DreameStatus.SpotCleaning,
    ];
    if (activeCleaningStates.includes(initialStatus.state) || activeCleaningStatuses.includes(initialStatus.status)) {
      initialRunMode = 1; // Cleaning
    } else if (initialStatus.state === DreameState.FastMapping || initialStatus.status === DreameStatus.FastMapping) {
      initialRunMode = 2; // Mapping
    }
  }

  // Create the RVC device using RoboticVacuumCleaner class
  // Use 'server' mode for Apple Home compatibility
  const rvc = new RoboticVacuumCleaner(
    device.name, // name
    device.did, // serial
    'server', // mode - server for Apple Home compatibility
    initialRunMode, // currentRunMode - computed from initial status
    RVC_RUN_MODES, // supportedRunModes
    4, // currentCleanMode (Standard)
    RVC_CLEAN_MODES, // supportedCleanModes
    null, // currentPhase
    null, // phaseList
    initialOperationalState, // operationalState
    RVC_OPERATIONAL_STATES, // operationalStateList
    supportedAreas, // supportedAreas
    [], // selectedAreas (empty = all allowed)
    supportedAreas[0]?.areaId ?? 1, // currentArea
    [], // supportedMaps
  );

  // Set additional identifiers
  rvc.uniqueId = device.did;

  // State tracking for updates
  let trackedRunMode = initialRunMode;
  let trackedCleanMode = 4; // Standard
  let trackedOperationalState = initialOperationalState;
  let trackedError: number | null | undefined = undefined; // undefined = not yet set
  let selectedAreas: number[] = [];

  // ============================================================================
  // Command Handlers
  // ============================================================================

  // Identify command (locate vacuum)
  rvc.addCommandHandler('identify', async () => {
    log.info(`Identify command for ${device.name}`);
    await cloud.locate(device.did);
  });

  // changeToMode command handler - shared by RvcRunMode and RvcCleanMode clusters
  // Matterbridge passes the cluster name (e.g., "rvcRunMode", "rvcCleanMode") to distinguish
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rvc.addCommandHandler('changeToMode', async (data: any) => {
    const newMode = data.request?.newMode ?? data.newMode;
    const clusterName = data.cluster as string | undefined;

    log.debug(`changeToMode: cluster=${clusterName}, newMode=${newMode}`);

    if (newMode === undefined) {
      log.warn(`changeToMode: newMode is undefined, cannot process command`);
      return;
    }

    // Matterbridge passes cluster name as string: "rvcRunMode" or "rvcCleanMode"
    const isRunMode = clusterName === 'rvcRunMode' || clusterName === undefined;
    const isCleanMode = clusterName === 'rvcCleanMode';

    if (isRunMode) {
      // RvcRunMode: Change running mode (Idle=0, Cleaning=1, Mapping=2)
      log.info(`RvcRunMode.changeToMode for ${device.name}: mode=${newMode}`);

      if (newMode === 0) {
        // Idle - Stop cleaning
        const success = await cloud.stopCleaning(device.did);
        if (success) {
          trackedRunMode = 0;
          rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
        }
      } else if (newMode === 1) {
        // Cleaning - Start cleaning
        // Map RvcCleanMode to Dreame cleaning mode:
        // RvcCleanMode: 0=Vacuum, 1=Vacuum&Mop, 2=MopOnly, 3-6=fan speeds (use current), 7=VacuumThenMop
        // Dreame: 0=Sweeping(vacuum), 1=Mopping(mop), 2=Sweeping&Mopping(vacuum+mop)
        const rvcModeToDreameCleanMode: Record<number, number> = {
          0: 0, // Vacuum → Sweeping
          1: 2, // Vacuum&Mop → Sweeping&Mopping
          2: 1, // MopOnly → Mopping
          3: 0, // Quiet → Sweeping (fan speed modes default to vacuum)
          4: 0, // Standard → Sweeping
          5: 0, // Strong → Sweeping
          6: 0, // Turbo → Sweeping
          7: 2, // VacuumThenMop → Sweeping&Mopping
        };
        const dreameCleanMode = rvcModeToDreameCleanMode[trackedCleanMode] ?? 0;
        log.info(`Cleaning mode: RvcCleanMode=${trackedCleanMode} → Dreame=${dreameCleanMode} (0=vacuum, 1=mop, 2=vacuum+mop)`);

        const success = selectedAreas.length > 0 ? await cloud.cleanRooms(device.did, selectedAreas, 1, dreameCleanMode) : await cloud.startCleaning(device.did);
        if (success) {
          trackedRunMode = 1;
          rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
        }
      } else if (newMode === 2) {
        // Mapping - Not directly controllable via MIOT
        // Fast mapping must be initiated from the Dreame app
        log.warn(`Mapping mode (2) cannot be started via Matter - use the Dreame app to initiate mapping`);
      }
    } else if (isCleanMode) {
      // RvcCleanMode: Change cleaning mode (vacuum/mop selection and fan speed preference)
      // Modes: 0=Vacuum, 1=Vacuum&Mop, 2=MopOnly, 3=Quiet, 4=Standard, 5=Strong, 6=Turbo, 7=VacuumThenMop
      log.info(`RvcCleanMode.changeToMode for ${device.name}: mode=${newMode}`);

      // Reject mode changes while actively cleaning - Dreame vacuums can't change mode mid-operation
      if (trackedOperationalState === RvcOperationalStateValue.Running) {
        log.warn(`Cannot change clean mode while actively cleaning - pause or stop first`);
        return; // Reject the mode change
      }

      // Update the tracked mode - will be applied when cleaning starts via cleanRooms()
      trackedCleanMode = newMode;
      rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    }
  });

  // RvcOperationalState: Pause command
  rvc.addCommandHandler('pause', async () => {
    log.info(`Pause command for ${device.name}`);
    const success = await cloud.pauseCleaning(device.did);
    if (success) {
      // Set run mode to Idle and operational state to Paused
      trackedRunMode = 0; // Idle
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.Paused;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }
  });

  // RvcOperationalState: Resume command
  rvc.addCommandHandler('resume', async () => {
    log.info(`Resume command for ${device.name}`);
    const success = await cloud.resumeCleaning(device.did);
    if (success) {
      // Set run mode to Cleaning and operational state to Running
      trackedRunMode = 1; // Cleaning
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.Running;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }
  });

  // RvcOperationalState: GoHome command
  // Acts as a stop operation: stops cleaning first, then sends vacuum home
  rvc.addCommandHandler('goHome', async () => {
    log.info(`GoHome command for ${device.name} - stopping cleaning and returning to dock`);

    // Stop cleaning first (this halts any active cleaning operation)
    await cloud.stopCleaning(device.did);

    // Then send to dock
    const success = await cloud.goHome(device.did);
    if (success) {
      trackedRunMode = 0; // Idle
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
      trackedOperationalState = RvcOperationalStateValue.SeekingCharger;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }
  });

  // ServiceArea: SelectAreas command
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rvc.addCommandHandler('selectAreas', async (data: any) => {
    const areas: number[] | undefined = data.request?.newAreas ?? data.newAreas;
    log.info(`SelectAreas command for ${device.name}: areas=${areas?.join(', ')}`);

    if (areas && areas.length > 0) {
      selectedAreas = areas;
      rvc.setAttribute('ServiceArea', 'selectedAreas', selectedAreas, log);
    }
  });

  // ============================================================================
  // Status Update Handler
  // ============================================================================

  /**
   *
   * @param status
   */
  function updateStatus(status: DeviceStatus): void {
    // Update operational state
    const newOperationalState = getOperationalStateFromDreame(status.state, status.status);
    if (newOperationalState !== trackedOperationalState) {
      log.info(`Operational state: ${trackedOperationalState} -> ${newOperationalState} (state=${status.state}, status=${status.status})`);
      trackedOperationalState = newOperationalState;
      rvc.setAttribute('RvcOperationalState', 'operationalState', trackedOperationalState, log);
    }

    // Update run mode based on state and status
    // IMPORTANT: Check definitive dock statuses FIRST - these override stale state values
    // The device may report state=ManualCleaning while status=Charging when idle at dock
    let newRunMode = 0; // Idle
    const definitiveDockedStatuses = [DreameStatus.Charging, DreameStatus.ChargingComplete, DreameStatus.Sleeping, DreameStatus.Standby, DreameStatus.Idle];

    if (!definitiveDockedStatuses.includes(status.status)) {
      // Only check for active cleaning if NOT at dock
      const activeCleaningStates = [
        DreameState.Cleaning,
        DreameState.Mopping,
        DreameState.ManualCleaning,
        DreameState.ZonedCleaning,
        DreameState.SpotCleaning,
        DreameState.CruiseRunning,
      ];
      const activeCleaningStatuses = [
        DreameStatus.Sweeping,
        DreameStatus.Mopping,
        DreameStatus.SweepingAndMopping,
        DreameStatus.SegmentCleaning,
        DreameStatus.ZoneCleaning,
        DreameStatus.SpotCleaning,
      ];

      if (activeCleaningStates.includes(status.state) || activeCleaningStatuses.includes(status.status)) {
        newRunMode = 1; // Cleaning
      } else if (status.state === DreameState.FastMapping || status.status === DreameStatus.FastMapping) {
        newRunMode = 2; // Mapping - only for explicit fast mapping mode (user-initiated)
      }
    }
    if (newRunMode !== trackedRunMode) {
      log.info(`Run mode: ${trackedRunMode} -> ${newRunMode} (state=${status.state}, status=${status.status})`);
      trackedRunMode = newRunMode;
      rvc.setAttribute('RvcRunMode', 'currentMode', trackedRunMode, log);
    }

    // Update error state (Matter requires operationalError to always be set)
    const newError = getOperationalErrorFromDreame(status.errorCode);
    if (newError !== trackedError) {
      trackedError = newError;
      // errorStateId 0 = NoError, always set this attribute
      const errorStateId = trackedError ?? 0;
      rvc.setAttribute('RvcOperationalState', 'operationalError', { errorStateId }, log);
    }

    // Update battery level and charging state (skip 0% - likely from partial MQTT update without battery data)
    if (status.battery > 0) {
      try {
        rvc.setAttribute('PowerSource', 'batPercentRemaining', status.battery * 2, log); // Matter uses 0-200

        // Set charging state based on DreameState AND DreameStatus
        // Device may report state=DustBagDryingPaused but status=Charging
        let chargeState: number = BatChargeState.Unknown;
        const isCharging = status.state === DreameState.Charging || status.status === DreameStatus.Charging;
        const isChargingComplete = status.status === DreameStatus.ChargingComplete;

        if (isCharging || isChargingComplete) {
          chargeState = status.battery >= 100 ? BatChargeState.IsAtFullCharge : BatChargeState.IsCharging;
        } else if ((status.state === DreameState.Idle || status.state === DreameState.Dormant || status.state === DreameState.Sleeping) && status.battery >= 100) {
          chargeState = BatChargeState.IsAtFullCharge;
        } else {
          chargeState = BatChargeState.IsNotCharging;
        }
        rvc.setAttribute('PowerSource', 'batChargeState', chargeState, log);
        log.debug(`Battery: ${status.battery}%, state: ${status.state}, status: ${status.status}, chargeState: ${chargeState}`);
      } catch {
        // PowerSource may not be available
      }
    }

    // Update fan speed to clean mode
    const fanSpeedToCleanMode: Record<DreameFanSpeed, number> = {
      [DreameFanSpeed.Quiet]: 3,
      [DreameFanSpeed.Standard]: 4,
      [DreameFanSpeed.Strong]: 5,
      [DreameFanSpeed.Turbo]: 6,
    };
    const newCleanMode = fanSpeedToCleanMode[status.fanSpeed] ?? 4;
    if (newCleanMode !== trackedCleanMode) {
      trackedCleanMode = newCleanMode;
      rvc.setAttribute('RvcCleanMode', 'currentMode', trackedCleanMode, log);
    }

    // Update current area if cleaning
    if (status.currentArea !== undefined) {
      try {
        rvc.setAttribute('ServiceArea', 'currentArea', status.currentArea, log);
      } catch {
        // ServiceArea may not be supported
      }
    }
  }

  // ============================================================================
  // Room Update Handler
  // ============================================================================

  /**
   *
   * @param newRooms
   */
  function updateRooms(newRooms: RoomInfo[]): void {
    if (newRooms.length === 0) {
      return;
    }

    log.info(`Updating ServiceArea with ${newRooms.length} rooms: ${newRooms.map((r) => r.name).join(', ')}`);

    // Generate new service areas from rooms
    // Note: mapId must be null when supportedMaps is empty (Matter spec requirement)
    const newSupportedAreas = newRooms.map((room) => ({
      areaId: room.id,
      mapId: null, // Must be null when supportedMaps is empty
      areaInfo: {
        locationInfo: {
          locationName: room.name,
          floorNumber: room.floorId ?? null,
          areaType: ServiceAreaType.Room,
        },
        landmarkInfo: null,
      },
    }));

    try {
      rvc.setAttribute('ServiceArea', 'supportedAreas', newSupportedAreas, log);
      log.info(`ServiceArea updated successfully with ${newRooms.length} rooms`);
    } catch (error) {
      log.error(`Failed to update ServiceArea: ${error}`);
    }
  }

  // ============================================================================
  // Register Device
  // ============================================================================

  try {
    await platform.registerDevice(rvc);
    log.info(`Registered ${device.name} as Matter RVC device with full cluster support`);

    // Force-set operational state and run mode to override any persisted values from previous sessions
    // This is critical because matterbridge persists attribute values, and our tracking
    // variables won't know about stale persisted values
    rvc.setAttribute('RvcOperationalState', 'operationalState', initialOperationalState, log);
    log.info(`Set initial operational state to ${initialOperationalState} (0=Stopped, 1=Running, 2=Paused, 3=Error, 64=SeekingCharger, 65=Charging, 66=Docked)`);

    rvc.setAttribute('RvcRunMode', 'currentMode', initialRunMode, log);
    log.info(`Set initial run mode to ${initialRunMode} (0=Idle, 1=Cleaning, 2=Mapping)`);

    // Set initial error state (required by Matter - must always be set)
    const initialError = initialStatus ? getOperationalErrorFromDreame(initialStatus.errorCode) : null;
    rvc.setAttribute('RvcOperationalState', 'operationalError', { errorStateId: initialError ?? 0 }, log);

    // Set initial status AFTER device is registered (endpoint must be active)
    if (initialStatus) {
      updateStatus(initialStatus);
    }

    return {
      did: device.did,
      name: device.name,
      model: device.model,
      device: rvc,
      updateStatus,
      updateRooms,
    };
  } catch (error) {
    log.error(`Failed to register device ${device.name}: ${error}`);
    return null;
  }
}
