/**
 * Constants and mappings for the Matterbridge Dreame plugin.
 * Includes Dreame state mappings and cloud API constants.
 *
 * @file constants.ts
 * @license Apache-2.0
 */

import { DreameState, DreameStatus, DreameErrorCode, type MiotProperty, type MiotAction } from './types.js';

// RVC Operational State IDs (Matter 1.4)
const RvcOperationalStateId = {
  Stopped: 0x00,
  Running: 0x01,
  Paused: 0x02,
  Error: 0x03,
  SeekingCharger: 0x40,
  Charging: 0x41,
  Docked: 0x42,
} as const;

// RVC Operational Error IDs (Matter 1.4)
const RvcOperationalErrorId = {
  NoError: 0,
  UnableToStartOrResume: 1,
  UnableToCompleteOperation: 2,
  CommandInvalidInState: 3,
  FailedToFindChargingDock: 64,
  Stuck: 65,
  DustBinMissing: 66,
  DustBinFull: 67,
  WaterTankEmpty: 68,
  WaterTankMissing: 69,
  WaterTankLidOpen: 70,
  MopCleaningPadMissing: 71,
} as const;

// Dreame State to Matter Operational State mapping
const dreameStateToOperationalState: Partial<Record<DreameState, number>> = {
  [DreameState.Unknown]: RvcOperationalStateId.Stopped,
  [DreameState.Idle]: RvcOperationalStateId.Docked,
  [DreameState.Paused]: RvcOperationalStateId.Paused,
  [DreameState.Cleaning]: RvcOperationalStateId.Running,
  [DreameState.GoCharging]: RvcOperationalStateId.SeekingCharger,
  [DreameState.Error]: RvcOperationalStateId.Error,
  [DreameState.Mopping]: RvcOperationalStateId.Running,
  [DreameState.Charging]: RvcOperationalStateId.Charging,
  [DreameState.Drying]: RvcOperationalStateId.Docked,
  [DreameState.Dormant]: RvcOperationalStateId.Docked,
  [DreameState.Washing]: RvcOperationalStateId.Docked,
  [DreameState.Returning]: RvcOperationalStateId.SeekingCharger,
  [DreameState.Defecating]: RvcOperationalStateId.Docked,
  [DreameState.Building]: RvcOperationalStateId.Running,
  [DreameState.ManualCleaning]: RvcOperationalStateId.Running,
  [DreameState.Sleeping]: RvcOperationalStateId.Docked,
  [DreameState.WaitingForTask]: RvcOperationalStateId.Docked,
  [DreameState.StationPaused]: RvcOperationalStateId.Paused,
  [DreameState.ManualPaused]: RvcOperationalStateId.Paused,
  [DreameState.ZonedPaused]: RvcOperationalStateId.Paused,
  [DreameState.ZonedCleaning]: RvcOperationalStateId.Running,
  [DreameState.SpotCleaning]: RvcOperationalStateId.Running,
  [DreameState.FastMapping]: RvcOperationalStateId.Running,
  [DreameState.CruiseWaiting]: RvcOperationalStateId.Docked,
  [DreameState.CruiseRunning]: RvcOperationalStateId.Running,
  [DreameState.SecondCleaning]: RvcOperationalStateId.Running,
  [DreameState.HumanFollowing]: RvcOperationalStateId.Running,
  [DreameState.SpotCleaningPaused]: RvcOperationalStateId.Paused,
  [DreameState.ReturningAutoEmpty]: RvcOperationalStateId.SeekingCharger,
  [DreameState.CleaningAutoEmpty]: RvcOperationalStateId.Running,
  [DreameState.StationCleaning]: RvcOperationalStateId.Docked,
  [DreameState.ReturningToDrain]: RvcOperationalStateId.SeekingCharger,
  [DreameState.Draining]: RvcOperationalStateId.Docked,
  [DreameState.AutoWaterDraining]: RvcOperationalStateId.Docked,
  [DreameState.Emptying]: RvcOperationalStateId.Docked,
  [DreameState.DustBagDrying]: RvcOperationalStateId.Docked,
  [DreameState.DustBagDryingPaused]: RvcOperationalStateId.Paused,
  [DreameState.HeadingToExtraCleaning]: RvcOperationalStateId.Running,
  [DreameState.ExtraCleaning]: RvcOperationalStateId.Running,
  [DreameState.FindingPetPaused]: RvcOperationalStateId.Paused,
  [DreameState.FindingPet]: RvcOperationalStateId.Running,
  [DreameState.Shortcut]: RvcOperationalStateId.Running,
  [DreameState.Monitoring]: RvcOperationalStateId.Running,
  [DreameState.MonitoringPaused]: RvcOperationalStateId.Paused,
  [DreameState.InitialDeepCleaning]: RvcOperationalStateId.Running,
  [DreameState.InitialDeepCleaningPaused]: RvcOperationalStateId.Paused,
  [DreameState.Sanitizing]: RvcOperationalStateId.Running,
  [DreameState.SanitizingWithDry]: RvcOperationalStateId.Running,
};

