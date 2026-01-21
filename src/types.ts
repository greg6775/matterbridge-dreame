/**
 * TypeScript types and interfaces for the Matterbridge Dreame plugin.
 *
 * @file types.ts
 * @license Apache-2.0
 */

// Configuration types
export interface DreameConfig {
  username: string;
  password: string;
  country: DreameCountry;
  refreshInterval?: number;
  unregisterOnShutdown?: boolean;
}

export type DreameCountry = 'cn' | 'eu' | 'us' | 'sg' | 'ru' | 'in';

// Authentication types
export interface AuthResult {
  success: boolean;
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  error?: string;
}

export interface CloudSession {
  token: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  country: DreameCountry;
  mqttKey?: string;
}

// Device types
export interface DreameDevice {
  did: string;
  name: string;
  model: string;
  mac: string;
  localIp?: string;
  token?: string;
  online: boolean;
  ownerId: string;
  bindDomain?: string;
  property?: string;
}

export interface DeviceStatus {
  state: DreameState;
  status: DreameStatus;
  battery: number;
  fanSpeed: DreameFanSpeed;
  waterFlow: DreameWaterFlow;
  errorCode: DreameErrorCode;
  currentArea?: number;
  cleaningTime?: number;
  cleanedArea?: number;
  // Accessory status
  waterTankInstalled?: boolean; // Water tank attached
  mopPadInstalled?: boolean; // Mop pad attached
  // Dock/base station status
  dustCollectionStatus?: number; // Auto-empty base status
  cleanWaterTankStatus?: number; // Clean water tank level/status
  dirtyWaterTankStatus?: number; // Dirty water tank level/status
}

// Room types
export interface RoomInfo {
  id: number;
  name: string;
  floorId?: number;
  icon?: string;
}

// Device state enums (siid=2 piid=1 operatingMode)
export enum DreameState {
  Unknown = -1,
  Idle = 0,
  Paused = 1,
  Cleaning = 2,
  GoCharging = 3,
  Error = 4,
  Mopping = 5,
  Charging = 6,
  Drying = 7,
  Dormant = 8, // Standby/sleep state after operation
  Washing = 9, // Self-washing mop pads at dock
  Returning = 10, // Returning to dock
  Defecating = 11, // Emptying dustbin to base station
  Building = 12, // Building/mapping
  ManualCleaning = 13,
  Sleeping = 14,
  WaitingForTask = 15, // Waiting for scheduled task
  StationPaused = 16, // Station operation paused
  ManualPaused = 17,
  ZonedPaused = 18, // Zoned cleaning paused
  ZonedCleaning = 19,
  SpotCleaning = 20, // Spot cleaning
  FastMapping = 21, // Fast mapping mode
  CruiseWaiting = 22, // Cruise mode waiting
  CruiseRunning = 23, // Cruise mode active
  // Extended states (24+)
  SecondCleaning = 24, // Second pass cleaning
  HumanFollowing = 25, // Human/pet following mode
  SpotCleaningPaused = 26,
  ReturningAutoEmpty = 27, // Returning for auto-empty
  CleaningAutoEmpty = 28, // Cleaning then auto-empty
  StationCleaning = 29, // Station self-cleaning
  ReturningToDrain = 30, // Returning to drain dirty water
  Draining = 31, // Draining dirty water
  AutoWaterDraining = 32, // Automatic water draining
  Emptying = 33, // Emptying dust bin
  DustBagDrying = 34, // Drying dust bag
  DustBagDryingPaused = 35,
  HeadingToExtraCleaning = 36, // Going to extra cleaning spot
  ExtraCleaning = 37, // Extra cleaning mode
  // High-value states (95+)
  FindingPetPaused = 95,
  FindingPet = 96, // Pet finding/tracking mode
  Shortcut = 97, // Executing shortcut
  Monitoring = 98, // Monitoring/patrol mode
  MonitoringPaused = 99,
  InitialDeepCleaning = 101,
  InitialDeepCleaningPaused = 102,
  Sanitizing = 103, // Sanitizing mode
  SanitizingWithDry = 104, // Sanitizing with drying
}

