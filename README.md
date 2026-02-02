# matterbridge-dreame

[![npm version](https://img.shields.io/npm/v/matterbridge-dreame.svg)](https://www.npmjs.com/package/matterbridge-dreame)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-dreame.svg)](https://www.npmjs.com/package/matterbridge-dreame)
[![powered by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)

A [Matterbridge](https://github.com/Luligu/matterbridge) plugin that exposes Dreame robot vacuums as Matter 1.4 RVC (Robotic Vacuum Cleaner) devices.

## Features

- **Matter 1.4 RVC Support** - Full compliance with the Matter Robotic Vacuum Cleaner device type
- **Cloud Integration** - Connects to Dreame Cloud for device discovery and control
- **Real-time Updates** - MQTT-based real-time status updates from your vacuum
- **Room Cleaning** - Select specific rooms/segments to clean via Matter Service Area cluster
- **Multiple Cleaning Modes** - Vacuum, Mop, Vacuum+Mop with adjustable suction and water levels
- **Multi-region Support** - Works with CN, EU, US, SG, RU, and IN regions

## Supported Devices

All Dreame robot vacuums (`dreame.vacuum.*` models) should be supported, but only the **Dreame Matrix10 Ultra** has been tested. If you have a different model and it works (or doesn't), please open an issue to let me know!

## Matter Clusters Exposed

| Cluster                   | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| **RVC Operational State** | Start, pause, resume, go home, error states                   |
| **RVC Run Mode**          | Idle, Cleaning, Mapping modes                                 |
| **RVC Clean Mode**        | Vacuum/Mop/Both, suction levels (Quiet/Standard/Strong/Turbo) |
| **Service Area**          | Room selection for targeted cleaning                          |
| **Power Source**          | Battery level and charging state                              |
| **Identify**              | Locate your vacuum (plays a sound)                            |

## Installation

### Using Matterbridge UI

1. Open the Matterbridge web interface
2. Go to "Install plugins"
3. Search for `matterbridge-dreame`
4. Click Install

### Using npm

```bash
npm install -g matterbridge-dreame
matterbridge -add matterbridge-dreame
```

## Configuration

Configure the plugin through the Matterbridge UI or edit the config file directly:

```json
{
  "name": "matterbridge-dreame",
  "type": "DynamicPlatform",
  "username": "your-dreame-email",
  "password": "your-dreame-password",
  "country": "eu",
  "refreshInterval": 120,
  "unregisterOnShutdown": false
}
```

### Configuration Options

| Option                 | Type    | Default  | Description                                   |
| ---------------------- | ------- | -------- | --------------------------------------------- |
| `username`             | string  | required | Your Dreame account email                     |
| `password`             | string  | required | Your Dreame account password                  |
| `country`              | string  | required | Region: `cn`, `eu`, `us`, `sg`, `ru`, or `in` |
| `refreshInterval`      | number  | `120`    | Polling interval in seconds (minimum 30)      |
| `unregisterOnShutdown` | boolean | `false`  | Unregister devices when plugin stops          |

## Usage

Once configured and paired with a Matter controller (Apple Home, Google Home, Amazon Alexa, Home Assistant, etc.), you can:

- **Start/Stop/Pause cleaning** - Control vacuum operation
- **Send to dock** - Return vacuum to charging station
- **Select rooms** - Choose specific rooms to clean
- **Change cleaning mode** - Switch between vacuum, mop, or both
- **Adjust suction** - Set fan speed (Quiet, Standard, Strong, Turbo)
- **Monitor battery** - View charge level and charging status
- **Locate vacuum** - Make it play a sound

## Adaptive Polling

The plugin uses intelligent polling to balance responsiveness with efficiency:

- **Active states** (cleaning, returning, etc.): 15-second polling
- **Idle states** (docked, charging): Uses configured `refreshInterval`
- **MQTT updates**: Real-time status changes when available

## Credits

- [Matterbridge](https://github.com/Luligu/matterbridge) by Luligu
- [ioBroker.dreame](https://github.com/TA2k/ioBroker.dreame) by TA2k
- [dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) by Tasshack