// Dreame Status to Matter Operational State mapping
const dreameStatusToOperationalState: Partial<Record<DreameStatus, number>> = {
  [DreameStatus.Unknown]: RvcOperationalStateId.Stopped,
  [DreameStatus.Idle]: RvcOperationalStateId.Docked,
  [DreameStatus.Paused]: RvcOperationalStateId.Paused,
  [DreameStatus.Cleaning]: RvcOperationalStateId.Running,
  [DreameStatus.BackHome]: RvcOperationalStateId.SeekingCharger,
  [DreameStatus.PartCleaning]: RvcOperationalStateId.Running,
  [DreameStatus.FollowWall]: RvcOperationalStateId.Running,
  [DreameStatus.Charging]: RvcOperationalStateId.Charging,
  [DreameStatus.OTA]: RvcOperationalStateId.Stopped,
  [DreameStatus.FCT]: RvcOperationalStateId.Stopped,
  [DreameStatus.WifiSet]: RvcOperationalStateId.Stopped,
  [DreameStatus.PowerOff]: RvcOperationalStateId.Stopped,
  [DreameStatus.Factory]: RvcOperationalStateId.Stopped,
  [DreameStatus.Error]: RvcOperationalStateId.Error,
  [DreameStatus.RemoteControl]: RvcOperationalStateId.Running,
  [DreameStatus.Sleeping]: RvcOperationalStateId.Docked,
  [DreameStatus.SelfRepair]: RvcOperationalStateId.Running,
  [DreameStatus.FactoryTest]: RvcOperationalStateId.Stopped,
  [DreameStatus.Standby]: RvcOperationalStateId.Docked,
  [DreameStatus.SegmentCleaning]: RvcOperationalStateId.Running,
  [DreameStatus.ZoneCleaning]: RvcOperationalStateId.Running,
  [DreameStatus.SpotCleaning]: RvcOperationalStateId.Running,
  [DreameStatus.FastMapping]: RvcOperationalStateId.Running,
  [DreameStatus.CruisingPath]: RvcOperationalStateId.Running,
  [DreameStatus.CruisingPoint]: RvcOperationalStateId.Running,
  [DreameStatus.SummonClean]: RvcOperationalStateId.Running,
  [DreameStatus.Shortcut]: RvcOperationalStateId.Running,
  [DreameStatus.PersonFollow]: RvcOperationalStateId.Running,
  [DreameStatus.WaterCheck]: RvcOperationalStateId.Docked,
  [DreameStatus.Sweeping]: RvcOperationalStateId.Running,
  [DreameStatus.Mopping]: RvcOperationalStateId.Running,
  [DreameStatus.SweepingAndMopping]: RvcOperationalStateId.Running,
  [DreameStatus.Drying]: RvcOperationalStateId.Docked,
  [DreameStatus.Washing]: RvcOperationalStateId.Docked,
  [DreameStatus.ReturningWashing]: RvcOperationalStateId.SeekingCharger,
  [DreameStatus.Building]: RvcOperationalStateId.Running,
  [DreameStatus.ChargingComplete]: RvcOperationalStateId.Docked,
  [DreameStatus.Upgrading]: RvcOperationalStateId.Stopped,
  [DreameStatus.CleanSummarizing]: RvcOperationalStateId.Docked,
  [DreameStatus.StationReset]: RvcOperationalStateId.Docked,
  [DreameStatus.ReturningDrain]: RvcOperationalStateId.SeekingCharger,
  [DreameStatus.SelfRepairing]: RvcOperationalStateId.Running,
  [DreameStatus.SelfWashing]: RvcOperationalStateId.Docked,
  [DreameStatus.BackWashing]: RvcOperationalStateId.Docked,
  [DreameStatus.SelfRefresh]: RvcOperationalStateId.Docked,
  [DreameStatus.SelfDrying]: RvcOperationalStateId.Docked,
  [DreameStatus.WaterCheckStart]: RvcOperationalStateId.Docked,
  [DreameStatus.WaterDraining]: RvcOperationalStateId.Docked,
  [DreameStatus.DryingStart]: RvcOperationalStateId.Docked,
  [DreameStatus.AutoEmptying]: RvcOperationalStateId.Docked,
  [DreameStatus.FillingWater]: RvcOperationalStateId.Docked,
};