// Device status enums (siid=4 piid=1 deviceStatus)
export enum DreameStatus {
  Unknown = -1,
  Idle = 0,
  Paused = 1,
  Cleaning = 2,
  BackHome = 3,
  PartCleaning = 4,
  FollowWall = 5,
  Charging = 6,
  OTA = 7, // Over-the-air update
  FCT = 8, // Factory test
  WifiSet = 9,
  PowerOff = 10,
  Factory = 11,
  Error = 12,
  RemoteControl = 13,
  Sleeping = 14,
  SelfRepair = 15,
  FactoryTest = 16,
  Standby = 17,
  SegmentCleaning = 18, // Room/segment cleaning
  ZoneCleaning = 19, // Zone cleaning
  SpotCleaning = 20, // Spot cleaning
  FastMapping = 21, // Fast mapping mode
  CruisingPath = 22, // Path cruising
  CruisingPoint = 23, // Point cruising
  SummonClean = 24, // Summon cleaning
  Shortcut = 25, // Shortcut execution
  PersonFollow = 26, // Person following
  WaterCheck = 27,
  // Dock operations (higher values)
  Sweeping = 101, // Legacy sweeping status
  Mopping = 102, // Legacy mopping status
  SweepingAndMopping = 103, // Vacuum and mop
  Drying = 104, // Drying mop pads
  Washing = 105, // Washing mop pads
  ReturningWashing = 106, // Returning to wash
  Building = 107, // Building map
  ChargingComplete = 108,
  Upgrading = 109,
  CleanSummarizing = 110, // Clean summary
  StationReset = 111, // Station reset
  ReturningDrain = 112, // Returning to drain
  SelfRepairing = 113, // Self-repair mode
  SelfWashing = 114, // Self washing
  BackWashing = 115, // Back washing
  SelfRefresh = 116, // Self refresh
  SelfDrying = 117, // Self drying
  WaterCheckStart = 118,
  WaterDraining = 119,
  DryingStart = 120,
  AutoEmptying = 121, // Auto emptying dust
  FillingWater = 122, // Filling water tank
}

export enum DreameFanSpeed {
  Quiet = 0,
  Standard = 1,
  Strong = 2,
  Turbo = 3,
}

export enum DreameWaterFlow {
  Low = 1,
  Medium = 2,
  High = 3,
}

export enum DreameErrorCode {
  None = 0,
  Drop = 1,
  Cliff = 2,
  Bumper = 3,
  Gesture = 4,
  BumperRepeat = 5,
  DropRepeat = 6,
  OpticalFlow = 7,
  NoBox = 8, // Dust bin missing
  NoTankBox = 9, // Water tank missing
  WaterBoxEmpty = 10,
  BoxFull = 11, // Dust bin full
  Brush = 12, // Main brush jammed
  SideBrush = 13, // Side brush jammed
  Fan = 14,
  LeftWheelMotor = 15,
  RightWheelMotor = 16,
  TurnSuffocate = 17, // Stuck turning
  ForwardSuffocate = 18, // Stuck moving forward
  ChargerGet = 19, // Failed to find charger
  BatteryLow = 20,
  ChargeFault = 21,
  BatteryPercentage = 22,
  Heart = 23,
  CameraOcclusion = 24, // Camera/sensor blocked
  CameraFault = 25,
  EventBattery = 26,
  ForwardLooking = 27,
  Gyroscope = 28,
  // Extended error codes
  WheelJammed = 29, // Wheels jammed
  DirtyTankFull = 30, // Dirty water tank full
  DirtyTankMissing = 31, // Dirty water tank not installed
  WaterTankLidOpen = 32,
  MopPadMissing = 33, // Mop cleaning pad not installed
  FilterBlocked = 34, // Filter needs cleaning
  StationDisconnected = 35, // Base station disconnected
  NavigationBlocked = 36, // Navigation sensor obstructed
  CannotReachArea = 37, // Cannot reach target area
  DustBagFull = 38, // Dust bag full (in base station)
  DustBagMissing = 39, // Dust bag not installed
  WaterPump = 40, // Water pump malfunction
  CleanTankMissing = 41, // Clean water tank missing
  LidarBlocked = 42, // LiDAR sensor blocked
  // High-value error codes
  RouteBlocked = 100, // Route to area blocked
  MainBrushJammed = 101,
  SideBrushJammed = 102,
  FilterClogged = 103,
  DustBinNotInstalled = 104,
  StationWaterEmpty = 105,
  StationWaterDirty = 106,
  StationDustFull = 107,
  ReturnFailed = 1000, // Failed to return to charger
}

// MIOT property types
export interface MiotProperty {
  siid: number;
  piid: number;
  value?: unknown;
}

export interface MiotAction {
  siid: number;
  aiid: number;
  in?: unknown[];
}