// Dreame Error Code to Matter Operational Error mapping
const dreameErrorToOperationalError: Partial<Record<DreameErrorCode, number | null>> = {
  [DreameErrorCode.None]: null,
  [DreameErrorCode.Drop]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.Cliff]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.Bumper]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.Gesture]: RvcOperationalErrorId.UnableToStartOrResume,
  [DreameErrorCode.BumperRepeat]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.DropRepeat]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.OpticalFlow]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.NoBox]: RvcOperationalErrorId.DustBinMissing,
  [DreameErrorCode.NoTankBox]: RvcOperationalErrorId.WaterTankMissing,
  [DreameErrorCode.WaterBoxEmpty]: RvcOperationalErrorId.WaterTankEmpty,
  [DreameErrorCode.BoxFull]: RvcOperationalErrorId.DustBinFull,
  [DreameErrorCode.Brush]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.SideBrush]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.Fan]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.LeftWheelMotor]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.RightWheelMotor]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.TurnSuffocate]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.ForwardSuffocate]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.ChargerGet]: RvcOperationalErrorId.FailedToFindChargingDock,
  [DreameErrorCode.BatteryLow]: RvcOperationalErrorId.UnableToStartOrResume,
  [DreameErrorCode.ChargeFault]: RvcOperationalErrorId.UnableToStartOrResume,
  [DreameErrorCode.BatteryPercentage]: RvcOperationalErrorId.UnableToStartOrResume,
  [DreameErrorCode.Heart]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.CameraOcclusion]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.CameraFault]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.EventBattery]: RvcOperationalErrorId.UnableToStartOrResume,
  [DreameErrorCode.ForwardLooking]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.Gyroscope]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.WheelJammed]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.DirtyTankFull]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.DirtyTankMissing]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.WaterTankLidOpen]: RvcOperationalErrorId.WaterTankLidOpen,
  [DreameErrorCode.MopPadMissing]: RvcOperationalErrorId.MopCleaningPadMissing,
  [DreameErrorCode.FilterBlocked]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.StationDisconnected]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.NavigationBlocked]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.CannotReachArea]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.DustBagFull]: RvcOperationalErrorId.DustBinFull,
  [DreameErrorCode.DustBagMissing]: RvcOperationalErrorId.DustBinMissing,
  [DreameErrorCode.WaterPump]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.CleanTankMissing]: RvcOperationalErrorId.WaterTankMissing,
  [DreameErrorCode.LidarBlocked]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.RouteBlocked]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.MainBrushJammed]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.SideBrushJammed]: RvcOperationalErrorId.Stuck,
  [DreameErrorCode.FilterClogged]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.DustBinNotInstalled]: RvcOperationalErrorId.DustBinMissing,
  [DreameErrorCode.StationWaterEmpty]: RvcOperationalErrorId.WaterTankEmpty,
  [DreameErrorCode.StationWaterDirty]: RvcOperationalErrorId.UnableToCompleteOperation,
  [DreameErrorCode.StationDustFull]: RvcOperationalErrorId.DustBinFull,
  [DreameErrorCode.ReturnFailed]: RvcOperationalErrorId.FailedToFindChargingDock,
};

// MIOT Property IDs (siid/piid pairs)
export const MIOT_PROPERTIES = {
  operatingMode: { siid: 2, piid: 1 } as MiotProperty,
  deviceFault: { siid: 2, piid: 2 } as MiotProperty,
  batteryLevel: { siid: 3, piid: 1 } as MiotProperty,
  chargingState: { siid: 3, piid: 2 } as MiotProperty,
  deviceStatus: { siid: 4, piid: 1 } as MiotProperty,
  suctionLevel: { siid: 4, piid: 4 } as MiotProperty,
  waterFlow: { siid: 4, piid: 5 } as MiotProperty,
  waterBoxMode: { siid: 4, piid: 25 } as MiotProperty,
  waterTankInstalled: { siid: 5, piid: 1 } as MiotProperty,
  mopPadInstalled: { siid: 5, piid: 2 } as MiotProperty,
  dustCollectionStatus: { siid: 9, piid: 1 } as MiotProperty,
  cleanWaterTankStatus: { siid: 9, piid: 2 } as MiotProperty,
  dirtyWaterTankStatus: { siid: 9, piid: 3 } as MiotProperty,
};

// MIOT Action IDs (siid/aiid pairs)
export const MIOT_ACTIONS = {
  startClean: { siid: 2, aiid: 1 } as MiotAction,
  pauseClean: { siid: 2, aiid: 2 } as MiotAction,
  charge: { siid: 3, aiid: 1 } as MiotAction,
  startCustom: { siid: 4, aiid: 1 } as MiotAction,
  stopClean: { siid: 4, aiid: 2 } as MiotAction,
  clearWarning: { siid: 4, aiid: 3 } as MiotAction,
  requestMap: { siid: 6, aiid: 1 } as MiotAction,
  locate: { siid: 7, aiid: 1 } as MiotAction,
};

// Action parameter IDs for START_CUSTOM
export const MIOT_ACTION_PARAMS = {
  status: 1,
  cleaningProperties: 10,
};

// Status values for START_CUSTOM action
export const DREAME_STATUS_VALUES = {
  segmentCleaning: 18,
};

// Dreame Cloud API configuration
const DREAME_API_DOMAIN = '.iot.dreame.tech';
const DREAME_API_PORT = '13267';
const DREAME_USER_AGENT = 'Dreame_Smarthome/2.1.9 (iPhone; iOS 18.4.1; Scale/3.00)';
const DREAME_TENANT_ID = '000000';

export const DREAME_AUTH_HEADER = 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=';
export const DREAME_PASSWORD_SALT = 'RAylYC%fmSKp7%Tq';
export const DREAME_CLIENT_ID = '1c80b3787b2266776bcdc481f37d8fa42ba10a30af81a6df-1';

export const DREAME_AUTH_ENDPOINT = '/dreame-auth/oauth/token';
export const DREAME_DEVICE_LIST_ENDPOINT = '/dreame-user-iot/iotuserbind/device/listV2';
export const DREAME_SEND_COMMAND_ENDPOINT = '/dreame-iot-com-10000/device/sendCommand';
export const DREAME_GET_DEVICE_DATA_ENDPOINT = '/dreame-user-iot/iotuserdata/getDeviceData';

export function getDreameApiUrl(country: string): string {
  return `https://${country}${DREAME_API_DOMAIN}:${DREAME_API_PORT}`;
}

export function getDreameUserAgent(): string {
  return DREAME_USER_AGENT;
}

export function getDreameTenantId(): string {
  return DREAME_TENANT_ID;
}

export function isSupportedModel(model: string): boolean {
  return model.startsWith('dreame.vacuum');
}

// Statuses that definitively indicate device is at dock (override stale state values)
const definitiveDockedStatuses = new Set([
  DreameStatus.Charging,
  DreameStatus.ChargingComplete,
  DreameStatus.Sleeping,
  DreameStatus.Standby,
  DreameStatus.Idle,
  DreameStatus.Drying,
  DreameStatus.Washing,
  DreameStatus.SelfWashing,
  DreameStatus.SelfDrying,
  DreameStatus.AutoEmptying,
  DreameStatus.FillingWater,
]);

// States that indicate active operations away from dock
const activeOperationStates = new Set([
  DreameState.Cleaning,
  DreameState.Mopping,
  DreameState.ZonedCleaning,
  DreameState.SpotCleaning,
  DreameState.ManualCleaning,
  DreameState.CruiseRunning,
  DreameState.Building,
  DreameState.FastMapping,
  DreameState.Returning,
  DreameState.GoCharging,
]);

/**
 * Map Dreame state/status to Matter RVC operational state.
 * Prioritizes paused status, definitive dock statuses, then checks for active operations.
 */
export function getOperationalStateFromDreame(state: DreameState, status: DreameStatus): number {
  const stateMapping = dreameStateToOperationalState[state];
  const statusMapping = dreameStatusToOperationalState[status];

  // Paused status takes priority - if vacuum reports paused, honor it
  if (status === DreameStatus.Paused) {
    return RvcOperationalStateId.Paused;
  }

  // Dock statuses override stale state values (e.g., state=ManualCleaning but status=Charging)
  if (definitiveDockedStatuses.has(status) && statusMapping !== undefined) {
    return statusMapping;
  }

  if (activeOperationStates.has(state) && stateMapping !== undefined) {
    return stateMapping;
  }

  if (status !== DreameStatus.Unknown && statusMapping !== undefined) {
    return statusMapping;
  }

  if (stateMapping !== undefined) {
    return stateMapping;
  }

  if (state > 0 && state !== DreameState.Idle && state !== DreameState.Sleeping && state !== DreameState.Dormant) {
    return RvcOperationalStateId.Running;
  }

  return RvcOperationalStateId.Docked;
}

/**
 * Map Dreame error code to Matter RVC operational error.
 * Error codes 43-99 are device-specific status codes and not treated as errors.
 */
export function getOperationalErrorFromDreame(errorCode: DreameErrorCode): number | null {
  if (errorCode === DreameErrorCode.None) {
    return null;
  }

  if (errorCode in dreameErrorToOperationalError) {
    return dreameErrorToOperationalError[errorCode] ?? null;
  }

  // Unknown codes 1-42 and 100+ are real errors; 43-99 are device-specific status codes
  const code = errorCode as number;
  if ((code >= 1 && code <= 42) || code >= 100) {
    return RvcOperationalErrorId.UnableToCompleteOperation;
  }

  return null;
}
